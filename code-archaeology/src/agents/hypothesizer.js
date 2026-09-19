// Agent B · 假设者
// 职责：针对「先进后出」的改动做反事实推断 —— 当时想做什么？为什么放弃？
// 这是整个系统里最接近「考古推理」的一步，也是最容易幻觉的一步，
// 因此必须标注置信度，并且只允许引用被放弃现场的两个 SHA。

import { chat, extractJSON } from './llm.js';

const SYSTEM = `你是一名代码考古学家，专长是「从痕迹推断意图」。

你会拿到一组「先进后出」的改动：某个文件在某次提交里大幅新增，随后短时间内又被大幅删除。
你要推断：当时那个人想做什么？为什么又放弃了？

证据等级判定（必须严格遵守）：
- 若新增和删除两次提交的信息都清晰描述了意图 → 置信度「高」
- 若只有其中一次信息清晰 → 置信度「中」
- 若两次都是含糊信息（如 "fix"、"update"）→ 置信度「低」，且必须在 whyAbandoned 里
  明确写出「提交信息未说明原因，以下为基于改动范围的推断」

输出严格 JSON：
{
  "hypotheses": [
    {
      "file": "文件路径",
      "addSha": "新增那次提交的SHA",
      "removeSha": "删除那次提交的SHA",
      "attempted": "当时想做什么，一两句话",
      "whyAbandoned": "为什么放弃。若证据不足必须写明是推测。",
      "usualPattern": "这种「先进后出」在老项目里通常意味着什么",
      "confidence": "高|中|低",
      "evidence": ["addSha", "removeSha"]
    }
  ],
  "overallPattern": "这批被放弃的尝试整体呈现出什么模式，两三句话"
}

铁律：hypotheses 里每一条的 addSha / removeSha 必须是给定的证据里真实存在的 SHA。
不要新增未给出的案例，不要编造 SHA。用中文。`;

export async function hypothesize({ env, digSite, model, signal }) {
  const abandoned = digSite.abandoned ?? [];
  if (!abandoned.length) {
    return {
      hypotheses: [],
      overallPattern: '在本次分析的窗口内，没有检出「先进后出」的改动模式。',
      skipped: true,
      skipReason: 'no_abandoned_attempts',
    };
  }

  const user = `【仓库】${digSite.repo}
【时间窗口】${digSite.window}

【检出的「先进后出」改动】
${JSON.stringify(abandoned, null, 1)}

【含糊提交样例（用于判断证据等级）】
${(digSite.vagueSamples ?? []).join('\n') || '无'}

请逐条推断。共 ${abandoned.length} 条，全部都要给出结论。`;

  const raw = await chat({ env, model, system: SYSTEM, user, json: true, maxTokens: 1500, signal });
  const parsed = extractJSON(raw);

  return {
    hypotheses: (parsed.hypotheses ?? []).map((h) => ({
      file: h.file ?? '',
      addSha: h.addSha ?? '',
      removeSha: h.removeSha ?? '',
      attempted: h.attempted ?? '',
      whyAbandoned: h.whyAbandoned ?? '',
      usualPattern: h.usualPattern ?? '',
      confidence: ['高', '中', '低'].includes(h.confidence) ? h.confidence : '低',
      evidence: h.evidence ?? [h.addSha, h.removeSha].filter(Boolean),
    })),
    overallPattern: parsed.overallPattern ?? '',
    skipped: false,
  };
}
