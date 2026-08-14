import assert from 'node:assert/strict'
import test from 'node:test'
import { classifyNavigation } from '../src/url-policy.mjs'

const APPLICATION_ORIGIN = 'http://127.0.0.1:49152'

test('navigation stays on the active loopback origin', () => {
  assert.equal(classifyNavigation(`${APPLICATION_ORIGIN}/settings`, APPLICATION_ORIGIN), 'allow')
  assert.equal(classifyNavigation('http://127.0.0.1:3080/', APPLICATION_ORIGIN), 'deny')
})

test('only HTTPS links may leave the Electron renderer', () => {
  assert.equal(classifyNavigation('https://deepseek.com/', APPLICATION_ORIGIN), 'external')
  assert.equal(classifyNavigation('http://example.com/', APPLICATION_ORIGIN), 'deny')
  assert.equal(classifyNavigation('file:///etc/passwd', APPLICATION_ORIGIN), 'deny')
  assert.equal(classifyNavigation('not a URL', APPLICATION_ORIGIN), 'deny')
})
