// 安全重构入口 · 真实浏览器集成「场景」脚本（由 refactor-entry-browser.test.mjs 在独立子进程中运行）。
//
// 为什么独立进程：app.js 在模块顶层读取 document/window/location/history 全局，并依赖全局 fetch；
// node --test 会并发运行所有测试文件，若在本进程注入这些全局会污染并发执行的其它测试。
// 因此把整段 jsdom 场景放在单独进程里跑，主测试只解析它打印的 JSON 结论，全局零泄漏。
//
// 用法：node tests/refactor-entry-scenario.mjs  →  向 stdout 输出一行 JSON { pass, fail, checks, errors }

import { JSDOM } from 'jsdom';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mine } from '../src/miner.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = await readFile(path.join(ROOT, 'public', 'index.html'), 'utf8');

const sha = 'a'.repeat(40);
function historyFetch() {
  return async (url) => {
    const u = new URL(url);
    let data;
    if (u.pathname === '/repos/owner/repo') data = { full_name: 'owner/repo', default_branch: 'main', created_at: '2025-01-01T00:00:00Z', pushed_at: '2026-01-01T00:00:00Z', stargazers_count: 0, forks_count: 0, open_issues_count: 0, size: 1, language: 'JavaScript', archived: false };
    else if (u.pathname === '/repos/owner/repo/commits') data = [{ sha }];
    else if (u.pathname === `/repos/owner/repo/commits/${sha}`) data = { sha, parents: [], author: { login: 'fixture', type: 'User' }, commit: { author: { name: 'fixture', date: '2026-01-01T00:00:00Z' }, message: 'refactor: simplify helper' }, files: [{ filename: 'src/a.js', status: 'modified', additions: 2, deletions: 1 }] };
    else throw new Error('Unexpected fixture URL ' + u.pathname);
    return new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } });
  };
}
const report = await mine({ repo: 'owner/repo', limit: 10, ref: sha, fetchImpl: historyFetch() });

function makeBackend(modeRef) {
  return async (url, opts = {}) => {
    const u = new URL(String(url), 'http://localhost:8787');
    const p = u.pathname;
    if (p === '/api/health') return { ok: true, status: 200, json: async () => ({ ok: true, data: { model: { configured: false } } }) };
    if (p === '/api/mine') return { ok: true, status: 200, json: async () => ({ ok: true, data: report }) };
    if (p === '/api/excavate') return { ok: true, status: 200, json: async () => ({ ok: true, data: { analysis: { available: false, reason: 'no model', degradations: [] } } }) };
    if (p === '/api/refactor') {
      const body = opts.body ? JSON.parse(opts.body) : {};
      if (body.mode === 'pr') return { ok: true, status: 200, json: async () => ({ ok: true, data: { mode: 'pr', url: 'https://github.com/owner/repo/pull/9', number: 9, draft: true, branch: 'refactor/owner-repo-' + sha.slice(0, 7) } }) };
      if (modeRef.v === 'model_unavailable') return { ok: false, status: 503, json: async () => ({ ok: false, error: true, message: '未配置重构模型（缺少对应 provider 凭据）；原有纯计算考古功能仍可用。' }) };
      const prEligible = modeRef.v === 'pr';
      return { ok: true, status: 200, json: async () => ({ ok: true, data: {
        mode: 'patch', repo: 'owner/repo', file: 'src/a.js', baseSha: sha, baseBranch: 'main',
        diff: '--- a/src/a.js\n+++ b/src/a.js\n-const x = 1;\n+const x = 2;\n', digest: 'd'.repeat(64), changedLines: 1,
        evidence: { commit: sha, author: 'human' }, warnings: ['历史只能证明改了什么'],
        reviewToken: prEligible ? 'payload.sign' : null, prEligible, expiresAt: prEligible ? Date.now() + 600000 : null,
      } }) };
    }
    throw new Error('unhandled ' + p);
  };
}

// 全量 node:test 会并行启动多个子进程，机器繁忙时入口挂载可能超过 8 秒；
// 这里等待业务条件而不是依赖固定动画时长，最长 30 秒仍只用于测试。
const waitFor = async (pred, ms = 30000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (pred()) return true; await new Promise((r) => setTimeout(r, 30)); }
  return false;
};

const checks = [];
const rec = (name, cond, extra = '') => checks.push({ name, ok: Boolean(cond), extra });
const modeRef = { v: 'ok' };
const errors = [];

