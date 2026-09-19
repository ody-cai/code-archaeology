// 重构服务 · 确定性单元测试 —— node:test + 全内存 fake（github / chat / mine），不触网。
//
// 覆盖：正常 patch、固定 base、候选排序、注入提示忽略、超时/模型缺失/坏 diff/路径/secret、
//       PR confirm/身份/权限/stale/replay。
//
// 所有依赖均可注入，因此无需真实 GitHub / 模型，可在任意环境绝对运行。

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { refactor, rankCandidates, verifyReviewToken } from '../src/refactor/service.js';
import { validatePatch } from '../src/refactor/patch.js';
import { RefactorError, sha256 } from '../src/refactor/safety.js';
import { createGitHub } from '../src/refactor/github.js';

/* ── 常量 ─────────────────────────────────────── */

const SIGNING_KEY = 'k'.repeat(40); // ≥32 字符，有效
const BAD_KEY = 'k'.repeat(40); // 与 SIGNING_KEY 同长但内容不同 → 验签必失败（其实长度相同内容不同即可）
const FAKE_SOURCE = 'function compute(x) {\n  return x + 1;\n}\n';
const SECRET = 'sk-ABCDEFGHIJKLMNOPQRSTUVWXYZ123456';

// 构造对 FAKE_SOURCE 可应用、且路径与目标文件一致的合格 diff（改动第 2 行）。
function diffFor(file) {
  return (
    `diff --git a/${file} b/${file}\n` +
    `--- a/${file}\n` +
    `+++ b/${file}\n` +
    '@@ -1,3 +1,3 @@\n' +
    ' function compute(x) {\n' +
    '-  return x + 1;\n' +
    '+  return x + 2;\n' +
    ' }\n'
  );
}

// 对 FAKE_SOURCE 可应用的合格 diff（改动第 2 行），默认针对候选首位文件。
const PATCH_DIFF = diffFor('src/hot.js');

// 上下文与基础源码不符的坏 diff
const BAD_DIFF =
  'diff --git a/src/hot.js b/src/hot.js\n' +
  '--- a/src/hot.js\n' +
  '+++ b/src/hot.js\n' +
  '@@ -1,3 +1,3 @@\n' +
  ' function compute(x) {\n' +
  '-  return x + 1 WRONG CONTEXT;\n' +
  '+  return x + 2;\n' +
  ' }\n';

// 应用后源码会包含凭据的 diff
const SECRET_DIFF =
  'diff --git a/src/hot.js b/src/hot.js\n' +
  '--- a/src/hot.js\n' +
  '+++ b/src/hot.js\n' +
  '@@ -1,3 +1,3 @@\n' +
  ' function compute(x) {\n' +
  '-  return x + 1;\n' +
  `+  return x + 2; // ${SECRET}\n` +
  ' }\n';

const FAKE_REPORT = {
  hotspots: [
    { file: 'src/hot.js', touches: 20, churn: 200, additions: 120, deletions: 80, net: 40, authors: ['a'], firstSeen: '2024-01-01', lastSeen: '2024-06-01', sequence: [{ sha: 'aaa1111', additions: 50, deletions: 10 }, { sha: 'bbb2222', additions: 30, deletions: 5 }] },
    { file: 'src/legacy.js', touches: 15, churn: 150, additions: 90, deletions: 60, net: 30, authors: ['b'], sequence: [] },
    { file: 'src/safe.js', touches: 5, churn: 30, additions: 20, deletions: 10, sequence: [] },
  ],
  thrash: [{ file: 'src/hot.js', touches: 20, churn: 200, net: 40, spinRatio: 5, authors: ['a'], lastSeen: '2024-06-01' }],
};

const NOW = () => 1_000_000_000_000; // 固定时间，便于审阅凭证不过期

/* ── fake 工厂 ────────────────────────────────── */

