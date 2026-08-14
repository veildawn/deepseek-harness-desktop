import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { app, BrowserWindow } from 'electron/main'
import { waitForBackendReady } from '../src/backend.mjs'

const READY_HOLD_MS = 2_000
const STOP_TIMEOUT_MS = 10_000
const PTY_TIMEOUT_MS = 5_000

/** Race a promise against a bounded staging timeout. */
function withTimeout(promise, timeoutMs, message) {
  let timer
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), timeoutMs)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

/** Prove the retained target-native PTY and spawn helper execute successfully. */
async function verifyNativePty(harnessRoot) {
  const require = createRequire(join(harnessRoot, 'package.json'))
  const pty = require('node-pty')
  const marker = 'dsh-desktop-pty-ok'
  const executable = process.platform === 'win32' ? process.env.ComSpec ?? 'cmd.exe' : '/bin/sh'
  const args = process.platform === 'win32'
    ? ['/d', '/s', '/c', `echo ${marker}`]
    : ['-c', `printf ${marker}`]
  let output = ''
  await withTimeout(new Promise((resolve, reject) => {
    const child = pty.spawn(executable, args, {
      cols: 80,
      cwd: harnessRoot,
      env: process.env,
      name: 'xterm-color',
      rows: 24,
    })
    child.onData(data => { output += data })
    child.onExit(({ exitCode, signal }) => {
      if (exitCode === 0 && output.includes(marker)) resolve()
      else reject(new Error(`desktop stage: native PTY failed with code ${String(exitCode)}, signal ${String(signal)}: ${output}`))
    })
  }), PTY_TIMEOUT_MS, 'desktop stage: native PTY verification timed out')
}

/** Prove the staged production closure boots, serves HTTP, remains alive, and drains. */
async function verify() {
  const harnessRoot = process.env.DSH_DESKTOP_STAGE_ROOT
  if (harnessRoot === undefined) throw new Error('desktop stage: DSH_DESKTOP_STAGE_ROOT is required')
  const cliEntry = join(harnessRoot, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
  const workspace = process.env.DSH_DESKTOP_VERIFY_WORKSPACE ?? harnessRoot
  const home = await mkdtemp(join(tmpdir(), 'dsh-desktop-electron-'))
  let child
  try {
    await verifyNativePty(harnessRoot)
    child = spawn(process.execPath, [
      '--expose-internals',
      fileURLToPath(new URL('../src/backend-entry.mjs', import.meta.url)),
      'web',
      '--port',
      '0',
    ], {
      cwd: workspace,
      env: { ...process.env, DSH_DESKTOP_CLI_ENTRY: cliEntry, DSH_HOME: home, ELECTRON_RUN_AS_NODE: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let observedExit
    const exited = once(child, 'exit').then(([code, signal]) => {
      observedExit = { code, signal }
      return code
    })
    const url = await waitForBackendReady(child)
    child.stdout?.pipe(process.stdout)
    child.stderr?.pipe(process.stderr)
    await withTimeout(new Promise(resolve => setTimeout(resolve, READY_HOLD_MS)), READY_HOLD_MS + 1_000, 'desktop stage: readiness hold timed out')
    const response = await fetch(url)
    if (!response.ok) throw new Error(`desktop stage: HTTP verification failed with ${String(response.status)}`)
    const window = new BrowserWindow({
      show: false,
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
    })
    await window.loadURL(url)
    await withTimeout(new Promise(resolve => setTimeout(resolve, READY_HOLD_MS)), READY_HOLD_MS + 1_000, 'desktop stage: browser hold timed out')
    window.destroy()
    if (observedExit !== undefined) {
      throw new Error(`desktop stage: backend process exited after the browser connected: ${JSON.stringify(observedExit)}`)
    }
    child.kill()
    const code = await withTimeout(exited, STOP_TIMEOUT_MS, 'desktop stage: backend process did not stop')
    child = undefined
    if (code !== 0) throw new Error(`desktop stage: backend process exited with code ${String(code)}`)
  } finally {
    child?.kill()
    await rm(home, { recursive: true, force: true })
  }
}

void app.whenReady().then(verify).then(() => app.exit(0)).catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`)
  app.exit(1)
})
