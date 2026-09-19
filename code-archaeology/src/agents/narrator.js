// Agent A · 叙事者
// 职责：把一串 commit 翻译成「这段代码经历了什么」的决策史。
// 不负责判断对错，只负责还原过程。所有结论必须引用 SHA。

import { chat, extractJSON } from './llm.js';

const SYSTEM = `你是一名代码考古学家。你面前只有客观证据：提交记录、改动行数、时间戳。
你的任务是从这些证据还原「这段代码经历了什么决策」，而不是复述 diff。

铁律：
1. 每一条结论都必须引用证据里真实存在的 commit SHA。不要编造 SHA，不要引用未出现的编号。
2. 证据不足时，明说「证据不足」，不要用推测填补。含糊的提交信息（如 "fix"）不能作为意图证据。
3. 只描述证据支持的事，不评价代码好坏。
4. 用中文输出，语气克制，像考古报告而不是营销文案。

输出严格 JSON：
{
  "headline": "一句话概括这段历史的性质，30字以内",
  "narrative": "3~5段决策史叙述。按时间顺序讲清这段代码经历了哪几个阶段、每次转向的触发点是什么。每段都要提到具体日期或 SHA。",
  "turningPoints": [
    {
      "sha": "真实存在的短SHA",
      "date": "YYYY-MM-DD",
      "title": "转折点的名称，15字以内",
      "what": "发生了什么改动",
      "why": "能推断出的原因；若提交信息含糊则写「提交信息未说明，仅从改动范围推测」",
      "evidence": ["真实SHA1", "真实SHA2"]
    }
  ],
  "currentState": "用两三句话解释：这段代码为什么长成现在这样"
}`;

export async function narrate({ env, digSite, model, signal }) {
  const user = `以下是某个仓库的发掘证据。

【仓库】${digSite.repo}
【信噪情况】${digSite.signalNote}
【时间窗口】${digSite.window}

【改动最密集的文件及其变更序列】
${JSON.stringify(digSite.topFiles, null, 1)}

【反复推翻的文件】
${JSON.stringify(digSite.thrash, null, 1)}

【沉寂期】
最长沉寂 ${digSite.longestGap?.days ?? 0} 天（${digSite.longestGap?.from?.slice(0, 10) ?? ''} → ${digSite.longestGap?.to?.slice(0, 10) ?? ''}）
沉寂后首条提交：${digSite.afterGap ? `${digSite.afterGap.sha} "${digSite.afterGap.message}"` : '无'}

【含糊提交样例】
${(digSite.vagueSamples ?? []).join('\n') || '无'}

【回滚提交】
${(digSite.reverts ?? []).join('\n') || '无'}

请还原这段历史。记住：至少产出 2 个转折点，每个都必须引用上面出现过的真实 SHA。`;

  const raw = await chat({ env, model, system: SYSTEM, user, json: true, maxTokens: 1600, signal });
  const parsed = extractJSON(raw);

  return {
    headline: parsed.headline ?? '',
    narrative: parsed.narrative ?? '',
    turningPoints: (parsed.turningPoints ?? []).map((t) => ({
      sha: t.sha ?? '',
      date: t.date ?? '',
      title: t.title ?? '',
      what: t.what ?? '',
      why: t.why ?? '',
      evidence: t.evidence ?? (t.sha ? [t.sha] : []),
    })),
    currentState: parsed.currentState ?? '',
  };
}
