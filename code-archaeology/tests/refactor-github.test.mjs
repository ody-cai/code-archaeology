// 安全重构 GitHub 适配器测试 —— node:test + 模拟 fetch。
// 全程不触网、不读凭据、不创建真实 PR；所有写入路径均由 fake fetch 驱动。
//
// 覆盖：resolveBase / identity / readSource（含 symlink、gitlink、blob 校验、
// 二进制、CR、64KB）/ createDraft（成功、无 token、权限、base 变化、重复去重、
// 并发、上游错误、超时、重定向）。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createGitHub } from '../src/refactor/github.js';

const BASE = 'https://api.github.com';
const HEX = (c = 'a', n = 40) => c.repeat(n);
const TOKEN = 'ghp_caller_token_only';

/* ── 测试用 git blob 工具（与适配器逻辑一致） ── */
function gitBlobSha(text) {
  const bytes = Buffer.from(text, 'utf-8');
  const header = Buffer.from(`blob ${bytes.length}\0`, 'utf-8');
  return createHash('sha1').update(header).update(bytes).digest('hex');
}
const b64 = (text) => Buffer.from(text, 'utf-8').toString('base64');
function refHex(repo, baseSha, file, digest) {
  return createHash('sha256')
    .update(Buffer.from(`${repo}\0${baseSha}\0${file}\0${digest}`, 'utf-8'))
    .digest('hex');
}
const pathOf = (url) => String(url).slice(BASE.length);

// 捕获被拒绝的错误（本 Node 版本的 assert.rejects 不会返回错误对象）。
async function expectReject(fn, regex) {
  let caught;
  await assert.rejects(fn, (e) => { caught = e; return regex ? regex.test(e.message) : true; });
  return caught;
}

/* ── fake fetch：基于路由表，记录所有调用 ── */
function jsonResponse(status, data, headers = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (k) => (headers[String(k).toLowerCase()] ?? null) },
    json: async () => data,
  };
}
function makeFetch(routes, log = []) {
  const fn = async (url, opts = {}) => {
    const u = String(url);
    log.push({ url: u, path: pathOf(u), method: (opts.method || 'GET').toUpperCase(),
      body: opts.body ? JSON.parse(opts.body) : undefined,
      auth: opts.headers && opts.headers.Authorization,
      signal: opts.signal });
    for (const route of routes) {
      if (route.test(pathOf(u), (opts.method || 'GET').toUpperCase(), opts)) {
        return route.handle(pathOf(u), opts);
      }
    }
    return jsonResponse(404, { message: 'not found' });
  };
  fn.log = log;
  return fn;
}
const route = (re, method, data, status = 200) => ({
  test: (p, m) => re.test(p) && m === method,
  handle: () => jsonResponse(status, typeof data === 'function' ? data() : data),
});

/* ═══ resolveBase ═══════════════════════════════ */

test('resolveBase 成功：规范名、push 权限、40hex HEAD', async () => {
  const baseSha = HEX('a');
  const fetchImpl = makeFetch([
    route(/^\/repos\/owner\/repo$/, 'GET', { full_name: 'owner/repo', default_branch: 'main', permissions: { push: true } }),
    route(/^\/repos\/owner\/repo\/git\/refs\/heads\/main$/, 'GET', { object: { sha: baseSha } }),
  ]);
  const gh = createGitHub({ token: TOKEN, fetchImpl });
  const base = await gh.resolveBase('owner/repo');
  assert.strictEqual(base.baseSha, baseSha);
  assert.strictEqual(base.baseBranch, 'main');
  assert.strictEqual(base.canPush, true);
});

test('resolveBase 拒绝规范名不符（疑似更名跳转）', async () => {
  const fetchImpl = makeFetch([
    route(/^\/repos\/owner\/repo$/, 'GET', { full_name: 'newowner/repo', default_branch: 'main', permissions: { push: true } }),
  ]);
  const gh = createGitHub({ token: TOKEN, fetchImpl });
  await assert.rejects(() => gh.resolveBase('owner/repo'), /更名|不一致/);
});

