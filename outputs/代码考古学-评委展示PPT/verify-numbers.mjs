// 数字溯源校验：PPT 里出现的每一个关键数字，必须能在 FACTS.json 里找到出处。
// 用法：node verify-numbers.mjs
import { readFileSync, readdirSync } from 'node:fs';

const FACTS = JSON.parse(readFileSync('../judge-evidence/FACTS.json', 'utf8'));
const OC = FACTS.openclaw, TF = FACTS.topfo, ST = FACTS.tool.selfTest;

const all = readdirSync('./slides')
  .filter((f) => f.endsWith('.slide'))
  .map((f) => readFileSync('./slides/' + f, 'utf8'))
  .join('\n');

// 每项：[说明, 期望在 PPT 中出现的字面值, 在 FACTS 中的出处]
const checks = [
  ['openclaw 提交数', String(OC.signal.analyzed), 'OC.signal.analyzed'],
  ['openclaw 人类决策数', String(OC.signal.signalCommits), 'OC.signal.signalCommits'],
  ['openclaw 信噪率', OC.signal.signalRate + '%', 'OC.signal.signalRate'],
  ['openclaw 机器人提交数', String(OC.signal.botCommits), 'OC.signal.botCommits'],
  ['openclaw 机器人占比', '(' + OC.signal.botRate + '%)', 'OC.signal.botRate'],
  ['openclaw 每小时提交', String(OC.signal.commitsPerHour), 'OC.signal.commitsPerHour'],
  ['openclaw 每分钟一次', String(OC.signal.minutesPerCommit), 'OC.signal.minutesPerCommit'],
  ['openclaw 窗口跨度', OC.capture.windowSpanText, 'OC.capture.windowSpanText'],
  ['openclaw API 调用', String(OC.capture.apiCalls), 'OC.capture.apiCalls'],
  ['openclaw 纯计算耗时', OC.wallClock.mineSec + 's', 'OC.wallClock.mineSec'],
  ['openclaw 全流程耗时', OC.wallClock.excavateSec + 's', 'OC.wallClock.excavateSec'],
  ['openclaw 风险分', OC.risk.score + '/100', 'OC.risk.score'],
  ['openclaw 作者数', String(OC.concentration.authorCount), 'OC.concentration.authorCount'],
  ['openclaw 首位作者提交数', String(OC.concentration.topAuthorCommits), 'OC.concentration.topAuthorCommits'],
  ['openclaw 集中度', OC.concentration.topAuthorSharePct + '%', 'OC.concentration.topAuthorSharePct'],
  ['openclaw 作者改动行', OC.concentration.topAuthorChurn.toLocaleString('en-US'), 'OC.concentration.topAuthorChurn'],
  ['openclaw 作者文件数', String(OC.concentration.topAuthorFiles), 'OC.concentration.topAuthorFiles'],
  ['openclaw 热点 churn', String(OC.hotspots[0].churn), 'OC.hotspots[0].churn'],
  ['openclaw 热点净变化', String(OC.hotspots[0].net), 'OC.hotspots[0].net'],
  ['openclaw 否定案例 addSha', OC.abandoned.rejected[0].addSha, 'OC.abandoned.rejected[0].addSha'],
  ['openclaw 否定案例 removeSha', OC.abandoned.rejected[0].removeSha, 'OC.abandoned.rejected[0].removeSha'],
  ['openclaw 否定案例行数', String(OC.abandoned.rejected[0].comparableLines), 'OC.abandoned.rejected[0].comparableLines'],
  ['openclaw 平均提交信息长度', String(OC.hygiene.avgMsgLen), 'OC.hygiene.avgMsgLen'],
  ['openclaw 独狼文件数', String(OC.soloOwned.count), 'OC.soloOwned.count'],
  ['openclaw 转折点数', String(OC.analysis.turningPoints.length), 'OC.analysis.turningPoints.length'],
  ['openclaw star 数', OC.repo.stars.toLocaleString('en-US'), 'OC.repo.stars'],

  ['topfo 提交数', String(TF.signal.analyzed), 'TF.signal.analyzed'],
  ['topfo 机器人占比', TF.signal.botRate + '%', 'TF.signal.botRate'],
  ['topfo 风险分', TF.risk.score + '/100', 'TF.risk.score'],
  ['topfo 跨度天数', String(TF.rhythm.spanDays), 'TF.rhythm.spanDays'],
  ['topfo 活跃天数', String(TF.rhythm.activeDays), 'TF.rhythm.activeDays'],
  ['topfo 平均天数', String(TF.rhythm.avgDaysPerCommit), 'TF.rhythm.avgDaysPerCommit'],
  ['topfo 沉寂期天数', String(TF.rhythm.longestGapDays), 'TF.rhythm.longestGapDays'],
  ['topfo 被放弃数', String(TF.abandoned.verifiedCount), 'TF.abandoned.verifiedCount'],
  ['topfo 重合率下限', TF.abandoned.overlapRange.min + '%', 'TF.abandoned.overlapRange.min'],
  ['topfo 重合率上限', TF.abandoned.overlapRange.max + '%', 'TF.abandoned.overlapRange.max'],
  ['topfo 打转文件数', String(TF.thrash.count), 'TF.thrash.count'],
  ['topfo 文档热点 churn', TF.hotspots[0].churn.toLocaleString('en-US'), 'TF.hotspots[0].churn'],
  ['topfo 次热点 churn', TF.hotspots[1].churn.toLocaleString('en-US'), 'TF.hotspots[1].churn'],
  ['topfo 三热点 churn', TF.hotspots[2].churn.toLocaleString('en-US'), 'TF.hotspots[2].churn'],
  ['topfo 三热点次数', String(TF.hotspots[2].touches), 'TF.hotspots[2].touches'],
  ['topfo API 调用', String(TF.capture.apiCalls), 'TF.capture.apiCalls'],
  ['topfo 纯计算耗时', TF.wallClock.mineSec + 's', 'TF.wallClock.mineSec'],
  ['topfo 全流程耗时', TF.wallClock.excavateSec + 's', 'TF.wallClock.excavateSec'],
  ['topfo 作者集中度', TF.concentration.topAuthorSharePct + '%', 'TF.concentration.topAuthorSharePct'],
  ['topfo 作者改动行', TF.concentration.topAuthorChurn.toLocaleString('en-US'), 'TF.concentration.topAuthorChurn'],
  ['topfo 作者文件数', String(TF.concentration.topAuthorFiles), 'TF.concentration.topAuthorFiles'],
  ['topfo 平均提交信息长度', String(TF.hygiene.avgMsgLen), 'TF.hygiene.avgMsgLen'],
  ['topfo 假设条数', String(TF.analysis.hypothesisCount), 'TF.analysis.hypothesisCount'],
  ['topfo 转折点数', String(TF.analysis.turningPoints.length), 'TF.analysis.turningPoints.length'],

  ['测试总数', String(ST.tests.total) + ' / ' + String(ST.tests.total), 'ST.tests.total'],
  ['测试失败数', String(ST.tests.fail), 'ST.tests.fail'],
  ['总行数', ST.code.totalLines.toLocaleString('en-US'), 'ST.code.totalLines'],
  ['总文件数', String(ST.code.totalFiles), 'ST.code.totalFiles'],
  ['src 行数', String(ST.code.srcLines), 'ST.code.srcLines'],
  ['public 行数', String(ST.code.publicLines), 'ST.code.publicLines'],
  ['tests 行数', String(ST.code.testsLines), 'ST.code.testsLines'],
  ['端点总数', String(ST.apiEndpoints), 'ST.apiEndpoints'],
];