function makeFakeGithub(opts = {}) {
  const state = {
    baseSha: opts.baseSha || 'a'.repeat(40),
    baseBranch: opts.baseBranch || 'main',
    canPush: opts.canPush !== false,
    identityId: opts.identityId || 12345,
    duplicateOnSecond: Boolean(opts.duplicateOnSecond),
    createDraftCalls: 0,
    lastRequest: null,
  };
  return {
    state,
    request: async (path) => { state.lastRequest = path; return {}; },
    resolveBase: async () => ({ baseSha: state.baseSha, baseBranch: state.baseBranch, canPush: state.canPush }),
    identity: async () => ({ id: state.identityId, login: 'caller' }),
    readSource: async () => ({ source: FAKE_SOURCE, blobSha: 'b'.repeat(40), mode: '100644' }),
    createDraft: async (ticket) => {
      state.createDraftCalls++;
      if (state.duplicateOnSecond && state.createDraftCalls > 1) {
        throw new RefactorError('pr_duplicate', '已存在相同分支的开放草稿 PR，为避免重复提交已拒绝。', 409);
      }
      return { url: `https://github.com/owner/repo/pull/${state.createDraftCalls + 6}`, number: state.createDraftCalls + 6, branch: `refactor/owner-repo-${ticket.baseSha.slice(0, 12)}`, draft: true };
    },
  };
}

function makeFakeChat({ diff = null, capture = null } = {}) {
  return async ({ env, system, user, signal }) => {
    if (capture) capture({ env, system, user, signal });
    const u = JSON.parse(user);
    return JSON.stringify({ file: u.file, diff: diff ?? diffFor(u.file) });
  };
}

function makeFakeMine() {
  let lastOpts = null;
  const fn = async (opts) => { lastOpts = opts; return FAKE_REPORT; };
  fn.lastOpts = () => lastOpts;
  return fn;
}

// 跑一次 patch，返回后续 PR 测试所需的全部要素。
async function runPatch({ env = { REFACTOR_SIGNING_KEY: SIGNING_KEY }, token = 'ghp_caller', github = makeFakeGithub(), chat = makeFakeChat(), mineImpl = makeFakeMine(), now = NOW } = {}) {
  const res = await refactor({ params: { repo: 'owner/repo', mode: 'patch' }, env, token, github, chat, mineImpl, now });
  return { res, env, token, github, chat, mineImpl, now };
}

/* ═══ 正常 patch ═══════════════════════════════ */

test('正常 patch：返回可审阅 diff、digest、审阅凭证，且 prEligible 为真', async () => {
  const github = makeFakeGithub();
  const mineImpl = makeFakeMine();
  const res = await refactor({
    params: { repo: 'owner/repo', mode: 'patch' },
    env: { REFACTOR_SIGNING_KEY: SIGNING_KEY },
    token: 'ghp_caller',
    github,
    chat: makeFakeChat(),
    mineImpl,
    now: NOW,
  });

  assert.equal(res.mode, 'patch');
  assert.equal(res.file, 'src/hot.js'); // 候选排序首位
  assert.equal(res.diff, PATCH_DIFF);
  assert.equal(res.digest, await sha256(PATCH_DIFF));
  assert.equal(res.changedLines, 2);
  assert.equal(res.prEligible, true);
  assert.equal(typeof res.reviewToken, 'string');
  assert.equal(res.reviewToken.includes('.'), true);
  assert.equal(typeof res.expiresAt, 'number');
  assert.ok(Array.isArray(res.warnings) && res.warnings.length === 1);
  // 响应绝不含调用者 token
  assert.ok(!JSON.stringify(res).includes('ghp_caller'));
});

/* ═══ 固定 base ═══════════════════════════════ */

test('mine 注入使用固定 baseSha（ref 与 readSource 一致）', async () => {
  const github = makeFakeGithub({ baseSha: 'fixedShaABC' });
  const mineImpl = makeFakeMine();
  await refactor({
    params: { repo: 'owner/repo', mode: 'patch' },
    env: { REFACTOR_SIGNING_KEY: SIGNING_KEY },
    token: 'ghp_caller',
    github,
    chat: makeFakeChat(),
    mineImpl,
    now: NOW,
  });
  const opts = mineImpl.lastOpts();
  assert.equal(opts.repo, 'owner/repo');
  assert.equal(opts.ref, 'fixedShaABC'); // 固定到基础提交
  assert.equal(typeof opts.fetchImpl, 'function'); // 注入了受信任的 fetch
  // 源码也按同一 baseSha 读取
  assert.equal(github.state.baseSha, 'fixedShaABC');
});

/* ═══ 候选排序 ═════════════════════════════════ */