test('resolveBase 拒绝默认分支 HEAD 非 40hex', async () => {
  const fetchImpl = makeFetch([
    route(/^\/repos\/owner\/repo$/, 'GET', { full_name: 'owner/repo', default_branch: 'main', permissions: { push: true } }),
    route(/^\/repos\/owner\/repo\/git\/refs\/heads\/main$/, 'GET', { object: { sha: 'abc' } }),
  ]);
  const gh = createGitHub({ token: TOKEN, fetchImpl });
  await assert.rejects(() => gh.resolveBase('owner/repo'), /40 位/);
});

test('resolveBase 无 push 权限时 canPush 为 false', async () => {
  const fetchImpl = makeFetch([
    route(/^\/repos\/owner\/repo$/, 'GET', { full_name: 'owner/repo', default_branch: 'main' }), // 无 permissions
    route(/^\/repos\/owner\/repo\/git\/refs\/heads\/main$/, 'GET', { object: { sha: HEX('a') } }),
  ]);
  const gh = createGitHub({ token: TOKEN, fetchImpl });
  const base = await gh.resolveBase('owner/repo');
  assert.strictEqual(base.canPush, false);
});

test('resolveBase 上游 500 -> 静态 upstream_error（不复述 message）', async () => {
  const fetchImpl = makeFetch([
    route(/^\/repos\/owner\/repo$/, 'GET', { message: 'SECRET_INTERNAL_DETAIL' }, 500),
  ]);
  const gh = createGitHub({ token: TOKEN, fetchImpl });
  const err = await expectReject(() => gh.resolveBase('owner/repo'));
  assert.strictEqual(err.code, 'upstream_error');
  assert.ok(!err.message.includes('SECRET'));
});

for (const status of [301, 302, 303, 307, 308]) {
  test(`resolveBase 使用 manual 拒绝 ${status}，不跟随也不读响应体`, async () => {
    let calls = 0;
    let reads = 0;
    const gh = createGitHub({ token: TOKEN, fetchImpl: async (_url, opts) => {
      calls++;
      assert.equal(opts.redirect, 'manual');
      return { ok: false, status, json: async () => { reads++; return {}; } };
    } });
    const err = await expectReject(() => gh.resolveBase('owner/repo'));
    assert.equal(err.code, 'unsafe_redirect');
    assert.equal(calls, 1);
    assert.equal(reads, 0);
  });
}

test('request 在边缘兼容的传输中可成功读取 JSON', async () => {
  const gh = createGitHub({ fetchImpl: async (_url, opts) => {
    if (!['manual', 'follow'].includes(opts.redirect)) throw new TypeError('Invalid redirect value');
    assert.equal(opts.redirect, 'manual');
    return jsonResponse(200, { success: true });
  } });
  assert.deepEqual(await gh.request('/test'), { success: true });
});

test('resolveBase 超时 -> upstream_timeout', async () => {
  const slow = (url, opts) => new Promise((_, rej) => {
    if (opts.signal) opts.signal.addEventListener('abort', () => rej(new Error('The operation was aborted')));
  });
  const gh = createGitHub({ token: TOKEN, fetchImpl: slow, timeoutMs: 30 });
  const err = await expectReject(() => gh.resolveBase('owner/repo'));
  assert.strictEqual(err.code, 'upstream_timeout');
});

/* ═══ identity ═════════════════════════════════ */

test('identity 成功返回 {id, login}', async () => {
  const fetchImpl = makeFetch([route(/^\/user$/, 'GET', { id: 12345, login: 'alice' })]);
  const gh = createGitHub({ token: TOKEN, fetchImpl });
  const id = await gh.identity();
  assert.deepStrictEqual(id, { id: 12345, login: 'alice' });
});

