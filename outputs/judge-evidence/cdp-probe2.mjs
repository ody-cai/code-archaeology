import { spawn } from 'node:child_process';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9335;
const c = spawn(CHROME, [
  '--headless=new', '--remote-allow-origins=*',
  '--user-data-dir=/tmp/ca-chrome-p2',
  `--remote-debugging-port=${PORT}`, 'about:blank',
], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await sleep(3500);
const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = list.find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0; const pend = new Map();
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } };
const send = (method, params = {}) => { const mid = ++id; const p = new Promise((r) => { pend.set(mid, r); setTimeout(() => { if (pend.has(mid)) { pend.delete(mid); r({ __timeout: method }); } }, 8000); }); ws.send(JSON.stringify({ id: mid, method, params })); return p; };

console.log('A) 未导航前 evaluate:', JSON.stringify(await send('Runtime.evaluate', { expression: '1+1', returnByValue: true })).slice(0, 200));
console.log('B) Runtime.enable:', JSON.stringify(await send('Runtime.enable')).slice(0, 120));
console.log('C) 再 evaluate:', JSON.stringify(await send('Runtime.evaluate', { expression: '2+2', returnByValue: true })).slice(0, 200));
console.log('D) navigate:', JSON.stringify(await send('Page.navigate', { url: 'http://127.0.0.1:8787/' })).slice(0, 200));
await sleep(3000);
console.log('E) 导航后 evaluate:', JSON.stringify(await send('Runtime.evaluate', { expression: 'document.title', returnByValue: true })).slice(0, 300));
console.log('F) getLayoutMetrics:', JSON.stringify(await send('Page.getLayoutMetrics')).slice(0, 200));
ws.close(); c.kill(); process.exit(0);
