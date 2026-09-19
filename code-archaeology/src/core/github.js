// GitHub API 客户端 —— 独立模块，可被挖掘引擎、CLI、任何 agent 复用。
// 职责：鉴权、速率感知、错误翻译、并发控制。不含任何考古逻辑。

export const API_BASE = 'https://api.github.com';

/**
 * 发起一次 GitHub API 请求。
 * 把 404 / 403 速率耗尽 / 401 鉴权失败翻译成人类可读的错误，
 * 并附带速率余量，方便上层决定要不要降级。
 */
export async function ghFetch(path, { token, fetchImpl = fetch } = {}) {
  const url = path.startsWith('http') ? path : API_BASE + path;
  const headers = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'code-archaeology/0.1',
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetchImpl(url, { headers });
  const rateRemaining = Number(res.headers.get('x-ratelimit-remaining') ?? -1);
  const rateLimit = Number(res.headers.get('x-ratelimit-limit') ?? -1);

  if (!res.ok) {
    let detail = '';
    try {
      detail = (await res.json())?.message ?? '';
    } catch {
      /* 响应体不是 JSON，忽略 */
    }
    const err = new Error(
      res.status === 404
        ? `仓库或路径不存在：${path}`
        : res.status === 403 && rateRemaining === 0
          ? `GitHub API 速率用尽（${rateLimit}/小时），请稍后重试或配置 Token`
          : res.status === 401
            ? 'GitHub Token 无效或已过期'
            : `GitHub API ${res.status}：${detail || '未知错误'}`
    );
    err.status = res.status;
    err.rateRemaining = rateRemaining;
    throw err;
  }

  return { data: await res.json(), rateRemaining, rateLimit };
}

/**
 * 并发池：把 N 个任务压到 limit 个并发里执行。
 * 用于逐条拉取 commit 详情时不打爆速率限制。
 */
export async function pool(items, limit, fn) {
  const out = new Array(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    for (;;) {
      const i = cursor++;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(runners);
  return out;
}

/** 把 "owner/name" 解析成两段，格式不对就直接报错 */
export function parseRepo(repo) {
  const [owner, name] = String(repo ?? '').split('/').map((s) => s.trim());
  if (!owner || !name) throw new Error('仓库格式应为 owner/name，例如 vuejs/core');
  return { owner, name };
}
