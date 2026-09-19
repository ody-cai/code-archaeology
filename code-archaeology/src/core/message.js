// 提交信息质量评分 —— 独立模块。
// 考古最怕前人只写 "fix" 两个字：任何靠 message 推断意图的分析都会失真。
// 因此需要先给每条历史标一个「可信度」，让下游知道哪些推断有依据。

const VAGUE_EXACT_RE =
  /^(fix|fixes|fixed|update|updates|updated|wip|test|tests|testing|minor|typo|typos|cleanup|clean|refactor|refactoring|change|changes|commit|save|tmp|temp|misc|修改|更新|修复|提交|临时|保存|调整|优化|改动|测试|补充|完善)[\s.。！!]*$/i;

const CONVENTIONAL_RE = /^(\w+)(\([^)]*\))?(!)?:\s*/;

const REVERT_RE = /\b(revert|rollback|roll\s?back|undo|back\s?out|回滚|撤销|还原|推倒重来)\b/i;

/** 是否为回滚提交 —— 决策失败的直接证据 */
export const isRevertMessage = (msg) => REVERT_RE.test(msg ?? '');

/**
 * 提交信息质量评分，0~1。低于 0.6 视为「含糊」，下游叙事需降级处理。
 * @returns {{score:number, vague:boolean, reason:string}}
 */
export function scoreMessage(raw) {
  const msg = (raw ?? '').split('\n')[0].trim();
  if (!msg) return { score: 0, vague: true, reason: '空提交信息' };
  if (VAGUE_EXACT_RE.test(msg)) return { score: 0.15, vague: true, reason: '信息量为零' };

  const stripped = msg.replace(CONVENTIONAL_RE, '').trim();
  if (stripped.length < 10) return { score: 0.3, vague: true, reason: '过于简短' };
  if (msg.length < 18) return { score: 0.55, vague: false, reason: '偏短' };

  const descriptive =
    /\b(add|remove|rename|migrate|replace|introduce|extract|optimi|fix|handle|support|refactor|avoid|prevent|align|drop|enable|disable|deprecat)\b/i.test(
      msg
    );
  if (msg.length >= 40 || descriptive) return { score: 1, vague: false, reason: '描述清晰' };
  return { score: 0.7, vague: false, reason: '可接受' };
}
