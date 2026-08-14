import { existsSync } from 'node:fs'
import { readdir, rm, unlink } from 'node:fs/promises'
import { join } from 'node:path'

const REMOVAL_BATCH_SIZE = 128

/** Native node-pty outputs that must survive pruning on each release platform. */
export function requiredPtyArtifacts(platform) {
  if (platform === 'win32') return ['conpty.node', 'conpty_console_list.node', 'pty.node']
  if (platform === 'darwin') return ['pty.node', 'spawn-helper']
  return ['pty.node']
}

/** Remove files selected by name without relying on platform-specific shell tools. */
async function removeMatchingFiles(root, matches) {
  const directories = [root]
  const files = []
  while (directories.length > 0) {
    const directory = directories.pop()
    if (directory === undefined) break
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) directories.push(path)
      else if (entry.isFile() && matches(entry.name)) files.push(path)
    }
  }
  for (let offset = 0; offset < files.length; offset += REMOVAL_BATCH_SIZE) {
    await Promise.all(files.slice(offset, offset + REMOVAL_BATCH_SIZE).map(path => unlink(path)))
  }
  return files.length
}

/**
 * Remove build-only content after native rebuilding and before runtime verification.
 * Every removed directory is either a non-target native prebuild, package tests or
 * sources behind an explicit compiled export; the browser smoke tests the result.
 */
export async function pruneHarnessRuntime(harnessRoot) {
  const modules = join(harnessRoot, 'node_modules')
  const pty = join(modules, 'node-pty')
  for (const artifact of requiredPtyArtifacts(process.platform)) {
    const path = join(pty, 'build', 'Release', artifact)
    if (!existsSync(path)) throw new Error(`desktop stage: rebuilt node-pty artifact missing: ${path}`)
  }

  const paths = [
    join(modules, '@anthropic-ai', 'sdk', 'src'),
    join(modules, '@mistralai', 'mistralai', 'examples'),
    join(modules, '@mistralai', 'mistralai', 'packages'),
    join(modules, '@mistralai', 'mistralai', 'src'),
    join(modules, '@mistralai', 'mistralai', 'tests'),
    join(modules, '@mixmark-io', 'domino', 'test'),
    join(modules, '@types'),
    join(modules, 'katex', 'src'),
    join(modules, 'node-pty', 'deps'),
    join(modules, 'node-pty', 'node-addon-api'),
    join(modules, 'node-pty', 'prebuilds'),
    join(modules, 'node-pty', 'scripts'),
    join(modules, 'node-pty', 'src'),
    join(modules, 'node-pty', 'third_party'),
    join(modules, 'openai', 'src'),
    join(modules, 'sharp', 'src'),
    join(modules, 'zod', 'src'),
  ]
  await Promise.all(paths.map(path => rm(path, { force: true, recursive: true })))
  const removedMaps = await removeMatchingFiles(modules, name => name.endsWith('.map'))
  process.stdout.write(`desktop stage: pruned build-only runtime content (${String(removedMaps)} source maps)\n`)
}