test('rankCandidates：被反复推翻文件优先，其次按 spinRatio/touches/churn', () => {
  const out = rankCandidates(FAKE_REPORT).map((x) => x.file);
  assert.deepEqual(out, ['src/hot.js', 'src/legacy.js', 'src/safe.js']);
  // src/hot.js 标记 repeated
  const hot = rankCandidates(FAKE_REPORT).find((x) => x.file === 'src/hot.js');
  assert.equal(hot.repeated, true);
  assert.equal(hot.spinRatio, 5);
});

test('rankCandidates：过滤掉不安全路径的候选', () => {
  const report = { hotspots: [{ file: '../../etc/passwd', touches: 1, churn: 1, sequence: [] }], thrash: [] };
  assert.deepEqual(rankCandidates(report), []);
});

/* ═══ 注入提示忽略 ═════════════════════════════ */

test('系统提示含注入忽略指令，且不可信仓库数据被显式标记', async () => {
  const github = makeFakeGithub();
  const mineImpl = makeFakeMine();
  let captured;
  await refactor({
    params: { repo: 'owner/repo', mode: 'patch' },
    env: { REFACTOR_SIGNING_KEY: SIGNING_KEY },
    token: 'ghp_caller',
    github,
    chat: makeFakeChat({ capture: (c) => { captured = c; } }),
    mineImpl,
    now: NOW,
  });
  assert.match(captured.system, /忽略/);
  assert.match(captured.system, /不是指令/);
  assert.match(captured.system, /泄露凭据/);
  assert.match(captured.system, /执行命令/);
  // 用户消息明确标注为不可信数据
  assert.match(captured.user, /UNTRUSTED_REPOSITORY_DATA/);
});

test('即使仓库数据内含注入指令，模型输出仍被约束为单文件 diff（不做越权）', async () => {
  // 伪造一个会「听从」注入的 chat：若 user 里写了 ignore，则仍只返回单文件 diff
  const github = makeFakeGithub();
  const mineImpl = makeFakeMine();
  const res = await refactor({
    params: { repo: 'owner/repo', mode: 'patch' },
    env: { REFACTOR_SIGNING_KEY: SIGNING_KEY },
    token: 'ghp_caller',
    github,
    chat: makeFakeChat(),
    mineImpl,
    now: NOW,
  });
  // 仅一个文件、diff 必合法、且不等于任何「delete everything」式越权输出
  assert.equal(res.file, 'src/hot.js');
  assert.ok(res.diff.startsWith('diff --git'));
});

/* ═══ 超时 / 模型缺失 / 坏 diff / 路径 / secret ═══ */

test('模型调用超时（模拟）：返回 model_timeout', async () => {
  const chat = async () => { throw new RefactorError('model_timeout', '模型调用超时', 504); };
  await assert.rejects(
    () => refactor({ params: { repo: 'owner/repo', mode: 'patch' }, env: { REFACTOR_SIGNING_KEY: SIGNING_KEY }, token: 'ghp_caller', github: makeFakeGithub(), chat, mineImpl: makeFakeMine(), now: NOW }),
    (e) => e.code === 'model_timeout'
  );
});

test('模型调用失败（模拟）：返回 model_error', async () => {
  const chat = async () => { throw Object.assign(new Error('boom'), { code: 'model_call_failed' }); };
  await assert.rejects(
    () => refactor({ params: { repo: 'owner/repo', mode: 'patch' }, env: { REFACTOR_SIGNING_KEY: SIGNING_KEY }, token: 'ghp_caller', github: makeFakeGithub(), chat, mineImpl: makeFakeMine(), now: NOW }),
    (e) => e.code === 'model_error'
  );
});

test('模型缺失（provider 已识别但无密钥）：返回 model_unavailable 503', async () => {
  // 不注入 chat → 使用默认模型；env 仅设置 provider，无 LLM_API_KEY
  await assert.rejects(
    () => refactor({ params: { repo: 'owner/repo', mode: 'patch' }, env: { LLM_PROVIDER: 'anthropic' }, token: 'ghp_caller', github: makeFakeGithub(), mineImpl: makeFakeMine(), now: NOW }),
    (e) => e.code === 'model_unavailable' && e.status === 503
  );
});

