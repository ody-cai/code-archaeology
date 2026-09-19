# 部署说明 · 两个入口与可达性差异

> 2026-09-19 · 起因：`workers.dev` 在中国内地不可达，站点打不开。

## 两个入口

| 入口 | 地址 | 内地可达 | 部署方式 |
|---|---|---|---|
| Cloudflare **Pages** | https://code-archaeology.pages.dev | **可以**（裸直连 200 / 1.21s） | `npm run deploy:pages` |
| Cloudflare **Workers** | https://code-archaeology.odycai.workers.dev | 不行（SSL reset） | `npm run deploy` |

**演示用 Pages 的地址。** 两个入口共用同一套 router 与 Agent 层，代码不存在分叉 ——
只有入口文件不同（`src/worker.js` / `src/pages-entry.js`），差别是 Pages 需要显式补 SPA 回退。

## 为什么 workers.dev 不行

同一台机器、同一个 Cloudflare IP `104.16.132.229`，只换 SNI 做对比：

| 测试 | 结果 |
|---|---|
| SNI = `code-archaeology.odycai.workers.dev` | **0.185s 失败，exit 35（SSL connect error）** |
| SNI = `api.cloudflare.com` | 走代理 **400**、直连 **403** —— TLS 握手成功 |
| `ldl-yizhan-2-2l5.pages.dev` | DNS 解析到**真实** Cloudflare IP，裸直连 **200** |
| `code-archaeology.odycai.workers.dev` 的 DNS | 被污染到 `116.89.243.8`（非 Cloudflare 段） |

结论：Cloudflare 的 IP 段本身可达，**被阻断的是 `workers.dev` 这个域名**（SNI 层）。
`pages.dev` 未被阻断 —— 因此不需要买域名，换 Pages 即可。

## Pages 怎么部署

`*.pages.dev` 只能给 Pages 项目用，Workers 换绑不了，所以要重新走一次 Pages 部署。

用的是 **Pages Advanced Mode**（部署目录里放一个 `_worker.js`）。但 `_worker.js` 不能直接
`import '../src/api/router.js'` —— Pages 的打包器从部署目录开始解析，相对路径跑到目录外就断了。
所以 `scripts/build-pages.mjs` 先用 esbuild 把 worker 树打成单文件，再连同 `public/` 一起
放进一个自包含的 `pages-dist/`：

```bash
npm run build:pages    # 生成 pages-dist/（含产物体检）
npm run deploy:pages   # 构建 + 部署
```

构建脚本自带两道体检，任一不过就删除产物并中止：

1. **密钥比对** —— 拿 `.dev.vars` 里的真实值与产物比对。刻意不用模式匹配：项目自己的
   `src/refactor/safety.js:31` 里就写着「检测凭据」的正则，那串正则源码长得和密钥一模一样，
   模式匹配会把自家安检代码判成泄漏（第一次构建就是这么被误伤的）。
2. **ESM 导出检查** —— 产物必须仍有 `export`，否则 Pages 会静默 500。

## 环境变量

Pages 的环境变量**在部署时注入**：改完 secret 必须**重新部署一次**才生效
（第一次配完没重新部署，`/api/health` 一直返回 `provider: none`）。

全部通过 `wrangler pages secret put <KEY> --project-name=code-archaeology` 写入 production
（统一用加密变量，不区分明文/加密 —— 代码都从 `env` 读）：

`LLM_PROVIDER` · `LLM_BASE_URL` · `LLM_MODEL` · `LLM_MODEL_B` · `LLM_MODEL_C` ·
`LLM_API_KEY` · `GITHUB_TOKEN` · `MAX_COMMITS`

`GITHUB_TOKEN` 是必需的，不是可选优化：未认证是 60 次/小时，而 Cloudflare 的出口 IP 是共享的，
这个配额早就被其他 Worker 用完了 —— 实测直接返回「GitHub API 速率用尽」。
配好之后一次 40 条提交的分析用掉 42 次调用，余量 4349。

## 顺带修掉的一个边缘 bug（重要）

部署到 Pages 后 `/api/excavate` 三个模型全部失败，错误是：

```
Invalid redirect value, must be one of "follow" or "manual"
("error" won't be implemented since it does not make sense at the edge)
```

`src/agents/llm.js` 里三处 fetch 用了 `redirect: 'error'`（安全设计：拒绝重定向，防止
请求头里的 API Key 被 302 转发到第三方域名）。**Node 接受 `'error'`，Cloudflare 的边缘运行时
不接受** —— 只支持 `follow` / `manual`。

所以这个问题从项目开始就在，**线上模型层从来没有真正生效过**。它一直没被发现，是因为
本地 CLI 和单元测试都跑在 Node 上，而 `tests/llm-transport.test.mjs` 甚至把这个行为固化成了
断言（`assert.equal(opts.redirect, 'error')`）—— 测试锁住了一个只在 Node 上成立的行为。

这跟项目里已经记过的另一课是同一类错误：**测试环境的运行时与生产不同，覆盖不到**。
上一次是「用自己捏的合成数据测渲染层，测不到真实来源的形状」。

修复：改用 `redirect: 'manual'`，再手动把 3xx 当错误抛（`assertNotRedirect`）——
语义等价，边缘可用。同时补两处语义：

- 给重定向错误打 `code: 'redirect_rejected'`
- `chat()` 的重试/降级循环里，遇到该 code 直接 `break modes` 跳出

第二点不是洁癖：`chat()` 在 JSON 模式失败时会降级到纯文本模式**再发一次请求**。
重定向被拒后降级毫无意义，只会把同一份凭据再送一遍 —— 收益为零、暴露面翻倍。
测试 `calls.length === 1` 抓到了这个（修之前是 2）。

## 验证

- 单元测试 **166 / 166 通过**（新增 3xx 拒绝用例）
- Pages `/api/health`：`provider=openai`、三模型就位、`githubToken.serverSide=true`
- Pages `/api/mine`（oa-system, 40 提交）：风险分 71、被放弃 4 / 已否定 3 / 整仓回滚 10，
  与本地结果一致
- Pages `/api/excavate`（oa-system, 40 提交）：**HTTP 200 / 27.8 秒**，
  `available=true`、`degraded=false`、假设层 4 条、证据接地 **0 编造**、`degradations` 为空
- Pages 前端 `render.js` 校验和与本地一致（`1d56c242…`）

## 已知限制

- Workers 入口已同步修复并重新部署（版本 `ad70fdf1-…`），但**本机无法验证** ——
  `workers.dev` 在此网络不可达。Pages 入口是唯一经实测确认可用的。
- 27.8 秒的请求时长目前没问题，但 Cloudflare 各版本对请求时长有上限，仓库更大时需
  留意（`limit` 参数可以控制分析规模）。
- 未做自定义域名。若日后要绑，Pages 项目同样支持，且大概率比免费子域更稳。

## 两个操作陷阱（踩过）

- **`nohup cmd &` 启动的本地服务会被回收**：Bash 工具的命令结束后进程就没了，`curl` 变
  `http=000`。要用后台任务方式启动。
- **zsh 不支持 bash 的 `${!VAR}` 间接引用**：`printf '%s' "${!K}"` 会报 `bad substitution`
  并且**把空字符串写进 secret** —— 而且 `wrangler` 会回显「✓ 已写入」，看起来是成功的。
  批量写 secret 要显式展开每个变量，或加非空校验。
