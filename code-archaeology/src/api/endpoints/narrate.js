// 单点能力：仅叙事层。供只想拿「决策史叙述」的调用方使用，不必跑完整流程。

import { narrate } from '../../agents/narrator.js';
import { modelStatus } from '../../agents/llm.js';
import { buildEvidenceIndex, auditEvidence } from '../../agents/verify.js';
import { ANALYZE_PARAMS, resolveReport } from '../params.js';

export default {
  method: 'POST',
  path: '/api/narrate',
  summary: '仅执行叙事层：把提交序列还原成决策史。可单独复用，无需跑完整考古流程。',
  params: ANALYZE_PARAMS,
  requiresModel: true,
  example: 'POST /api/narrate  { "repo": "chalk/chalk", "limit": 40 }',
  async handler({ params, token, env }) {
    const { report } = await resolveReport({ params, token });
    const st = modelStatus(env);
    if (!st.configured) {
      const err = new Error('模型层未配置，叙事能力不可用');
      err.code = 'model_unavailable';
      throw err;
    }

    const narrative = await narrate({ env, digSite: report.digSite, model: st.models.narrator });
    const audited = auditEvidence(narrative.turningPoints, buildEvidenceIndex(report));

    return {
      model: st.models.narrator,
      headline: narrative.headline,
      narrative: narrative.narrative,
      currentState: narrative.currentState,
      turningPoints: audited.items,
      evidenceAudit: audited.summary,
    };
  },
};
