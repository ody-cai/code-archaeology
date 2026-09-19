// 多模型编排层 —— 把三个 agent 串成一条有依赖关系的流水线。
//
// 为什么是「串行有依赖」而不是「并行投票」：
//   叙事者把 diff 变成过程，假设者据此推断意图，审稿人再回头质疑前两者。
//   后一步依赖前一步的产出，这才叫工作流；三个模型各答一遍再投票，那不叫工作流。
//
// 编排层同时承担容错职责：任何单个 agent 失败都不会让整次考古失败，
// 已成功的部分照常交付，并在 degradations 里如实记录。

import { narrate } from './narrator.js';
import { hypothesize } from './hypothesizer.js';
import { appraise } from './appraiser.js';
import { modelStatus } from './llm.js';
import { buildEvidenceIndex, auditEvidence } from './verify.js';

export async function excavate({ env, report, onProgress = () => {}, signal }) {
  const status = modelStatus(env);
  const degradations = [];

  if (!status.configured) {
    return {
      available: false,
      reason: '模型层未配置，推断能力不可用。客观指标部分（report）仍然完整可用。',
      modelStatus: status,
      degradations: [{ stage: 'all', error: '模型层未配置' }],
    };
  }

  const digSite = report.digSite;
  const index = buildEvidenceIndex(report);

  // ── 第一梯队：叙事者 ‖ 假设者（并行） ───────────────────────────
  // 两者都只依赖客观证据、互不依赖，所以并发执行。
  // 这不是炫技：三轮串行调用在路演现场会拖到难以忍受，并行能把墙钟时间砍掉近一半。
  onProgress({
    stage: 'narrator',
    msg: `叙事者与假设者并行分析中（${status.models.narrator} ‖ ${status.models.hypothesizer}）`,
  });

  const [narrativeSettled, hypothesisSettled] = await Promise.allSettled([
    narrate({ env, digSite, model: status.models.narrator, signal }),
    hypothesize({ env, digSite, model: status.models.hypothesizer, signal }),
  ]);

  let narrative;
  if (narrativeSettled.status === 'fulfilled') {
    narrative = narrativeSettled.value;
  } else {
    degradations.push({ stage: 'narrator', error: narrativeSettled.reason?.message ?? '未知错误' });
    narrative = { headline: '叙事层不可用', narrative: '', turningPoints: [], currentState: '', failed: true };
  }

  let hypotheses;
  if (hypothesisSettled.status === 'fulfilled') {
    hypotheses = hypothesisSettled.value;
  } else {
    degradations.push({ stage: 'hypothesizer', error: hypothesisSettled.reason?.message ?? '未知错误' });
    hypotheses = { hypotheses: [], overallPattern: '假设层不可用', skipped: true, failed: true };
  }

  // ── 代码层校验：这一步不经过任何模型 ────────────────────────────
  onProgress({ stage: 'verify', msg: '正在对模型引用的提交做真实性校验' });
  const narrativeAudit = auditEvidence(narrative.turningPoints, index);
  const hypothesisAudit = auditEvidence(hypotheses.hypotheses, index);
  const audit = {
    narrative: narrativeAudit.summary,
    hypothesis: hypothesisAudit.summary,
    overall: {
      claims: narrativeAudit.summary.claims + hypothesisAudit.summary.claims,
      fabricated: narrativeAudit.summary.fabricated + hypothesisAudit.summary.fabricated,
      invalidCitations: narrativeAudit.summary.invalidCitations + hypothesisAudit.summary.invalidCitations,
    },
  };

  // ── 第三棒：审稿人（拿到校验结果，可以点名批评） ────────────────
  onProgress({ stage: 'appraiser', msg: `审稿人正在复核并给出裁决（${status.models.appraiser}）` });
  let appraisal = null;
  try {
    appraisal = await appraise({
      env,
      digSite,
      report,
      narrative,
      hypotheses,
      audit,
      model: status.models.appraiser,
      signal,
    });
  } catch (e) {
    degradations.push({ stage: 'appraiser', error: e.message });
    appraisal = {
      verdict: '审稿层不可用',
      riskLevel: report.risk.level,
      riskDrivers: [],
      adviceForNewcomer: [],
      doubts: [],
      interviewQuestions: [],
      failed: true,
    };
  }

  onProgress({ stage: 'done', msg: '考古完成' });

  return {
    available: true,
    modelStatus: status,
    narrative: { ...narrative, turningPoints: narrativeAudit.items },
    hypotheses: { ...hypotheses, hypotheses: hypothesisAudit.items },
    appraisal,
    // 证据接地报告：这是系统可信度的自证，也是前端要重点展示的部分
    evidenceAudit: audit,
    degradations,
  };
}
