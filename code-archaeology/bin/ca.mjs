#!/usr/bin/env node
// 命令行界面 —— 同一套核心引擎的第三种调用形态。
//
// 为什么值得做：赛道把「可复用」列为加分项，而真正的可复用不是「有 API」，
// 是别人能在自己的流程里用上。把考古报告接进 CI 就是一个真实场景：
// 风险分超过阈值就阻断合并请求，逼着团队在提交信息烂到无法追溯之前先修。
//
// 用法：
//   node bin/ca.mjs mine        --repo=chalk/chalk --limit=40
//   node bin/ca.mjs excavate    --repo=chalk/chalk --json --out=report.json
//   node bin/ca.mjs capabilities
//   node bin/ca.mjs refactor    patch --repo=owner/name [--path=src/x.js] [--review-out=review.json]
//   node bin/ca.mjs refactor    pr    --review=review.json --diff=change.diff --reviewed-digest=<d> --confirm
//
// CI 用法（风险分超 60 就以退出码 2 失败，可用于卡住流水线）：
//   node bin/ca.mjs mine --repo=$REPO --fail-on-risk=60
//
// 说明：refactor 子命令在 loadEnv() 之前委派给 bin/refactor.mjs，因此其 Token 只来自
//      CA_GITHUB_TOKEN，不会被本机站点 GITHUB_TOKEN / .dev.vars / Keychain 污染。

import { readFile } from 'node:fs/promises';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mine } from '../src/miner.js';
import { excavate } from '../src/agents/orchestrator.js';
import { modelStatus } from '../src/agents/llm.js';
import { ENDPOINTS } from '../src/api/router.js';
import { execSync } from 'node:child_process';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

/* ── 环境：优先进程环境，其次 .dev.vars ─────────────── */
async function loadEnv() {
  const env = { ...process.env };
  try {
    const txt = await readFile(path.join(ROOT, '.dev.vars'), 'utf8');
    for (const line of txt.split('\n')) {
      if (/^\s*#/.test(line)) continue;
      const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)$/);
      if (!m) continue;
      const v = m[2].trim().replace(/^["']|["']$/g, '');
      if (v) env[m[1]] = v;
    }
  } catch {
    /* 无 .dev.vars 仍可运行纯计算部分 */
  }
  // 本机若已登录 GitHub，自动借用 Keychain 里的凭据，避免被 60 次/小时卡住
  if (!env.GITHUB_TOKEN) {
    try {
      const out = execSync('printf "protocol=https\\nhost=github.com\\n\\n" | git credential fill', {
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'ignore'],
      });
      const t = out.match(/^password=(.+)$/m)?.[1]?.trim();
      if (t) env.GITHUB_TOKEN = t;
    } catch {
      /* 取不到就算了 */
    }
  }
  return env;
}

/* ── 参数解析 ───────────────────────────────────── */
function parseArgs(argv) {
  const flags = {};
  const rest = [];
  for (const a of argv) {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/);
    if (m) flags[m[1]] = m[2] === undefined ? true : m[2];
    else rest.push(a);
  }
  return { flags, rest };
}

