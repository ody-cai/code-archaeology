import { spawn } from 'node:child_process';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9334;
const c = spawn(CHROME, [
  '--headless=new',
  '--remote-allow-origins=*',
  '--user-data-dir=/tmp/ca-chrome-profile',
  `--remote-debugging-port=${PORT}`,
  'about:blank',
], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await sleep(3500);
const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
console.log('targets:', list.map((t) => t.type + ':' + t.url).join(' | '));
const u = list.find((t) => t.type === 'page').webSocketDebuggerUrl;
console.log('ws url:', u);
const ws = new WebSocket(u);
ws.onopen = () => { console.log('OPEN'); ws.send(JSON.stringify({ id: 1, method: 'Browser.getVersion' })); };
ws.onerror = (e) => console.log('ERR', e.message ?? e.type);
ws.onmessage = (e) => { console.log('MSG', e.data.slice(0, 220)); ws.close(); c.kill(); process.exit(0); };
setTimeout(() => { console.log('TIMEOUT'); c.kill(); process.exit(1); }, 12000);
