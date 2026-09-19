// 统一路由层 —— 声明式注册，加一个功能只需加一个端点文件。
//
// 设计目标：同一套核心引擎同时以三种形态对外复用
//   1) HTTP API（本文件）—— 可被任何语言、任何流水线调用
//   2) CLI（bin/ca.mjs）—— 可挂进 CI
//   3) Web 界面（public/）    —— 给人看
// 三者共用 src/core 与 src/agents，不重复实现。

import { RefactorError, assertNoSecrets } from '../refactor/safety.js';
import mine from './endpoints/mine.js';
import excavate from './endpoints/excavate.js';
import narrate from './endpoints/narrate.js';
import hypothesize from './endpoints/hypothesize.js';
import appraise from './endpoints/appraise.js';
import refactor from './endpoints/refactor.js';
import health from './endpoints/health.js';

/** 自描述能力清单：让调用方（人或 agent）能自己发现有哪些接口、怎么调。
 *  注意它必须在 ENDPOINTS 之前定义 —— ENDPOINTS 里会引用到它。 */
const capabilities = {
  method: 'GET',
  path: '/api/capabilities',
  summary: '列出全部可用能力及其参数、示例。调用方据此自行发现接口，无需外部文档。',
  params: [],
  auth: 'none',
  handler: async ({ origin }) => ({
    name: 'code-archaeology',
    version: '0.1.0',
    description: '代码考古学 —— 从提交历史重建代码的决策史。先做信噪分离，再挖人类决策痕迹。',
    origin,
    endpoints: ENDPOINTS.map((e) => ({
      method: e.method,
      path: e.path,
      summary: e.summary,
      params: e.params,
      auth: e.auth ?? 'none',
      requiresModel: Boolean(e.requiresModel),
      example: e.example ?? null,
    })),
    reuse: {
      http: '本清单即接口契约，可直接被脚本或 agent 消费',
      cli: 'node bin/ca.mjs mine --repo=chalk/chalk --limit=40',
    },
  }),
};

/** 所有已注册能力。能力清单文档由这份列表自动生成，不会和实现脱节。 */
export const ENDPOINTS = [health, capabilities, mine, excavate, narrate, hypothesize, appraise, refactor];

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-GitHub-Token',
  'Access-Control-Max-Age': '86400',
};

const json = (data, status = 200) =>
  new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS },
  });

function matchRoute(pathname) {
  return ENDPOINTS.find((e) => e.path === pathname) ?? null;
}

/**
 * 统一的请求处理：解析参数 → 校验 → 执行 → 错误包装。
 * 任何端点抛错都会被翻译成结构化的 JSON 错误，附带 code 与 suggestion，
 * 便于调用方（尤其是自动化流水线）自己决定如何降级。
 */
export async function handle(request, env) {
  const url = new URL(request.url);
  const origin = url.origin;

  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

  const endpoint = matchRoute(url.pathname);
  if (!endpoint) {
    return json(
      {
        error: 'not_found',
        message: `没有这个接口：${url.pathname}`,
        suggestion: '调用 GET /api/capabilities 查看全部可用能力',
      },
      404
    );
  }

  if (endpoint.method === 'POST' && request.method !== 'POST') {
    return json({ error: 'method_not_allowed', message: `${endpoint.path} 只接受 POST` }, 405);
  }
  if (endpoint.method === 'GET' && request.method !== 'GET' && request.method !== 'POST') {
    return json({ error: 'method_not_allowed', message: `${endpoint.path} 只接受 GET` }, 405);
  }

  // 参数来源：GET 取 query，POST 取 JSON body。两条路径共用同一套校验。
  let raw = {};
  if (request.method === 'GET') {
    raw = Object.fromEntries(url.searchParams.entries());
  } else if (request.method === 'POST') {
    const ct = request.headers.get('content-type') ?? '';
    if (ct.includes('application/json')) {
      try {
        if (endpoint.path === '/api/refactor') {
          const reader = request.body?.getReader();
          let size = 0, text = '';
          const decoder = new TextDecoder();
          if (reader) {
            while (true) {
              const { value, done } = await reader.read();
              if (done) break;
              size += value.byteLength;
              if (size > 160000) { await reader.cancel(); return json({ error: 'payload_too_large', message: '请求体超过160KB。' }, 413); }
              text += decoder.decode(value, { stream: true });
            }
          }
          raw = JSON.parse(text + decoder.decode());
        } else raw = await request.json();
      } catch {
        return json({ error: 'bad_request', message: '请求体不是合法 JSON' }, 400);
      }
    } else {
      if (endpoint.path === '/api/refactor') return json({ error: 'unsupported_media_type', message: '重构请求必须使用 application/json。' }, 415);
      raw = Object.fromEntries(url.searchParams.entries());
    }
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return json({ error: 'bad_request', message: '请求必须为 JSON 对象。' }, 400);

  // 允许通过请求头传入 GitHub Token，方便调用方自带凭据、不占用服务端配额
  const headerToken = request.headers.get('x-github-token') ?? undefined;

  // 参数存在性判定：空字符串、null、undefined 都算未提供；
  // 对象与数组只要给了就算提供（report 这类结构化入参走这条）。
  const provided = (name) => {
    const v = raw[name];
    if (v === undefined || v === null) return false;
    if (typeof v === 'string') return v.trim() !== '';
    return true;
  };

  const missing = (endpoint.params ?? [])
    .filter((p) => {
      if (!p.required) return false;
      // 条件必需：requiredUnless 指定的字段一旦提供，本字段即可省略
      if (p.requiredUnless && provided(p.requiredUnless)) return false;
      return !provided(p.name);
    })
    .map((p) => p.name);
  if (missing.length) {
    return json(
      {
        error: 'missing_params',
        message: `缺少必需参数：${missing.join('、')}`,
        expected: endpoint.params,
        example: endpoint.example,
      },
      400
    );
  }

  try {
    const result = await endpoint.handler({
      params: raw,
      env,
      origin,
      token: endpoint.path === '/api/refactor' ? headerToken : env?.GITHUB_TOKEN || headerToken,
      // 进度回调：HTTP 场景下无法流式回传，交给调用方按需覆盖
      onProgress: () => {},
    });
    return json({ ok: true, endpoint: endpoint.path, data: result });
  } catch (e) {
    const upstreamMessages = {
      github_unavailable: 'GitHub 上游暂时不可用。',
      upstream_error: 'GitHub 上游请求失败。',
      upstream_unreachable: '无法连接 GitHub 上游。',
      upstream_timeout: 'GitHub 上游请求超时，未自动重试写入。',
      unsafe_redirect: 'GitHub 返回跳转，已拒绝跟随。',
    };
    const code =
      e.status === 404 ? 'upstream_not_found' : e.status === 401 ? 'auth_failed' : e.code ?? 'engine_error';
    const status = Number.isInteger(e.status) && e.status >= 400 && e.status <= 599 ? e.status : e.code === 'model_unavailable' ? 503 : 500;
    const rawMessage = upstreamMessages[e.code] || e.message || '请求处理失败。';
    const message = headerToken ? rawMessage.split(headerToken).join('[REDACTED]') : rawMessage;
    return json(
      {
        error: code,
        message,
        suggestion:
          e.status === 404
            ? '确认仓库是公开的，或检查 owner/name 拼写'
            : e.code === 'model_unavailable'
              ? '该能力需要配置模型凭据，请改用不依赖模型的 /api/mine'
              : '可稍后重试，或改用 /api/mine 获取纯计算指标',
      },
      status
    );
  }
}