test('identity 无 token -> caller_auth_required，且不发起请求', async () => {
  const log = [];
  const fetchImpl = makeFetch([], log);
  const gh = createGitHub({ fetchImpl }); // 无 token
  await assert.rejects(() => gh.identity(), /Token/);
  assert.strictEqual(log.length, 0);
});

/* ═══ readSource（Git Trees 逐级） ═════════════ */

function treesRoutesForBlob(content, blobSha) {
  const rootTree = HEX('b');
  const srcTree = HEX('c');
  return [
    route(/^\/repos\/owner\/repo\/git\/commits\/a{40}$/, 'GET', { tree: { sha: rootTree } }),
    route(new RegExp(`^/repos/owner/repo/git/trees/${rootTree}$`), 'GET',
      { tree: [{ path: 'src', mode: '040000', type: 'tree', sha: srcTree }] }),
    route(new RegExp(`^/repos/owner/repo/git/trees/${srcTree}$`), 'GET',
      { tree: [{ path: 'legacy.js', mode: '100644', type: 'blob', sha: blobSha }] }),
    route(new RegExp(`^/repos/owner/repo/git/blobs/${blobSha}$`), 'GET',
      { sha: blobSha, encoding: 'base64', content: b64(content) }),
  ];
}

test('readSource 成功：Trees 逐级、校验 blob SHA、LF UTF-8', async () => {
  const content = 'const x = 1;\nfunction f() {\n  return x;\n}\n';
  const blobSha = gitBlobSha(content);
  const fetchImpl = makeFetch(treesRoutesForBlob(content, blobSha));
  const gh = createGitHub({ token: TOKEN, fetchImpl });
  const info = await gh.readSource('owner/repo', HEX('a'), 'src/legacy.js');
  assert.strictEqual(info.source, content);
  assert.strictEqual(info.blobSha, blobSha);
  assert.strictEqual(info.mode, '100644');
});

test('readSource 拒绝 symlink 祖先', async () => {
  const rootTree = HEX('b');
  const fetchImpl = makeFetch([
    route(/^\/repos\/owner\/repo\/git\/commits\/a{40}$/, 'GET', { tree: { sha: rootTree } }),
    route(new RegExp(`^/repos/owner/repo/git/trees/${rootTree}$`), 'GET',
      { tree: [{ path: 'src', mode: '120000', type: 'blob', sha: HEX('c') }] }), // symlink
  ]);
  const gh = createGitHub({ token: TOKEN, fetchImpl });
  await assert.rejects(() => gh.readSource('owner/repo', HEX('a'), 'src/legacy.js'), /符号链接/);
});

test('readSource 拒绝 gitlink', async () => {
  const rootTree = HEX('b');
  const fetchImpl = makeFetch([
    route(/^\/repos\/owner\/repo\/git\/commits\/a{40}$/, 'GET', { tree: { sha: rootTree } }),
    route(new RegExp(`^/repos/owner/repo/git/trees/${rootTree}$`), 'GET',
      { tree: [{ path: 'sub', mode: '160000', type: 'commit', sha: HEX('c') }] }),
  ]);
  const gh = createGitHub({ token: TOKEN, fetchImpl });
  await assert.rejects(() => gh.readSource('owner/repo', HEX('a'), 'sub/x.js'), /gitlink|子树模块/);
});

test('readSource 拒绝非 blob 目标（目录）', async () => {
  const rootTree = HEX('b');
  const fetchImpl = makeFetch([
    route(/^\/repos\/owner\/repo\/git\/commits\/a{40}$/, 'GET', { tree: { sha: rootTree } }),
    route(new RegExp(`^/repos/owner/repo/git/trees/${rootTree}$`), 'GET',
      { tree: [{ path: 'src', mode: '040000', type: 'tree', sha: HEX('c') }] }),
    route(new RegExp(`^/repos/owner/repo/git/trees/${HEX('c')}$`), 'GET',
      { tree: [{ path: 'legacy.js', mode: '040000', type: 'tree', sha: HEX('d') }] }),
  ]);
  const gh = createGitHub({ token: TOKEN, fetchImpl });
  await assert.rejects(() => gh.readSource('owner/repo', HEX('a'), 'src/legacy.js'), /blob/);
});

