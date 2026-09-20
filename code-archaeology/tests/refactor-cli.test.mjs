// 安全重构 CLI 测试 —— node:test + fake transport + 内存文件系统。
// 全程不触网、不写真实磁盘、不做任何凭据借用。
//
// 覆盖：
//   1) --api 端点安全校验（拒绝 userinfo / query / hash / 明文远程 http）
//   2) patch 落盘：change.diff 正常写，review.json 权限 0600、不含 token、wx 不覆盖
//   3) pr：必须 --confirm；diff 摘要与 review.json / --reviewed-digest 三者一致才放行
//   4) Token 只来自 CA_GITHUB_TOKEN，不会误用 GITHUB_TOKEN（Keychain 类来源）

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
import {
  assertSafeEndpoint,
  digestText,
  parseConfirm,
  runPatch,
  runPr,
  runRefactorCommand,
  REVIEW_TOKEN_RE,
} from '../bin/refactor.mjs';

/* ── 内存文件系统（替代真实磁盘，避免副作用） ──── */

class MemFileHandle {
  constructor(store, file, flagsStr, mode = 0o644) {
    this.store = store;
    this.file = file;
    this.flags = flagsStr;
    this.mode = mode & 0o777;
  }
  async writeFile(content) {
    this.store.files.set(this.file, String(content));
    // 权限从 open 创建时即生效（模拟真实 f.open(path,'wx',mode)）
    this.store.modes.set(this.file, this.mode);
  }
  async chmod(mode) {
    this.store.modes.set(this.file, mode & 0o777);
  }
  async close() {}
}

class MemFS {
  constructor() {
    this.files = new Map();
    this.modes = new Map();
  }
  async open(file, flagsStr, mode = 0o644) {
    if (flagsStr === 'wx' && this.files.has(file)) {
      const e = new Error(`EEXIST: ${file}`);
      e.code = 'EEXIST';
      throw e;
    }
    return new MemFileHandle(this, file, flagsStr, mode);
  }
  async writeFile(file, content, opts) {
    this.files.set(file, String(content));
    if (opts?.mode != null) this.modes.set(file, opts.mode & 0o777);
  }
  async readFile(file) {
    if (!this.files.has(file)) {
      const e = new Error(`ENOENT: ${file}`);
      e.code = 'ENOENT';
      throw e;
    }
    return this.files.get(file);
  }
  getMode(file) {
    return this.modes.get(file);
  }
}

/* ── fake fetch（记录请求、返回预设 data） ──────── */

function fakeFetch(data) {
  const calls = [];
  const fn = async (url, opts) => {
    calls.push({ url: String(url), opts });
    return { ok: true, status: 200, json: async () => ({ ok: true, data }) };
  };
  fn.calls = calls;
  return fn;
}

const PATCH_DATA = {
  mode: 'patch',
  repo: 'owner/repo',
  file: 'src/legacy.js',
  baseSha: 'a'.repeat(40),
  baseBranch: 'main',
  diff: '--- a/src/legacy.js\n+++ b/src/legacy.js\n-const x = 1;\n+const x = 2;\n',
  digest: digestText('--- a/src/legacy.js\n+++ b/src/legacy.js\n-const x = 1;\n+const x = 2;\n'),
  changedLines: 2,
  evidence: { commit: 'abc123', author: 'human' },
  warnings: ['该文件历史含机器人提交'],
  reviewToken: 'dGVzdA==.' + '0'.repeat(64),
  prEligible: true,
  expiresAt: Date.now() + 60000,
};

// 与 src/refactor/service.js 的 signReview 一致：base64 payload + '.' + 64 位 hex 签名
const VALID_REVIEW_TOKEN = 'dGVzdA==' + '.' + '0'.repeat(64);

const PR_DATA = { mode: 'pr', url: 'https://github.com/owner/repo/pull/7', number: 7, draft: true, branch: 'refactor/owner-repo-abc123' };

const API = 'http://127.0.0.1:8787';

/* ═══ 端点安全校验 ═══════════════════════════════ */

