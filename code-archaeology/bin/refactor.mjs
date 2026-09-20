#!/usr/bin/env node
// 安全重构 · CLI / HTTP 客户端（与 Web 端共用同一套 /api/refactor 契约）。
//
// 安全约束（来自赛道要求，逐条落地）：
//   · 不自动借用 Keychain / 站点 GITHUB_TOKEN —— Token 只来自进程环境变量 CA_GITHUB_TOKEN；
//   · --api 只允许本地 http（localhost / 127.0.0.1 / [::1]）或 https；携带 userinfo / query / hash 一律拒绝；
//   · patch 落盘时，change.diff 与 review.json 都用 wx 强制不覆盖；review.json 权限 0600 从 open 创建开始；
//   · pr 必须先 --confirm（strict true / --confirm / --confirm=true），并校验「磁盘 diff 摘要 == review.json digest == --reviewed-digest」，
//     且必须有 CA_GITHUB_TOKEN、review.prEligible 为 true、reviewToken 形状有效，三者一致才放行；
//   · 显式输出说明：reviewToken / 确认不代表自动授权本轮创建 PR，本轮仍需显式 --confirm 且 digest 一致；
//   · 网络：180s 超时、reject redirects（manual + 显式拒绝 3xx）、错误响应绝不回显凭据。
//
// 本模块所有网络与文件操作都可注入（fetchImpl / fs），因此测试可完全离线、无副作用。

import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { safeRepo, safePath, assertNoSecrets } from '../src/refactor/safety.js';

export const DEFAULT_API = 'http://127.0.0.1:8787';
export const REQUEST_TIMEOUT_MS = 180_000;
// 与 src/refactor/service.js 的 verifyReviewToken 保持同一形状：base64 payload + '.' + 64 位 hex 签名
export const REVIEW_TOKEN_RE = /^[A-Za-z0-9+/]+=*\.[a-f0-9]{64}$/;

/* ── 参数解析（与 ca.mjs 同款：--key=value 或 --key） ─────── */

export function parseArgs(argv) {
  const flags = {};
  const rest = [];
  for (const a of argv) {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/);
    if (m) flags[m[1]] = m[2] === undefined ? true : m[2];
    else rest.push(a);
  }
  return { flags, rest };
}

/* ── --confirm 严格解析 ────────────────────────────
 * 仅 --confirm（无值）、--confirm=true 视为授权；
 * --confirm=false 或其它任意值一律视为「未授权」。 */
export function parseConfirm(flags) {
  const v = flags.confirm;
  return v === true || v === 'true';
}

/* ── 端点安全校验 ───────────────────────────────── */

/** 拒绝携带 userinfo / query / hash 的地址；http 仅允许本地，其余必须 https。 */
export function assertSafeEndpoint(urlStr) {
  let u;
  try {
    u = new URL(urlStr);
  } catch {
    throw new Error(`API 地址无法解析：${urlStr}`);
  }
  if (u.username || u.password) {
    throw new Error('API 地址不能包含用户名/密码（userinfo）—— 请勿在 URL 里嵌入凭据');
  }
  if (u.search) {
    throw new Error('API 地址不能包含查询参数（query）');
  }
  if (u.hash) {
    throw new Error('API 地址不能包含片段（hash）');
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw new Error('API 仅支持 http(s)');
  }
  if (u.protocol === 'http:') {
    // 明文 http 仅允许回环地址（localhost / 127.0.0.1 / [::1]）
    const h = u.hostname.replace(/^\[|\]$/g, ''); // 去掉 IPv6 方括号
    const local = h === 'localhost' || h === '127.0.0.1' || h === '::1';
    if (!local) {
      throw new Error('明文 http 仅允许本地端点（localhost / 127.0.0.1 / [::1]），远程请改用 https');
    }
  }
  return u;
}

/* ── 摘要 ─────────────────────────────────────── */

export function digestText(text) {
  return createHash('sha256').update(text ?? '', 'utf8').digest('hex');
}

/* ── 安全写文件（wx 不覆盖 + 权限从 open 起生效 + 失败安全关闭） ── */

async function writeSafeFile(file, content, { fs, mode = 0o644, wx = false } = {}) {
  const f = fs ?? (await import('node:fs/promises'));
  // 权限在 open 时即生效，避免「先建文件后 chmod」留下的短窗口；
  // wx 保证文件已存在时抛 EEXIST，绝不静默覆盖。
  const fh = await f.open(file, wx ? 'wx' : 'w', mode);
  try {
    await fh.writeFile(content);
  } finally {
    await fh.close();
  }
}

/* ── 与 /api/refactor 通信 ───────────────────────────── */