test('readSource 拒绝 blob SHA 不符（截断/篡改）', async () => {
  const content = 'const x = 1;\n';
  const fetchImpl = makeFetch(treesRoutesForBlob(content, HEX('d'))); // 声明的 sha 与内容不符
  const gh = createGitHub({ token: TOKEN, fetchImpl });
  await assert.rejects(() => gh.readSource('owner/repo', HEX('a'), 'src/legacy.js'), /校验失败|不一致/);
});

test('readSource 拒绝二进制内容', async () => {
  const raw = Buffer.from([0xff, 0xfe, 0x00, 0x01]);
  const blobSha = createHash('sha1')
    .update(Buffer.from(`blob ${raw.length}\0`)).update(raw).digest('hex');
  const rootTree = HEX('b');
  const srcTree = HEX('c');
  const fetchImpl = makeFetch([
    route(/^\/repos\/owner\/repo\/git\/commits\/a{40}$/, 'GET', { tree: { sha: rootTree } }),
    route(new RegExp(`^/repos/owner/repo/git/trees/${rootTree}$`), 'GET',
      { tree: [{ path: 'src', mode: '040000', type: 'tree', sha: srcTree }] }),
    route(new RegExp(`^/repos/owner/repo/git/trees/${srcTree}$`), 'GET',
      { tree: [{ path: 'legacy.js', mode: '100644', type: 'blob', sha: blobSha }] }),
    route(new RegExp(`^/repos/owner/repo/git/blobs/${blobSha}$`), 'GET',
      { sha: blobSha, encoding: 'base64', content: raw.toString('base64') }),
  ]);
  const gh = createGitHub({ token: TOKEN, fetchImpl });
  await assert.rejects(() => gh.readSource('owner/repo', HEX('a'), 'src/legacy.js'), /二进制|UTF-8/);
});

test('readSource 拒绝含回车 / 无换行结尾', async () => {
  const content = 'const x = 1;\r\nbad\n'; // 含 \r
  const blobSha = gitBlobSha(content);
  const fetchImpl = makeFetch(treesRoutesForBlob(content, blobSha));
  const gh = createGitHub({ token: TOKEN, fetchImpl });
  await assert.rejects(() => gh.readSource('owner/repo', HEX('a'), 'src/legacy.js'), /LF|回车/);
});

test('readSource 拒绝超过 64KB', async () => {
  const content = 'x'.repeat(70000) + '\n'; // > 64KB
  const blobSha = gitBlobSha(content);
  const fetchImpl = makeFetch(treesRoutesForBlob(content, blobSha));
  const gh = createGitHub({ token: TOKEN, fetchImpl });
  await assert.rejects(() => gh.readSource('owner/repo', HEX('a'), 'src/legacy.js'), /64KB/);
});

/* ═══ createDraft ══════════════════════════════ */

