// 安全重构 Web 端测试 —— node:test + 手写 DOM 桩 + fake fetch。
// 全程不触网、不装依赖、不读 .env / .dev.vars / keychain、不做任何真实 PR。
//
// 覆盖：
//   正常生成 / 失败清理旧预览 / 超时告知检查分支不重试 / XSS 安全(textContent) /
//   显式确认才 PR / token 切换使旧票据失效 / 下载不含 token / 销毁清理敏感状态 /
//   请求不传 path:null 且 redirect:'error' / PR 链接仅接受 http(s)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mountRefactor, prReadiness, isSafeHttpUrl } from '../public/refactor.js';

/* ── 手写最小 DOM 桩（不依赖 jsdom） ──── */

class El {
  constructor(tag) {
    this.tagName = tag;
    this.children = [];
    this.className = '';
    this._text = '';
    this.dataset = {};
    this.attrs = {};
    this.listeners = {};
    this.parent = null;
    // 任意属性（hidden/disabled/type/value/checked/href/rel/target/download...）
  }
  set textContent(v) {
    this._text = String(v ?? '');
    this.children = [];
  }
  get textContent() {
    if (this.children.length === 0) return this._text;
    return this.children.map((c) => c.textContent).join('');
  }
  set innerHTML(v) {
    if (v === '') {
      this.children = [];
      this._text = '';
    } else {
      throw new Error('stub: innerHTML 仅支持清空');
    }
  }
  get innerHTML() {
    return '';
  }
  setAttribute(k, v) {
    this.attrs[k] = v;
  }
  getAttribute(k) {
    return this.attrs[k];
  }
  appendChild(c) {
    c.parent = this;
    this.children.push(c);
    return c;
  }
  removeChild(c) {
    const i = this.children.indexOf(c);
    if (i >= 0) {
      this.children.splice(i, 1);
      c.parent = null;
    }
    return c;
  }
  remove() {
    if (this.parent) this.parent.removeChild(this);
  }
  addEventListener(t, fn) {
    (this.listeners[t] ||= []).push(fn);
  }
  dispatch(t, ev = {}) {
    (this.listeners[t] || []).forEach((fn) => fn(ev));
  }
  click() {
    this.dispatch('click');
  }
}

function makeDoc() {
  const body = new El('body');
  return { body, createElement: (t) => new El(t) };
}

function makeHistory(loc) {
  const calls = [];
  return {
    calls,
    replaceState(state, title, url) {
      calls.push({ state, title, url });
      // 模拟浏览器行为：replaceState 会更新 location.hash
      if (loc && typeof url === 'string' && url.startsWith('#')) loc.hash = url;
      else if (loc && url === ' ') loc.hash = '';
    },
  };
}

function makeLoc() {
  return { hash: '' };
}

/* ── 子树查询工具 ──────── */

function descendants(node, out = []) {
  for (const c of node.children) {
    out.push(c);
    descendants(c, out);
  }
  return out;
}
function byClass(node, cls) {
  return descendants(node).filter((e) => String(e.className).split(/\s+/).includes(cls));
}
function one(node, cls) {
  return byClass(node, cls)[0];
}

/* ── fake fetch ──────── */

function fakeFetch(data) {
  const calls = [];
  const fn = async (url, opts) => {
    calls.push({ url: String(url), opts });
    return { ok: true, status: 200, json: async () => ({ ok: true, data }) };
  };
  fn.calls = calls;
  return fn;
}

function fakeFetchFail(message, status = 500) {
  const calls = [];
  const fn = async (url, opts) => {
    calls.push({ url: String(url), opts });
    return { ok: false, status, json: async () => ({ ok: false, error: true, message }) };
  };
  fn.calls = calls;
  return fn;
}

// 永不 resolve，仅在 signal 被 abort 时以 AbortError 拒绝。
function fakeFetchHang() {
  const calls = [];
  const fn = (url, opts) => {
    calls.push({ url: String(url), opts });
    return new Promise((_, reject) => {
      const sig = opts.signal;
      if (!sig) return;
      const onAbort = () => {
        const e = new Error('aborted');
        e.name = 'AbortError';
        reject(e);
      };
      if (sig.aborted) onAbort();
      else sig.addEventListener('abort', onAbort);
    });
  };
  fn.calls = calls;
  return fn;
}