try {
  const dom = new JSDOM(html, { url: 'http://localhost:8787/', pretendToBeVisual: true });
  const { window } = dom;
  window.HTMLElement.prototype.scrollIntoView = () => {};
  globalThis.document = window.document;
  globalThis.window = window;
  globalThis.location = window.location;
  globalThis.history = window.history;
  globalThis.fetch = makeBackend(modeRef);
  window.addEventListener?.('error', (e) => errors.push(e.message));

  await import(path.join(ROOT, 'public', 'app.js'));
  const doc = window.document;
  const $ = (s) => doc.querySelector(s);
  const click = (el) => el && el.dispatchEvent(new window.Event('click', { bubbles: true }));
  const form = $('#digForm');
  const submit = () => form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));

  // 场景1：正常考古 + 入口挂载 + 生成补丁
  modeRef.v = 'ok';
  $('#repo').value = 'owner/repo';
  submit();
  const firstOk = await waitFor(() => $('#refactorZone')?.children.length > 0);
  rec('面板挂载', firstOk);
  rec('找到 .refactor-panel', Boolean($('#refactorZone .refactor-panel')));
  rec('找到「生成补丁」按钮', Boolean($('#refactorZone .refactor-generate')));
  click($('#refactorZone .refactor-generate'));
  rec('生成后 diff 经 textContent 渲染', await waitFor(() => { const pre = $('#refactorZone .refactor-diff'); return pre && !pre.hidden && pre.textContent.includes('const x = 2'); }));
  rec('下载按钮已启用', $('#refactorZone .refactor-download')?.disabled === false);
  rec('prEligible=false 时 PR 按钮禁用', $('#refactorZone .refactor-pr')?.disabled === true);

  // 场景2：重新考古不重复挂载
  $('#repo').value = 'owner/repo2';
  submit();
  rec('重考古后只一个面板', await waitFor(() => doc.querySelectorAll('#refactorZone .refactor-panel').length === 1), 'count=' + doc.querySelectorAll('#refactorZone .refactor-panel').length);

  // 场景3：token 先输入 → 生成可 PR 补丁 → 确认 → 创建草稿 PR → 下载
  modeRef.v = 'pr';
  const tokenInput = $('#refactorZone .refactor-token');
  tokenInput.value = 'ghp_user_typed_token_123';
  tokenInput.dispatchEvent(new window.Event('input', { bubbles: true }));
  click($('#refactorZone .refactor-generate'));
  rec('生成可 PR 补丁', await waitFor(() => { const pre = $('#refactorZone .refactor-diff'); return pre && !pre.hidden; }));
  rec('生成后确认框被重置（PR 仍禁用）', $('#refactorZone .refactor-pr')?.disabled === true);
  const confirmBox = $('#refactorZone .refactor-confirm-box');
  confirmBox.checked = true;
  confirmBox.dispatchEvent(new window.Event('change', { bubbles: true }));
  rec('勾选确认后 PR 按钮启用', $('#refactorZone .refactor-pr')?.disabled === false);
  click($('#refactorZone .refactor-pr'));
  rec('PR 成功', await waitFor(() => $('#refactorZone .refactor-pr-link') || /草稿 PR 已创建/.test($('#refactorZone .refactor-status')?.textContent || '')));
  const link = $('#refactorZone .refactor-pr-link');
  rec('渲染 PR 链接', Boolean(link));
  rec('PR 链接为 http(s)', link ? /^https?:\/\//.test(link.getAttribute('href')) : false);
  rec('PR 成功后确认撤销（按钮禁用）', $('#refactorZone .refactor-pr')?.disabled === true);
  click($('#refactorZone .refactor-download'));
  rec('下载被触发不抛错', true);

  // 场景4：后端 503 model_unavailable
  modeRef.v = 'model_unavailable';
  click($('#refactorZone .refactor-generate'));
  rec('前端如实展示 model_unavailable', await waitFor(() => /未配置重构模型|生成补丁失败/.test($('#refactorZone .refactor-status')?.textContent || '')));
  rec('失败后旧 diff 预览清空', $('#refactorZone .refactor-diff')?.hidden === true);
} catch (e) {
  errors.push('THROW: ' + (e && e.stack || e));
}

const pass = checks.filter((c) => c.ok).length;
const fail = checks.length - pass;
process.stdout.write(JSON.stringify({ pass, fail, checks, errors }) + '\n');
process.exit(fail || errors.length ? 1 : 0);
