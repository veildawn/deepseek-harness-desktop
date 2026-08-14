# DeepSeek Harness 桌面应用

[English](README.md) | 中文

桌面应用是已构建 DeepSeek Harness Web 应用的 Electron 宿主。它在专用的 Electron Node 模式子进程中启动现有的 `dsh web` profile，让操作系统选择空闲的 loopback 端口，并在启用沙箱的 renderer 中显示该 origin。

## 从检出运行

启动 Electron 前，安装并构建仓库：

```sh
pnpm install
pnpm run build
pnpm desktop
```

检出必须保留已构建的 `lib/` 与 Web `dist/` 产物。开发模式使用仓库根目录作为 Harness 的初始工作区。

## 构建本地 macOS 应用

创建未签名的本地应用 bundle：

```sh
pnpm desktop:pack
```

该命令先构建检出内容，再安装内部版本一致的已发布 Harness `0.1.0-rc.6` 运行时，为 Electron 重新构建原生模块，移除非目标平台的原生预构建与软件包构建输入，验证保留的 PTY 以及浏览器加载、持续就绪、HTTP 与干净关闭周期，最后将应用写入 `apps/desktop/dist/release/<architecture>/DeepSeek Harness.app`。在 Apple Silicon 上，架构目录为 `mac-arm64`。应用 bundle 使用 1024 像素的深色图标母版，保留未修改的官方鲸鱼图形，并包含从 16 到 1024 像素的全部标准 ICNS 尺寸。开发模式直接运行检出内容；由于检出中的 `0.1.0-rc.5` 工作区包并未全部发布到软件源，打包时会固定使用已发布运行时。打包后的应用在 `~/Projects` 存在时默认将其作为 Harness 工作区，否则使用主目录。启动前设置绝对的 `DEEPSEEK_GUI_WORKSPACE` 路径可以覆盖该默认值。

## 构建发布安装包

在 macOS 上构建 Apple Silicon DMG 与更新 ZIP：

```sh
pnpm desktop:dist:mac
```

在 Windows 上构建 Windows x64 NSIS 安装程序：

```sh
pnpm desktop:dist:win
```

两个命令都会将安装包、更新元数据与 blockmap 写入 `apps/desktop/dist/release`。原生依赖需要在目标操作系统上重新构建并验证，因此 Windows 版本使用 Windows runner，而不是从 macOS 交叉编译。

## 更新与发布

打包后的应用会在启动十秒后检查公开的 `veildawn/deeseek-gui` GitHub Releases，并每六小时再次检查。原生应用菜单同时提供**检查更新…**与 **GitHub 发布页**命令。发现新版后，由用户确认下载，并可重启完成安装。Electron Updater 会校验发布的 SHA-512 元数据，在 Windows 与 macOS 上优先使用基于 blockmap 的差分下载；没有旧安装包或可用 blockmap 时回退到完整安装包。

`Desktop release` GitHub Actions 工作流会构建 Windows x64 与 macOS arm64 产物，发布更新元数据与 SHA-256 校验和，并每六小时轮询官方 `deepseek-ai/deepseek-harness` Release。每个官方新版本都会映射到对应的已发布 `@deepseek-ai/dsh` 版本，并生成一个下游桌面 Release。手动触发可用于首次构建与故障恢复。macOS 自动安装要求应用始终使用一致的签名；工作流支持 Apple 签名与公证 secrets，未签名构建则引导用户前往发布页下载。

## 运行时行为

main process 使用 `dsh web --port 0` 启动已构建的 CLI，并在收到就绪行后创建窗口。后端以 Node 模式复用 Electron 可执行文件，并启用 Harness 插件加载器所需的内部模块访问；原生依赖针对同一 Electron ABI 重新构建。启动文件保留在应用归档之外，使子进程取得普通文件系统入口。上述能力均不向 renderer 公开。关闭最后一个窗口会在 Windows 和 Linux 上退出应用；macOS 继续遵循普通应用生命周期，直到用户退出。应用退出时向后端发送 `SIGTERM`，在其优雅关闭时间内等待，仅在进程仍存活时使用 `SIGKILL`。

renderer 禁用 Node.js integration，启用 context isolation 和 Chromium 沙箱。导航限制在当前 loopback origin。HTTPS 链接在系统浏览器中打开；其他 origin 与协议均被拒绝。当前 Web 应用不需要高权限 renderer API，因此所有浏览器权限请求均被拒绝。

## 限制

本地 macOS 构建会使用开发者钥匙串中匹配的身份，但只有配置 Apple 凭据后才会公证。GitHub Release 构建仅保留 Electron 的英文与简体中文 locale 资源。公开分发应配置 Apple Developer ID 签名与公证 secrets；未签名的 Windows 安装程序也可能触发 SmartScreen 警告，但更新完整性仍会通过发布元数据进行校验。