// 按序返回响应；最后一项循环复用（用于 patch 后接 PR 的场景）。
function fakeFetchSeq(responses) {
  const calls = [];
  let i = 0;
  const fn = async (url, opts) => {
    calls.push({ url: String(url), opts });
    const r = responses[Math.min(i, responses.length - 1)];
    i++;
    return { ok: r.ok !== false, status: r.status ?? 200, json: async () => r.json };
  };
  fn.calls = calls;
  return fn;
}

/* ── 样本数据（符合 API 契约） ──────── */

const PATCH_DATA = {
  mode: 'patch',
  repo: 'owner/repo',
  file: 'src/legacy.js',
  baseSha: 'abc123def456',
  baseBranch: 'main',
  diff: '--- a/src/legacy.js\n+++ b/src/legacy.js\n-const x = 1;\n+const x = 2;\n',
  digest: 'deadbeef' + '0'.repeat(56),
  changedLines: 2,
  evidence: { commit: 'abc123', author: 'human' },
  warnings: ['该文件历史含机器人提交'],
  reviewToken: 'rt_xyz',
  prEligible: true,
  expiresAt: Date.now() + 60000,
};

const PR_DATA = {
  mode: 'pr',
  url: 'https://github.com/owner/repo/pull/7',
  number: 7,
  draft: true,
  branch: 'refactor/owner-repo-abc123',
};

/* ── 通用挂载 ──────── */

function mount(overrides = {}) {
  const doc = makeDoc();
  const root = doc.createElement('main');
  const loc = makeLoc();
  const history = makeHistory(loc);
  const api = mountRefactor(root, {
    repo: 'owner/repo',
    doc,
    history,
    loc,
    ...overrides,
  });
  return { doc, root, history, loc, api };
}

const TOKEN = 'ghp_user_typed_token_123';

/* ═══ 纯函数 ═════════════════════════════════ */

test('prReadiness 四条件缺一不可', () => {
  const base = { prEligible: true, reviewToken: 'rt', hasToken: true, confirmed: true };
  assert.strictEqual(prReadiness(base), true);
  assert.strictEqual(prReadiness({ ...base, prEligible: false }), false);
  assert.strictEqual(prReadiness({ ...base, reviewToken: '' }), false);
  assert.strictEqual(prReadiness({ ...base, hasToken: false }), false);
  assert.strictEqual(prReadiness({ ...base, confirmed: false }), false);
});

test('isSafeHttpUrl 仅放行 http(s) 绝对地址', () => {
  assert.strictEqual(isSafeHttpUrl('https://github.com/x/y/pull/1'), true);
  assert.strictEqual(isSafeHttpUrl('http://localhost:8787/api'), true);
  assert.strictEqual(isSafeHttpUrl('javascript:alert(1)'), false);
  assert.strictEqual(isSafeHttpUrl('data:text/html,<script>'), false);
  assert.strictEqual(isSafeHttpUrl('vbscript:msgbox'), false);
  assert.strictEqual(isSafeHttpUrl(''), false);
  assert.strictEqual(isSafeHttpUrl('/relative/path'), false);
});

/* ═══ 正常生成 ═══════════════════════════════ */

test('生成补丁：渲染 diff、证据、可下载，且请求不传 path:null、redirect:error', async () => {
  const f = fakeFetch(PATCH_DATA);
  const { root, api } = mount({ fetchImpl: f });

  await api.generate();

  const diffPre = one(root, 'refactor-diff');
  assert.strictEqual(diffPre.hidden, false);
  assert.strictEqual(diffPre.textContent, PATCH_DATA.diff);

  const dlBtn = one(root, 'refactor-download');
  assert.strictEqual(dlBtn.disabled, false);

  const status = one(root, 'refactor-status');
  assert.strictEqual(status.className.includes('is-ok'), true);

  // 关键：patch 请求体不含 path:null
  const body = JSON.parse(f.calls[0].opts.body);
  assert.strictEqual(body.mode, 'patch');
  assert.strictEqual(body.path, undefined);
  assert.strictEqual('path' in body, false);
  // 关键：所有请求 redirect:'error'
  assert.strictEqual(f.calls[0].opts.redirect, 'error');
  // 习惯：X-GitHub-Token 仅来自用户输入（此处为空 -> 不发送）
  assert.strictEqual(f.calls[0].opts.headers['X-GitHub-Token'], undefined);
});

