// 案例侦察：批量评估候选仓库的「考古价值」，用来挑演示案例。
// 判断依据不是仓库大小，而是历史里有没有可供挖掘的人类决策戏剧性。
import { execSync } from 'node:child_process';
import { mine } from '../src/miner.js';

function getToken() {
  try {
    const out = execSync('printf "protocol=https\\nhost=github.com\\n\\n" | git credential fill', {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'ignore'],
    });
    return out.match(/^password=(.+)$/m)?.[1]?.trim() ?? null;
  } catch {
    return null;
  }
}

const repos = process.argv.slice(2);
if (!repos.length) {
  console.error('用法: node scripts/scout.mjs owner/repo [owner/repo ...]');
  process.exit(1);
}
const token = getToken();

const rows = [];
for (const repo of repos) {
  process.stdout.write(`  侦察 ${repo} ...`);
  try {
    const r = await mine({ repo, limit: 40, token });
    const sq = r.signalQuality;
    // 考古价值：历史里人类决策的戏剧性总和，而不是代码量
    const value =
      r.hygiene.vagueRate * 1.2 +
      r.abandoned.length * 8 +
      r.thrash.length * 5 +
      r.hygiene.revertCount * 7 +
      Math.min(r.rhythm.longestGap.days, 180) * 0.2 +
      sq.signalRate * 0.3;
    rows.push({
      repo,
      value: Math.round(value),
      signal: `${sq.signalCommits}/${sq.analyzed}`,
      bot: sq.botRate,
      vague: r.hygiene.vagueRate,
      abandoned: r.abandoned.length,
      thrash: r.thrash.length,
      reverts: r.hygiene.revertCount,
      gap: r.rhythm.longestGap.days,
      msgs: r.hygiene.avgMsgLen,
      risk: r.risk.score,
      err: null,
    });
    process.stdout.write(' ok\n');
  } catch (e) {
    rows.push({ repo, value: 0, err: e.message });
    process.stdout.write(' 失败\n');
  }
}

console.log('\n按考古价值排序：\n');
console.log(
  '价值  仓库                                 有效/分析  机器人%  含糊%  放弃  打转  回滚  沉寂d  均长  风险'
);
for (const r of rows.sort((a, b) => b.value - a.value)) {
  if (r.err) {
    console.log(`  --  ${r.repo.padEnd(34)} ${r.err.slice(0, 50)}`);
    continue;
  }
  console.log(
    `${String(r.value).padStart(4)}  ${r.repo.padEnd(34)} ${r.signal.padStart(8)}  ${String(r.bot).padStart(6)}  ${String(r.vague).padStart(5)}  ${String(r.abandoned).padStart(4)}  ${String(r.thrash).padStart(4)}  ${String(r.reverts).padStart(4)}  ${String(r.gap).padStart(5)}  ${String(r.msgs).padStart(4)}  ${String(r.risk).padStart(4)}`
  );
}
console.log('\n说明：考古价值 = 含糊率×1.2 + 放弃×8 + 打转×5 + 回滚×7 + 沉寂×0.2 + 人类占比×0.3');
console.log('      分高说明历史里有更多可供挖掘的人类决策痕迹，演示更戏剧化。\n');