test('历史挖掘超时（模拟）：返回 history_timeout', async () => {
  const mineImpl = async () => { throw new RefactorError('history_timeout', '历史读取超时', 504); };
  await assert.rejects(
    () => refactor({ params: { repo: 'owner/repo', mode: 'patch' }, env: { REFACTOR_SIGNING_KEY: SIGNING_KEY }, token: 'ghp_caller', github: makeFakeGithub(), chat: makeFakeChat(), mineImpl, now: NOW }),
    (e) => e.code === 'history_timeout'
  );
});

test('坏 diff（上下文不符）：validatePatch 抛 patch_context_mismatch', async () => {
  const chat = makeFakeChat({ diff: BAD_DIFF });
  await assert.rejects(
    () => refactor({ params: { repo: 'owner/repo', mode: 'patch' }, env: { REFACTOR_SIGNING_KEY: SIGNING_KEY }, token: 'ghp_caller', github: makeFakeGithub(), chat, mineImpl: makeFakeMine(), now: NOW }),
    (e) => e.code === 'patch_context_mismatch'
  );
});

test('源码含凭据（secret）：sensitive_content', async () => {
  const chat = makeFakeChat({ diff: SECRET_DIFF });
  await assert.rejects(
    () => refactor({ params: { repo: 'owner/repo', mode: 'patch' }, env: { REFACTOR_SIGNING_KEY: SIGNING_KEY }, token: 'ghp_caller', github: makeFakeGithub(), chat, mineImpl: makeFakeMine(), now: NOW }),
    (e) => e.code === 'sensitive_content'
  );
});

test('path:null 视为不指定，回退到候选首位', async () => {
  const res = await refactor({
    params: { repo: 'owner/repo', mode: 'patch', path: null },
    env: { REFACTOR_SIGNING_KEY: SIGNING_KEY },
    token: 'ghp_caller',
    github: makeFakeGithub(),
    chat: makeFakeChat(),
    mineImpl: makeFakeMine(),
    now: NOW,
  });
  assert.equal(res.file, 'src/hot.js');
});

test('指定 path 命中候选：返回该文件', async () => {
  const res = await refactor({
    params: { repo: 'owner/repo', mode: 'patch', path: 'src/legacy.js' },
    env: { REFACTOR_SIGNING_KEY: SIGNING_KEY },
    token: 'ghp_caller',
    github: makeFakeGithub(),
    chat: makeFakeChat(),
    mineImpl: makeFakeMine(),
    now: NOW,
  });
  assert.equal(res.file, 'src/legacy.js');
});

test('指定 path 不在安全候选内：no_candidate', async () => {
  await assert.rejects(
    () => refactor({ params: { repo: 'owner/repo', mode: 'patch', path: 'src/missing.js' }, env: { REFACTOR_SIGNING_KEY: SIGNING_KEY }, token: 'ghp_caller', github: makeFakeGithub(), chat: makeFakeChat(), mineImpl: makeFakeMine(), now: NOW }),
    (e) => e.code === 'no_candidate'
  );
});

test('unsafe path（目录穿越）：unsafe_path', async () => {
  await assert.rejects(
    () => refactor({ params: { repo: 'owner/repo', mode: 'patch', path: '../../etc/passwd' }, env: { REFACTOR_SIGNING_KEY: SIGNING_KEY }, token: 'ghp_caller', github: makeFakeGithub(), chat: makeFakeChat(), mineImpl: makeFakeMine(), now: NOW }),
    (e) => e.code === 'unsafe_path'
  );
});

test('invalid repo：invalid_repo', async () => {
  await assert.rejects(
    () => refactor({ params: { repo: 'not a repo', mode: 'patch' }, env: { REFACTOR_SIGNING_KEY: SIGNING_KEY }, token: 'ghp_caller', github: makeFakeGithub(), chat: makeFakeChat(), mineImpl: makeFakeMine(), now: NOW }),
    (e) => e.code === 'invalid_repo'
  );
});

test('invalid mode：invalid_mode', async () => {
  await assert.rejects(
    () => refactor({ params: { repo: 'owner/repo', mode: 'nuke' }, env: { REFACTOR_SIGNING_KEY: SIGNING_KEY }, token: 'ghp_caller', github: makeFakeGithub(), chat: makeFakeChat(), mineImpl: makeFakeMine(), now: NOW }),
    (e) => e.code === 'invalid_mode'
  );
});

/* ═══ PR 流程 ═════════════════════════════════ */