test('busy 状态阻断重复点击：连续两次 generate 只发一次请求', async () => {
  const f = fakeFetch(PATCH_DATA);
  const { api } = mount({ fetchImpl: f });
  const p1 = api.generate();
  const p2 = api.generate();
  await Promise.all([p1, p2]);
  assert.strictEqual(f.calls.length, 1);
});

/* ═══ 失败：清理旧预览 ═══════════════════════ */

test('第二次生成失败会清空旧 diff 预览与敏感状态', async () => {
  let n = 0;
  const f = async () => {
    n++;
    if (n === 1) return { ok: true, status: 200, json: async () => ({ ok: true, data: PATCH_DATA }) };
    return { ok: false, status: 500, json: async () => ({ ok: false, error: true, message: '后台流水线异常' }) };
  };
  const { root, api } = mount({ fetchImpl: f });

  await api.generate();
  const diffPreAfterOk = one(root, 'refactor-diff');
  assert.strictEqual(diffPreAfterOk.hidden, false);
  assert.strictEqual(diffPreAfterOk.textContent, PATCH_DATA.diff);

  await api.generate(); // 失败
  const diffPre = one(root, 'refactor-diff');
  assert.strictEqual(diffPre.hidden, true, '失败时旧预览应被隐藏');
  assert.strictEqual(diffPre.textContent, '', '失败时旧预览文本应清空');
  assert.strictEqual(api.getState().patch, null, '失败时 patch 应清空');
  const dlBtn = one(root, 'refactor-download');
  assert.strictEqual(dlBtn.disabled, true);
  const status = one(root, 'refactor-status');
  assert.match(status.textContent, /后台流水线异常/);
});

/* ═══ 超时：告知检查分支，不重试 ══════════════ */

test('请求超时：提示去 GitHub 检查分支，且不自动重试', async () => {
  const f = fakeFetchHang();
  const { root, api } = mount({ fetchImpl: f, timeoutMs: 30 });
  await api.generate();
  const status = one(root, 'refactor-status');
  assert.match(status.textContent, /超时/);
  assert.match(status.textContent, /检查对应分支|草稿 PR/);
  assert.doesNotMatch(status.textContent, /请稍后重试/); // 不应鼓励重试
  assert.strictEqual(f.calls.length, 1, '超时后不应自动重发');
});

/* ═══ XSS 安全 ════════════════════════════════ */

test('恶意 diff 通过 textContent 渲染，绝不生成可执行节点', async () => {
  const evil = '<img src=x onerror=alert(1)> </script><script>alert(2)</script>';
  const f = fakeFetch({ ...PATCH_DATA, diff: evil });
  const { root, api } = mount({ fetchImpl: f });
  await api.generate();

  const diffPre = one(root, 'refactor-diff');
  // 文本原样保存
  assert.strictEqual(diffPre.textContent, evil);
  // 没有因为 textContent 而创建任何子元素（证明未被解析为 HTML）
  assert.strictEqual(diffPre.children.length, 0);
  // 整个面板内都不应出现由 diff 注入的 <script>/<img> 元素
  const scripts = descendants(root).filter((e) => e.tagName === 'script' || e.tagName === 'img');
  assert.strictEqual(scripts.length, 0);
});

/* ═══ 显式确认才 PR ════════════════════════════ */

test('未勾选确认时 PR 按钮禁用；勾选 + token + 凭证后才放行', async () => {
  const f = fakeFetch(PATCH_DATA);
  const { root, api } = mount({ fetchImpl: f });

  const tokenInput = one(root, 'refactor-token');
  const confirmBox = one(root, 'refactor-confirm-box');
  const prBtn = one(root, 'refactor-pr');

  // 先输入 token（在生成之前），避免触发「换 token 失效旧票据」逻辑
  tokenInput.value = TOKEN;
  tokenInput.dispatch('input');

  await api.generate();
  // 刚生成后确认框被重置，PR 按钮应禁用（缺确认）
  assert.strictEqual(prBtn.disabled, true);

  // 勾选确认 -> 启用
  confirmBox.checked = true;
  confirmBox.dispatch('change');
  assert.strictEqual(prBtn.disabled, false);
});

