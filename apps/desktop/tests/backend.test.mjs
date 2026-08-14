import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { PassThrough, Writable } from 'node:stream'
import test from 'node:test'
import { createLineDecoder, extractReadyUrl, waitForBackendReady } from '../src/backend.mjs'

function sink() {
  return new Writable({ write(_chunk, _encoding, callback) { callback() } })
}

function fakeChild() {
  const child = new EventEmitter()
  child.stdout = new PassThrough()
  child.stderr = new PassThrough()
  return child
}

test('extractReadyUrl accepts only the loopback readiness signal', () => {
  assert.equal(extractReadyUrl('dsh web: http://127.0.0.1:43127'), 'http://127.0.0.1:43127')
  assert.equal(extractReadyUrl('dsh web: http://localhost:43127'), undefined)
  assert.equal(extractReadyUrl('ready http://127.0.0.1:43127'), undefined)
})

test('createLineDecoder joins split chunks and flushes the final line', () => {
  const lines = []
  const decoder = createLineDecoder(line => lines.push(line))
  decoder.push('first\nsec')
  decoder.push('ond\r\nthird')
  decoder.end()
  assert.deepEqual(lines, ['first', 'second', 'third'])
})

test('waitForBackendReady resolves a readiness line split across chunks', async () => {
  const child = fakeChild()
  const ready = waitForBackendReady(child, { timeoutMs: 100, stdout: sink(), stderr: sink() })
  child.stdout.write('dsh web: http://127.0.0.')
  child.stdout.write('1:49152\n')
  assert.equal(await ready, 'http://127.0.0.1:49152')
})

test('waitForBackendReady reports an early backend exit', async () => {
  const child = fakeChild()
  const ready = waitForBackendReady(child, { timeoutMs: 100, stdout: sink(), stderr: sink() })
  child.stderr.write('boot failed')
  child.emit('exit', 1)
  await assert.rejects(ready, /exited with code 1 before readiness[\s\S]*boot failed/)
})
