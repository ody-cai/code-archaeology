// Cloudflare Worker 入口。
// 静态资源走 ASSETS 绑定，/api/* 交给路由层。
// 单次部署 = 一个链接，前端与 API 同源，没有跨域问题。

import { handle } from './api/router.js';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname.startsWith('/api/')) {
      return handle(request, env);
    }

    // 其余请求交给静态资源（Pages/Workers Assets）
    if (env.ASSETS) return env.ASSETS.fetch(request);
    return new Response('静态资源未绑定', { status: 500 });
  },
};
