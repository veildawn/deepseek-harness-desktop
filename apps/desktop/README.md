# DeepSeek Harness desktop application

English | [中文](README.zh.md)

The desktop application is an Electron host for the built DeepSeek Harness Web application. It starts the existing `dsh web` profile in a dedicated Electron Node-mode child process, lets the operating system select a free loopback port, and displays that origin in a sandboxed renderer.

## Run from a checkout

Install and build the repository before starting Electron:

```sh
pnpm install
pnpm run build
pnpm desktop
```

The checkout must retain its built `lib/` and Web `dist/` artifacts. Development mode uses the repository root as the initial Harness workspace.

## Build a local macOS application

Create an unsigned local application bundle:

```sh
pnpm desktop:pack
```

The command builds the checkout, installs the internally consistent published Harness `0.1.0-rc.6` runtime, rebuilds native modules for Electron, prunes non-target native prebuilds and package build inputs, verifies the retained PTY plus a browser-load, held-readiness, HTTP, and clean-shutdown cycle, and writes the application below `apps/desktop/dist/release/<architecture>/DeepSeek Harness.app`. On Apple Silicon, the architecture directory is `mac-arm64`. The bundle uses a 1024-pixel dark application-icon master with the unchanged official whale mark and includes every standard ICNS size from 16 through 1024 pixels. Development mode runs the checkout directly; packaging pins the published runtime because the checkout's `0.1.0-rc.5` workspace packages are not all available from the registry. The packaged application defaults its Harness workspace to `~/Projects` when that directory exists, otherwise to the home directory. Set an absolute `DEEPSEEK_GUI_WORKSPACE` path before launch to override that default.

## Build release installers

Build the Apple Silicon DMG and update ZIP on macOS:

```sh
pnpm desktop:dist:mac
```

Build the Windows x64 NSIS installer on Windows:

```sh
pnpm desktop:dist:win
```

Both commands write installers, update metadata, and blockmaps below `apps/desktop/dist/release`. Native dependencies are rebuilt and verified on the target operating system, so the Windows release runs on a Windows runner rather than cross-compiling from macOS.

## Updates and releases

Packaged applications check the public `veildawn/deepseek-harness-desktop` GitHub Releases feed ten seconds after startup and every six hours afterward. The native application menu also provides **Check for Updates…** and **GitHub Releases** commands. When a release is available, the user approves its download and can restart to install it. Electron Updater verifies the published SHA-512 metadata, prefers blockmap-based differential downloads on Windows and macOS, and falls back to the complete installer when a previous package or usable blockmap is unavailable.

The `Desktop release` GitHub Actions workflow builds Windows x64 and macOS arm64 artifacts, publishes their update metadata and SHA-256 checksums, and polls the official `deepseek-ai/deepseek-harness` release feed every six hours. A new official release is mapped to the matching published `@deepseek-ai/dsh` version and produces one downstream desktop release. Manual dispatch supports the initial build and recovery. macOS automatic installation requires a consistently signed application; the workflow accepts Apple signing and notarization secrets, while an unsigned build directs the user to the release page instead.

## Runtime behavior

The main process launches the built CLI with `dsh web --port 0` and waits for its readiness line before creating a window. The backend reuses Electron's executable in Node mode with the internal-module access required by the Harness plugin loader; native dependencies are rebuilt for the same Electron ABI. The bootstrap remains outside the application archive so the child receives a normal filesystem entrypoint. None of these capabilities are exposed to the renderer. Closing the last window quits the application on Windows and Linux; macOS retains the ordinary application lifecycle until the user quits. Application quit sends the backend `SIGTERM`, waits through its graceful shutdown interval, and uses `SIGKILL` only if the process remains alive.

The renderer has Node.js integration disabled, context isolation enabled, and Chromium sandboxing enabled. Navigation stays on the active loopback origin. HTTPS links open in the system browser; other origins and protocols are denied. Browser permission requests are denied because the current Web application does not require privileged renderer APIs.

## Limitations

Local macOS builds use any matching identity available in the developer keychain but are not notarized unless Apple credentials are configured. GitHub release builds keep only Electron's English and Simplified Chinese locale resources. Public distribution should configure Apple Developer ID signing and notarization secrets; unsigned Windows installers can also trigger SmartScreen warnings even though update integrity is verified from the release metadata.
