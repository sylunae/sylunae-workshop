import { app, dialog, ipcMain, shell } from 'electron'
import { copyFile, mkdir, mkdtemp, open, readFile, readdir, rename, rmdir, stat, unlink, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, join } from 'node:path'

import sharp from 'sharp'
import type { ImageFolderSummary } from '../../src/shared/types'

let lastImport = ''
let sourceFolder = ''
let sources: string[] = []
let generated: { path: string; name: string }[] = []
let staging = ''
let folderBusy = false
let directory: string | null = null
let settingsWrite: Promise<void> = Promise.resolve()
const settingsPath = () => join(app.getPath('userData'), 'image-processing.json')

async function getDirectory() {
  if (directory) return directory
  try {
    const settings = JSON.parse(await readFile(settingsPath(), 'utf8'))
    if (typeof settings.lastImport === 'string') lastImport = settings.lastImport
    if (typeof settings.directory === 'string' && settings.directory) directory = settings.directory
  } catch { /* First use or damaged preferences use the default directory. */ }
  directory ??= join(app.getPath('pictures'), '丝月工坊', '图片处理')
  return directory
}

async function clearStaging() {
  // Only remove files from the exact temporary directory allocated for this job.
  if (!staging || dirname(staging) !== app.getPath('temp') || !basename(staging).startsWith('sylunae-images-')) return
  for (const entry of await readdir(staging)) await unlink(join(staging, entry))
  await rmdir(staging)
  staging = ''
  generated = []
}

async function rememberImport(path: string) {
  await getDirectory()
  const write = settingsWrite.catch(() => {}).then(async () => {
    const temporary = `${settingsPath()}.tmp`
    await writeFile(temporary, JSON.stringify({ directory, lastImport: path }), 'utf8')
    await rename(temporary, settingsPath())
    lastImport = path
  })
  settingsWrite = write
  await write
}

async function scanFolder(recursive: boolean, selectedFolder = sourceFolder): Promise<ImageFolderSummary> {
  if (!selectedFolder) throw new Error('请先选择文件夹')
  const files: string[] = []
  const summary: ImageFolderSummary = { path: selectedFolder, count: 0, bytes: 0, formats: {}, recursive }
  const visit = async (path: string) => {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const full = join(path, entry.name)
      if (entry.isDirectory() && recursive) await visit(full)
      else if (entry.isFile() && /\.(png|jpe?g|webp|avif|gif|tiff?|bmp)$/i.test(entry.name)) {
        const info = await stat(full)
        files.push(full)
        summary.bytes += info.size
        const extension = extname(entry.name).slice(1).toUpperCase()
        summary.formats[extension] = (summary.formats[extension] ?? 0) + 1
      }
    }
  }
  await visit(selectedFolder)
  sourceFolder = selectedFolder
  sources = files
  summary.count = files.length
  return summary
}

