import { spawn } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { app, BrowserWindow, dialog, Menu, session, shell } from 'electron/main'
import electronUpdater from 'electron-updater'
import { waitForBackendReady } from './backend.mjs'
import { createUpdateController } from './updater.mjs'
import { classifyNavigation } from './url-policy.mjs'

const REPOSITORY_ROOT = fileURLToPath(new URL('../../..', import.meta.url))
const SOURCE_BACKEND_ENTRY = fileURLToPath(new URL('./backend-entry.mjs', import.meta.url))
const BACKEND_STOP_TIMEOUT_MS = 7_000
const FORCE_STOP_TIMEOUT_MS = 2_000
const { autoUpdater } = electronUpdater

let backend
let backendUrl
let mainWindow
let stoppingBackend = false

app.setName('DeepSeek Harness')

const ownsInstance = app.requestSingleInstanceLock()
if (!ownsInstance) app.quit()

/** Resolve the source or staged CLI and its workspace directory. */
function resolveHarness() {
  if (!app.isPackaged) {
    return {
      cliEntry: join(REPOSITORY_ROOT, 'apps', 'cli', 'lib', 'bin.js'),
      workspace: REPOSITORY_ROOT,
    }
  }
  const requestedWorkspace = process.env.DEEPSEEK_GUI_WORKSPACE
  const projects = join(homedir(), 'Projects')
  const workspace = requestedWorkspace !== undefined && isAbsolute(requestedWorkspace) && isDirectory(requestedWorkspace)
    ? requestedWorkspace
    : isDirectory(projects) ? projects : homedir()
  const installRoot = join(process.resourcesPath, 'harness')
  return {
    cliEntry: join(installRoot, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'),
    workspace,
  }
}

/** Return whether a path names an existing directory. */
function isDirectory(path) {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

/** Start the bundled CLI and resolve only after its Web runtime is ready. */
async function startBackend() {
  const harness = resolveHarness()
  const backendEntry = app.isPackaged
    ? join(process.resourcesPath, 'app.asar.unpacked', 'src', 'backend-entry.mjs')
    : SOURCE_BACKEND_ENTRY
  if (!existsSync(harness.cliEntry)) {
    throw new Error(`DeepSeek Harness is not built: ${harness.cliEntry}\nRun pnpm run build before pnpm desktop.`)
  }
  backend = spawn(process.execPath, ['--expose-internals', backendEntry, 'web', '--port', '0'], {
    cwd: harness.workspace,
    env: {
      ...process.env,
      DSH_DESKTOP_CLI_ENTRY: harness.cliEntry,
      ELECTRON_RUN_AS_NODE: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const child = backend
  child.on('exit', (code, signal) => {
    if (backend === child) backend = undefined
    if (!stoppingBackend && backendUrl !== undefined) {
      const outcome = code === null ? `signal ${String(signal)}` : `code ${String(code)}`
      process.stderr.write(`DeepSeek Harness exited unexpectedly with ${outcome}.\n`)
      dialog.showErrorBox('DeepSeek Harness backend stopped', `DeepSeek Harness exited with ${outcome}.`)
      app.quit()
    }
  })
  backendUrl = await waitForBackendReady(child)
  child.stdout?.pipe(process.stdout)
  child.stderr?.pipe(process.stderr)
  return backendUrl
}

/** Open validated HTTPS links in the user's browser. */
function openExternal(target) {
  const action = classifyNavigation(target, new URL(backendUrl).origin)
  if (action === 'external') void shell.openExternal(target)
}

/** Create a locked-down renderer for the loopback Harness origin. */
function createWindow() {
  if (backendUrl === undefined) throw new Error('desktop window: backend URL is unavailable')
  const applicationOrigin = new URL(backendUrl).origin
  const window = new BrowserWindow({
    title: 'DeepSeek Harness',
    width: 1440,
    height: 920,
    minWidth: 960,
    minHeight: 640,
    show: false,
    backgroundColor: '#111827',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  window.once('ready-to-show', () => window.show())
  const handleNavigation = (event, target) => {
    const action = classifyNavigation(target, applicationOrigin)
    if (action === 'allow') return
    event.preventDefault()
    if (action === 'external') openExternal(target)
  }
  window.webContents.on('will-navigate', handleNavigation)
  window.webContents.on('will-redirect', handleNavigation)
  window.webContents.setWindowOpenHandler(({ url }) => {
    openExternal(url)
    return { action: 'deny' }
  })
  void window.loadURL(backendUrl).catch((error) => {
    dialog.showErrorBox('DeepSeek Harness failed to load', error instanceof Error ? error.message : String(error))
    app.quit()
  })
  window.once('closed', () => {
    if (mainWindow === window) mainWindow = undefined
  })
  mainWindow = window
}

/** Add a native update command while retaining the platform's standard menus. */
function installApplicationMenu(updateController) {
  const isChinese = app.getLocale().toLowerCase().startsWith('zh')
  const checkLabel = isChinese ? '检查更新…' : 'Check for Updates…'
  const releasesLabel = isChinese ? 'GitHub 发布页' : 'GitHub Releases'
  const updateItems = [
    {
      label: checkLabel,
      enabled: updateController !== undefined,
      click: () => { void updateController?.check({ notifyNoUpdate: true }) },
    },
    {
      label: releasesLabel,
      click: () => {
        if (updateController !== undefined) void updateController.openRelease()
        else void shell.openExternal('https://github.com/veildawn/deepseek-harness-desktop/releases/latest')
      },
    },
  ]
  const template = process.platform === 'darwin'
    ? [
        {
          label: app.name,
          submenu: [
            { role: 'about' },
            { type: 'separator' },
            ...updateItems,
            { type: 'separator' },
            { role: 'services' },
            { type: 'separator' },
            { role: 'hide' },
            { role: 'hideOthers' },
            { role: 'unhide' },
            { type: 'separator' },
            { role: 'quit' },
          ],
        },
        { role: 'fileMenu' },
        { role: 'editMenu' },
        { role: 'viewMenu' },
        { role: 'windowMenu' },
      ]
    : [
        { role: 'fileMenu' },
        { role: 'editMenu' },
        { role: 'viewMenu' },
        { role: 'windowMenu' },
        { role: 'help', submenu: updateItems },
      ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

/** Stop the CLI gracefully, escalating only after its documented drain window. */
async function stopBackend() {
  const child = backend
  if (child === undefined) return
  backend = undefined
  stoppingBackend = true
  const pid = child.pid
  let exited = false
  const exit = new Promise(resolve => {
    child.once('exit', () => {
      exited = true
      resolve()
    })
  })
  child.kill()
  await Promise.race([exit, new Promise(resolve => setTimeout(resolve, BACKEND_STOP_TIMEOUT_MS))])
  if (!exited && pid !== undefined) {
    try {
      process.kill(pid, 'SIGKILL')
    } catch (error) {
      if (error?.code !== 'ESRCH') throw error
    }
    await Promise.race([exit, new Promise(resolve => setTimeout(resolve, FORCE_STOP_TIMEOUT_MS))])
  }
}

if (ownsInstance) {
  app.on('second-instance', () => {
    if (mainWindow === undefined) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  })
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0 && backendUrl !== undefined) createWindow()
  })
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
  app.on('before-quit', (event) => {
    if (backend === undefined || stoppingBackend) return
    event.preventDefault()
    void stopBackend().finally(() => app.quit())
  })
  void app.whenReady().then(async () => {
    session.defaultSession.setPermissionCheckHandler(() => false)
    session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false))
    await startBackend()
    createWindow()
    let updateController
    if (app.isPackaged) {
      updateController = createUpdateController({
        updater: autoUpdater,
        dialog,
        shell,
        getWindow: () => mainWindow,
        beforeInstall: stopBackend,
        locale: app.getLocale(),
      })
      updateController.start()
    }
    installApplicationMenu(updateController)
  }).catch((error) => {
    dialog.showErrorBox('DeepSeek Harness failed to start', error instanceof Error ? error.message : String(error))
    app.quit()
  })
}