test('assertSafeEndpoint 拒绝携带 userinfo 的地址', () => {
  assert.throws(() => assertSafeEndpoint('http://user:pass@127.0.0.1:8787'), /userinfo/);
});

test('assertSafeEndpoint 拒绝 query', () => {
  assert.throws(() => assertSafeEndpoint('http://127.0.0.1:8787/?x=1'), /query/);
});

test('assertSafeEndpoint 拒绝 hash', () => {
  assert.throws(() => assertSafeEndpoint('http://127.0.0.1:8787/#x'), /hash/);
});

test('assertSafeEndpoint 拒绝非 http(s)', () => {
  assert.throws(() => assertSafeEndpoint('ftp://127.0.0.1'), /http/);
});

test('assertSafeEndpoint 拒绝明文远程 http', () => {
  assert.throws(() => assertSafeEndpoint('http://example.com/api'), /本地/);
});

test('assertSafeEndpoint 接受本地 http 与 https', () => {
  assert.doesNotThrow(() => assertSafeEndpoint('http://127.0.0.1:8787'));
  assert.doesNotThrow(() => assertSafeEndpoint('http://localhost:8787'));
  assert.doesNotThrow(() => assertSafeEndpoint('https://api.example.com'));
});

/* ═══ patch 落盘 ═════════════════════════════════ */

test('runPatch 写 change.diff 与 review.json（0600 且不含 token）', async () => {
  const mem = new MemFS();
  const f = fakeFetch(PATCH_DATA);
  const out = path.join(os.tmpdir(), 'ca-test-change.diff');
  const reviewOut = path.join(os.tmpdir(), 'ca-test-review.json');

  await runPatch({ api: API, repo: 'owner/repo', out, reviewOut, token: 'ca_secret', fs: mem, fetchImpl: f });

  // diff 内容正确
  assert.strictEqual(mem.files.get(out), PATCH_DATA.diff);

  assert.strictEqual(mem.getMode(out), 0o600);
  const raw = mem.files.get(reviewOut);
  assert.ok(raw != null);
  assert.strictEqual(mem.getMode(reviewOut), 0o600);
  const review = JSON.parse(raw);

  // 关键：review.json 绝不写入调用者 token
  assert.strictEqual(review.token, undefined);
  assert.ok(!raw.includes('ca_secret'));
  // 但保留审阅所需的字段
  assert.strictEqual(review.digest, PATCH_DATA.digest);
  assert.strictEqual(review.reviewToken, PATCH_DATA.reviewToken);
  assert.strictEqual(review.prEligible, true);
  assert.strictEqual(review.repo, 'owner/repo');

  // fetch 请求带了 X-GitHub-Token 头
  assert.strictEqual(f.calls[0].opts.headers['X-GitHub-Token'], 'ca_secret');
  // patch 默认 params：{repo, mode:'patch', limit:40}，path 为 null 时省略该字段（后端拒绝 path:null）
  const body = JSON.parse(f.calls[0].opts.body);
  assert.strictEqual(body.repo, 'owner/repo');
  assert.strictEqual(body.mode, 'patch');
  assert.strictEqual(body.limit, 40);
  assert.strictEqual(body.path, undefined);
});

test('runPatch 用 wx 强制不覆盖已有 review.json', async () => {
  const mem = new MemFS();
  const f = fakeFetch(PATCH_DATA);
  const out = path.join(os.tmpdir(), 'ca-test-change2.diff');
  const reviewOut = path.join(os.tmpdir(), 'ca-test-review2.json');

  // 预置一份「旧」review.json，防止被静默覆盖
  mem.files.set(reviewOut, 'OLD');
  await assert.rejects(
    () => runPatch({ api: API, repo: 'owner/repo', out, reviewOut, fs: mem, fetchImpl: f }),
    /EEXIST/ // 或至少不写成新内容
  );
  // 旧内容仍在
  assert.strictEqual(mem.files.get(reviewOut), 'OLD');
});

/* ═══ pr 一致性校验 ═════════════════════════════ */

