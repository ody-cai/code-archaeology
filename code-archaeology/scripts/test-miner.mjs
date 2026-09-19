// 本地验证脚本：直接跑挖掘引擎，检验硬指标是否合理。
// Token 从 macOS Keychain（经 git credential helper）运行时取用，不写入任何文件。
import { execSync } from 'node:child_process';
import { mine } from '../src/miner.js';

function getToken() {
  try {
    const out = execSync('printf "protocol=https\\nhost=github.com\\n\\n" | git credential fill', {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'ignore'],
    });
    const m = out.match(/^password=(.+)$/m);
    return m ? m[1].trim() : null;
  } catch {
    return null;
  }
}

const repo = process.argv[2] || 'axios/axios';
const path = process.argv[3] || '';
const limit = Number(process.argv[4] || 60);
const token = getToken();

console.log(`\n=== 代码考古 · 本地验证 ===`);
console.log(`目标: ${repo}${path ? ' :: ' + path : ''}`);
console.log(`鉴权: ${token ? '已启用（Keychain，未落盘）' : '未启用（速率 60/h，可能不够）'}\n`);

const t0 = Date.now();
let r;
try {
  r = await mine({
    repo,
    path,
    limit,
    token,
    onProgress: (p) => {
      const pctTxt = p.total ? ` ${p.done ?? ''}/${p.total}` : '';
      process.stdout.write(`\r  [${p.phase}] ${p.msg}${pctTxt}          `);
    },
  });
} catch (e) {
  process.stdout.write('\n');
  console.log(`\n✗ 挖掘失败：${e.message}\n`);
  process.exit(1);
}
const ms = Date.now() - t0;
process.stdout.write('\n');

const line = (s) => console.log(s);
line(`\n耗时 ${(ms / 1000).toFixed(1)}s · API 调用 ${r.cost.apiCalls} 次 · 剩余配额 ${r.cost.rateRemaining}`);
line(`窗口 ${r.scope.windowFrom?.slice(0, 10)} → ${r.scope.windowTo?.slice(0, 10)}（${r.scope.limit} 条提交）`);

const sq = r.signalQuality;
line(`\n── 信噪比（报告的第一个核心数字） ──`);
line(`  分析 ${sq.analyzed} 次提交`);
line(`  机器人提交 ${sq.botCommits}（${sq.botRate}%）· 纯生成物 ${sq.noiseOnlyCommits}`);
line(`  有效人类决策 ${sq.signalCommits}（${sq.signalRate}%）`);
if (sq.botAuthors.length) {
  line(`  机器人：${sq.botAuthors.map((b) => `${b.author}(${b.commits})`).join('、')}`);
}
line(`  最吵的文件：`);
for (const f of sq.noisiestFiles.slice(0, 5)) {
  line(`    ${String(f.touches).padStart(2)}x ${f.noise ? '[噪音]' : '[源码]'} ${f.file}`);
}

line(`\n── 风险评分 ${r.risk.score}/100 ──`);
for (const f of r.risk.factors) line(`  ${String(f.score).padStart(2)}/${f.weight}  ${f.label} — ${f.raw}`);

line(`\n── 提交卫生 ──`);
line(`  非合并提交 ${r.hygiene.nonMerge} · 含糊 ${r.hygiene.vagueCount}（${r.hygiene.vagueRate}%）· 回滚 ${r.hygiene.revertCount} · 平均信息长度 ${r.hygiene.avgMsgLen}`);
if (r.hygiene.vagueSamples.length) {
  line(`  含糊样例：`);
  for (const v of r.hygiene.vagueSamples.slice(0, 4)) line(`    ${v.sha} ${v.date.slice(0, 10)} "${v.message}"`);
}

line(`\n── 文件热度 Top 5 ──`);
for (const h of r.hotspots.slice(0, 5)) {
  line(`  ${String(h.churn).padStart(6)} churn  ${String(h.touches).padStart(2)}x  ${h.file}`);
}

line(`\n── 被放弃的尝试（先进后出）──`);
if (!r.abandoned.length) line('  未检出');
for (const a of r.abandoned.slice(0, 5)) {
  line(`  ${a.file}`);
  line(`    +${a.addLines} by ${a.addSha} (${a.addDate.slice(0, 10)}) "${a.addMessage.slice(0, 60)}"`);
  line(`    -${a.removeLines} by ${a.removeSha} (${a.removeDate.slice(0, 10)}) 存活 ${a.survivedDays} 天`);
}

line(`\n── 原地打转 ──`);
if (!r.thrash.length) line('  未检出');
for (const t of r.thrash.slice(0, 5)) {
  line(`  打转指数 ${String(t.spinRatio).padStart(3)}x  ${t.touches}x 净变化 ${t.net}  ${t.file}`);
}

line(`\n── 节奏 ──`);
line(`  活跃天数 ${r.rhythm.activeDays} / 跨度 ${r.rhythm.spanDays} 天`);
line(`  最长沉寂 ${r.rhythm.longestGap.days} 天（${r.rhythm.longestGap.from?.slice(0, 10)} → ${r.rhythm.longestGap.to?.slice(0, 10)}）`);
if (r.rhythm.afterGapCommit) line(`  沉寂后首条提交：${r.rhythm.afterGapCommit.sha} "${r.rhythm.afterGapCommit.message.slice(0, 70)}"`);

line(`\n── 作者 ──`);
for (const a of r.authors.slice(0, 5)) line(`  ${String(a.commits).padStart(3)} commits  ${a.author}`);

line(`\n── 给 LLM 的掘现场体积 ──`);
line(`  ${JSON.stringify(r.digSite).length} 字符`);

// 单条提交失败时的容错检查
const failedCount = r.timeline.filter((c) => c.failed).length;
if (failedCount) line(`\n⚠ 有 ${failedCount} 条提交详情拉取失败（已降级处理，未中断）`);

line('\n✓ 验证结束\n');
