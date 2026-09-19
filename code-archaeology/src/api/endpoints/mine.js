// 纯计算挖掘端点 —— 不依赖任何模型，永远可用。
// 这是整个系统的基础能力：拿到硬数字，才能谈后续的推断。

import { mine } from '../../miner.js';
import { MINE_PARAMS, clampLimit } from '../params.js';

export default {
  method: 'GET',
  path: '/api/mine',
  summary:
    '对仓库历史做信噪分离与硬指标挖掘。不调用任何模型，输出全部为可验证的客观统计，每条结论都可追溯到 commit SHA。',
  params: MINE_PARAMS,
  auth: '可选。请求头 X-GitHub-Token 可带自带凭据',
  requiresModel: false,
  example: 'GET /api/mine?repo=chalk/chalk&limit=40',
  async handler({ params, token }) {
    const report = await mine({
      repo: params.repo,
      path: params.path ?? '',
      limit: clampLimit(params.limit),
      token,
    });
    return report;
  },
};
