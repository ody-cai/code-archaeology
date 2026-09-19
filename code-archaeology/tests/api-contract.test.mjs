// 重构 API 契约测试 —— 通过统一路由层 handle() 验证 HTTP 契约：
//   参数校验、状态码映射、错误信封（不泄漏上游/凭据）、CORS、以及 patch/pr 端到端流程。
// 全程注入 fake 依赖，不触网、不读凭据、不创建真实 PR。

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { handle } from '../src/api/router.js';
import { ENDPOINTS } from '../src/api/router.js';
import { RefactorError } from '../src/refactor/safety.js';

/* ── 最小 fake ───────────────────────────────── */

const SIGNING_KEY = 'k'.repeat(40);
const FAKE_SOURCE = 'function compute(x) {\n  return x + 1;\n}\n';
const PATCH_DIFF =
  'diff --git a/src/hot.js b/src/hot.js\n--- a/src/hot.js\n+++ b/src/hot.js\n@@ -1,3 +1,3 @@\n function compute(x) {\n-  return x + 1;\n+  return x + 2;\n }\n';
const FAKE_REPORT = {
  hotspots: [{ file: 'src/hot.js', touches: 20, churn: 200, additions: 120, deletions: 80, net: 40, authors: ['a'], sequence: [{ sha: 'aaa1111', additions: 50, deletions: 10 }] }],
  thrash: [{ file: 'src/hot.js', touches: 20, churn: 200, net: 40, spinRatio: 5, authors: ['a'] }],
};

function makeFakeGithub(opts = {}) {
  const state = { baseSha: 'a'.repeat(40), baseBranch: 'main', canPush: opts.canPush !== false, identityId: 12345, createDraftCalls: 0 };
  return {
    state,
    request: async () => ({}),
    resolveBase: async () => ({ baseSha: state.baseSha, baseBranch: state.baseBranch, canPush: state.canPush }),
    identity: async () => ({ id: state.identityId, login: 'caller' }),
    readSource: async () => ({ source: FAKE_SOURCE, blobSha: 'b'.repeat(40), mode: '100644' }),
    createDraft: async (t) => { state.createDraftCalls++; return { url: `https://github.com/owner/repo/pull/${state.createDraftCalls + 6}`, number: state.createDraftCalls + 6, branch: `refactor/owner-repo-${t.baseSha.slice(0, 12)}`, draft: true }; },
  };
}
function makeFakeChat() {
  return async ({ user }) => { const u = JSON.parse(user); return JSON.stringify({ file: u.file, diff: PATCH_DIFF }); };
}
function makeFakeMine() {
  return async () => FAKE_REPORT;
}

const NOW = () => 1_000_000_000_000;

function makeEnv(extra = {}) {
  return { REFACTOR_SIGNING_KEY: SIGNING_KEY, __REFACTOR_DEPS__: { github: makeFakeGithub(), chat: makeFakeChat(), mine: makeFakeMine() }, ...extra };
}

function post(body, { token, env } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (token) headers['x-github-token'] = token;
  return handle(new Request('http://localhost/api/refactor', { method: 'POST', headers, body: JSON.stringify(body) }), env ?? makeEnv());
}

/* ═══ 端点注册与契约元数据 ═════════════════════ */

test('capabilities 列出 refactor 端点，且 repo 为必需参数', async () => {
  const res = await handle(new Request('http://localhost/api/capabilities', { method: 'GET' }), {});
  assert.equal(res.status, 200);
  const data = await res.json();
  const ep = data.data.endpoints.find((e) => e.path === '/api/refactor');
  assert.ok(ep, '应包含 /api/refactor');
  assert.equal(ep.method, 'POST');
  const repoParam = ep.params.find((p) => p.name === 'repo');
  assert.ok(repoParam && repoParam.required === true);
});

test('refactor 端点已注册到路由表', () => {
  assert.ok(ENDPOINTS.some((e) => e.path === '/api/refactor' && e.method === 'POST'));
});

/* ═══ 参数校验 ═══════════════════════════════ */

test('缺 repo：400 missing_params，带结构化信封', async () => {
  const res = await post({ mode: 'patch' });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.error, 'missing_params');
  assert.match(body.message, /repo/);
  assert.ok(Array.isArray(body.expected));
  assert.ok(body.example);
});

