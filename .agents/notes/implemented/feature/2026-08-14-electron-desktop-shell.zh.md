# Agent Note: Electron desktop shell

Status: implemented

[English](2026-08-14-electron-desktop-shell.md) | 中文

## 问题

浏览器界面需要单独管理 `dsh web` 进程，并将桌面启动、后端就绪、端口冲突和协调关闭留给用户。桌面入口必须复用现有 Web 组合，既不能向浏览器内容授予环境 Node.js 访问权限，也不能维护第二套 UI 实现。

## 决策

[`apps/desktop`](../../../../apps/desktop/README.md) 是私有 Electron 工作区应用。其 main process 使用 `web --port 0` 在专用 Electron Node 模式子进程中启动已构建的 `dsh` CLI，启用 Harness 插件加载器所需的 Node.js 内部模块访问，解析由 CLI 生成的就绪行，并仅在取得操作系统所选的 loopback URL 后创建 BrowserWindow。开发模式使用检出。macOS 打包会通过 hoisted linker 安装内部版本一致的已发布 `0.1.0-rc.6` CLI 依赖闭包、针对 Electron 重新构建原生依赖，并要求暂存内容完成浏览器加载、持续就绪、HTTP 检查与干净关闭周期后才复制到应用中。该已发布运行时边界是必要条件，因为检出的 `0.1.0-rc.5` 工作区中并非每个包都已发布，而混用预发布版本会在浏览器客户端连接后失败。

Electron renderer 禁用 Node.js integration，启用 context isolation 与进程沙箱，拒绝浏览器权限请求，并将导航限制在当前 Harness origin。经过验证的 HTTPS 链接通过系统浏览器离开 renderer。应用退出负责清理后端：先请求 CLI 通过 `SIGTERM` 优雅关闭，等待超过其记录的五秒排空时间，仅强制停止仍然存活的进程。

后端以 Node 模式复用 Electron 可执行文件，因此本地重新构建的原生模块面向相同 ABI。它的小型启动文件从应用归档中解包，为子进程提供普通文件系统入口。这些能力只授予后端进程；renderer 继续使用沙箱，且不提供 preload bridge。

工作区将 electron-builder 的 `@electron/get` 3.x 依赖固定为 3.1.0，因为当前 builder 会读取 3.0.0 尚未提供的 cache-mode export。Electron 自身继续使用独立的 5.x 下载器依赖。

打包仅在 Electron 原生模块重新构建完成后执行精简：在验证前移除非目标平台的 `node-pty` 预构建、软件包测试与已提供编译导出的源代码树、仅类型软件包和 source map。验证程序会执行保留的目标平台 PTY 与 spawn helper，再加载真实浏览器客户端，并检查持续就绪、HTTP 与干净关闭。Electron 仅保留英文与简体中文 locale 资源。在 Apple Silicon 参考构建中，这些改动在不移除模型提供商或运行时功能的前提下，将未压缩应用从 633 MB 降至 442 MB，其中包含完整的自定义图标与更新器。

macOS bundle 携带 1024 像素深色母版，将未修改的 Web 官方鲸鱼图形叠加在克制的 Harness 风格石墨黑底图上。仓库内的 ICNS 包含完整的 16、32、64、128、256、512 与 1024 像素表示，不再回退到 Electron 默认图标。

发布打包面向 macOS arm64 的 DMG 与 ZIP，以及 Windows x64 的 NSIS。每个目标都会在打包前重新构建并执行其保留的 `node-pty` 产物。发布配置会在安装包旁生成 GitHub provider 元数据与 blockmap，`electron-updater` 保持启用差分下载；首次安装或 blockmap 查询失败时回退到完整包。

打包后的应用会在启动十秒后检查公开的下游 GitHub Releases，并每六小时再次检查。原生菜单命令支持立即检查。发现新版后，下载与重启均需要用户确认；main process 会在交由安装程序处理前停止 Harness 后端。更新元数据与网络访问始终位于 main process，不会暴露给启用沙箱的 renderer。

下游 `Desktop release` 工作流每六小时轮询官方仓库的最新 GitHub Release，读取该 Release 的 CLI 软件包版本，打包匹配的已发布 `@deepseek-ai/dsh`，并只在对应下游 Release tag 不存在时发布 macOS arm64 与 Windows x64 产物。手动路径用于首次发布或重试。macOS 签名与公证以及可选的 Windows 签名只从 GitHub secrets 读取。

## 考虑的替代方案

**将页面安装为浏览器管理的 Web 应用。** 这会提供 Dock 图标，但仍要求用户分别启动和停止后端，因此不能拥有应用生命周期。

**在 renderer 中启用 Node.js 并在那里启动 Harness。** 这会合并进程划分，却让 Web 内容入侵直接获得文件系统与进程访问权限。专用后端进程保留现有服务器入口，并保持 renderer 无特权。

**使用 Electron utility process 承载后端。** 源码与暂存运行时检查可以成功启动，但打包后的 helper 会在真实浏览器客户端连接后终止。Electron Node 模式子进程保持相同运行时 ABI 与安全边界，同时维持打包后端的生命周期。

**构建第二套桌面 UI。** 原生 renderer 会复制现有的插件驱动客户端，并要求每个浏览器 UI contribution 增加另一种 presentation 实现。

## 结果

检出增加一个桌面入口，而 Web 应用仍是唯一的交互式 UI 实现。macOS arm64 与 Windows x64 bundle 自包含，仍携带 Electron 和已安装的 Harness 生产依赖闭包，但针对目标平台的精简可避免构建专用与其他平台产物占据主要体积。开发模式反映检出中的改动；发布版本反映匹配的官方已发布运行时。打包需要访问软件源。只有为公开工作流提供 Developer ID 身份与公证凭据后，macOS 才能自动安装更新；未签名的 Windows 安装程序可能触发 SmartScreen 警告。