test('runPr 在 digest 一致且 --confirm 时放行', async () => {
  const mem = new MemFS();
  const f = fakeFetch(PR_DATA);

  const diffText = PATCH_DATA.diff;
  const digest = digestText(diffText);
  const diff = path.join(os.tmpdir(), 'ca-test-pr.diff');
  const review = path.join(os.tmpdir(), 'ca-test-pr.json');
  mem.files.set(diff, diffText);
  mem.files.set(
    review,
    JSON.stringify({ mode: 'patch', repo: 'owner/repo', digest, reviewToken: VALID_REVIEW_TOKEN, prEligible: true })
  );

  const res = await runPr({
    api: API,
    review,
    diff,
    reviewedDigest: digest,
    confirm: true,
    token: 'ca_secret',
    fs: mem,
    fetchImpl: f,
  });

  assert.strictEqual(res.result.url, PR_DATA.url);
  assert.match(res.disclosure, /不代表自动授权/);
  // PR 请求体包含正确的 reviewedDigest / reviewToken / diff
  const body = JSON.parse(f.calls[0].opts.body);
  assert.strictEqual(body.mode, 'pr');
  assert.strictEqual(body.confirm, true);
  assert.strictEqual(body.reviewedDigest, digest);
  assert.strictEqual(body.reviewToken, VALID_REVIEW_TOKEN);
  assert.strictEqual(body.diff, diffText);
  assert.strictEqual(f.calls[0].opts.headers['X-GitHub-Token'], 'ca_secret');
});

test('runPr 缺少 --confirm 直接拒绝', async () => {
  const mem = new MemFS();
  const diff = path.join(os.tmpdir(), 'ca-test-a.diff');
  const review = path.join(os.tmpdir(), 'ca-test-a.json');
  mem.files.set(diff, PATCH_DATA.diff);
  mem.files.set(review, JSON.stringify({ repo: 'owner/repo', digest: digestText(PATCH_DATA.diff), reviewToken: 'rt', prEligible: true }));
  await assert.rejects(
    () => runPr({ api: API, review, diff, reviewedDigest: digestText(PATCH_DATA.diff), confirm: false, fs: mem, fetchImpl: fakeFetch(PR_DATA) }),
    /--confirm/
  );
});

test('runPr 严格确认：仅布尔 true 通过，字符串/数字一律拒绝', async () => {
  const mem = new MemFS();
  const diff = path.join(os.tmpdir(), 'ca-test-strict.diff');
  const review = path.join(os.tmpdir(), 'ca-test-strict.json');
  mem.files.set(diff, PATCH_DATA.diff);
  mem.files.set(
    review,
    JSON.stringify({ repo: 'owner/repo', digest: digestText(PATCH_DATA.diff), reviewToken: VALID_REVIEW_TOKEN, prEligible: true })
  );
  const reviewedDigest = digestText(PATCH_DATA.diff);
  // 字符串 'false'（旧 if(!confirm) 会误判为真，现已收紧）
  await assert.rejects(
    () => runPr({ api: API, review, diff, reviewedDigest, confirm: 'false', token: 'ca_secret', fs: mem, fetchImpl: fakeFetch(PR_DATA) }),
    /--confirm/
  );
  // 字符串 'true' 也不接受
  await assert.rejects(
    () => runPr({ api: API, review, diff, reviewedDigest, confirm: 'true', token: 'ca_secret', fs: mem, fetchImpl: fakeFetch(PR_DATA) }),
    /--confirm/
  );
  // 数字 1 也不接受
  await assert.rejects(
    () => runPr({ api: API, review, diff, reviewedDigest, confirm: 1, token: 'ca_secret', fs: mem, fetchImpl: fakeFetch(PR_DATA) }),
    /--confirm/
  );
  // 仅布尔 true 放行
  const res = await runPr({ api: API, review, diff, reviewedDigest, confirm: true, token: 'ca_secret', fs: mem, fetchImpl: fakeFetch(PR_DATA) });
  assert.strictEqual(res.result.url, PR_DATA.url);
});