export function registerImageProcessing() {
  app.once('before-quit', (event) => {
    event.preventDefault()
    void clearStaging().catch(() => {}).finally(() => app.quit())
  })
  ipcMain.handle('image-processing:remember-import', async (_event, path: unknown) => {
    if (typeof path === 'string' && path && (await stat(path)).isFile()) await rememberImport(dirname(path))
  })
  ipcMain.handle('image-processing:pick-folder', async () => {
    if (folderBusy) throw new Error('正在处理，请稍候')
    await getDirectory()
    const selected = await dialog.showOpenDialog({ title: '选择待处理图片文件夹', defaultPath: lastImport || app.getPath('pictures'), properties: ['openDirectory'] })
    if (selected.canceled || !selected.filePaths[0]) return null
    const summary = await scanFolder(false, selected.filePaths[0])
    await rememberImport(summary.path)
    return summary
  })
  ipcMain.handle('image-processing:scan-folder', async (_event, recursive: unknown) => {
    if (folderBusy || typeof recursive !== 'boolean') throw new Error('无法扫描文件夹')
    return scanFolder(recursive)
  })
  ipcMain.handle('image-processing:process-folder', async (_event, format: string, level: string) => {
    if (folderBusy || !sources.length || !['image/png', 'image/jpeg', 'image/webp'].includes(format) || !['strong', 'standard', 'original'].includes(level)) throw new Error('无效的批处理参数')
    folderBusy = true
    try {
      await clearStaging()
      staging = await mkdtemp(join(app.getPath('temp'), 'sylunae-images-'))
      generated = []
      const output = { count: 0, bytes: 0, errors: [] as string[] }
      for (const [index, source] of sources.entries()) {
        try {
          const extension = format === 'image/jpeg' ? 'jpg' : format.split('/')[1]
          const name = level === 'original' ? basename(source) : `${basename(source, extname(source))}.${extension}`
          const path = join(staging, `${index}-${name}`)
          if (level === 'original') await copyFile(source, path)
          else {
            let pipeline = sharp(source).rotate()
            const quality = level === 'strong' ? 45 : 82
            if (format === 'image/jpeg') pipeline = pipeline.flatten({ background: '#fff' }).jpeg({ quality, mozjpeg: true })
            else if (format === 'image/webp') pipeline = pipeline.webp({ quality, effort: 6 })
            else pipeline = pipeline.png({ compressionLevel: 9 })
            await pipeline.toFile(path)
          }
          generated.push({ path, name })
          output.count++
          output.bytes += (await stat(path)).size
        } catch (error) { output.errors.push(`${source}：${error instanceof Error ? error.message : '处理失败'}`) }
      }
      return output
    } finally { folderBusy = false }
  })
  ipcMain.handle('image-processing:save-folder', async () => {
    if (folderBusy) throw new Error('正在处理，请稍候')
    folderBusy = true
    try {
      const output = { count: 0, errors: [] as string[] }
      for (const item of generated) {
        try { await saveImage(item.name, await readFile(item.path)); output.count++ }
        catch (error) { output.errors.push(`${item.name}：${error instanceof Error ? error.message : '保存失败'}`) }
      }
      return output
    } finally { folderBusy = false }
  })
  ipcMain.handle('image-processing:get-directory', getDirectory)
  ipcMain.handle('image-processing:pick-directory', async () => {
    await getDirectory()
    await settingsWrite.catch(() => {})
    const selected = await dialog.showOpenDialog({ title: '下载图片到文件夹', defaultPath: lastImport || directory || app.getPath('pictures'), properties: ['openDirectory', 'createDirectory'] })
    if (selected.canceled || !selected.filePaths[0]) return null
    const path = selected.filePaths[0]
    const write = settingsWrite.catch(() => {}).then(async () => {
      const temporary = `${settingsPath()}.tmp`
      await writeFile(temporary, JSON.stringify({ directory: path, lastImport }), 'utf8')
      await rename(temporary, settingsPath())
      directory = path
    })
    settingsWrite = write
    await write
    return path
  })
  ipcMain.handle('image-processing:open-directory', async () => {
    const path = await getDirectory()
    await mkdir(path, { recursive: true })
    const error = await shell.openPath(path)
    if (error) throw new Error(error)
  })
  ipcMain.handle('image-processing:save', async (_event, name: unknown, bytes: unknown) => {
    if (!(bytes instanceof ArrayBuffer)) throw new Error('无效的图片输出')
    return saveImage(name, Buffer.from(bytes))
  })
}

async function saveImage(name: unknown, bytes: Buffer) {
    if (typeof name !== 'string' || !/\.(png|jpe?g|webp|avif|gif|tiff?|bmp|svg|ico)$/i.test(name) || bytes.byteLength === 0 || bytes.byteLength > 256 * 1024 * 1024) throw new Error('无效的图片输出')
    // Accept a filename only; renderer input can never select an arbitrary path.
    const safeName = name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/[. ]+$/, '').slice(-180)
    const path = await getDirectory()
    await mkdir(path, { recursive: true })
    for (let suffix = 0; suffix < 10000; suffix++) {
      const candidate = join(path, suffix ? safeName.replace(/(\.[^.]+)$/, ` (${suffix})$1`) : safeName)
      let handle
      try { handle = await open(candidate, 'wx') }
      catch (reason) { if ((reason as NodeJS.ErrnoException).code === 'EEXIST') continue; throw reason }
      try {
        await handle.writeFile(Buffer.from(bytes))
        await handle.close()
        return candidate
      } catch (reason) {
        await handle.close().catch(() => {})
        await unlink(candidate).catch(() => {})
        throw reason
      }
    }
    throw new Error('同名文件过多，请更换输出文件夹')
}