function draftRoutes({ canPush = true, newSha = HEX('e'), prNumber = 1, postRefsStatus = 201 } = {}) {
  const baseSha = HEX('a');
  const rootTree = HEX('b');
  const newBlob = HEX('c');
  const newTree = HEX('d');
  return {
    baseSha,
    routes: [
      route(/^\/repos\/owner\/repo$/, 'GET', { full_name: 'owner/repo', default_branch: 'main', permissions: { push: canPush } }),
      route(/^\/repos\/owner\/repo\/git\/refs\/heads\/main$/, 'GET', { object: { sha: baseSha } }),
      route(/^\/repos\/owner\/repo\/git\/refs$/, 'POST', { ref: 'refs/heads/refactor/x', object: { sha: baseSha } }, postRefsStatus),
      route(/^\/repos\/owner\/repo\/git\/blobs$/, 'POST', { sha: newBlob }),
      route(new RegExp(`^/repos/owner/repo/git/commits/${baseSha}$`), 'GET', { tree: { sha: rootTree } }),
      route(/^\/repos\/owner\/repo\/git\/trees$/, 'POST', { sha: newTree }),
      route(/^\/repos\/owner\/repo\/git\/commits$/, 'POST', { sha: newSha }),
      route(/^\/repos\/owner\/repo\/git\/refs\/heads\/refactor\/[0-9a-f]{64}$/, 'PATCH', { ref: 'refs/heads/refactor/x', object: { sha: newSha } }),
      route(/^\/repos\/owner\/repo\/pulls$/, 'POST', { html_url: 'https://github.com/owner/repo/pull/1', number: prNumber }),
    ],
  };
}

test('createDraft 成功：建分支锁 -> blob/tree/commit -> PATCH -> 草稿 PR', async () => {
  const { baseSha, routes } = draftRoutes();
  const log = [];
  const fetchImpl = makeFetch(routes, log);
  const gh = createGitHub({ token: TOKEN, fetchImpl });
  const file = 'src/legacy.js';
  const digest = HEX('d', 64);
  const source = 'const x = 2;\n';
  const res = await gh.createDraft({ repo: 'owner/repo', file, baseSha, baseBranch: 'main',
    mode: '100644', digest, userId: 123, source });

  const hex = refHex('owner/repo', baseSha, file, digest);
  assert.strictEqual(res.branch, `refactor/${hex}`);
  assert.strictEqual(res.draft, true);
  assert.strictEqual(res.url, 'https://github.com/owner/repo/pull/1');
  assert.strictEqual(res.number, 1);

  // 请求序列必须包含：claim POST refs -> POST blobs -> POST trees -> POST commits -> PATCH refs -> POST pulls
  const methods = log.map((c) => `${c.method} ${c.path}`);
  assert.ok(methods.some((m) => m === 'POST /repos/owner/repo/git/refs'));
  assert.ok(methods.some((m) => m === 'POST /repos/owner/repo/git/blobs'));
  assert.ok(methods.some((m) => m === 'POST /repos/owner/repo/git/trees'));
  assert.ok(methods.some((m) => m === 'POST /repos/owner/repo/git/commits'));
  assert.ok(methods.some((m) => m.startsWith('PATCH /repos/owner/repo/git/refs/heads/refactor/')));
  assert.ok(methods.some((m) => m === 'POST /repos/owner/repo/pulls'));
  // 绝不可写入默认分支（仅读取其 HEAD 是允许的）/ 绝不 merge
  assert.ok(!methods.some((m) => /(?:POST|PATCH) \/repos\/owner\/repo\/git\/refs\/heads\/main/.test(m)));
  // claim 的 POST refs 指向 baseSha
  const claim = log.find((c) => c.method === 'POST' && c.path === '/repos/owner/repo/git/refs');
  assert.strictEqual(claim.body.sha, baseSha);
  // PATCH 使用 force:false
  const patch = log.find((c) => c.method === 'PATCH' && c.path.startsWith('/repos/owner/repo/git/refs/heads/refactor/'));
  assert.strictEqual(patch.body.force, false);
  // 所有请求都带调用者 token
  assert.ok(log.every((c) => c.auth === `Bearer ${TOKEN}`));
  // 草稿 PR 标记
  const pr = log.find((c) => c.method === 'POST' && c.path === '/repos/owner/repo/pulls');
  assert.strictEqual(pr.body.draft, true);
  assert.strictEqual(pr.body.head, `refactor/${hex}`);
  assert.strictEqual(pr.body.base, 'main');
});

