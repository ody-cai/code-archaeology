// 安全重构入口 · 真实浏览器集成测试（jsdom，子进程隔离）。
//
// 为什么需要它：tests/refactor-web.test.mjs 用手写 DOM 桩 + fake fetch 直接调用 mountRefactor，
// 从不加载 public/app.js；且桩的 innerHTML 设定器对非空字符串直接抛错，所以 app.js 的
// renderReportShell → document.getElementById('refactorZone') → mountRefactor 这条「入口挂载」链路
// 完全没有被单测覆盖。本测试在独立子进程里用 jsdom 真正加载 public/app.js（连带 render.js /
// refactor.js），驱动真实表单提交与按钮点击，验证入口从挂载到生成/下载/PR 的端到端行为。
//
// 子进程隔离：app.js 在模块顶层读取 document/window/location/history 全局并依赖全局 fetch；
// node --test 并发运行所有文件，若在本进程注入这些全局会污染并发的其它测试，因此整段场景放在
// tests/refactor-entry-scenario.mjs 里以子进程方式执行，本文件只解析它输出的 JSON 结论（全局零泄漏）。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const scenario = path.join(ROOT, 'refactor-entry-scenario.mjs');

function runScenario() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [scenario], { cwd: ROOT, env: { ...process.env, NODE_PATH: '' } });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('error', reject);
    child.on('close', (code) => {
      let result = null;
      try { result = JSON.parse(out.trim().split('\n').pop()); } catch {}
      resolve({ code, result, err });
    });
  });
}

test('安全重构入口：真实浏览器端到端集成（挂载→生成→下载→重考古→PR→后端 503）', async () => {
  const { code, result, err } = await runScenario();
  if (!result) {
    throw new Error('场景脚本无 JSON 输出（exit ' + code + '）\nstdout:\n' + err);
  }
  for (const c of result.checks) {
    assert.ok(c.ok, `入口集成检查未通过：${c.name}${c.extra ? ' — ' + c.extra : ''}`);
  }
  assert.deepStrictEqual(result.errors, [], '入口集成过程不应有未捕获错误：\n' + result.errors.join('\n'));
  assert.strictEqual(result.fail, 0, `应有 0 项失败，实际 ${result.fail}`);
});