async function callApi({ api, body, token, fetchImpl, signal }) {
  const base = assertSafeEndpoint(api);
  const url = new URL('/api/refactor', base);
  const headers = { 'Content-Type': 'application/json' };
  // token 只走 X-GitHub-Token 头，不进 URL、不进 body、不进日志
  if (token) headers['X-GitHub-Token'] = token;

  const doFetch = fetchImpl ?? globalThis.fetch;
  if (!doFetch) throw new Error('当前环境没有可用的 fetch');

  const res = await doFetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: signal ?? AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    // manual 禁止自动跟随；下面先拒绝 3xx，不读取其响应体或 Location。
    redirect: 'manual',
  });
  if (res.status >= 300 && res.status < 400) {
    throw new Error('服务返回重定向，已拒绝跟随以保护调用者凭据。');
  }

  let payload;
  try {
    payload = await res.json();
  } catch {
    throw new Error(`服务返回了非 JSON 响应（HTTP ${res.status}）`);
  }
  if (!res.ok || payload.error) {
    // 错误响应绝不回显凭据：把 token 从消息里抹掉
    let msg = (payload && payload.message) || `请求失败（HTTP ${res.status}）`;
    if (token) msg = msg.split(token).join('[REDACTED]');
    throw new Error(msg);
  }
  return payload.data;
}

export async function fetchRefactorPatch({ api, repo, limit = 40, path = null, token = '', fetchImpl }) {
  // 共享契约：patch 默认 params {repo, mode:'patch', limit:40}，path 可选；
  // path 为 null 时省略该字段（后端不接受 path:null）。
  const body = { repo, mode: 'patch', limit };
  if (path != null) body.path = path;
  return callApi({ api, token, fetchImpl, body });
}

export async function fetchRefactorPr({ api, repo, token = '', reviewToken, reviewedDigest, diff, fetchImpl }) {
  return callApi({
    api,
    token,
    fetchImpl,
    body: { repo, mode: 'pr', confirm: true, reviewedDigest, reviewToken, diff },
  });
}

/* ── 返回数据校验（patch 端） ──────────────────────
 * 校验 diff 摘要 / 安全字段齐全，且响应绝不包含 token / 密钥。 */
function validatePatchData(data) {
  if (!data || typeof data !== 'object') {
    throw new Error('服务返回的 patch 数据格式异常');
  }
  if (typeof data.diff !== 'string' || data.diff.length === 0) {
    throw new Error('服务未返回有效的 diff 内容');
  }
  if (typeof data.digest !== 'string' || data.digest.length === 0) {
    throw new Error('服务未返回 diff 摘要（digest），无法安全审阅');
  }
  for (const k of Object.keys(data)) {
    if (/^(token|secret|api[_-]?key|password|authorization)$/i.test(k)) {
      throw new Error(`服务响应包含不应出现的敏感字段：${k}`);
    }
  }
  return data;
}

/* ── patch 子命令 ───────────────────────────────── */

export async function runPatch({ api, repo, limit = 40, path = null, out = 'change.diff', reviewOut = 'review.json', token = '', fs, fetchImpl = null } = {}) {
  if (!repo) throw new Error('patch 需要 repo（--repo=owner/name）');
  // patch 与 review 不应指向同一文件，否则 wx 相互覆盖语义混乱
  if (resolve(out) === resolve(reviewOut)) throw new Error('输出文件 --out 与 --review-out 不能相同');
  safeRepo(repo);
  if (path != null) safePath(path);

  const raw = await fetchRefactorPatch({ api, repo, limit, path, token, fs, fetchImpl });
  const data = validatePatchData(raw);

  assertNoSecrets(JSON.stringify(data), [token]);
  if (digestText(data.diff) !== data.digest) throw new Error('服务返回的 diff 与摘要不一致');
  if (safeRepo(data.repo) !== safeRepo(repo)) throw new Error('服务返回的仓库不一致');
  safePath(data.file);
  if (!/^[a-f0-9]{40}$/.test(data.baseSha) || !Number.isInteger(data.changedLines) || data.changedLines < 1 || data.changedLines > 100) throw new Error('服务返回的基础提交或改动规模非法');
  if (data.prEligible === true && !REVIEW_TOKEN_RE.test(data.reviewToken || '')) throw new Error('审阅凭证形状无效');

  // 1) diff 落盘；同样使用私有权限，避免私有仓库源码向本机其他用户公开
  await writeSafeFile(out, data.diff, { fs, mode: 0o600, wx: true });

  // 2) review.json：记录审阅所需的一切，但绝不写入 token；0600 + wx 从 open 起生效
  const review = {
    mode: 'patch',
    repo,
    baseSha: data.baseSha ?? null,
    baseBranch: data.baseBranch ?? null,
    digest: data.digest,
    changedLines: data.changedLines ?? null,
    reviewToken: data.reviewToken ?? null,
    prEligible: data.prEligible ?? false,
    expiresAt: data.expiresAt ?? null,
    warnings: data.warnings ?? [],
    evidence: data.evidence ?? null,
    savedAt: new Date().toISOString(),
  };
  await writeSafeFile(reviewOut, JSON.stringify(review, null, 2), { fs, mode: 0o600, wx: true });

  return { out, reviewOut, data, review };
}

