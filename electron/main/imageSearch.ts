import { dialog, ipcMain, shell, type WebContents } from 'electron'
import { open, opendir } from 'node:fs/promises'
import { basename, join, relative } from 'node:path'
import sharp from 'sharp'
import {
  imageFingerprint, imageSearchExtensions, imageSimilarity, isSearchableImage, rankImageMatches,
  type ImageSearchOptions, type ImageSearchOutput, type ImageSearchProgress,
} from '../../src/shared/imageSearch'

async function imageBytes(path: string) {
  const file = await open(path, 'r')
  try {
    const info = await file.stat()
    if (!info.isFile() || info.size > 128 * 1024 * 1024) throw new Error('图片文件超过 128 MB 或无法读取')
    return await file.readFile()
  } finally { await file.close() }
}

async function fingerprint(path: string) {
  // Buffer input prevents libvips' file cache from locking source images on Windows.
  const image = sharp(await imageBytes(path), { limitInputPixels: 80_000_000 })
  const metadata = await image.metadata()
  const { data, info } = await image.rotate()
    .flatten({ background: '#fff' }).toColourspace('srgb').removeAlpha()
    .resize(32, 32, { fit: 'fill' }).raw().toBuffer({ resolveWithObject: true })
  // autoOrient accounts for EXIF rotation when comparing aspect ratios.
  const dimensions = metadata.autoOrient ?? metadata
  return imageFingerprint(data, (dimensions.width ?? info.width) / (dimensions.height ?? info.height))
}

async function preview(path: string) {
  const bytes = await sharp(await imageBytes(path), { limitInputPixels: 80_000_000 }).rotate().resize(360, 260, { fit: 'inside', withoutEnlargement: true })
    .flatten({ background: '#fff' }).jpeg({ quality: 78 }).toBuffer()
  return `data:image/jpeg;base64,${bytes.toString('base64')}`
}

export async function searchImageFolder(
  referencePath: string, folder: string, options: ImageSearchOptions,
  signal: AbortSignal, report: (progress: ImageSearchProgress) => void,
): Promise<ImageSearchOutput> {
  const reference = await fingerprint(referencePath)
  const progress: ImageSearchProgress = { checked: 0, failed: 0, skippedFolders: 0, discovered: 0, current: '', phase: 'searching' }
  let ranked: { path: string; score: number }[] = []
  let matches = 0
  let lastReport = 0
  const emit = (force = false) => {
    if (force || Date.now() - lastReport > 100) { report({ ...progress }); lastReport = Date.now() }
  }
  // Stream directory entries so a large tree doesn't create a huge file list.
  // Symlinks/junctions are excluded, preventing loops and escapes from the selected tree.
  const directories = [folder]
  while (directories.length && !signal.aborted) {
    const directory = directories.pop()!
    try {
      const handle = await opendir(directory)
      for await (const entry of handle) {
        if (signal.aborted) break
        const path = join(directory, entry.name)
        if (entry.isDirectory() && options.recursive) directories.push(path)
        if (!entry.isFile() || !isSearchableImage(entry.name)) continue
        progress.discovered++
        progress.current = relative(folder, path)
        try {
          const score = imageSimilarity(reference, await fingerprint(path))
          progress.checked++
          if (score >= options.minScore) { matches++; ranked = rankImageMatches([...ranked, { path, score }]) }
        } catch { progress.failed++ }
        emit()
      }
    } catch (error) {
      if (directory === folder) throw new Error('无法读取所选文件夹，请检查路径和访问权限', { cause: error })
      progress.skippedFolders++
      emit()
    }
  }
  progress.phase = 'previews'
  emit(true)
  const results: ImageSearchOutput['results'] = []
  for (const match of ranked) {
    // Cancellation still returns matches already found. Preview errors don't hide a match.
    let thumbnail = ''
    if (!signal.aborted) { try { thumbnail = await preview(match.path) } catch { /* File may have moved. */ } }
    results.push({ ...match, name: basename(match.path), preview: thumbnail })
  }
  return { ...progress, current: '', results, matches, cancelled: signal.aborted }
}

export function registerImageSearch() {
  const sessions = new Map<number, { reference: string; folder: string; job?: AbortController; results: Set<string>; picking: boolean }>()
  const session = (sender: WebContents) => {
    let value = sessions.get(sender.id)
    if (!value) {
      value = { reference: '', folder: '', results: new Set(), picking: false }
      sessions.set(sender.id, value)
      sender.once('destroyed', () => { value!.job?.abort(); sessions.delete(sender.id) })
    }
    return value
  }
  ipcMain.handle('image-search:pick-reference', async ({ sender }) => {
    const state = session(sender)
    if (state.job || state.picking) throw new Error('请等待当前操作结束')
    state.picking = true
    try {
      const selected = await dialog.showOpenDialog({ title: '选择用于查找的图片', properties: ['openFile'], filters: [{ name: '图片', extensions: imageSearchExtensions }] })
      if (selected.canceled || !selected.filePaths[0]) return null
      const path = selected.filePaths[0]
      const thumbnail = await preview(path)
      state.reference = path
      state.results.clear()
      return { name: basename(path), preview: thumbnail }
    } finally { state.picking = false }
  })
  ipcMain.handle('image-search:pick-folder', async ({ sender }) => {
    const state = session(sender)
    if (state.job || state.picking) throw new Error('请等待当前操作结束')
    state.picking = true
    try {
      const selected = await dialog.showOpenDialog({ title: '选择要查找的图片文件夹', properties: ['openDirectory'] })
      if (selected.canceled || !selected.filePaths[0]) return null
      state.folder = selected.filePaths[0]
      state.results.clear()
      return state.folder
    } finally { state.picking = false }
  })
  ipcMain.handle('image-search:search', async ({ sender }, options: ImageSearchOptions) => {
    const state = session(sender)
    if (state.job || state.picking || !state.reference || !state.folder) throw new Error('请先选择图片和文件夹，并等待当前操作结束')
    if (!options || typeof options.recursive !== 'boolean' || !Number.isFinite(options.minScore) || options.minScore < 0 || options.minScore > 100) throw new Error('无效的查找参数')
    const job = new AbortController()
    state.job = job
    state.results.clear()
    try {
      const result = await searchImageFolder(state.reference, state.folder, options, job.signal, (progress) => {
        if (!sender.isDestroyed()) sender.send('image-search:progress', progress)
      })
      state.results = new Set(result.results.map((match) => match.path))
      return result
    } finally { state.job = undefined }
  })
  ipcMain.handle('image-search:cancel', ({ sender }) => { session(sender).job?.abort() })
  ipcMain.handle('image-search:open-result', async ({ sender }, path: unknown, reveal: unknown) => {
    if (typeof path !== 'string' || typeof reveal !== 'boolean' || !session(sender).results.has(path)) throw new Error('请从当前查找结果中选择图片')
    if (reveal) shell.showItemInFolder(path)
    else { const error = await shell.openPath(path); if (error) throw new Error(error) }
  })
}
