# 代码考古学桌面版

桌面版不是另一套产品：Windows、macOS 与网站加载同一个线上入口 `https://code-archaeology.pages.dev/`，因此分析、报告、下载和「安全重构入口」功能由同一套网页/API 提供。

## 开发

```bash
cd code-archaeology/desktop
npm install
npm start
```

## 运行时安全边界

- BrowserWindow 开启 sandbox + contextIsolation，关闭 Node integration。
- 只允许加载 HTTPS 网站入口；导航到外部网站时阻断并提示用系统浏览器打开。
- 拒绝所有 Electron 权限请求和 webview 挂载。
- 下载仅允许来自网站同源或网站创建的 blob URL，文件名按 Windows/macOS 规则清理。
- 网络不可用时只显示连接提示，不展示伪造或过期缓存分析。
- 应用不存储 GitHub Token；网站自身的 token 生命周期和权限规则保持不变。

## 构建

macOS ARM64 目录版（当前机器可构建）：

```bash
NODE_PATH="/Users/odycai/.workbuddy/binaries/node/workspace/node_modules" \
PATH="/Users/odycai/.workbuddy/binaries/node/versions/22.22.2-3/bin:$PATH" \
node /Users/odycai/.workbuddy/binaries/node/workspace/node_modules/electron-builder/out/cli/cli.js \
  --dir --mac --config.directories.output="../../outputs/desktop-release"
```

正式 DMG/ZIP：`npm run package:mac`

Windows NSIS/ZIP：`npm run package:win`。本项目已在 macOS 上交叉构建 Windows x64 安装器和 ZIP；构建成功不等于 Windows 真机运行验收。当前未做 Windows 真机安装测试。

macOS 的 `afterSign` 钩子对完整 .app 做本地临时签名并强制验证；它不是 Apple 开发者签名，也不是 Apple 公证。Windows 安装器未做商业代码签名，两端首次运行可能出现系统安全提示。

运行验收：`node tests/runtime-smoke.mjs <已打包的应用可执行文件绝对路径> <输出目录>`。脚本启动实际应用、检查线上入口和 Node 隔离、提交 chalk/chalk 的 30 次提交分析、核实真实报告与重构入口，并保存截图与 JSON。调试端口仅用于此验收，脚本结束后退出应用。

## 功能一致性定义

桌面版与网站共享：

1. 完整网页 UI 与 `public/` 资源；
2. 同一个 Pages API（包括 `/api/mine`、`/api/excavate`、`/api/refactor`）；
3. 同一个网站登录/Token/下载/错误处理流程；
4. 桌面端只增加窗口菜单、外部链接确认、离线连接提示，不复制或改写业务逻辑。

注意：当前线上「安全重构入口」本身仍有已核实的三个问题（边缘 `redirect:error`、缺 `REFACTOR_SIGNING_KEY`、模型 diff 契约不一致）。桌面封装不会掩盖或自动修复这些网站/API 问题；修复网站后，Windows/macOS 会因同源加载自动获得相同修复。

## 2026-09-19 验收状态

- 166 个原有测试与 6 个桌面策略测试全部通过。
- macOS ARM64、macOS Intel、Windows x64 三个包内的主进程、策略模块与离线页逐字节相同，且与源文件相同。
- 两种 Mac .app 均通过 `codesign --verify --deep --strict`；Windows 主程序为 PE32+ x86-64，ZIP 完整性检查通过。
- 网站入口 HTTP 200。
- **运行验收未通过，当前产物是待验收构建，不是已验证可用的正式版。** 本机直接启动时报 `sandbox initialization failed: Operation not permitted`，渲染进程崩溃；系统启动方式也未连上调试端口，未取得页面截图或真实分析成功证据。尚不能断言是执行环境限制还是应用兼容性问题；未通过关闭 Electron 沙箱掩盖问题。
- Windows 与 Intel Mac 未做对应系统真机运行验收。因此，共享业务入口已经核实，但“所有功能完全一致且可正常使用”尚未完成证明。