/* ── pr 子命令 ─────────────────────────────────── */

export async function runPr({ api, repo = null, review, diff, reviewedDigest, confirm = false, token = '', fs, fetchImpl = null } = {}) {
  if (!review || !diff) throw new Error('pr 需要 --review=review.json 和 --diff=change.diff');
  if (!reviewedDigest) throw new Error('pr 需要 --reviewed-digest=<你看过并确认的 digest>');
  // 严格确认：仅接受布尔值 true（const confirm === true）。'false'/'true' 字符串、1 等一律拒绝。
  if (confirm !== true) throw new Error('创建 PR 需要显式 --confirm（这是对「本轮创建」的明确授权）');

  const f = fs ?? (await import('node:fs/promises'));

  let reviewJson;
  try {
    reviewJson = JSON.parse(await f.readFile(review, 'utf8'));
  } catch (e) {
    throw new Error(`无法读取 ${review}：${e.message}`);
  }

  // 可选交叉校验：命令行 --repo 与 review.json 记录不一致则拒绝
  if (repo && reviewJson.repo && repo !== reviewJson.repo) {
    throw new Error(`命令行 --repo=${repo} 与 ${review} 中记录的 repo=${reviewJson.repo} 不一致`);
  }
  const effectiveRepo = reviewJson.repo ?? repo;
  safeRepo(effectiveRepo);
  if (!effectiveRepo) throw new Error('无法确定目标仓库（review.json 缺 repo 且无 --repo）');
  if (!resolve(review) || !resolve(diff)) throw new Error('审阅文件路径非法');

  // 读取磁盘上的 diff，独立计算摘要做一致性校验
  let diffText;
  try {
    diffText = await f.readFile(diff, 'utf8');
  } catch (e) {
    throw new Error(`无法读取 ${diff}：${e.message}`);
  }
  const fileDigest = digestText(diffText);

  if (fileDigest !== reviewedDigest) {
    throw new Error('磁盘上 diff 的摘要与 --reviewed-digest 不一致，补丁可能已被改动，已拒绝创建 PR');
  }
  if (reviewJson.digest && fileDigest !== reviewJson.digest) {
    throw new Error('磁盘上 diff 的摘要与 review.json 记录的 digest 不一致，已拒绝创建 PR');
  }

  // 安全门槛：仅读取 CA_GITHUB_TOKEN（绝不读 GITHUB_TOKEN / .dev.vars / Keychain）
  if (!token) {
    throw new Error('创建 PR 需要 CA_GITHUB_TOKEN 环境变量已设置（仅读取该变量，绝不借用 GITHUB_TOKEN / .dev.vars / Keychain）');
  }
  if (reviewJson.prEligible !== true) {
    throw new Error('该审阅凭证未授权创建 PR（review.prEligible 不为 true），已拒绝');
  }
  if (typeof reviewJson.reviewToken !== 'string' || !REVIEW_TOKEN_RE.test(reviewJson.reviewToken)) {
    throw new Error('审阅凭证中的 reviewToken 形状无效，已拒绝创建 PR');
  }

  const result = await fetchRefactorPr({
    api,
    repo: effectiveRepo,
    token,
    reviewToken: reviewJson.reviewToken,
    reviewedDigest,
    diff: diffText,
    fetchImpl,
  });

  const disclosure =
    '注意：reviewToken / 确认仅代表您已审阅该 diff，不代表自动授权本轮创建 PR；创建需本命令显式 --confirm 且 digest 一致。';

  return { result, reviewJson, fileDigest, disclosure, repo: effectiveRepo };
}

/* ── 帮助 ─────────────────────────────────────── */

function printHelp() {
  line();
  line(C.b('code-archaeology · 安全重构 refactor'));
  line();
  line(C.cyan('用法'));
  line('  node bin/ca.mjs refactor patch --repo=owner/name [--path=src/x.js] [--limit=40] \\');
  line('      [--api=http://127.0.0.1:8787] [--out=change.diff] [--review-out=review.json]');
  line('  node bin/ca.mjs refactor pr --review=review.json --diff=change.diff \\');
  line('      --reviewed-digest=<digest> --confirm');
  line();
  line(C.cyan('说明'));
  line('  patch 生成安全补丁：change.diff 与 review.json 均用 wx 不覆盖落盘，');
  line('        review.json 权限 0600，不含 GitHub Token/模型密钥（含短期审阅凭证）。');
  line('  pr   创建草稿 PR：必须显式 --confirm，且磁盘 diff 摘要 == review.json digest == --reviewed-digest，');
  line('        同时要求 CA_GITHUB_TOKEN 已设置、review.prEligible 为 true、reviewToken 形状有效。');
  line('  Token 仅来自环境变量 CA_GITHUB_TOKEN，绝不读取 GITHUB_TOKEN / .dev.vars / Keychain。');
  line('  --confirm=false 与任何非授权写法都视为未授权，不会创建 PR。');
  line();
}