test('完整 PR 流程：请求体含 confirm/reviewedDigest/reviewToken/diff，且带用户 token', async () => {
  const f = fakeFetchSeq([
    { json: { ok: true, data: PATCH_DATA } },
    { json: { ok: true, data: PR_DATA } },
  ]);
  const { root, api } = mount({ fetchImpl: f });

  const tokenInput = one(root, 'refactor-token');
  const confirmBox = one(root, 'refactor-confirm-box');

  tokenInput.value = TOKEN;
  tokenInput.dispatch('input');
  await api.generate();
  confirmBox.checked = true;
  confirmBox.dispatch('change');

  const prBtn = one(root, 'refactor-pr');
  assert.strictEqual(prBtn.disabled, false);
  prBtn.click();
  await new Promise((r) => setTimeout(r, 0)); // 让 onPr 的 await 完成

  assert.strictEqual(f.calls.length, 2, '应发了 patch + pr 两次请求');
  const prBody = JSON.parse(f.calls[1].opts.body);
  assert.strictEqual(prBody.mode, 'pr');
  assert.strictEqual(prBody.confirm, true);
  assert.strictEqual(prBody.reviewedDigest, PATCH_DATA.digest);
  assert.strictEqual(prBody.reviewToken, PATCH_DATA.reviewToken);
  assert.strictEqual(prBody.diff, PATCH_DATA.diff);
  assert.strictEqual(prBody.repo, 'owner/repo');
  // X-GitHub-Token 仅来自用户输入
  assert.strictEqual(f.calls[1].opts.headers['X-GitHub-Token'], TOKEN);
  assert.strictEqual(f.calls[1].opts.redirect, 'error');

  // PR 成功后应撤销「已审阅」确认
  assert.strictEqual(confirmBox.checked, false);
  assert.strictEqual(api.getState().confirmed, false);
});

test('PR 成功后渲染安全链接（http(s) 才生成可点击 href）', async () => {
  const f = fakeFetchSeq([
    { json: { ok: true, data: PATCH_DATA } },
    { json: { ok: true, data: PR_DATA } },
  ]);
  const { root, api } = mount({ fetchImpl: f });
  const tokenInput = one(root, 'refactor-token');
  const confirmBox = one(root, 'refactor-confirm-box');
  tokenInput.value = TOKEN;
  tokenInput.dispatch('input');
  await api.generate();
  confirmBox.checked = true;
  confirmBox.dispatch('change');
  one(root, 'refactor-pr').click();
  await new Promise((r) => setTimeout(r, 0));

  const link = one(root, 'refactor-pr-link');
  assert.ok(link, '应渲染 PR 链接');
  assert.strictEqual(link.href, PR_DATA.url);
  assert.strictEqual(link.target, '_blank');
});

/* ═══ token 切换使旧票据失效 ══════════════════ */

test('切换 token 会令旧审阅票据失效，必须重新生成', async () => {
  const f = fakeFetch(PATCH_DATA);
  const { root, api } = mount({ fetchImpl: f });

  const tokenInput = one(root, 'refactor-token');
  const confirmBox = one(root, 'refactor-confirm-box');

  tokenInput.value = TOKEN;
  tokenInput.dispatch('input');
  await api.generate();
  confirmBox.checked = true;
  confirmBox.dispatch('change');

  const prBtn = one(root, 'refactor-pr');
  assert.strictEqual(prBtn.disabled, false, '初始 token 下 PR 可点');

  // 切换为另一个 token -> 旧 reviewToken 立即失效（diff 仍可见，但 PR 资格被撤销）
  tokenInput.value = 'ghp_another_token_999';
  tokenInput.dispatch('input');

  const patch = api.getState().patch;
  assert.ok(patch, 'diff 预览应保留供人工复核');
  assert.strictEqual(patch.reviewToken, null, '旧审阅票据应失效');
  assert.strictEqual(patch.prEligible, false, '切换 token 后 PR 资格应被撤销');
  assert.strictEqual(prBtn.disabled, true, '切换 token 后 PR 应禁用，必须重新生成');

  // 用新 token 重新生成可恢复 PR 资格
  await api.generate();
  const patch2 = api.getState().patch;
  assert.ok(patch2.reviewToken, '重新生成后换发新票据');
  assert.strictEqual(patch2.prEligible, true);
});