test('createDraft 无 token -> caller_auth_required，不发起任何请求', async () => {
  const log = [];
  const { baseSha, routes } = draftRoutes();
  const fetchImpl = makeFetch(routes, log);
  const gh = createGitHub({ fetchImpl }); // 无 token
  await assert.rejects(() => gh.createDraft({ repo: 'owner/repo', file: 'src/legacy.js', baseSha,
    baseBranch: 'main', mode: '100644', digest: HEX('d', 64), userId: 1, source: 'x\n' }), /Token/);
  assert.strictEqual(log.length, 0);
});

test('createDraft 无 push 权限 -> write_forbidden', async () => {
  const { baseSha, routes } = draftRoutes({ canPush: false });
  const fetchImpl = makeFetch(routes);
  const gh = createGitHub({ token: TOKEN, fetchImpl });
  await assert.rejects(() => gh.createDraft({ repo: 'owner/repo', file: 'src/legacy.js', baseSha,
    baseBranch: 'main', mode: '100644', digest: HEX('d', 64), userId: 1, source: 'x\n' }), /写权限/);
});

test('createDraft 基础提交变化 -> stale_base，不移动分支 / 不建 PR', async () => {
  const baseSha = HEX('a');
  let mainCalls = 0;
  const routes = [
    // 写前 / 写后 verifyBase 都查 /repos 与 refs/heads/main
    route(/^\/repos\/owner\/repo$/, 'GET', { full_name: 'owner/repo', default_branch: 'main', permissions: { push: true } }),
    {
      test: (p, m) => p === '/repos/owner/repo/git/refs/heads/main' && m === 'GET',
      handle: () => {
        mainCalls += 1;
        // 第一次（写前）HEAD 仍是 baseSha；第二次（写后）已变化
        return jsonResponse(200, { object: { sha: mainCalls <= 1 ? baseSha : HEX('f') } });
      },
    },
    route(/^\/repos\/owner\/repo\/git\/refs$/, 'POST', { ref: 'x', object: { sha: baseSha } }, 201),
    route(/^\/repos\/owner\/repo\/git\/blobs$/, 'POST', { sha: HEX('c') }),
    route(new RegExp(`^/repos/owner/repo/git/commits/${baseSha}$`), 'GET', { tree: { sha: HEX('b') } }),
    route(/^\/repos\/owner\/repo\/git\/trees$/, 'POST', { sha: HEX('d') }),
    route(/^\/repos\/owner\/repo\/git\/commits$/, 'POST', { sha: HEX('e') }),
  ];
  const log = [];
  const fetchImpl = makeFetch(routes, log);
  const gh = createGitHub({ token: TOKEN, fetchImpl });
  await assert.rejects(() => gh.createDraft({ repo: 'owner/repo', file: 'src/legacy.js', baseSha,
    baseBranch: 'main', mode: '100644', digest: HEX('d', 64), userId: 1, source: 'x\n' }), /基础提交已变化/);
  // 已创建分支锁，但未 PATCH 移动、未建 PR
  assert.ok(!log.some((c) => c.method === 'PATCH'));
  assert.ok(!log.some((c) => c.method === 'POST' && c.path === '/repos/owner/repo/pulls'));
});

test('createDraft 重复 claim -> duplicate_operation 409，不更新旧 ref', async () => {
  const baseSha = HEX('a');
  const routes = [
    route(/^\/repos\/owner\/repo$/, 'GET', { full_name: 'owner/repo', default_branch: 'main', permissions: { push: true } }),
    route(/^\/repos\/owner\/repo\/git\/refs\/heads\/main$/, 'GET', { object: { sha: baseSha } }),
    // claim POST refs 已存在 -> 422
    route(/^\/repos\/owner\/repo\/git\/refs$/, 'POST', { message: 'Reference already exists' }, 422),
    // 二次确认：该 ref 确实存在 -> 判定为重复
    route(/^\/repos\/owner\/repo\/git\/refs\/heads\/refactor\/[0-9a-f]{64}$/, 'GET', { ref: 'x', object: { sha: baseSha } }),
  ];
  const log = [];
  const fetchImpl = makeFetch(routes, log);
  const gh = createGitHub({ token: TOKEN, fetchImpl });
  const err = await expectReject(() => gh.createDraft({ repo: 'owner/repo', file: 'src/legacy.js', baseSha,
    baseBranch: 'main', mode: '100644', digest: HEX('d', 64), userId: 1, source: 'x\n' }));
  assert.strictEqual(err.code, 'duplicate_operation');
  assert.strictEqual(err.status, 409);
  // 重复路径下不得创建 blob/tree/commit/PATCH/PR
  assert.ok(!log.some((c) => c.method === 'POST' && c.path === '/repos/owner/repo/git/blobs'));
  assert.ok(!log.some((c) => c.method === 'PATCH'));
});