test('runPr 在 --reviewed-digest 与文件不符时拒绝', async () => {
  const mem = new MemFS();
  const diff = path.join(os.tmpdir(), 'ca-test-b.diff');
  const review = path.join(os.tmpdir(), 'ca-test-b.json');
  mem.files.set(diff, PATCH_DATA.diff);
  mem.files.set(review, JSON.stringify({ repo: 'owner/repo', digest: digestText(PATCH_DATA.diff), reviewToken: 'rt', prEligible: true }));
  await assert.rejects(
    () => runPr({ api: API, review, diff, reviewedDigest: 'wrongdigest', confirm: true, fs: mem, fetchImpl: fakeFetch(PR_DATA) }),
    /不一致/
  );
});

test('runPr 在 diff 被篡改（与 review.json 不符）时拒绝', async () => {
  const mem = new MemFS();
  const diff = path.join(os.tmpdir(), 'ca-test-c.diff');
  const review = path.join(os.tmpdir(), 'ca-test-c.json');
  const good = PATCH_DATA.diff;
  const tampered = good + '\n+evil();\n';
  mem.files.set(diff, tampered);
  mem.files.set(review, JSON.stringify({ repo: 'owner/repo', digest: digestText(good), reviewToken: 'rt', prEligible: true }));
  await assert.rejects(
    () => runPr({ api: API, review, diff, reviewedDigest: digestText(good), confirm: true, token: 'ca_secret', fs: mem, fetchImpl: fakeFetch(PR_DATA) }),
    /不一致|review\.json/
  );
});

/* ═══ Token 来源：仅 CA_GITHUB_TOKEN ═════════════ */

test('runRefactorCommand 只用 CA_GITHUB_TOKEN，不用 GITHUB_TOKEN', async () => {
  const prevCa = process.env.CA_GITHUB_TOKEN;
  const prevSite = process.env.GITHUB_TOKEN;
  process.env.CA_GITHUB_TOKEN = 'ca_only_token';
  process.env.GITHUB_TOKEN = 'site_or_keychain_token'; // 模拟不应被借用的站点凭据

  const mem = new MemFS();
  const f = fakeFetch(PATCH_DATA);
  const captured = [];
  const fetchSpy = async (url, opts) => {
    captured.push(opts.headers);
    return { ok: true, status: 200, json: async () => ({ ok: true, data: PATCH_DATA }) };
  };

  const out = path.join(os.tmpdir(), 'ca-test-cli.diff');
  const reviewOut = path.join(os.tmpdir(), 'ca-test-cli.json');
  let exitCode = null;
  await runRefactorCommand(['patch', '--repo=owner/repo', `--out=${out}`, `--review-out=${reviewOut}`], {
    exit: (c) => {
      exitCode = c;
    },
    fetchImpl: fetchSpy,
    fs: mem,
  });

  assert.strictEqual(exitCode, 0);
  assert.strictEqual(captured.length, 1);
  // 头里必须是 CA_GITHUB_TOKEN，绝不能是站点/Keychain 凭据
  assert.strictEqual(captured[0]['X-GitHub-Token'], 'ca_only_token');
  assert.notStrictEqual(captured[0]['X-GitHub-Token'], 'site_or_keychain_token');

  if (prevCa === undefined) delete process.env.CA_GITHUB_TOKEN;
  else process.env.CA_GITHUB_TOKEN = prevCa;
  if (prevSite === undefined) delete process.env.GITHUB_TOKEN;
  else process.env.GITHUB_TOKEN = prevSite;
});

/* ═══ 端点收紧：仅 127.0.0.1 / localhost / [::1] 的 http ═══ */

test('assertSafeEndpoint 拒绝 0.0.0.0 等公网回环误用', () => {
  assert.throws(() => assertSafeEndpoint('http://0.0.0.0:8787'), /本地/);
  assert.throws(() => assertSafeEndpoint('http://192.168.1.5:8787'), /本地/);
  // 但 [::1] 允许
  assert.doesNotThrow(() => assertSafeEndpoint('http://[::1]:8787'));
});

/* ═══ --confirm 严格解析（--confirm=false 不可授权） ═══ */

test('parseConfirm：仅 --confirm / --confirm=true 视为授权', () => {
  assert.strictEqual(parseConfirm({ confirm: true }), true);
  assert.strictEqual(parseConfirm({ confirm: 'true' }), true);
  assert.strictEqual(parseConfirm({}), false);
  assert.strictEqual(parseConfirm({ confirm: 'false' }), false);
  assert.strictEqual(parseConfirm({ confirm: 'yes' }), false);
});

