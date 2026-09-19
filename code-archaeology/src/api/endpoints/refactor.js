import { createGitHub } from '../../refactor/github.js';
import { refactor } from '../../refactor/service.js';
import { mine } from '../../miner.js';

export default {
  method: 'POST',
  path: '/api/refactor',
  summary: '基于固定基础提交与考古证据生成单文件、最多100行的可审阅 diff；默认只下载 patch，PR 需用户确认与身份/写权限校验。',
  params: [
    { name: 'repo', required: true, type: 'string', desc: 'owner/name' },
    { name: 'mode', required: false, type: 'string', default: 'patch', desc: 'patch 或 pr' },
    { name: 'confirm', required: false, type: 'boolean', desc: 'PR 模式必须为 true' },
    { name: 'reviewedDigest', required: false, type: 'string', desc: '用户审阅后确认的补丁 SHA-256' },
    { name: 'reviewToken', required: false, type: 'string', desc: 'patch 返回的短期审阅凭证' },
    { name: 'diff', required: false, type: 'string', desc: 'PR 必需，用户已审阅的完整补丁' },
    { name: 'limit', required: false, type: 'integer', default: 40, desc: '历史窗口，10 至 100' },
    { name: 'path', required: false, type: 'string', desc: '可选的安全源码路径；省略时自动选择高反复修改文件' },
  ],
  auth: 'patch 可选调用者 Token；pr 必须 X-GitHub-Token 调用者凭据，禁止借用站点 Token',
  requiresModel: true,
  modelModes: ['patch'],
  example: 'POST /api/refactor {"repo":"owner/name","mode":"patch"}',
  async handler({ params, env, token }) {
    // 生产默认走真实适配器与模型；测试可通过 env.__REFACTOR_DEPS__ 注入 fake github/chat/mine。
    const deps = (env && env.__REFACTOR_DEPS__) || {};
    const github = deps.github ?? createGitHub({ token });
    const chat = deps.chat; // 不传则使用默认模型（需配置）
    const mineImpl = deps.mine ?? mine;
    return refactor({ params, env, token, github, chat, mineImpl });
  },
};