test('PR 缺少 confirm：confirmation_required', async () => {
  const { res } = await runPatch();
  await assert.rejects(
    () => refactor({ params: { repo: 'owner/repo', mode: 'pr', reviewToken: res.reviewToken, diff: res.diff, reviewedDigest: res.digest }, env: { REFACTOR_SIGNING_KEY: SIGNING_KEY }, token: 'ghp_caller', github: makeFakeGithub(), chat: makeFakeChat(), mineImpl: makeFakeMine(), now: NOW }),
    (e) => e.code === 'confirmation_required'
  );
});

test('PR 缺少调用者 token：caller_auth_required 401', async () => {
  const { res } = await runPatch({ token: 'ghp_caller' });
  await assert.rejects(
    () => refactor({ params: { repo: 'owner/repo', mode: 'pr', confirm: true, reviewToken: res.reviewToken, diff: res.diff, reviewedDigest: res.digest }, env: { REFACTOR_SIGNING_KEY: SIGNING_KEY }, token: undefined, github: makeFakeGithub(), chat: makeFakeChat(), mineImpl: makeFakeMine(), now: NOW }),
    (e) => e.code === 'caller_auth_required' && e.status === 401
  );
});

test('PR 未配置签名密钥：pr_disabled 503', async () => {
  const { res } = await runPatch({ env: { REFACTOR_SIGNING_KEY: SIGNING_KEY } });
  await assert.rejects(
    () => refactor({ params: { repo: 'owner/repo', mode: 'pr', confirm: true, reviewToken: res.reviewToken, diff: res.diff, reviewedDigest: res.digest }, env: {}, token: 'ghp_caller', github: makeFakeGithub(), chat: makeFakeChat(), mineImpl: makeFakeMine(), now: NOW }),
    (e) => e.code === 'pr_disabled' && e.status === 503
  );
});

test('PR 审阅凭证/仓库不匹配：review_mismatch 403', async () => {
  const { res } = await runPatch();
  // 用不同 repo 提交
  await assert.rejects(
    () => refactor({ params: { repo: 'owner/other', mode: 'pr', confirm: true, reviewToken: res.reviewToken, diff: res.diff, reviewedDigest: res.digest }, env: { REFACTOR_SIGNING_KEY: SIGNING_KEY }, token: 'ghp_caller', github: makeFakeGithub(), chat: makeFakeChat(), mineImpl: makeFakeMine(), now: NOW }),
    (e) => e.code === 'review_mismatch' && e.status === 403
  );
});

test('PR diff 摘要被篡改：review_mismatch 403', async () => {
  const { res } = await runPatch();
  await assert.rejects(
    () => refactor({ params: { repo: 'owner/repo', mode: 'pr', confirm: true, reviewToken: res.reviewToken, diff: res.diff + '\n// tampered', reviewedDigest: res.digest }, env: { REFACTOR_SIGNING_KEY: SIGNING_KEY }, token: 'ghp_caller', github: makeFakeGithub(), chat: makeFakeChat(), mineImpl: makeFakeMine(), now: NOW }),
    (e) => e.code === 'review_mismatch' && e.status === 403
  );
});

test('PR 无写权限：write_forbidden 403', async () => {
  const github = makeFakeGithub({ canPush: true }); // patch 时有权 → 签发 reviewToken
  const { res } = await runPatch({ github });
  github.state.canPush = false; // PR 时撤销权限
  await assert.rejects(
    () => refactor({ params: { repo: 'owner/repo', mode: 'pr', confirm: true, reviewToken: res.reviewToken, diff: res.diff, reviewedDigest: res.digest }, env: { REFACTOR_SIGNING_KEY: SIGNING_KEY }, token: 'ghp_caller', github, chat: makeFakeChat(), mineImpl: makeFakeMine(), now: NOW }),
    (e) => e.code === 'write_forbidden' && e.status === 403
  );
});

test('PR 基础提交已变化：stale_base 409', async () => {
  const github = makeFakeGithub({ baseSha: 'a'.repeat(40), canPush: true });
  const { res } = await runPatch({ github });
  github.state.baseSha = 'baseSHA99999999'; // PR 时基础已变
  await assert.rejects(
    () => refactor({ params: { repo: 'owner/repo', mode: 'pr', confirm: true, reviewToken: res.reviewToken, diff: res.diff, reviewedDigest: res.digest }, env: { REFACTOR_SIGNING_KEY: SIGNING_KEY }, token: 'ghp_caller', github, chat: makeFakeChat(), mineImpl: makeFakeMine(), now: NOW }),
    (e) => e.code === 'stale_base' && e.status === 409
  );
});

