// 健康检查与运行时自检 —— 让调用方能判断服务当前具备哪些能力。

import { modelStatus } from '../../agents/llm.js';

export default {
  method: 'GET',
  path: '/api/health',
  summary: '健康检查。返回服务状态，以及模型层是否已配置（决定哪些能力可用）。',
  params: [],
  auth: 'none',
  example: 'GET /api/health',
  async handler({ env }) {
    const model = modelStatus(env);
    return {
      status: 'ok',
      time: new Date().toISOString(),
      model: {
        configured: model.configured,
        provider: model.provider,
        models: model.models,
        // 前端徽标要用这两个字段显示「多模型分工 / N 个模型」——
        // 之前只返回 models，徽标会把 mode 渲染成 undefined。
        mode: model.mode,
        distinctModels: model.distinctModels,
      },
      capabilities: {
        mining: true, // 纯计算层，永远可用
        narrative: model.configured,
        hypothesis: model.configured,
        appraisal: model.configured,
        fullExcavation: model.configured,
      },
      githubToken: {
        serverSide: Boolean(env?.GITHUB_TOKEN),
        headerOverride: 'X-GitHub-Token',
        note: env?.GITHUB_TOKEN
          ? '服务端已配置 Token，匿名调用也可享受 5000 次/小时'
          : '未配置服务端 Token，仅 60 次/小时；调用方可自带 X-GitHub-Token',
      },
    };
  },
};
