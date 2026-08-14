# Agent Note: Electron desktop shell

Status: implemented

English | [中文](2026-08-14-electron-desktop-shell.zh.md)

## Problem

The browser surface requires a separately managed `dsh web` process and leaves desktop launch, backend readiness, port conflicts, and coordinated shutdown to the user. A desktop entry must reuse the existing Web composition without granting browser content ambient Node.js access or maintaining a second UI implementation.

## Decision

[`apps/desktop`](../../../../apps/desktop/README.md) is a private Electron workspace application. Its main process starts the built `dsh` CLI in a dedicated Electron Node-mode child process with `web --port 0`, enables the Node.js internal-module access required by the Harness plugin loader, parses the CLI-owned readiness line, and creates a BrowserWindow only after the operating system-selected loopback URL is available. Development uses the checkout. macOS packaging installs the internally consistent published `0.1.0-rc.6` CLI closure with a hoisted linker, rebuilds native dependencies against Electron, and requires a browser-load, held-readiness, HTTP, and clean-shutdown cycle before copying it into the application. The published runtime boundary is necessary because not every package in the checkout's `0.1.0-rc.5` workspace exists in the registry, while mixing prerelease generations fails after the browser client connects.

The Electron renderer keeps Node.js integration disabled, context isolation and process sandboxing enabled, denies browser permission requests, and limits navigation to the active Harness origin. Validated HTTPS links leave the renderer through the system browser. Application quit owns backend teardown: it requests the CLI's graceful `SIGTERM` shutdown, waits beyond its documented five-second drain, and force-stops only a process that remains alive.

The backend reuses Electron's executable in Node mode, so its locally rebuilt native modules target the same ABI. Its small bootstrap is unpacked from the application archive to give the child a regular filesystem entrypoint. These capabilities stay confined to the backend process; the renderer remains sandboxed and receives no preload bridge.

The workspace pins electron-builder's `@electron/get` 3.x dependency to 3.1.0 because the current builder reads the cache-mode export that 3.0.0 does not provide. Electron itself keeps its independent 5.x downloader dependency.

Packaging prunes only after Electron native rebuilding: non-target `node-pty` prebuilds, package tests and compiled-export source trees, type-only packages, and source maps are removed before verification. The verifier executes the retained target PTY and spawn helper, then loads the real browser client and checks held readiness, HTTP, and clean shutdown. Electron keeps only English and Simplified Chinese locale resources. On the Apple Silicon reference build these changes reduce the unpacked application from 633 MB to 442 MB, including the complete custom icon and updater, without removing model providers or runtime features.

The macOS bundle carries a 1024-pixel dark master that composites the unchanged official Web whale mark over a restrained Harness-style graphite plate. The checked-in ICNS contains the complete 16, 32, 64, 128, 256, 512, and 1024-pixel representation set instead of falling back to Electron's default icon.

Release packaging targets macOS arm64 with DMG plus ZIP outputs and Windows x64 with NSIS. Each target rebuilds and executes its own retained `node-pty` artifacts before packaging. The release configuration emits GitHub-provider metadata and blockmaps next to the installers, and `electron-updater` keeps differential downloads enabled. A first install or failed blockmap lookup falls back to the complete package.

Packaged applications check the public downstream GitHub Releases feed after a ten-second startup delay and then every six hours. A native menu command permits an immediate check. Available releases require user approval before download and before restart; the main process stops the Harness backend before handing control to the installer. Update metadata and network access remain in the main process and are never exposed to the sandboxed renderer.

The downstream `Desktop release` workflow polls the official repository's latest GitHub Release every six hours. It reads that release's CLI package version, bundles the matching published `@deepseek-ai/dsh`, and publishes macOS arm64 and Windows x64 artifacts only when the corresponding downstream release tag is absent. A manual path supplies the initial release or retries. macOS signing and notarization plus optional Windows signing are sourced only from GitHub secrets.

## Alternatives considered

**Install the page as a browser-managed Web application.** This provides a Dock icon but still requires users to start and stop the backend separately, so it does not own the application lifecycle.

**Enable Node.js in the renderer and boot Harness there.** This collapses the process split but turns a Web-content compromise into direct filesystem and process access. The dedicated backend process preserves the existing server entrypoint and keeps the renderer unprivileged.

**Use an Electron utility process for the backend.** Source and staged-runtime checks booted successfully, but the packaged helper terminated after the real browser client connected. The Electron Node-mode child keeps the same runtime ABI and security boundary while preserving the packaged backend lifetime.

**Build a second desktop UI.** A native renderer would duplicate the existing plugin-driven client and require every browser UI contribution to grow another presentation implementation.

## Consequences

The checkout gains one desktop entrypoint while the Web application remains the only interactive UI implementation. macOS arm64 and Windows x64 bundles are self-contained and still carry Electron plus the installed Harness production closure, but target-specific pruning prevents build-only and other-platform artifacts from dominating the bundle. Development reflects checkout changes; releases reflect the matching published official runtime. Packaging requires registry access. macOS automatic installation remains unavailable until the public workflow is supplied with a Developer ID identity and notarization credentials; unsigned Windows installers can trigger SmartScreen warnings.