/* ── CLI 入口（供 ca.mjs 在 loadEnv 之前委派，或单独执行） ── */

const C = {
  b: (s) => `\x1b[1m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  cyan: (s) => `\x1b[36m${s}\x1b[0m`,
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
};
const line = (s = '') => process.stdout.write(s + '\n');

export async function runRefactorCommand(argv, { exit = process.exit, fetchImpl = null, fs = null } = {}) {
  const { flags, rest } = parseArgs(argv);
  if (flags.help || rest[0] === 'help') {
    printHelp();
    exit(0);
    return;
  }
  const sub = rest[0] ?? 'patch';
  if (!['patch', 'pr'].includes(sub)) {
    line(C.red(`未知 refactor 子命令：${sub}（可用 patch | pr）`));
    printHelp();
    exit(2);
    return;
  }

  // Token 只来自 CA_GITHUB_TOKEN —— 不读 GITHUB_TOKEN，也不向 Keychain 借用
  const token = process.env.CA_GITHUB_TOKEN ?? '';
  const api = flags.api ?? DEFAULT_API;
  const fsMod = fs ?? (await import('node:fs/promises'));

  if (sub === 'patch') {
    const res = await runPatch({
      api,
      repo: flags.repo,
      limit: flags.limit != null ? Number(flags.limit) : 40,
      path: flags.path ?? null,
      out: flags.out ?? 'change.diff',
      reviewOut: flags['review-out'] ?? 'review.json',
      token,
      fs: fsMod,
      fetchImpl,
    });
    const d = res.data;
    line();
    line(C.b('安全重构 · 补丁已生成'));
    line(`  ${C.cyan('diff')}  → ${res.out}  ${C.dim(`(${(d.diff ?? '').length} 字符)`)}`);
    line(`  ${C.cyan('审阅凭证')} → ${res.reviewOut}  ${C.dim('权限 0600 · 不含 GitHub Token/模型密钥（含短期审阅凭证）· 不覆盖已有文件')}`);
    line(`  ${C.cyan('文件')}  ${d.file ?? '?'}  ${C.dim('base ' + (d.baseSha ?? '?').slice(0, 10) + ' @ ' + (d.baseBranch ?? '?'))}`);
    line(`  ${C.cyan('digest')} ${d.digest ?? '?'}`);
    line(`  ${C.cyan('改动')} ${d.changedLines ?? '?'} 行 · ${d.prEligible ? C.green('可创建 PR') : C.yellow('仅可下载（未授权 PR）')}`);
    if (d.warnings?.length) {
      line(`  ${C.yellow('警告')} ` + d.warnings.map((w) => (typeof w === 'string' ? w : w?.message)).join('；'));
    }
    line();
    line(C.dim('请人工审阅 diff。如需创建草稿 PR：'));
    line(
      C.dim(
        `  node bin/ca.mjs refactor pr --review=${res.reviewOut} --diff=${res.out} --confirm` +
          ` --reviewed-digest=${d.digest}`
      )
    );
    line();
    exit(0);
    return;
  }

  // pr
  const res = await runPr({
    api,
    repo: flags.repo ?? null,
    review: flags.review,
    diff: flags.diff,
    reviewedDigest: flags['reviewed-digest'],
    confirm: parseConfirm(flags),
    token,
    fs: fsMod,
    fetchImpl,
  });
  line();
  line(C.yellow(res.disclosure));
  line();
  line(C.b('草稿 PR 已创建'));
  line(`  ${C.cyan('URL')}  ${res.result.url ?? '?'}`);
  line(`  ${C.cyan('编号')} #${res.result.number ?? '?'}`);
  line(`  ${C.cyan('分支')} ${res.result.branch ?? '?'}  ${C.dim('（独立分支 · draft=' + res.result.draft + '）')}`);
  line(`  ${C.cyan('repo')} ${res.repo}  ${C.dim('digest ' + res.fileDigest.slice(0, 12) + '…')}`);
  line();
  exit(0);
  return;
}

// 直接执行（node bin/refactor.mjs ...）时启动；经 ca.mjs 委派时不会触发此分支。
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runRefactorCommand(process.argv.slice(2)).catch((e) => {
    line(C.red(`✗ ${e.message}`));
    process.exit(1);
  });
}
