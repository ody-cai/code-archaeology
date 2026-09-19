// 单点能力：仅假设层。针对「先进后出」的改动做反事实推断。

import { hypothesize } from '../../agents/hypothesizer.js';
import { modelStatus } from '../../agents/llm.js';
import { buildEvidenceIndex, auditEvidence } from '../../agents/verify.js';
import { ANALYZE_PARAMS, resolveReport } from '../params.js';

export default {
  method: 'POST',
  path: '/api/hypothesize',
  summary: '仅执行假设层：推断每一处「先进后出」的改动当年想做什么、为何被放弃。',
  params: ANALYZE_PARAMS,
  requiresModel: true,
  example: 'POST /api/hypothesize  { "repo": "chalk/chalk", "limit": 40 }',
  async handler({ params, token, env }) {
    const { report } = await resolveReport({ params, token });
    const st = modelStatus(env);
    if (!st.configured) {
      const err = new Error('模型层未配置，推断能力不可用');
      err.code = 'model_unavailable';
      throw err;
    }

    const result = await hypothesize({ env, digSite: report.digSite, model: st.models.hypothesizer });
    const audited = auditEvidence(result.hypotheses, buildEvidenceIndex(report));

    return {
      model: st.models.hypothesizer,
      skipped: result.skipped,
      skipReason: result.skipReason,
      overallPattern: result.overallPattern,
      hypotheses: audited.items,
      evidenceAudit: audited.summary,
    };
  },
};