test('createDraft 并发：一方成功、一方判定重复（分布式去重）', async () => {
  const baseSha = HEX('a');
  let refPosts = 0;
  const routes = [
    route(/^\/repos\/owner\/repo$/, 'GET', { full_name: 'owner/repo', default_branch: 'main', permissions: { push: true } }),
    route(/^\/repos\/owner\/repo\/git\/refs\/heads\/main$/, 'GET', { object: { sha: baseSha } }),
    {
      test: (p, m) => p === '/repos/owner/repo/git/refs' && m === 'POST',
      handle: () => {
        refPosts += 1;
        // 第一个 claim 成功，其后者得到 422
        return refPosts === 1
          ? jsonResponse(201, { ref: 'x', object: { sha: baseSha } })
          : jsonResponse(422, { message: 'Reference already exists' });
      },
    },
    route(/^\/repos\/owner\/repo\/git\/refs\/heads\/refactor\/[0-9a-f]{64}$/, 'GET', { ref: 'x', object: { sha: baseSha } }),
    route(/^\/repos\/owner\/repo\/git\/blobs$/, 'POST', { sha: HEX('c') }),
    route(new RegExp(`^/repos/owner/repo/git/commits/${baseSha}$`), 'GET', { tree: { sha: HEX('b') } }),
    route(/^\/repos\/owner\/repo\/git\/trees$/, 'POST', { sha: HEX('d') }),
    route(/^\/repos\/owner\/repo\/git\/commits$/, 'POST', { sha: HEX('e') }),
    route(/^\/repos\/owner\/repo\/git\/refs\/heads\/refactor\/[0-9a-f]{64}$/, 'PATCH', { ref: 'x', object: { sha: HEX('e') } }),
    route(/^\/repos\/owner\/repo\/pulls$/, 'POST', { html_url: 'https://github.com/owner/repo/pull/1', number: 1 }),
  ];
  const log = [];
  const fetchImpl = makeFetch(routes, log);
  const gh = createGitHub({ token: TOKEN, fetchImpl });
  const ticket = { repo: 'owner/repo', file: 'src/legacy.js', baseSha, baseBranch: 'main',
    mode: '100644', digest: HEX('d', 64), userId: 1, source: 'x\n' };
  const [r1, r2] = await Promise.all([
    gh.createDraft(ticket).catch((e) => e),
    gh.createDraft(ticket).catch((e) => e),
  ]);
  const ok = [r1, r2].find((r) => r && r.draft === true);
  const dup = [r1, r2].find((r) => r instanceof Error && r.code === 'duplicate_operation');
  assert.ok(ok && ok.draft === true, '应有一方成功创建草稿 PR');
  assert.ok(dup, '应有一方判定重复');
  // 成功方建了 PR，重复方没有
  const patchCount = log.filter((c) => c.method === 'PATCH').length;
  assert.strictEqual(patchCount, 1, '只应有一个分支被移动');
  assert.strictEqual(log.filter((c) => c.method === 'POST' && c.path === '/repos/owner/repo/pulls').length, 1);
});

