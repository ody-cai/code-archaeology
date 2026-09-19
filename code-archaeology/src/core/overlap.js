// 内容级比对 —— 「被放弃的尝试」判定里最关键的一道闸门。
// 独立模块：只做纯字符串比对，不依赖网络、不依赖模型，可被单独测试。
//
// 为什么要它：只按「净删行数」判定「方案被放弃」会产生大量假阳性。
// 实测（2026-09-19，用 GitHub API 逐条核对）：
//   chalk/chalk       4c304dd(+19) → 5729845(-35)   重合率  14%  ← 假阳性
//     「下划线样式」并未被放弃，5729845 的 message 是 "Improve performance"，
//     且它是 4c304dd 的**直接子提交**。功能至今仍在 main 的 index.js 里。
//   chalk/chalk       ff549c5(+20) → 8a94e0e(-36)   重合率  31%  ← 假阳性
//     随「Require Node.js 22」整文件重写，原有断言被保留，功能没被拆。
//   oa-system AGENTS.md d8ca09f(+43) → 109fd2c(-119) 重合率  28%  ← 假阳性
//     109fd2c 的 message 是 "Restored to 'acd42d064...'"，一次整仓回滚的连带删除。
//   oa-system Resend   b86cce0(+58) → 7c78ec0(-58)  重合率 100%  ← 真阳性
//     集成 Resend 后 52 分钟即被「清理不需要的邮件相关代码」整体拆除，确属放弃。
//
// 真阳性与假阳性之间隔着约 50 个百分点，因此以 50% 为界 —— 阈值来自实测分布，不是拍脑袋。
// 这一步的价值在于：它把「按行数猜」升级为「按内容判定」，而且零额外 API 调用
//（patch 在拉取提交详情时已经拿到，此前只是被丢弃了）。

export const OVERLAP_THRESHOLD = 0.5;

/** 过短的行不具备区分力（`}`、`);`、空行），参与比对只会制造假重合 */
const MIN_LINE_LEN = 4;

/**
 * 一次提交信息是否是「整仓回滚」。
 * git 和 GitHub 的 revert 会写成 `Restored to '<sha>'`，它删除的内容是全局性的，
 * 不能归因为「某个文件的某个方案被放弃」—— 那只是被顺带清理。
 */
export const GLOBAL_REVERT_RE = /^restored?\s+to\s+'?[0-9a-f]{7,40}/i;
export const isGlobalRevert = (message) => GLOBAL_REVERT_RE.test(String(message ?? '').trim());

/**
 * 从 unified diff patch 中提取纯新增行与纯删除行（已 trim，忽略文件头）。
 * @returns {{added:string[], removed:string[]}|null}
 */
export function extractDiffLines(patch) {
  if (typeof patch !== 'string' || !patch) return null;
  const added = [];
  const removed = [];
  for (const line of patch.split('\n')) {
    if (line.startsWith('+++') || line.startsWith('---')) continue;
    if (line.startsWith('+')) added.push(line.slice(1).trim());
    else if (line.startsWith('-')) removed.push(line.slice(1).trim());
  }
  return { added, removed };
}

/**
 * 计算「拆除侧删掉的行，有多少曾在新增侧出现过」。
 *
 * 高重合 = 当初加进去的东西被原样拆掉 → 真的放弃了。
 * 低重合 = 两次改动碰的其实是不同的代码 → 只是重写/无关改动 → 假阳性。
 *
 * @param {string|null} addPatch    新增那次提交对该文件的 patch
 * @param {string|null} removePatch 拆除那次提交对该文件的 patch
 * @returns {{verifiable:boolean, rate:number|null, hits:number, comparable:number, reason:string}}
 */
export function contentOverlap(addPatch, removePatch) {
  const a = extractDiffLines(addPatch);
  const b = extractDiffLines(removePatch);

  // GitHub 对超大 diff 不返回 patch。拿不到就不下判断 —— 宁可保留可疑条目，
  // 也不因为「无法核实」而丢掉真阳性。此时 verifiable=false，下游按原逻辑保留。
  if (!a || !b) {
    return { verifiable: false, rate: null, hits: 0, comparable: 0, reason: '拿不到 patch，无法核实' };
  }

  const addedSet = new Set(a.added.filter((l) => l.length >= MIN_LINE_LEN));
  const comparable = b.removed.filter((l) => l.length >= MIN_LINE_LEN);

  if (!comparable.length) {
    return { verifiable: false, rate: null, hits: 0, comparable: 0, reason: '拆除侧无可比对的有效行' };
  }

  const hits = comparable.filter((l) => addedSet.has(l));
  return {
    verifiable: true,
    rate: hits.length / comparable.length,
    hits: hits.length,
    comparable: comparable.length,
    reason: hits.length ? '拆除内容与新增内容存在重叠' : '拆除内容与新增内容完全无关',
  };
}

/**
 * 「被放弃的尝试」的最终判据：行数门槛 + 内容重合。
 *
 * @param {number} overlapRate  contentOverlap 得出的重合率，null 表示不可核实
 * @returns {{abandoned:boolean, note:string}}
 */
export function classifyAbandonment(overlapRate) {
  if (overlapRate === null) {
    return { abandoned: true, note: '内容未核实（缺 patch），保留为待核实线索' };
  }
  return overlapRate >= OVERLAP_THRESHOLD
    ? { abandoned: true, note: `内容核实通过（重合 ${Math.round(overlapRate * 100)}%）` }
    : { abandoned: false, note: `内容核实未通过（重合 ${Math.round(overlapRate * 100)}% < ${OVERLAP_THRESHOLD * 100}%），判定为重写而非放弃` };
}