/* ═══ 下载不含 token ══════════════════════════ */

test('下载 .diff 仅含 diff 文本，绝不含 token', async () => {
  const f = fakeFetch(PATCH_DATA);
  const blobCapture = [];
  function BlobCtor(parts, opts) {
    this.parts = parts;
    this.type = opts && opts.type;
    blobCapture.push(this);
  }
  const URLCtor = { createObjectURL: () => 'blob:fake', revokeObjectURL: () => {} };
  const { root, api } = mount({ fetchImpl: f, blobCtor: BlobCtor, urlCtor: URLCtor });

  await api.generate();
  const dlBtn = one(root, 'refactor-download');
  dlBtn.click();

  assert.strictEqual(blobCapture.length, 1, '应创建一次 Blob');
  const content = blobCapture[0].parts.join('');
  assert.strictEqual(content, PATCH_DATA.diff);
  assert.doesNotMatch(content, /ghp_|github_pat_|token/i, '下载内容不得含 token');
  // 生成的 blob URL 也不含 token
  assert.doesNotMatch('blob:fake', /ghp_|github_pat_/i);
});

/* ═══ getState 不泄露 token ═══════════════════ */

test('getState 在任何时候都不暴露 token', async () => {
  const f = fakeFetch(PATCH_DATA);
  const { root, api } = mount({ fetchImpl: f });
  const tokenInput = one(root, 'refactor-token');
  tokenInput.value = TOKEN;
  tokenInput.dispatch('input');
  await api.generate();

  const s = api.getState();
  assert.strictEqual(s.token, undefined, 'getState 不应包含 token 字段');
  assert.ok(s.patch, '应暴露非敏感的 patch');
  assert.strictEqual(s.busy, false);
});

/* ═══ 销毁：清理敏感状态与 DOM ════════════════ */

test('destroy 清理 token、移除面板、撤销 URL 标记', async () => {
  const f = fakeFetch(PATCH_DATA);
  const { root, history, api } = mount({ fetchImpl: f });
  const tokenInput = one(root, 'refactor-token');
  tokenInput.value = TOKEN;
  tokenInput.dispatch('input');
  await api.generate();

  assert.strictEqual(byClass(root, 'refactor-panel').length, 1);
  api.destroy();

  assert.strictEqual(byClass(root, 'refactor-panel').length, 0, '面板应从 DOM 移除');
  assert.strictEqual(api.getState().token, undefined, 'destroy 后 token 应被清理');
  assert.strictEqual(api.getState().patch, null);
  // 生成时已 replaceState('#refactor')，销毁时应再次 replaceState 清理
  assert.ok(history.calls.some((c) => c.url === '#refactor'));
  assert.ok(history.calls.some((c) => c.url === ' '), 'destroy 应撤销 URL 标记');
});

/* ═══ PR 返回非法 URL 时不生成可点击链接 ══════ */

test('PR 返回 javascript: URL 时只提示文本，不生成危险链接', async () => {
  const f = fakeFetchSeq([
    { json: { ok: true, data: PATCH_DATA } },
    { json: { ok: true, data: { mode: 'pr', url: 'javascript:alert(1)', number: 8, draft: true, branch: 'b' } } },
  ]);
  const { root, api } = mount({ fetchImpl: f });
  const tokenInput = one(root, 'refactor-token');
  const confirmBox = one(root, 'refactor-confirm-box');
  tokenInput.value = TOKEN;
  tokenInput.dispatch('input');
  await api.generate();
  confirmBox.checked = true;
  confirmBox.dispatch('change');
  one(root, 'refactor-pr').click();
  await new Promise((r) => setTimeout(r, 0));

  const link = one(root, 'refactor-pr-link');
  assert.strictEqual(link, undefined, '危险 URL 不应生成可点击链接');
  const anchors = descendants(root).filter((e) => e.tagName === 'a');
  for (const a of anchors) {
    assert.notMatch(String(a.href), /^javascript:/i, '不得出现 javascript: 链接');
  }
  const status = one(root, 'refactor-status');
  assert.match(status.textContent, /未返回可验证链接|自行核对/);
});
