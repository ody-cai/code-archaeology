# 安全一键重构交付说明

## 已实现

- 新增 `POST /api/refactor`，默认 `mode=patch`：从目标仓库固定的基础提交读取源码，基于真实考古证据选择候选文件，生成单文件 LF unified diff；补丁应用前会做精确上下文校验，新增/删除总行数上限为 100 行。
- 历史证据只用于选点，输出明确提示：历史只能证明改了什么，不能证明重构正确；不会把考古结论当作正确性证明。
- GitHub 适配器固定 `https://api.github.com`，拒绝重定向、绝对路径、路径穿越、symlink/gitlink、截断树、二进制及不合法源码；校验 blob SHA、UTF-8、LF 结尾和源码大小。
- `mode=pr` 仅接受布尔 `confirm=true`，要求调用者 Token、GitHub 身份、目标仓库写权限、未变化的基础提交、签名审阅凭证和用户审阅后的 digest 全部匹配；仅创建确定性独立分支和 `draft=true` 草稿 PR，不合并、不写默认分支。重复提交与不确定超时会被阻断，不自动重试。
- HTTP、CLI、Web 共用同一 API 契约。CLI 仅读取 `CA_GITHUB_TOKEN`，使用 `wx` 防覆盖写入，`review.json` 创建时即为 0600；Web 只以内存保存 Token，补丁预览和下载不执行动态内容，PR 链接仅允许 http(s)。
- 能力清单已暴露 `path`、`limit`、`diff` 等参数，并标明模型仅用于 patch 模式。

## 使用方式

### HTTP

```bash
curl -X POST http://127.0.0.1:8787/api/refactor \
  -H 'content-type: application/json' \
  -H 'x-github-token: <调用者Token>' \
  -d '{"repo":"owner/name","mode":"patch","limit":40}'
```

返回 `data.diff`、`data.digest`、固定 `baseSha`、证据、警告和短期审阅凭证。先人工审阅 diff，再用同一返回数据提交 `mode=pr`，并显式传 `confirm:true`、`reviewedDigest`、`reviewToken` 和完整 `diff`。

### CLI

```bash
node bin/ca.mjs refactor patch --repo=owner/name
CA_GITHUB_TOKEN='<调用者Token>' node bin/ca.mjs refactor pr \
  --review=review.json --diff=change.diff \
  --reviewed-digest=<人工审阅后的digest> --confirm
```

远程 API 必须使用 HTTPS；明文 HTTP 只允许本机回环地址。CLI 不读取 `GITHUB_TOKEN`、`.dev.vars` 或 Keychain。

### Web

在考古结果页的“安全重构入口”中输入本次会话 Token，生成候选补丁，审阅 diff 后勾选确认，再创建草稿 PR。切换 Token、生成失败或销毁面板会让旧审阅状态失效。

## 验证范围

使用 Node 22.22.2-3 的离线 fake 依赖运行了 157 项测试，最终 157 通过、0 失败。覆盖补丁解析与应用、固定 SHA、模型失败/超时/缺失、提示注入、凭据检测、HTTP 契约、CLI 写入安全、Web XSS/Token 清理、GitHub 读写适配器、重复提交、权限、重定向和基础提交变化。

所有 GitHub 写入测试均为模拟 fetch；没有创建真实 PR、没有向默认分支写入、没有部署公开站点，也没有读取凭据文件。真实 GitHub 权限、真实模型输出、真实端到端 PR 创建尚未验证。

## 比赛记录约束

本次交付只记录当前工作树的实现与验证结果，不伪造或回填提交时间；项目目录当前不是 Git 仓库，因此无法提供真实 commit hash。