// 表格里逐条出现的 SHA 与行数
for (const x of TF.abandoned.verified) {
  checks.push(['清单 SHA ' + x.addSha, x.addSha, 'TF.abandoned.verified.addSha']);
  checks.push(['清单 SHA ' + x.removeSha, x.removeSha, 'TF.abandoned.verified.removeSha']);
  checks.push(['清单重合率 ' + x.overlapPct, x.overlapPct + '%', 'TF.abandoned.verified.overlapPct']);
}

let fail = 0;
for (const [label, needle, src] of checks) {
  // 允许千分位或原值两种写法
  const alt = needle.replace(/,/g, '').replace(/\((\d+)%\)/, '（$1%）');
  if (!all.includes(needle) && !all.includes(alt)) {
    console.log('✗ 缺失:', label, '| 期望「' + needle + '」 | 出处', src);
    fail++;
  }
}
console.log(fail === 0 ? `✓ 全部 ${checks.length} 项数字均可在 FACTS.json 中找到出处` : `✗ ${fail} / ${checks.length} 项未通过`);

// 反向扫描：找出 PPT 里出现、但 FACTS 中不存在的“可疑具体数字”（四位以上）
const factsText = JSON.stringify(FACTS);
const NUM = /\b\d{2,}(?:[,.]\d+)*\b/g;
const suspicious = new Set();
for (const m of all.matchAll(NUM)) {
  const v = m[0];
  const bare = v.replace(/,/g, '');
  if (bare.length < 3) continue;                       // 忽略页码、2 位以内的数字
  if (factsText.includes(v) || factsText.includes(bare)) continue;
  suspicious.add(v);
}
console.log('PPT 中出现但 FACTS 未含的 3 位以上数字（需人工确认是否为结构性数字）：');
console.log([...suspicious].sort().join('  ') || '（无）');