test('runRefactorCommand 下 --confirm=false 不被授权（CLI 层）', async () => {
  const mem = new MemFS();
  const diff = path.join(os.tmpdir(), 'ca-test-conf.diff');
  const review = path.join(os.tmpdir(), 'ca-test-conf.json');
  mem.files.set(diff, PATCH_DATA.diff);
  mem.files.set(
    review,
    JSON.stringify({ repo: 'owner/repo', digest: digestText(PATCH_DATA.diff), reviewToken: 'rt_xyz123', prEligible: true })
  );
  await assert.rejects(
    () =>
      runRefactorCommand(['pr', `--review=${review}`, `--diff=${diff}`, `--reviewed-digest=${digestText(PATCH_DATA.diff)}`, '--confirm=false'], {
        exit: () => {},
        fetchImpl: fakeFetch(PR_DATA),
        fs: mem,
      }),
    /--confirm/
  );
});

/* ═══ patch 落盘：diff 也走 wx 不覆盖；path 可选省略 ═══ */

test('runPatch 对 diff 也使用 wx 不覆盖已有文件', async () => {
  const mem = new MemFS();
  const f = fakeFetch(PATCH_DATA);
  const out = path.join(os.tmpdir(), 'ca-test-change3.diff');
  const reviewOut = path.join(os.tmpdir(), 'ca-test-review3.json');
  mem.files.set(out, 'OLD-DIFF'); // 预置旧 diff，禁止被静默覆盖
  await assert.rejects(
    () => runPatch({ api: API, repo: 'owner/repo', out, reviewOut, fs: mem, fetchImpl: f }),
    /EEXIST/
  );
  assert.strictEqual(mem.files.get(out), 'OLD-DIFF');
});

test('runPatch 在校验返回数据含 token 字段时拒绝', async () => {
  const mem = new MemFS();
  const leaky = { ...PATCH_DATA, token: 'ghp_should_not_leak' };
  await assert.rejects(
    () => runPatch({ api: API, repo: 'owner/repo', fs: mem, fetchImpl: fakeFetch(leaky) }),
    /敏感字段/
  );
});

test('runPatch 在校验返回数据缺 diff/digest 时拒绝', async () => {
  const mem = new MemFS();
  await assert.rejects(
    () => runPatch({ api: API, repo: 'owner/repo', fs: mem, fetchImpl: fakeFetch({ mode: 'patch' }) }),
    /digest|diff/i
  );
});

test('runPatch 在提供 path 时把 path 写入请求体', async () => {
  const mem = new MemFS();
  const f = fakeFetch(PATCH_DATA);
  await runPatch({ api: API, repo: 'owner/repo', path: 'src/legacy.js', fs: mem, fetchImpl: f });
  const body = JSON.parse(f.calls[0].opts.body);
  assert.strictEqual(body.path, 'src/legacy.js');
});

/* ═══ pr 安全门槛：CA_GITHUB_TOKEN / prEligible / reviewToken 形状 ═══ */

test('runPr 在缺少 CA_GITHUB_TOKEN 时拒绝', async () => {
  const mem = new MemFS();
  const diff = path.join(os.tmpdir(), 'ca-test-t.diff');
  const review = path.join(os.tmpdir(), 'ca-test-t.json');
  mem.files.set(diff, PATCH_DATA.diff);
  mem.files.set(
    review,
    JSON.stringify({ repo: 'owner/repo', digest: digestText(PATCH_DATA.diff), reviewToken: 'rt_xyz123', prEligible: true })
  );
  await assert.rejects(
    () => runPr({ api: API, review, diff, reviewedDigest: digestText(PATCH_DATA.diff), confirm: true, token: '', fs: mem, fetchImpl: fakeFetch(PR_DATA) }),
    /CA_GITHUB_TOKEN/
  );
});

