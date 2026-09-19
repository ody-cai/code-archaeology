// 单点能力：仅评估层。基于客观指标给出裁决与给接手者的建议。

import { appraise } from '../../agents/appraiser.js';
import { modelStatus } from '../../agents/llm.js';
import { buildEvidenceIndex, auditEvidence } from '../../agents/verify.js';
import { ANALYZE_PARAMS, resolveReport } from '../params.js';

export default {
  method: 'POST',
  path: '/api/appraise',
  summary: '仅执行评估层：基于客观指标与机械风险因子，给出风险裁决、给接手者的建议，以及该去问原作者的问题清单。',
  params: ANALYZE_PARAMS,
  requiresModel: true,
  example: 'POST /api/appraise  { "repo": "chalk/chalk", "limit": 40 }',
  async handler({ params, token, env }) {
    const { report } = await resolveReport({ params, token });
    const st = modelStatus(env);
    if (!st.configured) {
      const err = new Error('模型层未配置，评估能力不可用');
      err.code = 'model_unavailable';
      throw err;
    }

    const empty = { narrative: { turningPoints: [] }, hypotheses: { hypotheses: [] } };
    const appraisal = await appraise({
      env,
      digSite: report.digSite,
      report,
      narrative: empty.narrative,
      hypotheses: empty.hypotheses,
      audit: { narrative: null, hypothesis: null, overall: null },
      model: st.models.appraiser,
    });

    const audited = auditEvidence(appraisal.riskDrivers, buildEvidenceIndex(report));

    return {
      model: st.models.appraiser,
      verdict: appraisal.verdict,
      riskLevel: appraisal.riskLevel,
      mechanicalRisk: { score: report.risk.score, level: report.risk.level, factors: report.risk.factors },
      riskDrivers: audited.items,
      adviceForNewcomer: appraisal.adviceForNewcomer,
      doubts: appraisal.doubts,
      interviewQuestions: appraisal.interviewQuestions,
      evidenceAudit: audited.summary,
    };
  },
};
