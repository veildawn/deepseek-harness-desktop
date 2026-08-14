export const RELEASES_URL = 'https://github.com/veildawn/deeseek-gui/releases/latest'
export const UPDATE_CHECK_DELAY_MS = 10_000
export const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1_000

const COPY = {
  en: {
    available: version => `DeepSeek Harness ${version} is available. Download it now?`,
    availableTitle: 'Update available',
    current: 'You are using the latest version of DeepSeek Harness.',
    currentTitle: 'No updates available',
    download: 'Download update',
    downloadFailed: 'The update could not be checked or installed automatically. You can download it from GitHub Releases.',
    downloadFailedTitle: 'Update unavailable',
    later: 'Later',
    openRelease: 'View release',
    ready: version => `DeepSeek Harness ${version} is ready. Restart now to install it?`,
    readyTitle: 'Update ready',
    restart: 'Restart and install',
  },
  zh: {
    available: version => `DeepSeek Harness ${version} 已发布，是否立即下载？`,
    availableTitle: '发现新版本',
    current: '当前已是 DeepSeek Harness 最新版本。',
    currentTitle: '暂无更新',
    download: '下载更新',
    downloadFailed: '无法自动检查或安装更新，可前往 GitHub Releases 手动下载。',
    downloadFailedTitle: '更新不可用',
    later: '稍后',
    openRelease: '查看发布页',
    ready: version => `DeepSeek Harness ${version} 已下载，是否立即重启安装？`,
    readyTitle: '更新已就绪',
    restart: '重启并安装',
  },
}

function getCopy(locale) {
  return locale.toLowerCase().startsWith('zh') ? COPY.zh : COPY.en
}

/** Configure GitHub release checks without exposing updater privileges to the renderer. */
export function createUpdateController({
  updater,
  dialog,
  shell,
  getWindow,
  beforeInstall,
  locale,
  setTimeoutFn = setTimeout,
  setIntervalFn = setInterval,
}) {
  const copy = getCopy(locale)
  let checking = false
  let downloading = false
  let showingError = false
  let notifyWhenCurrent = false
  let announcedVersion
  let downloadedVersion

  updater.autoDownload = false
  updater.autoInstallOnAppQuit = true
  // NSIS uses blockmaps by default; keep differential downloads explicit.
  updater.disableDifferentialDownload = false

  function showMessage(options) {
    const window = getWindow()
    return window === undefined ? dialog.showMessageBox(options) : dialog.showMessageBox(window, options)
  }

  async function openRelease() {
    await shell.openExternal(RELEASES_URL)
  }

  async function reportDownloadFailure(error) {
    if (showingError) return
    showingError = true
    process.stderr.write(`desktop updater: ${error instanceof Error ? error.stack : String(error)}\n`)
    const result = await showMessage({
      type: 'error',
      title: copy.downloadFailedTitle,
      message: copy.downloadFailed,
      buttons: [copy.openRelease, copy.later],
      defaultId: 0,
      cancelId: 1,
    })
    showingError = false
    if (result.response === 0) await openRelease()
  }

  async function offerDownload(info) {
    if (announcedVersion === info.version) return
    announcedVersion = info.version
    const result = await showMessage({
      type: 'info',
      title: copy.availableTitle,
      message: copy.available(info.version),
      buttons: [copy.download, copy.openRelease, copy.later],
      defaultId: 0,
      cancelId: 2,
    })
    if (result.response === 1) {
      await openRelease()
      return
    }
    if (result.response !== 0) return
    downloading = true
    try {
      await updater.downloadUpdate()
    } catch (error) {
      downloading = false
      await reportDownloadFailure(error)
    }
  }

  async function offerInstall(info) {
    if (downloadedVersion === info.version) return
    downloadedVersion = info.version
    downloading = false
    getWindow()?.setProgressBar(-1)
    const result = await showMessage({
      type: 'info',
      title: copy.readyTitle,
      message: copy.ready(info.version),
      buttons: [copy.restart, copy.later],
      defaultId: 0,
      cancelId: 1,
    })
    if (result.response !== 0) return
    await beforeInstall()
    updater.quitAndInstall(false, true)
  }

  updater.on('update-available', info => {
    checking = false
    notifyWhenCurrent = false
    void offerDownload(info)
  })
  updater.on('update-not-available', () => {
    checking = false
    if (!notifyWhenCurrent) return
    notifyWhenCurrent = false
    void showMessage({
      type: 'info',
      title: copy.currentTitle,
      message: copy.current,
      buttons: ['OK'],
      defaultId: 0,
    })
  })
  updater.on('download-progress', progress => {
    getWindow()?.setProgressBar(Math.max(0, Math.min(1, progress.percent / 100)))
  })
  updater.on('update-downloaded', info => { void offerInstall(info) })
  updater.on('error', error => {
    checking = false
    const shouldReport = downloading || notifyWhenCurrent
    notifyWhenCurrent = false
    if (!shouldReport) {
      process.stderr.write(`desktop updater check: ${error instanceof Error ? error.message : String(error)}\n`)
      return
    }
    downloading = false
    getWindow()?.setProgressBar(-1)
    void reportDownloadFailure(error)
  })

  async function check({ notifyNoUpdate = false } = {}) {
    if (notifyNoUpdate) notifyWhenCurrent = true
    if (checking || downloading) return
    checking = true
    try {
      await updater.checkForUpdates()
    } catch (error) {
      checking = false
      if (notifyWhenCurrent) {
        notifyWhenCurrent = false
        await reportDownloadFailure(error)
      } else {
        process.stderr.write(`desktop updater check: ${error instanceof Error ? error.message : String(error)}\n`)
      }
    }
  }

  function start() {
    const firstCheck = setTimeoutFn(() => { void check() }, UPDATE_CHECK_DELAY_MS)
    const recurringCheck = setIntervalFn(() => { void check() }, UPDATE_CHECK_INTERVAL_MS)
    firstCheck.unref?.()
    recurringCheck.unref?.()
    return () => {
      clearTimeout(firstCheck)
      clearInterval(recurringCheck)
    }
  }

  return { check, openRelease, start }
}
