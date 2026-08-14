import assert from 'node:assert/strict'
import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { pruneHarnessRuntime, requiredPtyArtifacts } from '../scripts/prune-harness.mjs'

test('requiredPtyArtifacts covers macOS and Windows native runtimes', () => {
  assert.deepEqual(requiredPtyArtifacts('darwin'), ['pty.node', 'spawn-helper'])
  assert.deepEqual(requiredPtyArtifacts('win32'), ['conpty.node', 'conpty_console_list.node', 'pty.node'])
})

test('pruneHarnessRuntime keeps rebuilt PTY artifacts and removes build-only files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-desktop-prune-'))
  const modules = join(root, 'node_modules')
  const release = join(modules, 'node-pty', 'build', 'Release')
  const prebuilds = join(modules, 'node-pty', 'prebuilds', 'win32-x64')
  const packageLib = join(modules, 'example', 'lib')
  try {
    await Promise.all([
      mkdir(release, { recursive: true }),
      mkdir(prebuilds, { recursive: true }),
      mkdir(packageLib, { recursive: true }),
    ])
    await Promise.all([
      writeFile(join(release, 'pty.node'), ''),
      writeFile(join(release, 'spawn-helper'), ''),
      writeFile(join(prebuilds, 'pty.node'), ''),
      writeFile(join(packageLib, 'index.js'), ''),
      writeFile(join(packageLib, 'index.js.map'), ''),
    ])

    await pruneHarnessRuntime(root)

    await Promise.all([
      access(join(release, 'pty.node')),
      access(join(release, 'spawn-helper')),
      access(join(packageLib, 'index.js')),
    ])
    await assert.rejects(access(join(modules, 'node-pty', 'prebuilds')))
    await assert.rejects(access(join(packageLib, 'index.js.map')))
  } finally {
    await rm(root, { force: true, recursive: true })
  }
})
