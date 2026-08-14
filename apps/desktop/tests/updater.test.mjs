import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import test from 'node:test'
import { createUpdateController, RELEASES_URL } from '../src/updater.mjs'

test('update controller checks, downloads, and installs a GitHub release', async () => {
  const updater = new EventEmitter()
  const messages = []
  const progress = []
  let checks = 0
  let downloads = 0
  let installs = 0
  let stopped = 0
  updater.checkForUpdates = async () => { checks += 1 }
  updater.downloadUpdate = async () => { downloads += 1 }
  updater.quitAndInstall = () => { installs += 1 }
  const responses = [{ response: 0 }, { response: 0 }]
  const controller = createUpdateController({
    updater,
    dialog: {
      async showMessageBox(_window, options) {
        messages.push(options)
        return responses.shift()
      },
    },
    shell: { async openExternal() {} },
    getWindow: () => ({ setProgressBar: value => progress.push(value) }),
    beforeInstall: async () => { stopped += 1 },
    locale: 'zh-CN',
  })

  await controller.check()
  updater.emit('update-available', { version: '0.1.1' })
  await new Promise(resolve => setImmediate(resolve))
  updater.emit('download-progress', { percent: 42 })
  updater.emit('update-downloaded', { version: '0.1.1' })
  await new Promise(resolve => setImmediate(resolve))

  assert.equal(RELEASES_URL, 'https://github.com/veildawn/deeseek-gui/releases/latest')
  assert.equal(updater.autoDownload, false)
  assert.equal(updater.autoInstallOnAppQuit, true)
  assert.equal(updater.disableDifferentialDownload, false)
  assert.equal(checks, 1)
  assert.equal(downloads, 1)
  assert.equal(stopped, 1)
  assert.equal(installs, 1)
  assert.deepEqual(progress, [0.42, -1])
  assert.match(messages[0].message, /0\.1\.1/)
})
