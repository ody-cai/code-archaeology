# 代码考古学 · Code-Archaeology

> 我们不告诉你「为什么」，只告诉你「哪里已经没人能说清为什么」。
> We don't tell you *why* — we tell you *where nobody can explain why anymore*.

**BAYTECH 2026 国际湾区创科节 · AI 应用与工程赛道**参赛项目。

## 这是什么

一个**代码信息丢失审计**工具：从真实 GitHub 提交历史出发，找出代码库里那些
「已经没人能说清为什么」的地方 —— 被放弃的方案、被否定的假设、整仓回滚、零痕迹的决策。

不是「重建决策史」（猜不出来也不打算猜），而是**量化知识可继承性**。

三段流水线：

1. **信噪分离** —— 先把机器人沉积物（依赖升级、锁文件、格式化提交）筛掉，只留人类活动的「地层」
2. **多模型真分工** —— 三个模型各司其职，不是同一份 prompt 换三次
3. **证据接地** —— 每一条结论都必须落到具体 commit SHA；靠代码校验，不靠模型自觉

## 目录结构

```
code-archaeology/          站点与引擎
├── src/core/              信噪分离、重叠检测、GitHub 数据层
├── src/agents/            多模型编排（hypothesizer / verify / narrator / appraiser）
├── src/api/               API 路由与端点（health·mine·hypothesize·excavate·narrate·appraise·refactor）
├── src/refactor/          安全重构：补丁生成、校验、签名
├── public/                前端（原生 ESM，无框架）
├── desktop/               Electron 桌面端（macOS / Windows，与网站共用同一入口与 API）
├── bin/                   CLI（ca / refactor）
├── scripts/               构建、本地服务、冒烟测试
└── tests/                 172 项自动化测试

outputs/                   交付与证据
├── 代码考古学-项目简介/     5 页双语路演 PPT（含 DESIGN.md / STORY.md）
├── 代码考古学-评委展示PPT/
├── 代码考古学-产品价值论证报告/
├── evidence-verification/  数据真实性验证报告（含原始 API 响应）
├── judge-evidence/         实测案例的原始输出与截图
└── desktop-checksums.txt   安装包校验和
```

## 本地运行

```bash
cd code-archaeology
npm install

# 配置环境变量（模板见 .dev.vars.example）
cp .dev.vars.example .dev.vars
# 填入 LLM_API_KEY / GITHUB_TOKEN 等

npm run dev          # 本地服务 → http://localhost:8787
npm test             # 172 项测试
npm run cli -- mine <owner>/<repo>    # 命令行考古
```

## 部署

```bash
npm run deploy:pages   # 构建 pages-dist/ 并部署到 Cloudflare Pages
```

线上入口：<https://code-archaeology.pages.dev/>

> `workers.dev` 域名的 SNI 在中国内地被阻断，`pages.dev` 未被阻断 —— 演示请用 Pages 地址。
> 细节见 `code-archaeology/DEPLOY.md`。

## 桌面端

`code-archaeology/desktop/` 是 Electron 客户端，与网站共用同一套入口与 API，不做代码分叉。

安装包在 [Releases](https://github.com/ody-cai/code-archaeology/releases/latest) 下载
（macOS arm64 / Intel、Windows x64）。**安装包体积超过 GitHub 单文件 100 MB 上限，
因此不进仓库，只作为 Release 资产分发。**

- **macOS**：本地临时签名、未做 Apple 公证。首次打开若被 Gatekeeper 拦截，在
  「系统设置 → 隐私与安全性」点「仍要打开」，或执行
  `xattr -dr com.apple.quarantine /Applications/代码考古学.app`
- **Windows**：未做商业代码签名，SmartScreen 可能提示未知发布者，选择「更多信息 → 仍要运行」

## 校验和

见 `outputs/desktop-checksums.txt`，与 Release 页一并列出。

## 联系方式

cqjody@126.com