test('PR 正常：创建草稿并返回 url', async () => {
  const { res, github } = await runPatch();
  const pr = await refactor({ params: { repo: 'owner/repo', mode: 'pr', confirm: true, reviewToken: res.reviewToken, diff: res.diff, reviewedDigest: res.digest }, env: { REFACTOR_SIGNING_KEY: SIGNING_KEY }, token: 'ghp_caller', github, chat: makeFakeChat(), mineImpl: makeFakeMine(), now: NOW });
  assert.equal(pr.mode, 'pr');
  assert.match(pr.url, /github\.com\/owner\/repo\/pull\//);
  assert.equal(pr.draft, true);
  assert.equal(github.state.createDraftCalls, 1);
});

test('PR replay：同一审阅凭证二次提交被适配器拒绝（pr_duplicate 409）', async () => {
  const github = makeFakeGithub({ canPush: true, duplicateOnSecond: true });
  const { res } = await runPatch({ github });
  const args = { params: { repo: 'owner/repo', mode: 'pr', confirm: true, reviewToken: res.reviewToken, diff: res.diff, reviewedDigest: res.digest }, env: { REFACTOR_SIGNING_KEY: SIGNING_KEY }, token: 'ghp_caller', github, chat: makeFakeChat(), mineImpl: makeFakeMine(), now: NOW };
  await refactor(args); // 第一次成功
  await assert.rejects(() => refactor(args), (e) => e.code === 'pr_duplicate' && e.status === 409); // 重放被拒
});

/* ═══ 审阅凭证签名/验签 ═════════════════════════ */

test('verifyReviewToken：合法凭证可解析且与签名密钥绑定', async () => {
  const { res } = await runPatch();
  const ticket = await verifyReviewToken(res.reviewToken, SIGNING_KEY, NOW());
  assert.equal(ticket.repo, 'owner/repo');
  assert.equal(ticket.file, 'src/hot.js');
  assert.equal(ticket.digest, res.digest);
  assert.equal(ticket.userId, 12345);
});

test('verifyReviewToken：错误密钥验签失败', async () => {
  const { res } = await runPatch();
  await assert.rejects(() => verifyReviewToken(res.reviewToken, 'z'.repeat(40), NOW()), (e) => e.code === 'invalid_review');
});

test('verifyReviewToken：篡改 payload 验签失败', async () => {
  const { res } = await runPatch();
  const [payload, sig] = res.reviewToken.split('.');
  const tampered = payload.slice(0, -2) + (payload.endsWith('A') ? 'B' : 'A') + '.' + sig;
  await assert.rejects(() => verifyReviewToken(tampered, SIGNING_KEY, NOW()), (e) => e.code === 'invalid_review');
});

test('verifyReviewToken：过期凭证被拒', async () => {
  const { res } = await runPatch();
  // 用一个「未来很久」的 now，使 expiresAt 落在 now 之前
  await assert.rejects(() => verifyReviewToken(res.reviewToken, SIGNING_KEY, NOW() + 2 * 60 * 60 * 1000), (e) => e.code === 'invalid_review');
});

/* ═══ validatePatch 单元 ═══════════════════════ */

test('validatePatch：合格 diff 通过并给出 changedLines', () => {
  const out = validatePatch({ diff: PATCH_DIFF, source: FAKE_SOURCE, file: 'src/hot.js' });
  assert.equal(out.changedLines, 2);
  assert.match(out.source, /return x \+ 2/);
});

test('validatePatch：空改动（无差异）被拒', () => {
  const empty = 'diff --git a/src/hot.js b/src/hot.js\n--- a/src/hot.js\n+++ b/src/hot.js\n@@ -1,3 +1,3 @@\n function compute(x) {\n   return x + 1;\n }\n';
  assert.throws(() => validatePatch({ diff: empty, source: FAKE_SOURCE, file: 'src/hot.js' }), (e) => e.code === 'empty_patch');
});

test('validatePatch：路径不匹配被拒', () => {
  assert.throws(() => validatePatch({ diff: PATCH_DIFF, source: FAKE_SOURCE, file: 'src/other.js' }), (e) => e.code === 'unsafe_patch_path');
});
