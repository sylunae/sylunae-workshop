import { app, BrowserWindow, ipcMain } from 'electron'
import updater from 'electron-updater'
import type { AppUpdateStatus } from '../../src/shared/types'

export function registerAppUpdates() {
  if (!app.isPackaged || process.platform !== 'win32') return

  const { autoUpdater } = updater
  autoUpdater.autoInstallOnAppQuit = false
  autoUpdater.allowDowngrade = false
  autoUpdater.allowPrerelease = false

  let status: AppUpdateStatus = { phase: 'idle' }
  const publish = (next: AppUpdateStatus) => {
    status = next
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send('updates:status', status)
    }
  }
  const fail = (error: unknown) => {
    console.error('Desktop update failed:', error)
    if (status.phase !== 'error') publish({ phase: 'error' })
  }

  autoUpdater.on('error', fail)
  autoUpdater.on('update-not-available', () => publish({ phase: 'current' }))
  autoUpdater.on('update-available', ({ version }) => publish({ phase: 'downloading', version, percent: 0 }))
  autoUpdater.on('download-progress', ({ percent }) => {
    if (status.phase !== 'downloading') return
    const rounded = Math.min(100, Math.max(0, Math.floor(percent)))
    if (rounded !== status.percent) publish({ ...status, percent: rounded })
  })
  autoUpdater.on('update-downloaded', ({ version }) => publish({ phase: 'ready', version }))

  const check = async () => {
    if (['checking', 'downloading', 'ready', 'installing'].includes(status.phase)) return
    publish({ phase: 'checking' })
    try {
      const result = await autoUpdater.checkForUpdates()
      await result?.downloadPromise
    } catch (error) {
      if (status.phase !== 'error') fail(error)
    }
  }

  ipcMain.handle('updates:get-status', () => status)
  ipcMain.handle('updates:check', () => { void check() })
  ipcMain.handle('updates:install', () => {
    if (status.phase !== 'ready') return false
    publish({ phase: 'installing', version: status.version })
    autoUpdater.quitAndInstall(true, true)
    return true
  })

  setTimeout(() => { void check() }, 5000).unref()
  setInterval(() => { void check() }, 60 * 60 * 1000).unref()
}