test('createDraft 上游错误（blob 创建 500）-> 静态 upstream_error，分支锁保留不重试', async () => {
  const baseSha = HEX('a');
  const custom = [
    route(/^\/repos\/owner\/repo$/, 'GET', { full_name: 'owner/repo', default_branch: 'main', permissions: { push: true } }),
    route(/^\/repos\/owner\/repo\/git\/refs\/heads\/main$/, 'GET', { object: { sha: baseSha } }),
    route(/^\/repos\/owner\/repo\/git\/refs$/, 'POST', { ref: 'x', object: { sha: baseSha } }, 201),
    route(/^\/repos\/owner\/repo\/git\/blobs$/, 'POST', { message: 'boom' }, 500),
  ];
  const log = [];
  const fetchImpl = makeFetch(custom, log);
  const gh = createGitHub({ token: TOKEN, fetchImpl });
  const err = await expectReject(() => gh.createDraft({ repo: 'owner/repo', file: 'src/legacy.js', baseSha,
    baseBranch: 'main', mode: '100644', digest: HEX('d', 64), userId: 1, source: 'x\n' }));
  assert.strictEqual(err.code, 'upstream_error');
  // 分支锁（claim）已建立，但未 PATCH、未建 PR、未重试 blob
  const blobPosts = log.filter((c) => c.method === 'POST' && c.path === '/repos/owner/repo/git/blobs').length;
  assert.strictEqual(blobPosts, 1, '失败后不应重试 blob 创建');
  assert.ok(!log.some((c) => c.method === 'PATCH'));
});

test('createDraft 写入过程超时 -> upstream_timeout，保留分支锁不重试', async () => {
  const baseSha = HEX('a');
  // 已知路由（前几步）由 makeFetch 处理；blobs 之后的尾部请求一律挂起，靠 timeout 触发。
  const baseRoutes = [
    route(/^\/repos\/owner\/repo$/, 'GET', { full_name: 'owner/repo', default_branch: 'main', permissions: { push: true } }),
    route(/^\/repos\/owner\/repo\/git\/refs\/heads\/main$/, 'GET', { object: { sha: baseSha } }),
    route(/^\/repos\/owner\/repo\/git\/refs$/, 'POST', { ref: 'x', object: { sha: baseSha } }, 201),
  ];
  const fetchImpl = async (url, opts = {}) => {
    const p = pathOf(url);
    for (const rt of baseRoutes) {
      if (rt.test(p, (opts.method || 'GET').toUpperCase())) return rt.handle(p, opts);
    }
    // 尾部（blobs/trees/commits/...）挂起直至超时
    return new Promise((_, rej) => {
      if (opts.signal) opts.signal.addEventListener('abort', () => rej(new Error('The operation was aborted')));
    });
  };
  const gh = createGitHub({ token: TOKEN, fetchImpl, timeoutMs: 30 });
  const err = await expectReject(() => gh.createDraft({ repo: 'owner/repo', file: 'src/legacy.js', baseSha,
    baseBranch: 'main', mode: '100644', digest: HEX('d', 64), userId: 1, source: 'x\n' }));
  assert.strictEqual(err.code, 'upstream_timeout');
});

test('request 拒绝绝对 URL / 协议前缀路径', async () => {
  const fetchImpl = makeFetch([]);
  const gh = createGitHub({ token: TOKEN, fetchImpl });
  await assert.rejects(() => gh.request('https://evil.com/x'), /非法/);
  await assert.rejects(() => gh.request('//evil.com/x'), /非法/);
});

test('request 仅使用固定 origin，不拼接到其他主机', async () => {
  const log = [];
  const fetchImpl = makeFetch([route(/^\/repos\/owner\/repo$/, 'GET', { full_name: 'owner/repo' })], log);
  const gh = createGitHub({ token: TOKEN, fetchImpl });
  await gh.request('/repos/owner/repo');
  assert.ok(log[0].url.startsWith(BASE + '/'));
  assert.strictEqual(log[0].url, `${BASE}/repos/owner/repo`);
});
