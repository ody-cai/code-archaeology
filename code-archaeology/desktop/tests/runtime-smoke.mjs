import { spawn } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import path from 'node:path';
const [executable, outDir] = process.argv.slice(2);
assert.ok(executable && outDir, 'Usage: node runtime-smoke.mjs <app executable> <output directory>');
const port = 19333;
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const launchViaOpen = process.env.CA_SMOKE_OPEN === '1';
const args = [`--remote-debugging-port=${port}`, '--remote-debugging-address=127.0.0.1', `--user-data-dir=${path.join(outDir, 'smoke-profile')}`];
const child = spawn(launchViaOpen ? '/usr/bin/open' : executable, launchViaOpen ? ['-n', '-a', path.resolve(executable, '../../..'), '--args', ...args] : args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
let stderr = '';
child.stderr.on('data', b => { stderr += b; });
child.stdout.resume();
let socket;
let nextId = 0;
const pending = new Map();
const delay = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, ms = 20000) {
  const end = Date.now() + ms;
  let last;
  while (Date.now() < end) {
    try { const value = await fn(); if (value) return value; } catch (e) { last = e; }
    if (child.exitCode !== null && (!launchViaOpen || child.exitCode !== 0)) throw new Error(`Application exited ${child.exitCode}: ${stderr.slice(-2000)}`);
    await delay(300);
  }
  throw new Error(`Timed out: ${last?.message || 'condition not met'}`);
}
function call(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++nextId;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`${method} timeout`)); }, 120000);
    pending.set(id, { resolve, reject, timer });
    socket.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) {
  const r = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails));
  return r.result.value;
}
try {
  const target = await until(async () => {
    const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    return pages.find(p => p.type === 'page');
  });
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  socket.onmessage = ({data}) => {
    const r = JSON.parse(data), p = pending.get(r.id);
    if (p) { clearTimeout(p.timer); pending.delete(r.id); r.error ? p.reject(new Error(JSON.stringify(r.error))) : p.resolve(r.result); }
  };
  await call('Runtime.enable');
  await until(() => evaluate(`location.href === 'https://code-archaeology.pages.dev/' && !!document.querySelector('#digForm')`), 30000);
  const initial = await evaluate(`({url:location.href,title:document.title,nodeAvailable:typeof require !== 'undefined',inputs:[...document.querySelectorAll('input,select')].map(e=>e.id),scripts:[...document.scripts].map(e=>e.src)})`);
  assert.equal(initial.nodeAvailable, false);
  const health = await evaluate(`fetch('/api/health').then(async r=>({status:r.status,body:await r.json()}))`);
  assert.equal(health.status, 200);
  await evaluate(`document.querySelector('#repo').value='chalk/chalk';document.querySelector('#limit').value='30';document.querySelector('#digForm').requestSubmit();true`);
  await until(() => evaluate(`!document.querySelector('#digBtn').disabled`), 150000);
  const result = await evaluate(`({errorVisible:!document.querySelector('#errorBox').hidden,error:document.querySelector('#errorMsg').textContent,reportVisible:!document.querySelector('#report').hidden,reportChars:document.querySelector('#report').innerText.length,refactorVisible:!!document.querySelector('#refactorZone')?.children.length,progress:document.querySelector('#progressSub').textContent,analysis:document.querySelector('#analysisZone')?.innerText.slice(0,500)})`);
  assert.equal(result.errorVisible, false, result.error);
  assert.equal(result.reportVisible, true);
  assert.ok(result.reportChars > 1000);
  assert.equal(result.refactorVisible, true);
  const screenshot = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  await writeFile(path.join(outDir, 'desktop-acceptance.png'), Buffer.from(screenshot.data,'base64'));
  const report = { checkedAt: new Date().toISOString(), platform: process.platform, architecture:process.arch, initial, health, result, limits: ['Windows runtime not executed on this Mac','Existing secure-refactor server defects not fixed by desktop packaging'] };
  await writeFile(path.join(outDir,'desktop-acceptance.json'), JSON.stringify(report,null,2));
  console.log(JSON.stringify(report,null,2));
} catch (error) {
  console.error(stderr.slice(-6000));
  throw error;
} finally {
  socket?.close();
  for (const p of pending.values()) clearTimeout(p.timer);
  child.kill('SIGTERM');
}
