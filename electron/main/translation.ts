import { app, BrowserWindow, clipboard, ipcMain, safeStorage } from 'electron'
import { readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { googleTranslateWebUrl, googleTranslationLanguages, normalizeTranslationCredentials, translateWithGoogle, type TranslationCredentials, type TranslationRequest } from '../../src/shared/translation'

export function registerTranslation() {
  ipcMain.handle('translation:open-web', async (event, request: Parameters<typeof googleTranslateWebUrl>[0]) => {
    const url = googleTranslateWebUrl(request)
    const window = new BrowserWindow({
      parent: BrowserWindow.fromWebContents(event.sender) ?? undefined,
      title: 'Google 翻译',
      width: 1100,
      height: 760,
      autoHideMenuBar: true,
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, partition: 'google-translate-web' },
    })
    window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
    window.webContents.session.setPermissionCheckHandler(() => false)
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    const restrictNavigation = (event: Electron.Event, target: string) => {
      if (new URL(target).origin !== 'https://translate.google.com') event.preventDefault()
    }
    window.webContents.on('will-navigate', restrictNavigation)
    window.webContents.on('will-redirect', restrictNavigation)
    try {
      await window.loadURL(url)
    } catch {
      if (window.isDestroyed()) return
      window.destroy()
      throw new Error('无法打开 Google 翻译网页，请检查网络后重试。')
    }
  })
  ipcMain.handle('translation:read-clipboard', () => ({ text: clipboard.readText() }))
  ipcMain.handle('translation:write-clipboard', (_event, value: { text: string }) => clipboard.writeText(value.text))
  const path = join(app.getPath('userData'), 'google-translator.credentials')
  let pending = Promise.resolve<unknown>(undefined)
  const serialize = <T>(work: () => Promise<T>) => {
    const result = pending.then(work)
    pending = result.catch(() => undefined)
    return result
  }
  async function load(): Promise<TranslationCredentials | undefined> {
    try {
      return normalizeTranslationCredentials(JSON.parse(safeStorage.decryptString(await readFile(path))))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
      throw new Error('无法读取本机 Google Cloud API Key，请重新配置。')
    }
  }

  ipcMain.handle('translation:status', () => serialize(async () => {
    const credentials = await load()
    return { configured: Boolean(credentials) }
  }))
  ipcMain.handle('translation:save', (_event, value: TranslationCredentials) => serialize(async () => {
    const credentials = normalizeTranslationCredentials(value)
    if (!safeStorage.isEncryptionAvailable()) throw new Error('系统凭据加密不可用。')
    const temporary = path + '.tmp'
    try {
      await writeFile(temporary, safeStorage.encryptString(JSON.stringify(credentials)), { mode: 0o600 })
      await rename(temporary, path)
    } finally {
      await rm(temporary, { force: true }).catch(() => undefined)
    }
  }))
  ipcMain.handle('translation:clear', () => serialize(() => rm(path, { force: true })))
  ipcMain.handle('translation:translate', async (_event, request: TranslationRequest) => {
    const credentials = await serialize(load)
    if (!credentials) throw new Error('请先填写自己的 Google Cloud API Key。')
    return translateWithGoogle(credentials, request)
  })
  ipcMain.handle('translation:languages', async () => {
    const credentials = await serialize(load)
    if (!credentials) throw new Error('请先填写自己的 Google Cloud API Key。')
    return googleTranslationLanguages(credentials)
  })
}
