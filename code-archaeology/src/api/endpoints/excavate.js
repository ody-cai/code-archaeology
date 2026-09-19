// 完整考古端点 —— 挖掘 + 多模型协作分析。
// 这是系统的主能力。模型层不可用时不会整体失败，而是降级返回客观指标部分。

import { mine } from '../../miner.js';
import { excavate } from '../../agents/orchestrator.js';
import { MINE_PARAMS, REPORT_PARAM, clampLimit, resolveReport } from '../params.js';

export default {
  method: 'POST',
  path: '/api/excavate',
  summary:
    '完整考古流程：先用纯计算还原客观指标，再让三个模型分工协作 —— 叙事者还原决策史、假设者推断被放弃的方案、审稿人复核前两者的证据。每次推断都由代码校验其引用的提交是否真实存在。',
  params: [...MINE_PARAMS, REPORT_PARAM],
  auth: '可选。请求头 X-GitHub-Token 可带自带凭据',
  requiresModel: true,
  example: 'POST /api/excavate  { "repo": "chalk/chalk", "limit": 40 }',
  async handler({ params, token, env, onProgress }) {
    // 若调用方已带着 report 进来（例如前端已先调过 /api/mine），
    // 就直接复用，省掉一次完整的 GitHub 拉取 —— 演示时这几秒很关键。
    const { report, mined } = await resolveReport({ params, token });

    const analysis = await excavate({ env, report, onProgress });

    return {
      mined,
      report,
      analysis,
      // 降级说明：模型层不可用时，客观指标仍然完整交付
      degraded: !analysis.available,
    };
  },
};