test('invalid repo：400 invalid_repo（不触网）', async () => {
  const res = await post({ repo: 'bad repo!!', mode: 'patch' });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.error, 'invalid_repo');
});

test('invalid mode：400 invalid_mode', async () => {
  const res = await post({ repo: 'owner/repo', mode: 'nuke' });
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error, 'invalid_mode');
});

/* ═══ PR 门禁（无需模型即可触发） ═════════════ */

test('PR 无调用者 token：401 caller_auth_required', async () => {
  const res = await post({ repo: 'owner/repo', mode: 'pr', confirm: true });
  assert.equal(res.status, 401);
  const body = await res.json();
  assert.equal(body.error, 'auth_failed'); // 路由将 401 统一映射
  assert.ok(body.message.includes('Token'));
});

test('PR 缺 confirm：400 confirmation_required', async () => {
  const res = await post({ repo: 'owner/repo', mode: 'pr' }, { token: 'ghp_caller' });
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error, 'confirmation_required');
});

/* ═══ 错误信封不泄漏凭据 / 上游细节 ════════════ */

test('错误响应绝不回显调用者 token', async () => {
  const res = await post({ repo: 'owner/repo', mode: 'pr', confirm: true }, { token: 'ghp_super_secret_token_123' });
  const text = await res.text();
  assert.ok(!text.includes('ghp_super_secret_token_123'));
});

test('上游错误被消毒：适配器不泄漏 GitHub 原始 detail', async () => {
  // 构造一个会抛出含「secret」细节的 GitHub 错误，验证错误信封不含该细节
  const leakingGithub = {
    resolveBase: async () => { throw new RefactorError('github_unavailable', 'internal: repo is SECRET_DETAIL_XYZ', 502); },
  };
  const env = { REFACTOR_SIGNING_KEY: SIGNING_KEY, __REFACTOR_DEPS__: { github: leakingGithub, chat: makeFakeChat(), mine: makeFakeMine() } };
  const res = await post({ repo: 'owner/repo', mode: 'patch' }, { token: 'ghp_caller', env });
  const text = await res.text();
  assert.ok(!text.includes('SECRET_DETAIL_XYZ'), '上游细节不应透传');
});

/* ═══ 端到端 happy path（注入 fake） ════════════ */

test('PATCH 端到端：200 且 data 含可审阅字段', async () => {
  const res = await post({ repo: 'owner/repo', mode: 'patch' }, { token: 'ghp_caller' });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.endpoint, '/api/refactor');
  const d = body.data;
  assert.equal(d.mode, 'patch');
  assert.equal(d.file, 'src/hot.js');
  assert.equal(d.diff, PATCH_DIFF);
  assert.equal(typeof d.reviewToken, 'string');
  assert.equal(d.prEligible, true);
  // 绝不回显 token
  assert.ok(!JSON.stringify(body).includes('ghp_caller'));
  // CORS 头存在
  assert.equal(res.headers.get('access-control-allow-origin'), '*');
  return d;
});

test('PR 端到端：拿 patch 凭证 → 创建草稿 PR，200 含 url', async () => {
  const patchRes = await post({ repo: 'owner/repo', mode: 'patch' }, { token: 'ghp_caller' });
  const patch = await patchRes.json();
  const res = await post(
    { repo: 'owner/repo', mode: 'pr', confirm: true, reviewToken: patch.data.reviewToken, diff: patch.data.diff, reviewedDigest: patch.data.digest },
    { token: 'ghp_caller' }
  );
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.data.mode, 'pr');
  assert.match(body.data.url, /github\.com\/owner\/repo\/pull\//);
});

/* ═══ CORS 预检 ═════════════════════════════ */

test('OPTIONS 预检返回 204 与 CORS 头', async () => {
  const res = await handle(new Request('http://localhost/api/refactor', { method: 'OPTIONS' }), {});
  assert.equal(res.status, 204);
  assert.equal(res.headers.get('access-control-allow-origin'), '*');
  assert.match(res.headers.get('access-control-allow-headers'), /X-GitHub-Token/);
});