test('runPr 在 review.prEligible 不为 true 时拒绝', async () => {
  const mem = new MemFS();
  const diff = path.join(os.tmpdir(), 'ca-test-p.json-diff');
  const review = path.join(os.tmpdir(), 'ca-test-p.json');
  mem.files.set(diff, PATCH_DATA.diff);
  mem.files.set(
    review,
    JSON.stringify({ repo: 'owner/repo', digest: digestText(PATCH_DATA.diff), reviewToken: 'rt_xyz123', prEligible: false })
  );
  await assert.rejects(
    () => runPr({ api: API, review, diff, reviewedDigest: digestText(PATCH_DATA.diff), confirm: true, token: 'ca_secret', fs: mem, fetchImpl: fakeFetch(PR_DATA) }),
    /prEligible/
  );
});

test('runPr 在 reviewToken 形状无效时拒绝', async () => {
  const mem = new MemFS();
  const diff = path.join(os.tmpdir(), 'ca-test-r.diff');
  const review = path.join(os.tmpdir(), 'ca-test-r.json');
  mem.files.set(diff, PATCH_DATA.diff);
  mem.files.set(
    review,
    JSON.stringify({ repo: 'owner/repo', digest: digestText(PATCH_DATA.diff), reviewToken: 'bad-shape', prEligible: true })
  );
  await assert.rejects(
    () => runPr({ api: API, review, diff, reviewedDigest: digestText(PATCH_DATA.diff), confirm: true, token: 'ca_secret', fs: mem, fetchImpl: fakeFetch(PR_DATA) }),
    /reviewToken/
  );
});

test('REVIEW_TOKEN_RE 形状校验', () => {
  assert.ok(REVIEW_TOKEN_RE.test(VALID_REVIEW_TOKEN));
  assert.ok(!REVIEW_TOKEN_RE.test('rt'));
  assert.ok(!REVIEW_TOKEN_RE.test('ghp_xxx'));
  assert.ok(!REVIEW_TOKEN_RE.test('rt_xyz'));
  assert.ok(!REVIEW_TOKEN_RE.test('dGVzdA==.abc')); // 签名非 64 位 hex
});

/* ═══ 网络层：180s 超时 + reject redirects ═══ */

test('callApi 使用 manual 拒绝重定向并设置超时 signal', async () => {
  const mem = new MemFS();
  let captured;
  const f = async (url, opts) => {
    captured = opts;
    return { ok: true, status: 200, json: async () => ({ ok: true, data: PATCH_DATA }) };
  };
  await runPatch({ api: API, repo: 'owner/repo', fs: mem, fetchImpl: f });
  assert.strictEqual(captured.redirect, 'manual');
  assert.ok(captured.signal, '应传入超时 signal');
});

for (const status of [301, 302, 303, 307, 308]) {
  test(`callApi 拒绝 ${status}：不跟随、不读取响应体、不落盘`, async () => {
    const mem = new MemFS();
    let calls = 0;
    let reads = 0;
    const fetchImpl = async (_url, opts) => {
      calls++;
      assert.equal(opts.redirect, 'manual');
      return {
        ok: false, status,
        json: async () => { reads++; throw new Error('ca_secret'); },
      };
    };
    await assert.rejects(
      () => runPatch({ api: API, repo: 'owner/repo', token: 'ca_secret', fs: mem, fetchImpl }),
      (e) => /重定向/.test(e.message) && !e.message.includes('ca_secret')
    );
    assert.equal(calls, 1);
    assert.equal(reads, 0);
    assert.equal(mem.files.size, 0);
  });
}

/* ═══ 错误响应不回显凭据 ═══ */

test('callApi 错误响应不回显 token', async () => {
  const mem = new MemFS();
  const f = async () => ({ ok: false, status: 401, json: async () => ({ ok: false, message: 'unauthorized token=ca_secret' }) });
  await assert.rejects(
    () => runPatch({ api: API, repo: 'owner/repo', token: 'ca_secret', fs: mem, fetchImpl: f }),
    (e) => !e.message.includes('ca_secret') && /请求失败|unauthorized/.test(e.message)
  );
});

// 让 node:test 不把本文件的相对导入当成测试失败（无实际操作）
assert.ok(fileURLToPath(import.meta.url));
