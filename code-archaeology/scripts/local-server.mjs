// 本地运行模式 —— 同一个路由层，换一个 HTTP 容器。
//
// 这不是「备份方案」，而是刻意的容错设计：
// 引擎本身不依赖 Cloudflare，只是恰好也能跑在 Worker 上。
// 现场网络或云端出问题时，本地一样能演示，且行为完全一致 ——
// 因为 API 与静态资源都由同一套代码提供。
//
// 用法：node scripts/local-server.mjs [端口]

import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { handle } from '../src/api/router.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = path.join(ROOT, 'public');
const PORT = Number(process.argv[2] || 8787);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

/** 读取 .dev.vars（若存在）并与进程环境合并 —— 与 wrangler 的行为保持一致 */
async function loadEnv() {
  const env = { ...process.env };
  try {
    const txt = await readFile(path.join(ROOT, '.dev.vars'), 'utf8');
    for (const line of txt.split('\n')) {
      if (/^\s*#/.test(line)) continue;
      const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)$/);
      if (!m) continue;
      const value = m[2].trim().replace(/^["']|["']$/g, '');
      // 空值不覆盖进程环境 —— 模板里留空的字段不应该把外部注入的同名变量抹掉
      if (value === '') continue;
      env[m[1]] = value;
    }
  } catch {
    /* 没有 .dev.vars 就只用进程环境，仍可运行（仅客观指标） */
  }
  return env;
}

const env = await loadEnv();

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > 200000) { reject(Object.assign(new Error('请求体过大'), { status: 413 })); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || `localhost:${PORT}`}`);

  // ── API ──────────────────────────────────────────
  if (url.pathname.startsWith('/api/')) {
    try {
      const hasBody = !['GET', 'HEAD'].includes(req.method);
      const raw = hasBody ? await readBody(req) : undefined;

      const request = new Request(url, {
        method: req.method,
        headers: req.headers,
        body: raw && raw.length ? raw : undefined,
      });

      const response = await handle(request, env);
      const buf = Buffer.from(await response.arrayBuffer());
      res.writeHead(response.status, Object.fromEntries(response.headers.entries()));
      res.end(buf);
    } catch (e) {
      res.writeHead(e.status === 413 ? 413 : 500, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ error: e.status === 413 ? 'body_too_large' : 'server_error', message: e.status === 413 ? '请求体过大' : '本地服务请求失败' }));
    }
    return;
  }

  // ── 静态资源 ─────────────────────────────────────
  try {
    const rel = url.pathname === '/' ? 'index.html' : url.pathname.replace(/^\/+/, '');
    // 防目录穿越：解析后必须仍在 public 目录内
    const target = path.resolve(PUBLIC, rel);
    if (!target.startsWith(PUBLIC)) {
      res.writeHead(403).end('Forbidden');
      return;
    }
    const st = await stat(target);
    if (st.isDirectory()) throw new Error('is dir');

    const body = await readFile(target);
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(target)] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(body);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('404 未找到');
  }
});

server.listen(PORT, '127.0.0.1', () => {
  const model = env.LLM_API_KEY ? `${env.LLM_PROVIDER ?? 'openai'} 已配置` : '未配置（仅客观指标）';
  console.log(`\n  代码考古学 · 本地模式`);
  console.log(`  http://localhost:${PORT}\n`);
  console.log(`  GitHub Token : ${env.GITHUB_TOKEN ? '已配置（5000 次/小时）' : '未配置（60 次/小时）'}`);
  console.log(`  模型层        : ${model}\n`);
});
