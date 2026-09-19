// Agent C · 审稿人
// 职责不是附和，而是质疑。
// 它拿到的不只是前两个 agent 的结论，还有「代码层证据校验」的结果 ——
// 于是它可以说出「这条结论引用了不存在的提交」，而不是含糊地说「可能不准」。
//
// 输出里最有价值的是 interviewQuestions：考古的终点不是给出答案，
// 而是列出「该去问当初那个人什么」。这是这个工具真正交付给接手者的东西。

import { chat, extractJSON } from './llm.js';

const SYSTEM = `你是代码考古项目的审稿人。你的职责是质疑，不是附和。

你会收到：
1. 客观统计指标（这些是机器算出来的，可信）
2. 叙事者对历史的还原（可能过度推断）
3. 假设者对被放弃尝试的推断（最可能出错的部分）
4. 代码层面已完成的证据校验结果（哪些结论引用了不存在的提交）

你的任务：
- 指出哪些结论证据不足或被过度解读，直接点名
- 如果校验结果显示某条结论引用了不存在的提交，必须明确指出来
- 给出给「即将接手这份代码的人」的实用建议
- 列出应该去问原作者的问题 —— 这是考古无法回答、只能由当事人回答的部分

输出严格 JSON：
{
  "verdict": "两三句话的整体判断：这份代码的历史是清晰的还是混乱的，为什么",
  "riskLevel": "高|中|低",
  "riskDrivers": [
    { "title": "风险点名称，15字以内", "detail": "具体说明，必须引用指标或SHA", "evidence": ["SHA"] }
  ],
  "adviceForNewcomer": ["3~5条给接手者的具体建议，每条一句话，要可执行"],
  "doubts": [
    { "claim": "被质疑的结论原文缩写", "concern": "为什么证据不足或可能过度解读" }
  ],
  "interviewQuestions": ["3~4个必须去问原作者的问题"]
}

铁律：用中文。不要复述收到的一切，只输出你的判断。风险等级必须与客观指标一致 ——
如果含糊率低、无回滚、无打转，就不要给出高风险结论。`;

export async function appraise({ env, digSite, report, narrative, hypotheses, audit, model, signal }) {
  const user = `【客观指标】这些是机器算出的事实，不可质疑：
- 提交卫生：非合并提交 ${report.hygiene.nonMerge} 条，其中含糊 ${report.hygiene.vagueCount} 条（${report.hygiene.vagueRate}%），回滚 ${report.hygiene.revertCount} 次，平均信息长度 ${report.hygiene.avgMsgLen} 字
- 信噪比：分析 ${report.signalQuality.analyzed} 次提交，机器人 ${report.signalQuality.botCommits} 次（${report.signalQuality.botRate}%），有效人类决策 ${report.signalQuality.signalCommits} 次
- 原地打转：${report.thrash.length} 个文件改动量大但净变化小
- 被放弃的尝试：${report.abandoned.length} 处先进后出
- 最长沉寂：${report.rhythm.longestGap.days} 天
- 风险评分：${report.risk.score}/100（${report.risk.level}）

【机械风险因子】
${JSON.stringify(report.risk.factors, null, 1)}

【叙事者的还原】
${JSON.stringify(narrative, null, 1)}

【假设者的推断】
${JSON.stringify(hypotheses, null, 1)}

【代码层证据校验结果】这一项是程序对 SHA 做集合运算得出的，不是模型判断：
${JSON.stringify(audit, null, 1)}

请审阅。特别注意：如果上面校验结果里有 fabricated 的条目，必须在 doubts 里点名。`;

  const raw = await chat({ env, model, system: SYSTEM, user, json: true, maxTokens: 1400, signal });
  const parsed = extractJSON(raw);

  return {
    verdict: parsed.verdict ?? '',
    riskLevel: ['高', '中', '低'].includes(parsed.riskLevel) ? parsed.riskLevel : report.risk.level,
    riskDrivers: (parsed.riskDrivers ?? []).map((r) => ({
      title: r.title ?? '',
      detail: r.detail ?? '',
      evidence: r.evidence ?? [],
    })),
    adviceForNewcomer: parsed.adviceForNewcomer ?? [],
    doubts: parsed.doubts ?? [],
    interviewQuestions: parsed.interviewQuestions ?? [],
  };
}
