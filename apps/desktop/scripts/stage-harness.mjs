import { execFileSync } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { pruneHarnessRuntime } from './prune-harness.mjs'

const desktopRoot = fileURLToPath(new URL('..', import.meta.url))
const repositoryRoot = fileURLToPath(new URL('../../..', import.meta.url))
const distRoot = join(desktopRoot, 'dist')
const harnessRoot = join(distRoot, 'harness')
const desktopManifest = JSON.parse(await readFile(join(desktopRoot, 'package.json'), 'utf8'))
const ELECTRON_VERSION = desktopManifest.devDependencies.electron
const HARNESS_VERSION = process.env.DSH_HARNESS_VERSION ?? '0.1.0-rc.6'

if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(HARNESS_VERSION)) {
  throw new Error(`desktop stage: invalid DSH_HARNESS_VERSION: ${HARNESS_VERSION}`)
}

/** Run a packaging command and preserve its output and exit status. */
function run(command, args, options = {}) {
  execFileSync(command, args, {
    cwd: repositoryRoot,
    env: process.env,
    shell: process.platform === 'win32',
    stdio: 'inherit',
    ...options,
  })
}

/** Write the isolated manifest for the published, internally consistent CLI release. */
async function prepareHarnessManifest() {
  const manifest = {
    name: 'deepseek-gui-harness-runtime',
    private: true,
    version: '0.0.0',
    packageManager: 'pnpm@11.7.0',
    dependencies: { '@deepseek-ai/dsh': HARNESS_VERSION },
  }
  await writeFile(join(harnessRoot, 'package.json'), `${JSON.stringify(manifest, undefined, 2)}\n`)
}

/** Install the packed CLI with a reviewed lifecycle-script policy. */
async function installProductionClosure() {
  const workspacePolicy = [
    'packages:',
    '  - .',
    'nodeLinker: hoisted',
    'allowBuilds:',
    "  '@deepseek-ai/dsh-subprocess-local': true",
    "  '@google/genai': false",
    '  koffi: true',
    '  node-addon-require-builtin: false',
    '  node-pty: true',
    '  protobufjs: false',
    '',
  ].join('\n')
  await writeFile(join(harnessRoot, 'pnpm-workspace.yaml'), workspacePolicy)
  const registry = process.env.npm_config_registry ?? 'https://registry.npmjs.org'
  run('pnpm', ['install', '--prod', '--no-lockfile', `--registry=${registry}`], { cwd: harnessRoot })
}

/** Rebuild native dependencies for Electron, then verify them in its Node runtime. */
async function verifyStagedHarness() {
  const electronRebuild = join(desktopRoot, 'node_modules', '.bin', 'electron-rebuild')
  const electron = join(desktopRoot, 'node_modules', '.bin', 'electron')
  run(electronRebuild, [
    '--force',
    '--module-dir', harnessRoot,
    '--version', ELECTRON_VERSION,
    '--arch', process.arch,
  ])
  await pruneHarnessRuntime(harnessRoot)
  run(electron, [join(desktopRoot, 'scripts', 'verify-staged-electron.mjs')], {
    env: { ...process.env, DSH_DESKTOP_STAGE_ROOT: harnessRoot },
  })
}

await mkdir(harnessRoot, { recursive: true })
await prepareHarnessManifest()
await installProductionClosure()
await verifyStagedHarness()
