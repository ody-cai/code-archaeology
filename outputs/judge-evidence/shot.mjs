// 用 CDP 驱动真实浏览器，对「代码考古学」本地实例做一次真实交互并截图。
// 这不是摆拍：截图里的数字全部来自同一次真实运行的 API 返回。
//
// 用法：node shot.mjs <url> <repo> <outPng> [waitMs]
import { writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';

const [url, repo, out, waitMsRaw] = process.argv.slice(2);
const WAIT = Number(waitMsRaw ?? 90000);
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9333;

const chrome = spawn(CHROME, [
  '--headless=new',
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-dev-shm-usage',
  '--disable-gpu',
  '--no-first-run',
  '--no-default-browser-check',
  '--hide-scrollbars',
  '--remote-allow-origins=*',
  '--user-data-dir=/tmp/ca-chrome-shot',
  `--remote-debugging-port=${PORT}`,
  '--window-size=1440,2400',
  'about:blank',
], { stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function targetUrl() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const list = await r.json();
      const page = list.find((t) => t.type === 'page');
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
    } catch { /* 还没起来 */ }
    await sleep(500);
  }
  throw new Error('CDP 未就绪');
}

const ws = new WebSocket(await targetUrl());
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

let id = 0;
const pending = new Map();
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  else if (m.method) { /* 事件，忽略 */ }
};
function send(method, params = {}) {
  const mid = ++id;
  const p = new Promise((res) => {
    pending.set(mid, res);
    setTimeout(() => { if (pending.has(mid)) { pending.delete(mid); res({ __timeout: method }); } }, 25000);
  });
  ws.send(JSON.stringify({ id: mid, method, params }));
  return p;
}
async function evaluate(expression) {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (process.env.DEBUG_CDP && (!r.result || r.error)) console.error('EVAL RAW:', JSON.stringify(r).slice(0, 400));
  return r.result?.result?.value;
}

await send('Page.enable');
await send('Runtime.enable');
await send('Page.navigate', { url });
await sleep(4000);
console.log('DEBUG first eval:', JSON.stringify(await send('Runtime.evaluate', { expression: '1+1', returnByValue: true })).slice(0, 300));

// 填仓库名 → 提交表单（真实交互，走真实 API）
await evaluate(`
  (() => {
    const i = document.getElementById('repo');
    i.value = ${JSON.stringify(repo)};
    i.dispatchEvent(new Event('input', { bubbles: true }));
    const sel = document.getElementById('limit');
    if (sel) sel.value = '60';
    document.getElementById('digForm').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    return true;
  })()
`);

// 等报告渲染完成（#report 出现内容且进度条隐藏）
const deadline = Date.now() + WAIT;
let ok = false;
while (Date.now() < deadline) {
  const state = await evaluate(`
    (() => {
      const rep = document.getElementById('report');
      const prog = document.getElementById('progress');
      const err = document.getElementById('errorBox');
      const done = rep && !rep.hidden && rep.innerText.trim().length > 200;
      return { done, err: err && !err.hidden, plen: rep ? rep.innerText.length : 0,
               progHidden: prog ? prog.hasAttribute('hidden') : null };
    })()
  `);
  if (state?.err) { console.error('页面报错', JSON.stringify(state)); break; }
  if (state?.done) { ok = true; break; }
  await sleep(1500);
}
console.log('report rendered:', ok);

await evaluate('window.scrollTo(0,0)');
await sleep(600);

// 全页截图
const metrics = await send('Page.getLayoutMetrics');
const h = Math.min(Math.ceil(metrics.result.cssContentSize.height), 6000);
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: h, deviceScaleFactor: 2, mobile: false });
await sleep(800);
const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
writeFileSync(out, Buffer.from(shot.result.data, 'base64'));
console.log('saved', out, 'height', h);

const text = await evaluate("document.getElementById('report').innerText.slice(0, 4000)");
writeFileSync(out.replace(/\.png$/, '.txt'), text ?? '');
console.log('text chars:', (text ?? '').length);

ws.close();
chrome.kill();
process.exit(0);