const C = {
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  b: (s) => `\x1b[1m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  cyan: (s) => `\x1b[36m${s}\x1b[0m`,
};

const line = (s = '') => process.stdout.write(s + '\n');
const d10 = (s) => (s ? String(s).slice(0, 10) : '');

// 「存活 0 天」是句自相矛盾的话：0 天意味着它从未活到能被放弃。
// 这里用真实时间戳算到分钟 —— 52 分钟就写 52 分钟，不四舍五入成 0。
const spanLabel = (from, to) => {
  const ms = new Date(to) - new Date(from);
  if (!Number.isFinite(ms) || ms < 0) return '—';
  const min = Math.round(ms / 60000);
  if (min < 60) return `${min} 分钟`;
  const hr = Math.round(min / 60);
  if (hr < 36) return `${hr} 小时`;
  return `${Math.round(hr / 24)} 天`;
};

/* ── 人类可读输出 ───────────────────────────────── */
function printReport(r) {
  const s = r.signalQuality;
  line();
  line(C.b(`${r.repo.full}`) + C.dim(`  ${r.repo.language ?? ''} · ${r.repo.stars} stars`));
  line(C.dim(`${d10(r.scope.windowFrom)} → ${d10(r.scope.windowTo)} · ${r.cost.apiCalls} 次 API 调用`));
  line();

  line(C.cyan('信噪比'));
  const bar = (n, total, ch) => ch.repeat(Math.round((n / Math.max(total, 1)) * 34));
  line(`  ${C.green(bar(s.signalCommits, s.analyzed, '█'))}${C.dim(bar(s.analyzed - s.signalCommits, s.analyzed, '░'))}`);
  line(`  人类决策 ${C.b(s.signalCommits)} / ${s.analyzed} 次  机器人 ${s.botCommits} 次（${s.botRate}%）`);
  line();

  const riskColor = r.risk.score >= 60 ? C.red : r.risk.score >= 35 ? C.yellow : C.green;
  line(C.cyan('风险因子') + `  总分 ${riskColor(String(r.risk.score) + '/100')} ${riskColor('(' + r.risk.level + ')')}`);
  for (const f of r.risk.factors) {
    line(`  ${String(f.score).padStart(2)}/${String(f.weight).padEnd(2)}  ${f.label.padEnd(14, '　')} ${C.dim(f.raw)}`);
  }
  line();

  line(C.cyan('文件热度 Top 6'));
  for (const h of r.hotspots.slice(0, 6)) {
    line(`  ${String(h.churn).padStart(6)} churn  ${String(h.touches).padStart(2)}x  ${h.file}`);
  }
  line();

  if (r.abandoned.length) {
    line(C.cyan('被放弃的尝试') + C.dim('（短时间加入又拆除 · 已通过内容核实）'));
    for (const a of r.abandoned.slice(0, 5)) {
      line(`  ${C.yellow(a.file)}`);
      line(`    +${a.addLines} 行 ${C.dim(a.addSha + ' ' + d10(a.addDate))} 「${a.addMessage.slice(0, 46)}」`);
      line(`    −${a.removeLines} 行 ${C.dim(a.removeSha + ' ' + d10(a.removeDate))} 存在 ${C.b(spanLabel(a.addDate, a.removeDate))}后被拆除`);
      if (a.verified) {
        const rate = Math.round((a.overlapRate ?? 0) * 100);
        line(C.dim(`    核实：拆除的 ${a.comparableLines} 行中有 ${a.overlappedLines} 行来自新增侧（重合 ${rate}%）`));
      }
    }
    line();
  }

  if (r.abandonedRejected?.length) {
    line(C.cyan('复核未通过') + C.dim('（行数达标，但拆除内容与新增内容无关 —— 判为重写而非放弃）'));
    for (const a of r.abandonedRejected.slice(0, 5)) {
      line(`  ${C.dim(a.file + '  重合 ' + Math.round((a.overlapRate ?? 0) * 100) + '%  ' + a.addSha + ' → ' + a.removeSha)}`);
    }
    line();
  }

  if (r.globalReverts?.length) {
    line(C.cyan('整仓回滚') + C.dim('（全局操作 · 连带删除不计为放弃）'));
    for (const a of r.globalReverts.slice(0, 5)) {
      line(`  ${C.dim(a.file + '  ' + a.addSha + ' → ' + a.removeSha + ' 「' + a.removeMessage.slice(0, 40) + '」')}`);
    }
    line();
  }

  if (r.thrash.length) {
    line(C.cyan('原地打转') + C.dim('（改动量大但净变化小）'));
    for (const t of r.thrash.slice(0, 5)) {
      line(`  ${String(t.spinRatio).padStart(3)}x  ${String(t.touches).padStart(2)} 次  净变化 ${String(t.net).padStart(6)}  ${t.file}`);
    }
    line();
  }
}

function printAnalysis(a) {
  if (!a.available) {
    line(C.yellow('模型分析层不可用：' + (a.reason ?? '未配置')));
    return;
  }
  const ms = a.modelStatus;
  line(C.cyan('多模型分工') + C.dim(`  ${ms.distinctModels} 个模型 · ${ms.mode}`));
  line(C.dim(`  叙事者 ${ms.models.narrator} · 假设者 ${ms.models.hypothesizer} · 审稿人 ${ms.models.appraiser}`));
  line();

  const n = a.narrative;
  line(C.b('决策史还原') + C.dim(`  [${ms.models.narrator}]`));
  if (n.headline) line(`  ${C.b(n.headline)}`);
  for (const p of String(n.narrative || '').split(/\n{2,}|\n/).filter((x) => x.trim())) {
    line(`  ${p.trim()}`);
  }
  for (const t of n.turningPoints ?? []) {
    const st = t.evidenceAudit?.status;
    const tag = st === 'grounded' ? C.green('证据成立') : st === 'fabricated' ? C.red('编造证据') : C.yellow('未引用证据');
    line(`  · ${C.b(t.title)} ${C.dim(t.sha)} ${tag}`);
    line(`    改动：${t.what}`);
    line(`    原因：${t.why}`);
  }
  line();

  const h = a.hypotheses;
  if (h && !h.skipped && (h.hypotheses ?? []).length) {
    line(C.b('被放弃方案的推断') + C.dim(`  [${ms.models.hypothesizer}]`));
    if (h.overallPattern) line(`  ${h.overallPattern}`);
    for (const x of h.hypotheses) {
      line(`  · ${C.yellow(x.file)}  置信度 ${C.b(x.confidence)}`);
      line(`    当年想做：${x.attempted}`);
      line(`    为何放弃：${x.whyAbandoned}`);
    }
    line();
  }

  const ap = a.appraisal;
  line(C.b('审稿人裁决') + C.dim(`  [${ms.models.appraiser}]`));
  line(`  ${ap.verdict}`);
  for (const x of ap.adviceForNewcomer ?? []) line(`  ${C.green('→')} ${x}`);
  if ((ap.interviewQuestions ?? []).length) {
    line(`  ${C.dim('该去问原作者：')}`);
    for (const q of ap.interviewQuestions) line(`  ${C.cyan('?')} ${q}`);
  }
  line();

  const e = a.evidenceAudit;
  const okAll = e.overall.fabricated === 0;
  line(
    C.b('证据接地校验') +
      `  ${e.overall.claims} 条推断 · ` +
      (okAll ? C.green('0 条编造') : C.red(`${e.overall.fabricated} 条编造`)) +
      C.dim(`  · 程序对 SHA 做集合运算，不依赖模型自评`)
  );
  line();
}

/* ── 主流程 ─────────────────────────────────────── */
const { flags, rest } = parseArgs(process.argv.slice(2));
const cmd = rest[0] ?? 'excavate';

// refactor 子命令在 loadEnv() 之前委派给独立模块 —— 刻意避开下面的 Keychain 自动借凭据逻辑，
// 因为重构流程的 Token 只来自 CA_GITHUB_TOKEN，不应被本机站点凭据污染。
if (cmd === 'refactor') {
  const { runRefactorCommand } = await import('./refactor.mjs');
  try {
    await runRefactorCommand(process.argv.slice(2).slice(1));
  } catch (e) {
    // runRefactorCommand 内部已自行 exit，这里仅兜底未捕获异常
    line(C.red(`✗ ${e?.message ?? e}`));
    process.exit(1);
  }
  process.exit(0);
}

// capabilities：在 loadEnv() 之前静态列出，避免触达 .dev.vars / Keychain 借凭据。
// 仅用进程环境变量（process.env）做只读状态展示，不做任何凭据借用。
if (cmd === 'capabilities') {
  line();
  line(C.b('code-archaeology · 可用能力'));
  line();
  for (const e of ENDPOINTS) {
    line(`  ${e.method.padEnd(5)} ${e.path.padEnd(20)} ${e.requiresModel ? C.yellow('[需模型]') : C.green('[纯计算]')}  ${e.summary.slice(0, 50)}`);
  }
  line();
  const ms = modelStatus(process.env);
  const githubToken = process.env.GITHUB_TOKEN || process.env.CA_GITHUB_TOKEN;
  line(C.dim(`  模型层：${ms.configured ? `${ms.provider} · ${ms.distinctModels} 个模型 · ${ms.mode}` : '未配置'}`));
  line(C.dim(`  GitHub：${githubToken ? '已配置（5000 次/小时）' : '未配置（60 次/小时）'}`));
  line();
  line(C.dim('  安全重构：ca.mjs refactor patch|pr --help'));
  process.exit(0);
}

const env = await loadEnv();


const repo = flags.repo ?? rest[1] ?? 'chalk/chalk';
const limit = Math.max(10, Math.min(100, Number(flags.limit ?? 40)));

if (!['mine', 'excavate', 'refactor'].includes(cmd)) {
  line(C.red(`未知命令：${cmd}`) + '  可用：mine | excavate | capabilities | refactor');
  process.exit(1);
}

try {
  const report = await mine({ repo, limit, path: flags.path ?? '', token: env.GITHUB_TOKEN });

  if (flags.json) {
    const payload = cmd === 'excavate' ? { report, analysis: await excavate({ env, report }) } : report;
    const text = JSON.stringify(payload, null, 2);
    if (flags.out) {
      await writeFile(flags.out, text);
      line(C.green(`已写出 ${flags.out}`) + C.dim(`  ${text.length} 字符`));
    } else {
      process.stdout.write(text);
    }
  } else {
    printReport(report);
    if (cmd === 'excavate') printAnalysis(await excavate({ env, report }));
  }

  // CI 闸门：风险分超阈值即以退出码 2 失败，可用于阻断合并
  if (flags['fail-on-risk'] !== undefined) {
    const threshold = Number(flags['fail-on-risk']);
    if (report.risk.score > threshold) {
      line(C.red(`✗ 风险分 ${report.risk.score} 超过阈值 ${threshold}，流水线阻断`));
      process.exit(2);
    }
    line(C.green(`✓ 风险分 ${report.risk.score} 未超过阈值 ${threshold}`));
  }
  process.exit(0);
} catch (e) {
  line(C.red(`✗ ${e.message}`));
  process.exit(1);
}
