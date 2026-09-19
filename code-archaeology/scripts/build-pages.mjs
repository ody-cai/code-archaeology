// 构建 Cloudflare Pages 部署目录。
//
// 为什么要打包而不是直接把 _worker.js 丢进 public/：
// Pages 的 direct upload 从「部署目录」开始解析模块，而 _worker.js 需要 import
// ../src/api/router.js —— 相对路径跑到部署目录之外，打包器不会跟随。
// 所以先把 worker 树打成单文件，再连同静态资源一起放进一个自包含的目录。
//
// 用法：node scripts/build-pages.mjs

import { rm, cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'pages-dist');

await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });

// ── 1. 静态资源 ──────────────────────────────────────────────
await cp(path.join(ROOT, 'public'), OUT, { recursive: true });

// ── 2. Worker 打成单文件 _worker.js ─────────────────────────
const result = await build({
  entryPoints: [path.join(ROOT, 'src/pages-entry.js')],
  outfile: path.join(OUT, '_worker.js'),
  bundle: true,
  format: 'esm',
  target: 'es2022',
  platform: 'browser',
  conditions: ['worker', 'browser'],
  mainFields: ['module', 'main'],
  minify: false, // 保留可读性：这份产物要能对着看，比赛也要求有可解释性
  legalComments: 'none',
  metafile: true,
  logLevel: 'warning',
});

const bundled = await readFile(path.join(OUT, '_worker.js'), 'utf8');

// 打包泄漏检查：拿 .dev.vars 里的真实值与产物比对，而不是做模式匹配。
//
// 为什么不用模式匹配：项目自己的 src/refactor/safety.js:31 里就写着「检测凭据」的正则
// （`gh[pousr]_…|github_pat_…|sk-…`），那串正则源码本身长得和密钥一模一样 ——
// 第一次构建时它把自己的安检代码判成了泄漏。模式匹配在这里会自伤。
// 与真实值比对没有歧义：产物里出现了本机密钥，才是泄漏。
const devVarsRaw = await readFile(path.join(ROOT, '.dev.vars'), 'utf8').catch(() => '');
const secretValues = devVarsRaw
  .split('\n')
  .filter((line) => /^\s*[A-Za-z_][A-Za-z0-9_]*\s*=/.test(line))
  .map((line) => line.slice(line.indexOf('=') + 1).trim().replace(/^["']|["']$/g, ''))
  .filter((v) => v.length >= 12 && !v.includes(' '));

const leaked = secretValues.filter((v) => bundled.includes(v));
if (leaked.length) {
  await rm(OUT, { recursive: true, force: true });
  // 只报数量，不复述命中的值
  throw new Error(`构建产物体检失败：_worker.js 内联了 ${leaked.length} 个 .dev.vars 中的真实值。已删除产物。`);
}

// 产物必须仍然是 ESM 且导出 fetch handler，否则 Pages 会静默 500
if (!/export\s*\{/.test(bundled) || !/fetch/.test(bundled)) {
  await rm(OUT, { recursive: true, force: true });
  throw new Error('构建产物体检失败：未找到 ESM 导出或 fetch handler。已删除产物。');
}

// Pages 的 _worker.js 必须是部署目录里唯一的入口脚本；
// ASSETS 若被误写成静态文件会被当成资源暴露，这里留一条自证。
await writeFile(path.join(OUT, '.build-stamp'), new Date().toISOString() + '\n');

const inputs = Object.keys(result.metafile.inputs).length;
const bytes = Buffer.byteLength(bundled);
console.log(`✓ Pages 产物已生成：${path.relative(ROOT, OUT)}/`);
console.log(`  _worker.js  ${(bytes / 1024).toFixed(1)} KiB（内联 ${inputs} 个模块）`);
console.log(`  静态资源    public/ 已全量复制`);
console.log(`  密钥比对    通过（${secretValues.length} 个真实值均未出现在产物中）`);
console.log(`  ESM 导出    通过`);
