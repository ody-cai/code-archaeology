// 共享参数定义 —— 所有端点复用，保证接口契约一致。

export const REPO_PARAM = {
  name: 'repo',
  required: true,
  // 若调用方直接给了 report（上一步的挖掘结果），就不必再给 repo
  requiredUnless: 'report',
  type: 'string',
  desc: '仓库标识，格式 owner/name，例如 chalk/chalk',
};

export const PATH_PARAM = {
  name: 'path',
  required: false,
  type: 'string',
  desc: '限定到仓库内某个文件或目录，例如 src/core',
};

export const LIMIT_PARAM = {
  name: 'limit',
  required: false,
  type: 'number',
  default: 60,
  desc: '分析最近 N 次提交，取值 10~100',
};

/** 可选的 report 入参：把上一步 /api/mine 的结果直接喂进来，跳过重复挖掘。
 *  这让每个 agent 都能被单独复用 —— 调用方不必为了拿一段叙事而重跑整次挖掘。 */
export const REPORT_PARAM = {
  name: 'report',
  required: false,
  type: 'object',
  desc: '可选。/api/mine 返回的完整报告对象。传入则跳过重新挖掘，直接进入分析。',
};

export const MINE_PARAMS = [REPO_PARAM, PATH_PARAM, LIMIT_PARAM];

/** 分析类端点的参数：可给 repo，也可给已有的 report */
export const ANALYZE_PARAMS = [REPO_PARAM, PATH_PARAM, LIMIT_PARAM, REPORT_PARAM];

/** 把字符串参数收敛成安全数值，避免巨型 limit 拖垮服务 */
export function clampLimit(v, fallback = 60) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(10, Math.min(100, Math.round(n)));
}

/** 统一取报告：调用方已给 report 就直接用，否则现场挖掘 */
export async function resolveReport({ params, token }) {
  if (params.report && typeof params.report === 'object' && params.report.timeline) {
    return { report: params.report, mined: false };
  }
  if (!String(params.repo ?? '').trim()) {
    const err = new Error('需要给定 repo，或传入上一步 /api/mine 返回的 report');
    err.code = 'missing_params';
    throw err;
  }
  const { mine } = await import('../miner.js');
  const report = await mine({
    repo: params.repo,
    path: params.path ?? '',
    limit: clampLimit(params.limit),
    token,
  });
  return { report, mined: true };
}
