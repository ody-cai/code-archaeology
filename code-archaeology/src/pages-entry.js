// Cloudflare Pages 入口（Advanced Mode）。
//
// 为什么需要它：Workers 部署只拿得到 `*.workers.dev`，而该域名在国内被 SNI 阻断
// （实测：直连 0.185s 即 SSL reset）。`*.pages.dev` 实测国内直连可达（200 / 1.76s），
// 且 Pages 不接受把 workers.dev 换绑过来 —— 要用 pages.dev 域名，就必须走 Pages。
//
// 与 src/worker.js 的差别只有一处：Pages 的静态资源找不到时不会自动回退到
// index.html（Workers 侧由 wrangler.toml 的 not_found_handling 负责），
// 所以这里显式补上 SPA 回退。
//
// 两个入口共用同一套 router 与 Agent 层，不存在逻辑分叉。

import { handle } from './api/router.js';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname.startsWith('/api/')) {
      return handle(request, env);
    }

    if (!env.ASSETS) return new Response('静态资源未绑定', { status: 500 });

    const res = await env.ASSETS.fetch(request);

    // SPA 回退：Pages 不会像 Workers Assets 那样自动处理 not_found_handling
    if (res.status === 404 && request.method === 'GET') {
      return env.ASSETS.fetch(new Request(new URL('/index.html', url.origin), { headers: request.headers }));
    }
    return res;
  },
};
