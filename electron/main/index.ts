import { app, BrowserWindow, dialog, ipcMain, nativeImage, nativeTheme, Notification, protocol, shell } from 'electron'
import { createReadStream, createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { open, readdir, stat } from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import { isIP } from 'node:net'
import { basename, extname, join, relative, resolve } from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'
import { create as createYoutubeDl } from 'youtube-dl-exec'
import sharp from 'sharp'
import { configureDevelopmentProfile } from './developmentProfile'
import { closeDatabase, getNoteAsset, putNoteAsset, loadSnapshot, replaceSnapshot, saveSnapshotPatch } from './database'
import { getMediaToolPaths, getMediaToolsStatus, installMediaTools } from './mediaTools'
import { registerImageProcessing } from './imageProcessing'
import { downloadResource, getResourceAudioPath, importWhiteNoise, listResources, removeResource } from './resourceManager'
import type { AppSnapshot, AppSnapshotPatch, ImageAspectType, ImageAsset, ImageLibraryRoot, ImageLibraryState, ImageScanProgress, LinkPreview, ManagedResourceDirectory, MusicEditableMetadata, MusicImportProgress, MusicImportStage, MusicMetadataUpdate, MusicRemoteImport, MusicTrack, YoutubeVideoSearchResult } from '../../src/shared/types'

// Keep development writes away from the installed application's profile.
configureDevelopmentProfile(app)

const AUDIO_EXTENSIONS = new Set(['.mp3', '.m4a', '.aac', '.wav', '.ogg', '.oga', '.flac', '.opus'])
const AUDIO_MIME_TYPES: Record<string, string> = {
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.oga': 'audio/ogg',
  '.flac': 'audio/flac',
  '.opus': 'audio/ogg',
}
const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp', '.avif'])
const IMAGE_MIME_TYPES: Record<string, string> = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp',
  '.gif': 'image/gif', '.bmp': 'image/bmp', '.avif': 'image/avif',
}
const sessionMediaPaths = new Set<string>()
const sessionDownloadDirectories = new Set<string>()
const sessionImageRootPaths = new Set<string>()
const cancelledImageScans = new Set<string>()
const IMAGE_THUMBNAIL_MAX_EDGE = 2560
const IMAGE_THUMBNAIL_CACHE_LIMIT = 256 * 1024 * 1024
const imageThumbnailRequests = new Map<string, Promise<Buffer>>()
let imageThumbnailPrune: Promise<void> | null = null
let tagLibPromise: ReturnType<typeof initializeTagLib> | null = null
const MAX_REMOTE_AUDIO_BYTES = 1024 * 1024 * 1024
type ProgressReporter = (progress: Omit<MusicImportProgress, 'taskId' | 'source'>) => void
type ImageProgressReporter = (progress: Omit<ImageScanProgress, 'taskId'>) => void

protocol.registerSchemesAsPrivileged([
  { scheme: 'sylunae-media', privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true, corsEnabled: true } },
])

function isIndexedPath(filePath: string): boolean {
  const snapshot = loadSnapshot()
  return sessionMediaPaths.has(filePath)
    || snapshot.settings.pomodoroAlarmPath === filePath
    || snapshot.tracks.some((track) => track.path === filePath)
    || snapshot.imageLibrary?.assets.some((asset) => asset.path === filePath)
    || snapshot.countdowns.some((event) => event.coverImagePath === filePath)
}

function pathKey(filePath: string): string {
  return process.platform === 'win32' ? resolve(filePath).toLocaleLowerCase() : resolve(filePath)
}

function imageThumbnailDirectory(): string {
  return join(app.getPath('userData'), 'image-thumbnails')
}

async function pruneImageThumbnailCache(): Promise<void> {
  if (imageThumbnailPrune) return imageThumbnailPrune
  imageThumbnailPrune = (async () => {
    try {
      const directory = imageThumbnailDirectory()
      const entries = await readdir(directory, { withFileTypes: true })
      const files = (await Promise.all(entries.filter((entry) => entry.isFile() && entry.name.endsWith('.png')).map(async (entry) => {
        const filePath = join(directory, entry.name)
        try {
          const details = await stat(filePath)
          return { filePath, size: details.size, mtimeMs: details.mtimeMs }
        } catch { return null }
      }))).filter((item): item is { filePath: string; size: number; mtimeMs: number } => item !== null)
      let total = files.reduce((sum, file) => sum + file.size, 0)
      for (const file of files.sort((left, right) => left.mtimeMs - right.mtimeMs)) {
        if (total <= IMAGE_THUMBNAIL_CACHE_LIMIT) break
        try { unlinkSync(file.filePath); total -= file.size } catch { /* Cache cleanup is best-effort. */ }
      }
    } catch { /* The thumbnail cache is optional. */ }
    finally { imageThumbnailPrune = null }
  })()
  return imageThumbnailPrune
}

async function getImageThumbnail(filePath: string, maxEdge: number): Promise<Buffer> {
  const details = statSync(filePath)
  const edge = Math.max(64, Math.min(IMAGE_THUMBNAIL_MAX_EDGE, Math.round(maxEdge)))
  const key = createHash('sha256').update(`thumbnail-v3:${pathKey(filePath)}:${details.size}:${details.mtimeMs}:${edge}`).digest('hex')
  const cachePath = join(imageThumbnailDirectory(), `${key}.png`)
  if (existsSync(cachePath)) return readFileSync(cachePath)

  const pending = imageThumbnailRequests.get(key)
  if (pending) return pending
  const request = sharp(filePath, { failOn: 'error' })
    .resize({ width: edge, height: edge, fit: 'inside', withoutEnlargement: true, kernel: 'lanczos3' })
    .png()
    .toBuffer()
    .then((buffer) => {
      mkdirSync(imageThumbnailDirectory(), { recursive: true })
      writeFileSync(cachePath, buffer)
      void pruneImageThumbnailCache()
      return buffer
    }).finally(() => imageThumbnailRequests.delete(key))
  imageThumbnailRequests.set(key, request)
  return request
}

function aspectType(width: number, height: number): ImageAspectType {
  const ratio = height > 0 ? width / height : 1
  if (ratio >= 0.9 && ratio <= 1.1) return 'square'
  return ratio > 1 ? 'landscape' : 'portrait'
}

function ensureImageScanActive(taskId: string): void {
  if (cancelledImageScans.has(taskId)) throw new Error('IMAGE_SCAN_CANCELLED')
}

async function mapConcurrent<T, R>(items: T[], concurrency: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length)
  let cursor = 0
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++
      results[index] = await worker(items[index])
    }
  }))
  return results
}

async function listImages(directory: string, recursive: boolean, taskId: string, report: ImageProgressReporter): Promise<string[]> {
  const files: string[] = []
  const pending = [directory]
  let scannedDirectories = 0
  while (pending.length) {
    ensureImageScanActive(taskId)
    const batch = pending.splice(0, 24)
    const batches = await Promise.allSettled(batch.map((item) => readdir(item, { withFileTypes: true }).then((entries) => ({ directory: item, entries }))))
    for (const result of batches) {
      if (result.status !== 'fulfilled') continue
      scannedDirectories += 1
      for (const entry of result.value.entries) {
        const filePath = join(result.value.directory, entry.name)
        if (entry.isFile() && IMAGE_EXTENSIONS.has(extname(entry.name).toLowerCase())) files.push(filePath)
        else if (recursive && entry.isDirectory()) pending.push(filePath)
      }
    }
    report({ stage: 'discovering', message: `正在查找图片 · ${files.length} 张`, completed: scannedDirectories, total: null })
  }
  return files
}

interface ImageFileInfo {
  filePath: string
  size: number
  mtimeMs: number
  identity: string
}

interface RootedImageFileInfo extends ImageFileInfo {
  root: ImageLibraryRoot
}

async function inspectImage(info: ImageFileInfo) {
  const { filePath } = info
  const handle = await open(filePath, 'r')
  try {
    const headLength = Math.min(info.size, 256 * 1024)
    const head = Buffer.allocUnsafe(headLength)
    await handle.read(head, 0, headLength, 0)
    let dimensions: { width: number; height: number }
    try {
      try { dimensions = imageDimensions(head, extname(filePath).toLowerCase()) }
      catch {
        const extendedLength = Math.min(info.size, 2 * 1024 * 1024)
        const extended = Buffer.allocUnsafe(extendedLength)
        await handle.read(extended, 0, extendedLength, 0)
        dimensions = imageDimensions(extended, extname(filePath).toLowerCase())
      }
    } catch {
      dimensions = nativeImageDimensions(filePath)
    }
    const sampleSize = Math.min(info.size, 64 * 1024)
    const middle = Buffer.allocUnsafe(sampleSize)
    const tail = Buffer.allocUnsafe(sampleSize)
    const middleStart = Math.max(0, Math.floor((info.size - sampleSize) / 2))
    const tailStart = Math.max(0, info.size - sampleSize)
    await Promise.all([
      handle.read(middle, 0, sampleSize, middleStart),
      handle.read(tail, 0, sampleSize, tailStart),
    ])
    const fingerprint = createHash('sha256').update(String(info.size)).update(head).update(middle).update(tail).digest('hex')
    return {
      size: info.size, mtimeMs: info.mtimeMs, width: dimensions.width, height: dimensions.height,
      identity: info.identity, hash: `sample-v1:${fingerprint}`,
    }
  } finally { await handle.close() }
}

function nativeImageDimensions(filePath: string): { width: number; height: number } {
  const { width, height } = nativeImage.createFromPath(filePath).getSize()
  if (width > 0 && height > 0) return { width, height }
  throw new Error('无法读取图片尺寸')
}

function imageMimeTypeFromHeader(data: Buffer): string | null {
  if (data.length >= 8 && data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png'
  if (data.length >= 3 && data.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) return 'image/jpeg'
  if (data.length >= 6 && ['GIF87a', 'GIF89a'].includes(data.toString('ascii', 0, 6))) return 'image/gif'
  if (data.length >= 2 && data.toString('ascii', 0, 2) === 'BM') return 'image/bmp'
  if (data.length >= 12 && data.toString('ascii', 0, 4) === 'RIFF' && data.toString('ascii', 8, 12) === 'WEBP') return 'image/webp'
  if (data.length >= 12 && data.toString('ascii', 4, 8) === 'ftyp' && ['avif', 'avis'].includes(data.toString('ascii', 8, 12))) return 'image/avif'
  return null
}

async function imageMimeType(filePath: string, extension: string): Promise<string> {
  const fallback = IMAGE_MIME_TYPES[extension] || 'application/octet-stream'
  try {
    const handle = await open(filePath, 'r')
    try {
      const header = Buffer.alloc(32)
      const { bytesRead } = await handle.read(header, 0, header.length, 0)
      return imageMimeTypeFromHeader(header.subarray(0, bytesRead)) || fallback
    } finally { await handle.close() }
  } catch { return fallback }
}

async function parseImageAsset(filePath: string, id: string = randomUUID()): Promise<ImageAsset> {
  const resolvedPath = resolve(filePath)
  const value = await stat(resolvedPath, { bigint: true })
  const details = await inspectImage({
    filePath: resolvedPath,
    size: Number(value.size),
    mtimeMs: Number(value.mtimeMs),
    identity: `${value.dev.toString()}:${value.ino.toString()}`,
  })
  const now = new Date().toISOString()
  return {
    id,
    rootId: null,
    collectionIds: [],
    path: resolvedPath,
    relativePath: basename(resolvedPath),
    name: basename(resolvedPath),
    extension: extname(resolvedPath).toLowerCase(),
    ...details,
    aspectType: aspectType(details.width, details.height),
    missing: false,
    metadata: {},
    createdAt: now,
    updatedAt: now,
  }
}

function imageDimensions(data: Buffer, extension: string): { width: number; height: number } {
  if (data.length >= 12 && data.toString('ascii', 4, 8) === 'ftyp' && ['avif', 'avis'].includes(data.toString('ascii', 8, 12))) {
    for (let offset = 4; offset + 16 <= data.length; offset += 1) {
      if (data.toString('ascii', offset, offset + 4) !== 'ispe') continue
      const width = data.readUInt32BE(offset + 8)
      const height = data.readUInt32BE(offset + 12)
      if (width > 0 && height > 0) return { width, height }
    }
  }
  if (extension === '.png' && data.length >= 24 && data.toString('ascii', 1, 4) === 'PNG') {
    return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) }
  }
  if (extension === '.gif' && data.length >= 10 && data.toString('ascii', 0, 3) === 'GIF') {
    return { width: data.readUInt16LE(6), height: data.readUInt16LE(8) }
  }
  if (extension === '.bmp' && data.length >= 26 && data.toString('ascii', 0, 2) === 'BM') {
    return { width: Math.abs(data.readInt32LE(18)), height: Math.abs(data.readInt32LE(22)) }
  }
  if (extension === '.webp' && data.length >= 30 && data.toString('ascii', 0, 4) === 'RIFF' && data.toString('ascii', 8, 12) === 'WEBP') {
    const kind = data.toString('ascii', 12, 16)
    if (kind === 'VP8X') return { width: 1 + data.readUIntLE(24, 3), height: 1 + data.readUIntLE(27, 3) }
    if (kind === 'VP8L' && data[20] === 0x2f) return {
      width: 1 + (data[21] | ((data[22] & 0x3f) << 8)),
      height: 1 + ((data[22] >> 6) | (data[23] << 2) | ((data[24] & 0x0f) << 10)),
    }
    if (kind === 'VP8 ' && data.toString('hex', 23, 26) === '9d012a') return { width: data.readUInt16LE(26) & 0x3fff, height: data.readUInt16LE(28) & 0x3fff }
  }
  if ((extension === '.jpg' || extension === '.jpeg') && data.length >= 4 && data[0] === 0xff && data[1] === 0xd8) {
    const startOfFrame = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf])
    let offset = 2
    while (offset + 8 < data.length) {
      if (data[offset] !== 0xff) { offset += 1; continue }
      while (offset < data.length && data[offset] === 0xff) offset += 1
      const marker = data[offset]
      if (marker === undefined || marker === 0xd9 || marker === 0xda) break
      if (marker >= 0xd0 && marker <= 0xd7) { offset += 1; continue }
      if (offset + 2 >= data.length) break
      const length = data.readUInt16BE(offset + 1)
      if (length < 2 || offset + length >= data.length) break
      if (startOfFrame.has(marker)) return { height: data.readUInt16BE(offset + 4), width: data.readUInt16BE(offset + 6) }
      offset += length + 1
    }
  }
  throw new Error('无法读取图片尺寸')
}

async function scanImageLibrary(library: ImageLibraryState, taskId: string, report: ImageProgressReporter, rootId?: string): Promise<ImageLibraryState> {
  const now = new Date().toISOString()
  const roots = library.roots.map((root) => ({ ...root }))
  const assets = library.assets.map((asset) => ({ ...asset }))
  const targets = roots.filter((root) => !rootId || root.id === rootId)
  const targetIds = new Set(targets.map((root) => root.id))
  const seenIds = new Set<string>()
  const byPath = new Map(assets.map((asset) => [pathKey(asset.path), asset]))
  const byIdentity = new Map<string, ImageAsset[]>()
  const byHash = new Map<string, ImageAsset[]>()
  for (const asset of assets) {
    if (asset.identity) byIdentity.set(asset.identity, [...(byIdentity.get(asset.identity) ?? []), asset])
    if (asset.hash) byHash.set(asset.hash, [...(byHash.get(asset.hash) ?? []), asset])
  }
  const discovered: Array<{ root: ImageLibraryRoot; filePath: string }> = []
  for (const root of targets) {
    try {
      ensureImageScanActive(taskId)
      const storedRoots = loadSnapshot().imageLibrary?.roots ?? []
      if (!sessionImageRootPaths.has(pathKey(root.path)) && !storedRoots.some((stored) => pathKey(stored.path) === pathKey(root.path))) throw new Error('未授权的图片文件夹')
      const rootStat = await stat(root.path, { bigint: true })
      if (!rootStat.isDirectory()) throw new Error('不是文件夹')
      root.identity = `${rootStat.dev.toString()}:${rootStat.ino.toString()}`
      root.missing = false
      root.lastScannedAt = now
      root.updatedAt = now
      const filePaths = await listImages(root.path, root.recursive, taskId, report)
      discovered.push(...filePaths.map((filePath) => ({ root, filePath })))
    } catch (error) {
      if (error instanceof Error && error.message === 'IMAGE_SCAN_CANCELLED') throw error
      root.missing = true
      root.updatedAt = now
    }
  }

  ensureImageScanActive(taskId)
  report({ stage: 'indexing', message: `正在读取 ${discovered.length} 张图片`, completed: 0, total: discovered.length })
  let completed = 0
  let lastProgressAt = 0
  const emitIndexProgress = (force = false) => {
    const current = Date.now()
    if (!force && current - lastProgressAt < 80 && completed < discovered.length) return
    lastProgressAt = current
    report({ stage: 'indexing', message: `正在建立图片索引 · ${completed}/${discovered.length}`, completed, total: discovered.length })
  }
  const fileInfos = (await mapConcurrent(discovered, 32, async ({ root, filePath }): Promise<RootedImageFileInfo | null> => {
    ensureImageScanActive(taskId)
    try {
      const value = await stat(filePath, { bigint: true })
      return { filePath, size: Number(value.size), mtimeMs: Number(value.mtimeMs), identity: `${value.dev.toString()}:${value.ino.toString()}`, root }
    } catch { return null }
  })).filter((info): info is RootedImageFileInfo => info !== null)

  const claimedIds = new Set<string>()
  const prepared = fileInfos.map((info) => {
    let asset = byPath.get(pathKey(info.filePath))
    if (!asset) asset = (byIdentity.get(info.identity) ?? []).find((candidate) => !claimedIds.has(candidate.id))
    if (asset) claimedIds.add(asset.id)
    return { info, asset }
  })
  const inspected = await mapConcurrent(prepared, 8, async ({ info, asset }) => {
    ensureImageScanActive(taskId)
    try {
      const details = asset && asset.size === info.size && asset.mtimeMs === info.mtimeMs && asset.hash.startsWith('sample-v1:')
        ? { size: asset.size, mtimeMs: asset.mtimeMs, width: asset.width, height: asset.height, identity: info.identity, hash: asset.hash }
        : await inspectImage(info)
      completed += 1
      emitIndexProgress()
      return { info, asset, details }
    } catch (error) {
      if (error instanceof Error && error.message === 'IMAGE_SCAN_CANCELLED') throw error
      completed += 1
      emitIndexProgress()
      return null
    }
  })

  for (const item of inspected) {
    if (!item) continue
    const { info, details } = item
    let { asset } = item
    if (!asset && details.hash) {
      const hashMatches = (byHash.get(details.hash) ?? []).filter((candidate) => !seenIds.has(candidate.id) && !existsSync(candidate.path))
      if (hashMatches.length === 1) asset = hashMatches[0]
    }
    if (asset) {
      Object.assign(asset, {
        rootId: info.root.id, path: info.filePath, relativePath: relative(info.root.path, info.filePath), name: basename(info.filePath),
        collectionIds: info.root.collectionId ? [...new Set([...asset.collectionIds, info.root.collectionId])] : asset.collectionIds,
        extension: extname(info.filePath).toLowerCase(), ...details, aspectType: aspectType(details.width, details.height), missing: false, updatedAt: now,
      })
    } else {
      asset = {
        id: randomUUID(), rootId: info.root.id, collectionIds: info.root.collectionId ? [info.root.collectionId] : [], path: info.filePath, relativePath: relative(info.root.path, info.filePath), name: basename(info.filePath),
        extension: extname(info.filePath).toLowerCase(), ...details, aspectType: aspectType(details.width, details.height),
        missing: false, metadata: {}, createdAt: now, updatedAt: now,
      }
      assets.push(asset)
      byHash.set(asset.hash, [...(byHash.get(asset.hash) ?? []), asset])
    }
    seenIds.add(asset.id)
    sessionMediaPaths.add(info.filePath)
  }
  for (const asset of assets) {
    if (asset.rootId && targetIds.has(asset.rootId) && !seenIds.has(asset.id)) asset.missing = true
  }
  emitIndexProgress(true)
  report({ stage: 'complete', message: `已完成 · ${seenIds.size} 张图片`, completed: discovered.length, total: discovered.length })
  return { roots, collections: library.collections, assets }
}

async function initializeTagLib() {
  const { TagLib } = await import('taglib-wasm')
  return TagLib.initialize()
}

function getTagLib() {
  tagLibPromise ??= initializeTagLib()
  return tagLibPromise
}

function getDefaultMusicDirectory(): string {
  let directory = resolve(app.getPath('userData'), 'music')
  try {
    const saved = JSON.parse(readFileSync(join(app.getPath('userData'), 'music-download-directory.json'), 'utf8')) as { directory?: unknown }
    if (typeof saved.directory === 'string' && saved.directory.length > 0) {
      const lastDirectory = resolve(saved.directory)
      if (existsSync(lastDirectory) && statSync(lastDirectory).isDirectory()) directory = lastDirectory
    }
  } catch { /* Use the default music folder if the saved location is missing or invalid. */ }
  mkdirSync(directory, { recursive: true })
  sessionDownloadDirectories.add(directory)
  return directory
}

function rememberMusicDirectory(directory: string): void {
  const preferencesPath = join(app.getPath('userData'), 'music-download-directory.json')
  const temporaryPath = `${preferencesPath}.${randomUUID()}.tmp`
  try {
    writeFileSync(temporaryPath, JSON.stringify({ directory }), { flag: 'wx' })
    renameSync(temporaryPath, preferencesPath)
  } catch (error) {
    try { unlinkSync(temporaryPath) } catch { /* Best-effort cleanup. */ }
    throw error
  }
}

function managedResourceDirectory(directory: ManagedResourceDirectory): string {
  switch (directory) {
    case 'app-data': return app.getPath('userData')
    case 'music': return getDefaultMusicDirectory()
    case 'resources': {
      const resourceDirectory = join(app.getPath('userData'), 'resources')
      mkdirSync(resourceDirectory, { recursive: true })
      return resourceDirectory
    }
    default: throw new Error('不支持的本地文件夹')
  }
}

function sanitizeFileName(value: string): string {
  const clean = value.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/[. ]+$/g, '').trim()
  return (clean || '未命名音频').slice(0, 180)
}

function uniqueFilePath(directory: string, fileName: string): string {
  const extension = extname(fileName)
  const stem = basename(fileName, extension)
  let candidate = join(directory, fileName)
  for (let index = 2; existsSync(candidate); index += 1) candidate = join(directory, `${stem} (${index})${extension}`)
  return candidate
}

function isPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (host === 'localhost' || host.endsWith('.localhost') || host === '::1') return true
  if (isIP(host) === 4) {
    const [a, b] = host.split('.').map(Number)
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
  }
  return isIP(host) === 6 && (host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe8') || host.startsWith('fe9') || host.startsWith('fea') || host.startsWith('feb'))
}

function faviconFromHtml(html: string, pageUrl: URL): string | null {
  const links = html.match(/<link\b[^>]*>/gi) ?? []
  for (const link of links) {
    const relMatch = /\brel\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))/i.exec(link)
    const rel = (relMatch?.[1] ?? relMatch?.[2] ?? relMatch?.[3] ?? '').toLowerCase()
    if (!/(^|\s)(apple-touch-icon|shortcut\s+icon|icon)(\s|$)/.test(rel)) continue
    const href = /\bhref\s*=\s*["']([^"']+)["']|\bhref\s*=\s*([^\s>]+)/i.exec(link)
    const value = href?.[1] ?? href?.[2]
    if (!value || value.startsWith('data:')) continue
    try {
      const iconUrl = new URL(value, pageUrl)
      if (iconUrl.protocol === 'http:' || iconUrl.protocol === 'https:') return iconUrl.toString()
    } catch { /* Try the next declared icon. */ }
  }
  return null
}

async function findFavicon(rawUrl: string): Promise<string | null> {
  if (typeof rawUrl !== 'string' || rawUrl.length > 4096) return null
  let url: URL
  try { url = new URL(rawUrl) } catch { return null }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || isPrivateHost(url.hostname)) return null
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 6000)
  try {
    const response = await fetch(url, { redirect: 'follow', signal: controller.signal, headers: { 'User-Agent': 'Sylunae-Workshop/0.1' } })
    const finalUrl = new URL(response.url)
    if (!response.ok || !['http:', 'https:'].includes(finalUrl.protocol) || isPrivateHost(finalUrl.hostname)) return null
    const contentType = response.headers.get('content-type') || ''
    if (contentType.includes('text/html')) {
      const html = (await response.text()).slice(0, 512 * 1024)
      const declared = faviconFromHtml(html, finalUrl)
      if (declared) return declared
    }
    return new URL('/favicon.ico', finalUrl).toString()
  } catch { return null } finally { clearTimeout(timeout) }
}

function decodeHtml(value: string): string {
  return value.replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'").replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/\s+/g, ' ').trim()
}

function htmlAttribute(tag: string, name: string): string | null {
  const match = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(tag)
  return match ? decodeHtml(match[1] ?? match[2] ?? match[3] ?? '') : null
}

function metaContent(html: string, name: string): string | null {
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    const key = htmlAttribute(tag, 'property') ?? htmlAttribute(tag, 'name')
    if (key?.toLowerCase() === name.toLowerCase()) return htmlAttribute(tag, 'content')
  }
  return null
}

async function getLinkPreview(rawUrl: string): Promise<LinkPreview | null> {
  if (typeof rawUrl !== 'string' || rawUrl.length > 4096) return null
  let url: URL
  try { url = new URL(rawUrl) } catch { return null }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || isPrivateHost(url.hostname)) return null

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 6000)
  try {
    let response: Response | null = null
    for (let redirects = 0; redirects <= 3; redirects += 1) {
      if (!['http:', 'https:'].includes(url.protocol) || isPrivateHost(url.hostname)) return null
      response = await fetch(url, { redirect: 'manual', signal: controller.signal, headers: { 'User-Agent': 'Sylunae-Workshop/0.1', Accept: 'text/html,application/xhtml+xml' } })
      if (response.status < 300 || response.status >= 400) break
      const location = response.headers.get('location')
      if (!location || redirects === 3) return null
      url = new URL(location, url)
    }
    if (!response || !response.ok || !(response.headers.get('content-type') || '').includes('text/html')) return null
    const finalUrl = url
    if (Number(response.headers.get('content-length') || 0) > 2 * 1024 * 1024) return null
    const html = (await response.text()).slice(0, 512 * 1024)
    const host = finalUrl.hostname.replace(/^www\./i, '')
    const title = metaContent(html, 'og:title') || metaContent(html, 'twitter:title') || /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] || host
    const description = metaContent(html, 'og:description') || metaContent(html, 'twitter:description') || metaContent(html, 'description') || ''
    return { url: finalUrl.toString(), host, title: decodeHtml(title).slice(0, 300) || host, description: decodeHtml(description).slice(0, 500), iconUrl: faviconFromHtml(html, finalUrl) || new URL('/favicon.ico', finalUrl).toString() }
  } catch { return null } finally { clearTimeout(timeout) }
}

function checkedRemoteImport(input: MusicRemoteImport): { taskId: string; source: MusicRemoteImport['source']; url: URL; directory: string } {
  if (!input || typeof input.taskId !== 'string' || !/^[a-zA-Z0-9-]{1,64}$/.test(input.taskId) || !['youtube', 'audio-url'].includes(input.source) || typeof input.url !== 'string' || input.url.length > 4096 || typeof input.directory !== 'string') {
    throw new Error('导入参数无效')
  }
  const directory = resolve(input.directory)
  if (!sessionDownloadDirectories.has(directory)) throw new Error('请先选择文件保存位置')
  let url: URL
  try { url = new URL(input.url) } catch { throw new Error('请输入有效的链接') }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('仅支持 HTTP 或 HTTPS 链接')
  if (input.source === 'youtube') {
    const host = url.hostname.toLowerCase()
    if (host !== 'youtu.be' && host !== 'youtube.com' && !host.endsWith('.youtube.com')) throw new Error('请输入 YouTube 视频链接')
  } else if (isPrivateHost(url.hostname)) {
    throw new Error('不支持本机或局域网链接')
  }
  mkdirSync(directory, { recursive: true })
  return { taskId: input.taskId, source: input.source, url, directory }
}

function extensionFromResponse(url: URL, contentType: string): string {
  const fromUrl = extname(url.pathname).toLowerCase()
  if (AUDIO_EXTENSIONS.has(fromUrl)) return fromUrl
  const mime = contentType.split(';')[0].trim().toLowerCase()
  return ({
    'audio/mpeg': '.mp3', 'audio/mp4': '.m4a', 'audio/aac': '.aac', 'audio/wav': '.wav',
    'audio/x-wav': '.wav', 'audio/ogg': '.ogg', 'application/ogg': '.ogg', 'audio/flac': '.flac',
    'audio/x-flac': '.flac', 'audio/opus': '.opus',
  } as Record<string, string>)[mime] || ''
}

function responseFileName(response: Response, url: URL, extension: string): string {
  const disposition = response.headers.get('content-disposition') || ''
  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(disposition)?.[1]
  const plain = /filename="?([^";]+)"?/i.exec(disposition)?.[1]
  let supplied = encoded ? decodeURIComponent(encoded) : plain
  supplied ||= basename(url.pathname) || `下载音频${extension}`
  const suppliedExtension = extname(supplied).toLowerCase()
  return `${sanitizeFileName(basename(supplied, suppliedExtension))}${AUDIO_EXTENSIONS.has(suppliedExtension) ? suppliedExtension : extension}`
}

async function importAudioUrl(url: URL, directory: string, report: ProgressReporter): Promise<MusicTrack> {
  report({ stage: 'reading', message: '正在连接音频地址…', percent: null })
  const response = await fetch(url, { redirect: 'follow', headers: { 'User-Agent': 'Sylunae-Workshop/0.1' } })
  if (!response.ok || !response.body) throw new Error(`下载失败（HTTP ${response.status}）`)
  const finalUrl = new URL(response.url)
  if (!['http:', 'https:'].includes(finalUrl.protocol) || isPrivateHost(finalUrl.hostname)) throw new Error('下载地址重定向到了不受支持的位置')
  const contentType = response.headers.get('content-type') || ''
  const extension = extensionFromResponse(finalUrl, contentType)
  if (!extension) throw new Error('链接返回的内容不是支持的音频文件')
  const declaredSize = Number(response.headers.get('content-length') || 0)
  const totalBytes = Number.isFinite(declaredSize) && declaredSize > 0 ? declaredSize : null
  if (totalBytes && totalBytes > MAX_REMOTE_AUDIO_BYTES) throw new Error('音频文件不能超过 1 GB')
  const filePath = uniqueFilePath(directory, responseFileName(response, finalUrl, extension))
  const partialPath = `${filePath}.part`
  let received = 0
  let lastReportAt = 0
  report({ stage: 'downloading', message: '正在下载音频…', percent: totalBytes ? 0 : null, receivedBytes: 0, totalBytes })
  const sizeLimit = new Transform({
    transform(chunk, _encoding, callback) {
      received += chunk.length
      const now = Date.now()
      if (now - lastReportAt >= 100 || (totalBytes !== null && received >= totalBytes)) {
        const percent = totalBytes ? Math.min(100, Math.round((received / totalBytes) * 100)) : null
        report({ stage: 'downloading', message: percent === null ? '正在下载音频…' : `正在下载音频 ${percent}%`, percent, receivedBytes: received, totalBytes })
        lastReportAt = now
      }
      callback(received > MAX_REMOTE_AUDIO_BYTES ? new Error('音频文件不能超过 1 GB') : null, chunk)
    },
  })
  try {
    await pipeline(Readable.fromWeb(response.body as never), sizeLimit, createWriteStream(partialPath, { flags: 'wx' }))
    const { rename } = await import('node:fs/promises')
    await rename(partialPath, filePath)
    report({ stage: 'metadata', message: '正在读取音频信息…', percent: 100, receivedBytes: received, totalBytes })
    const track = await parseTrack(filePath)
    sessionMediaPaths.add(filePath)
    report({ stage: 'complete', message: '导入完成', percent: 100, receivedBytes: received, totalBytes })
    return track
  } catch (error) {
    if (existsSync(partialPath)) unlinkSync(partialPath)
    if (existsSync(filePath)) unlinkSync(filePath)
    throw error
  }
}

async function importYoutube(url: URL, directory: string, report: ProgressReporter): Promise<MusicTrack> {
  const mediaTools = getMediaToolPaths()
  const youtubeDl = createYoutubeDl(mediaTools.ytDlp)
  report({ stage: 'reading', message: '正在读取视频信息…', percent: null })
  const metadata = await youtubeDl(url.toString(), { dumpSingleJson: true, skipDownload: true, noPlaylist: true, noWarnings: true })
  if (typeof metadata === 'string' || !metadata.id || !metadata.title) throw new Error('无法读取这个 YouTube 视频的信息')
  if (metadata.is_live) throw new Error('暂不支持直播内容')
  const stem = sanitizeFileName(`${metadata.title} [${metadata.id}]`)
  const filePath = uniqueFilePath(directory, `${stem}.mp3`)
  const output = `${filePath.slice(0, -4).replace(/%/g, '%%')}.%(ext)s`
  const stageOrder: Record<MusicImportStage, number> = { reading: 0, downloading: 1, converting: 2, metadata: 3, complete: 4 }
  let currentStage: MusicImportStage = 'downloading'
  const reportStage = (stage: MusicImportStage, message: string, percent: number | null = null) => {
    if (stageOrder[stage] < stageOrder[currentStage]) return
    currentStage = stage
    report({ stage, message, percent })
  }
  try {
    reportStage('downloading', '正在下载 YouTube 音频…', 0)
    const subprocess = youtubeDl.exec(url.toString(), {
      extractAudio: true,
      audioFormat: 'mp3',
      audioQuality: 0,
      addMetadata: true,
      embedThumbnail: true,
      ffmpegLocation: mediaTools.ffmpeg,
      maxFilesize: '1G',
      noPlaylist: true,
      noWarnings: true,
      noOverwrites: true,
      newline: true,
      output,
      windowsFilenames: process.platform === 'win32',
    })
    const readProgress = (chunk: Buffer | string) => {
      const outputText = chunk.toString()
      const download = /\[download\]\s+(\d+(?:\.\d+)?)%/i.exec(outputText)
      if (download) {
        const percent = Math.min(100, Math.round(Number(download[1])))
        reportStage('downloading', `正在下载 YouTube 音频 ${percent}%`, percent)
      }
      if (/\[(?:ExtractAudio|FFmpeg|VideoConvertor|Merger)\]/i.test(outputText)) reportStage('converting', '正在使用 FFmpeg 转换为 MP3…')
      if (/\[(?:Metadata|EmbedThumbnail)\]/i.test(outputText)) reportStage('metadata', '正在写入标题、作者与封面…')
    }
    ;(subprocess.stdout as unknown as NodeJS.ReadableStream | null)?.on('data', readProgress)
    ;(subprocess.stderr as unknown as NodeJS.ReadableStream | null)?.on('data', readProgress)
    await subprocess
    if (!existsSync(filePath)) throw new Error('YouTube 音频转换完成，但未找到输出文件')
    reportStage('metadata', '正在整理音乐元信息…')
    const track = await parseTrack(filePath)
    sessionMediaPaths.add(filePath)
    reportStage('complete', '导入完成', 100)
    return track
  } catch (error) {
    if (existsSync(filePath)) unlinkSync(filePath)
    throw error
  }
}

async function searchYoutubeVideos(query: unknown): Promise<YoutubeVideoSearchResult[]> {
  if (typeof query !== 'string') throw new Error('请输入搜索内容')
  const normalized = query.trim()
  if (!normalized) throw new Error('请输入搜索内容')
  if (normalized.length > 200) throw new Error('搜索内容不能超过 200 个字符')
  const mediaTools = getMediaToolPaths()
  const youtubeDl = createYoutubeDl(mediaTools.ytDlp)
  const response = await youtubeDl(`ytsearch10:${normalized}`, {
    dumpSingleJson: true,
    flatPlaylist: true,
    noWarnings: true,
    skipDownload: true,
  })
  if (typeof response === 'string') return []
  const playlist = response as unknown as { entries?: unknown[] }
  if (!Array.isArray(playlist.entries)) return []
  return playlist.entries.flatMap((item: unknown) => {
    if (!item || typeof item !== 'object') return []
    const entry = item as Record<string, unknown>
    const id = typeof entry.id === 'string' ? entry.id : ''
    const title = typeof entry.title === 'string' ? entry.title : ''
    if (!/^[\w-]{6,20}$/.test(id) || !title) return []
    const duration = typeof entry.duration === 'number' && Number.isFinite(entry.duration) && entry.duration >= 0 ? entry.duration : null
    const channel = typeof entry.channel === 'string' ? entry.channel : typeof entry.uploader === 'string' ? entry.uploader : ''
    return [{ id, title, channel, duration, url: `https://www.youtube.com/watch?v=${id}` }]
  })
}

function assertEditableAudioPath(filePath: string): void {
  if (typeof filePath !== 'string' || !isIndexedPath(filePath) || !existsSync(filePath) || !AUDIO_EXTENSIONS.has(extname(filePath).toLowerCase())) {
    throw new Error('音乐文件不可用或未加入资料库')
  }
}

async function readEditableMetadata(filePath: string): Promise<MusicEditableMetadata> {
  assertEditableAudioPath(filePath)
  const { parseFile } = await import('music-metadata')
  const parsed = await parseFile(filePath)
  const indexed = loadSnapshot().tracks.find((track) => track.path === filePath)
  const picture = parsed.common.picture?.[0]
  const indexedArtist = indexed?.artist === '未知艺术家' ? '' : indexed?.artist
  const indexedAlbum = indexed?.album === '未知专辑' ? '' : indexed?.album
  return {
    title: parsed.common.title?.trim() || indexed?.title || basename(filePath, extname(filePath)),
    artist: parsed.common.artist?.trim() || indexedArtist || '',
    album: parsed.common.album?.trim() || indexedAlbum || '',
    genre: parsed.common.genre?.filter(Boolean).join('; ') || '',
    year: parsed.common.year || null,
    track: parsed.common.track.no || null,
    comment: parsed.common.comment?.map((item) => item.text?.trim()).filter(Boolean).join('\n') || '',
    cover: picture
      ? `data:${picture.format};base64,${Buffer.from(picture.data).toString('base64')}`
      : indexed?.cover || '',
  }
}

function checkedText(value: unknown, label: string, maxLength: number): string {
  if (typeof value !== 'string' || value.length > maxLength) throw new Error(`${label}内容无效`)
  return value.trim()
}

function checkedNumber(value: unknown, label: string): number {
  if (value === null) return 0
  if (!Number.isInteger(value) || Number(value) < 0 || Number(value) > 9999) throw new Error(`${label}内容无效`)
  return Number(value)
}

function checkedCover(update: MusicMetadataUpdate['cover']): MusicMetadataUpdate['cover'] {
  if (!update || !['keep', 'remove', 'replace'].includes(update.mode)) throw new Error('封面操作无效')
  if (update.mode !== 'replace') return update
  const data = new Uint8Array(update.data)
  if (data.byteLength === 0 || data.byteLength > 12 * 1024 * 1024) throw new Error('封面文件需小于 12 MB')
  const isJpeg = update.mimeType === 'image/jpeg' && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff
  const isPng = update.mimeType === 'image/png' && data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47
  if (!isJpeg && !isPng) throw new Error('仅支持 JPEG 或 PNG 封面')
  return { mode: 'replace', data, mimeType: update.mimeType }
}

async function updateTrackMetadata(update: MusicMetadataUpdate): Promise<MusicTrack> {
  if (!update || typeof update.id !== 'string') throw new Error('曲目信息无效')
  assertEditableAudioPath(update.path)
  const metadata = {
    title: checkedText(update.metadata?.title, '标题', 1024),
    artist: checkedText(update.metadata?.artist, '艺术家', 1024),
    album: checkedText(update.metadata?.album, '专辑', 1024),
    genre: checkedText(update.metadata?.genre, '流派', 1024),
    comment: checkedText(update.metadata?.comment, '备注', 10_000),
    year: checkedNumber(update.metadata?.year, '年份'),
    track: checkedNumber(update.metadata?.track, '音轨号'),
  }
  const cover = checkedCover(update.cover)
  const tagLib = await getTagLib()
  await tagLib.edit(update.path, (file) => {
    file.tag()
      .setTitle(metadata.title)
      .setArtist(metadata.artist)
      .setAlbum(metadata.album)
      .setGenre(metadata.genre)
      .setYear(metadata.year)
      .setTrack(metadata.track)
      .setComment(metadata.comment)
    if (cover.mode === 'remove') file.removePictures()
    if (cover.mode === 'replace') file.setPictures([{ type: 'FrontCover', mimeType: cover.mimeType, data: cover.data, description: 'Album cover' }])
  })
  return parseTrack(update.path, update.id)
}

async function parseTrack(filePath: string, id: string = crypto.randomUUID()): Promise<MusicTrack> {
  const { parseFile } = await import('music-metadata')
  const metadata = await parseFile(filePath, { duration: true })
  const picture = metadata.common.picture?.[0]
  const cover = picture
    ? `data:${picture.format};base64,${Buffer.from(picture.data).toString('base64')}`
    : ''
  const now = new Date().toISOString()
  return {
    id,
    path: filePath,
    title: metadata.common.title?.trim() || basename(filePath, extname(filePath)),
    artist: metadata.common.artist?.trim() || '未知艺术家',
    album: metadata.common.album?.trim() || '未知专辑',
    albumArtist: metadata.common.albumartist?.trim() || '',
    albumId: null,
    duration: metadata.format.duration || 0,
    cover,
    missing: false,
    createdAt: now,
    updatedAt: now,
  }
}

function createWindow(): void {
  const window = new BrowserWindow({
    width: 1380,
    height: 880,
    minWidth: 360,
    minHeight: 560,
    backgroundColor: '#ffffff',
    icon: app.isPackaged ? undefined : fileURLToPath(new URL('../../build/icon.png', import.meta.url)),
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#00000000', symbolColor: '#6f6f6f', height: 42 },
    webPreferences: {
      preload: fileURLToPath(new URL('../preload/index.mjs', import.meta.url)),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false,
    },
  })
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  if (process.env.ELECTRON_RENDERER_URL) void window.loadURL(process.env.ELECTRON_RENDERER_URL)
  else void window.loadFile(fileURLToPath(new URL('../renderer/index.html', import.meta.url)))
}

function registerIpc(): void {
  registerImageProcessing()
  ipcMain.handle('storage:put-note-asset', (_event, bytes: Uint8Array, mime: string) => putNoteAsset(bytes, mime))
  ipcMain.handle('storage:get-note-asset', (_event, id: string) => getNoteAsset(id))
  ipcMain.handle('storage:load', () => loadSnapshot())
  ipcMain.handle('storage:save', (_event, patch: AppSnapshotPatch) => saveSnapshotPatch(patch))
  ipcMain.handle('storage:replace', (_event, snapshot: AppSnapshot) => replaceSnapshot(snapshot))

  ipcMain.handle('music:pick', async () => {
    const result = await dialog.showOpenDialog({
      title: '选择音乐文件',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: '音频文件', extensions: [...AUDIO_EXTENSIONS].map((value) => value.slice(1)) }],
    })
    if (result.canceled) return []
    const tracks: MusicTrack[] = []
    for (const filePath of result.filePaths) {
      try { const track = await parseTrack(filePath); tracks.push(track); sessionMediaPaths.add(track.path) } catch { /* Ignore unreadable files. */ }
    }
    return tracks
  })
  ipcMain.handle('music:get-download-directory', () => getDefaultMusicDirectory())
  ipcMain.handle('music:search-youtube', (_event, query: unknown) => searchYoutubeVideos(query))
  ipcMain.handle('music:pick-download-directory', async (_event, currentDirectory: string) => {
    const defaultPath = typeof currentDirectory === 'string' && sessionDownloadDirectories.has(resolve(currentDirectory))
      ? resolve(currentDirectory)
      : getDefaultMusicDirectory()
    const result = await dialog.showOpenDialog({
      title: '选择音乐保存位置',
      defaultPath,
      properties: ['openDirectory', 'createDirectory'],
    })
    if (result.canceled || !result.filePaths[0]) return null
    const directory = resolve(result.filePaths[0])
    rememberMusicDirectory(directory)
    sessionDownloadDirectories.add(directory)
    return directory
  })
  ipcMain.handle('music:import-remote', async (event, input: MusicRemoteImport) => {
    const checked = checkedRemoteImport(input)
    const report: ProgressReporter = (progress) => {
      if (!event.sender.isDestroyed()) event.sender.send('music:import-progress', { ...progress, taskId: checked.taskId, source: checked.source } satisfies MusicImportProgress)
    }
    return checked.source === 'youtube'
      ? importYoutube(checked.url, checked.directory, report)
      : importAudioUrl(checked.url, checked.directory, report)
  })
  ipcMain.handle('music:get-media-tools-status', () => getMediaToolsStatus())
  ipcMain.handle('music:install-media-tools', (event) => installMediaTools((progress) => {
    if (!event.sender.isDestroyed()) event.sender.send('music:media-tools-progress', progress)
  }))
  ipcMain.handle('music:relocate', async (_event, trackId: string) => {
    const result = await dialog.showOpenDialog({
      title: '重新定位音乐文件',
      properties: ['openFile'],
      filters: [{ name: '音频文件', extensions: [...AUDIO_EXTENSIONS].map((value) => value.slice(1)) }],
    })
    if (result.canceled || !result.filePaths[0]) return null
    try { const track = await parseTrack(result.filePaths[0], trackId); sessionMediaPaths.add(track.path); return track } catch { return null }
  })
  ipcMain.handle('music:check-paths', (_event, paths: string[]) =>
    Object.fromEntries(paths.map((filePath) => [filePath, existsSync(filePath)])),
  )
  ipcMain.handle('music:get-url', (_event, filePath: string) => {
    if (!isIndexedPath(filePath) || !existsSync(filePath) || !AUDIO_EXTENSIONS.has(extname(filePath).toLowerCase())) {
      throw new Error('音乐文件不可用或未加入资料库')
    }
    return `sylunae-media://audio/${Buffer.from(filePath).toString('base64url')}`
  })
  ipcMain.handle('music:show-in-folder', (_event, filePath: string) => {
    if (typeof filePath !== 'string' || !isIndexedPath(filePath) || !existsSync(filePath) || !AUDIO_EXTENSIONS.has(extname(filePath).toLowerCase())) {
      throw new Error('音乐文件不可用或未加入资料库')
    }
    shell.showItemInFolder(resolve(filePath))
  })
  ipcMain.handle('music:read-metadata', (_event, filePath: string) => readEditableMetadata(filePath))
  ipcMain.handle('music:update-metadata', (_event, update: MusicMetadataUpdate) => updateTrackMetadata(update))

  ipcMain.handle('resources:list', () => listResources())
  ipcMain.handle('resources:open-directory', async (_event, directory: ManagedResourceDirectory) => {
    const error = await shell.openPath(managedResourceDirectory(directory))
    if (error) throw new Error(`无法打开文件夹：${error}`)
  })
  ipcMain.handle('resources:download', (event, id: string) => downloadResource(id, (progress) => {
    if (!event.sender.isDestroyed()) event.sender.send('resources:download-progress', progress)
  }))
  ipcMain.handle('resources:remove', (_event, id: string) => removeResource(id))
  ipcMain.handle('resources:import-white-noise', () => importWhiteNoise())
  ipcMain.handle('resources:get-audio-url', async (_event, id: string) => {
    const filePath = await getResourceAudioPath(id)
    sessionMediaPaths.add(filePath)
    return `sylunae-media://audio/${Buffer.from(filePath).toString('base64url')}`
  })

  ipcMain.handle('images:pick', async () => {
    const result = await dialog.showOpenDialog({
      title: '选择图片文件',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: '图片文件', extensions: [...IMAGE_EXTENSIONS].map((value) => value.slice(1)) }],
    })
    if (result.canceled) return []
    const assets: ImageAsset[] = []
    for (const filePath of result.filePaths) {
      try {
        const asset = await parseImageAsset(filePath)
        assets.push(asset)
        sessionMediaPaths.add(asset.path)
      } catch { /* Ignore unreadable images. */ }
    }
    return assets
  })
  ipcMain.handle('images:pick-file', async () => {
    const result = await dialog.showOpenDialog({
      title: '选择倒数日背景图片',
      properties: ['openFile'],
      filters: [{ name: '图片文件', extensions: [...IMAGE_EXTENSIONS].map((value) => value.slice(1)) }],
    })
    if (result.canceled || !result.filePaths[0]) return null
    const filePath = resolve(result.filePaths[0])
    if (!existsSync(filePath) || !IMAGE_EXTENSIONS.has(extname(filePath).toLowerCase())) return null
    sessionMediaPaths.add(filePath)
    return { path: filePath, name: basename(filePath) }
  })
  ipcMain.handle('images:pick-root', async (_event, recursive: boolean) => {
    const result = await dialog.showOpenDialog({ title: '选择图片收藏夹', properties: ['openDirectory'] })
    if (result.canceled || !result.filePaths[0]) return null
    const directory = resolve(result.filePaths[0])
    sessionImageRootPaths.add(pathKey(directory))
    const directoryStat = await stat(directory, { bigint: true })
    const now = new Date().toISOString()
    return {
      id: randomUUID(), path: directory, name: basename(directory), recursive: Boolean(recursive),
      identity: `${directoryStat.dev.toString()}:${directoryStat.ino.toString()}`, missing: false, createdAt: now, updatedAt: now, lastScannedAt: null, collectionId: null,
    } satisfies ImageLibraryRoot
  })
  const runImageScan = async (event: Electron.IpcMainInvokeEvent, taskId: string, library: ImageLibraryState, rootId?: string) => {
    if (typeof taskId !== 'string' || !/^[a-zA-Z0-9-]{1,64}$/.test(taskId)) throw new Error('扫描任务无效')
    cancelledImageScans.delete(taskId)
    const report: ImageProgressReporter = (progress) => {
      if (!event.sender.isDestroyed()) event.sender.send('images:scan-progress', { ...progress, taskId } satisfies ImageScanProgress)
    }
    try {
      return await scanImageLibrary(library, taskId, report, rootId)
    } catch (error) {
      if (error instanceof Error && error.message === 'IMAGE_SCAN_CANCELLED') {
        report({ stage: 'cancelled', message: '扫描已取消', completed: 0, total: null })
        throw new Error('扫描已取消')
      }
      throw error
    } finally { cancelledImageScans.delete(taskId) }
  }
  ipcMain.handle('images:scan', (event, taskId: string, library: ImageLibraryState, rootId?: string) => runImageScan(event, taskId, library, rootId))
  ipcMain.handle('images:cancel-scan', (_event, taskId: string) => { if (typeof taskId === 'string') cancelledImageScans.add(taskId) })
  ipcMain.handle('images:relocate-root', async (event, taskId: string, rootId: string, library: ImageLibraryState) => {
    const root = library.roots.find((item) => item.id === rootId)
    if (!root) return null
    const result = await dialog.showOpenDialog({ title: `重新定位“${root.name}”`, properties: ['openDirectory'] })
    if (result.canceled || !result.filePaths[0]) return null
    const directory = resolve(result.filePaths[0])
    sessionImageRootPaths.add(pathKey(directory))
    const next: ImageLibraryState = {
      roots: library.roots.map((item) => item.id === rootId ? { ...item, path: directory, name: basename(directory), identity: '', missing: false, updatedAt: new Date().toISOString() } : item),
      collections: library.collections,
      assets: library.assets,
    }
    return runImageScan(event, taskId, next, rootId)
  })
  ipcMain.handle('images:relocate-asset', async (_event, assetId: string, library: ImageLibraryState) => {
    const asset = library.assets.find((item) => item.id === assetId)
    if (!asset) return null
    const result = await dialog.showOpenDialog({ title: `重新定位“${asset.name}”`, properties: ['openFile'], filters: [{ name: '图片文件', extensions: [...IMAGE_EXTENSIONS].map((value) => value.slice(1)) }] })
    if (result.canceled || !result.filePaths[0]) return null
    try {
      const filePath = resolve(result.filePaths[0])
      const replacement = await parseImageAsset(filePath, asset.id)
      sessionMediaPaths.add(filePath)
      return {
        roots: library.roots,
        collections: library.collections,
        assets: library.assets.map((item) => item.id === assetId ? {
          ...replacement, rootId: item.rootId, collectionIds: item.collectionIds, createdAt: item.createdAt,
        } : item),
      } satisfies ImageLibraryState
    } catch { return null }
  })
  ipcMain.handle('images:check-paths', (_event, paths: string[]) =>
    Object.fromEntries(paths.map((filePath) => [filePath, existsSync(filePath)])),
  )
  ipcMain.handle('images:get-urls', (_event, paths: string[]) => {
    const snapshot = loadSnapshot()
    const indexedImagePaths = new Set((snapshot.imageLibrary?.assets ?? []).map((asset) => pathKey(asset.path)))
    for (const event of snapshot.countdowns) if (event.coverImagePath) indexedImagePaths.add(pathKey(event.coverImagePath))
    return Object.fromEntries(paths.flatMap((filePath) => {
      const authorized = sessionMediaPaths.has(filePath) || indexedImagePaths.has(pathKey(filePath))
      if (!authorized || !existsSync(filePath) || !IMAGE_EXTENSIONS.has(extname(filePath).toLowerCase())) return []
      return [[filePath, `sylunae-media://image/${Buffer.from(filePath).toString('base64url')}`]]
    }))
  })
  ipcMain.handle('images:get-thumbnail-urls', (_event, requests: Array<{ path: string; maxEdge: number }>) => {
    const snapshot = loadSnapshot()
    const indexedImagePaths = new Set((snapshot.imageLibrary?.assets ?? []).map((asset) => pathKey(asset.path)))
    for (const event of snapshot.countdowns) if (event.coverImagePath) indexedImagePaths.add(pathKey(event.coverImagePath))
    return Object.fromEntries(requests.flatMap(({ path: filePath, maxEdge }) => {
      const authorized = sessionMediaPaths.has(filePath) || indexedImagePaths.has(pathKey(filePath))
      if (!authorized || !existsSync(filePath) || !IMAGE_EXTENSIONS.has(extname(filePath).toLowerCase())) return []
      const details = statSync(filePath)
      const edge = Math.max(64, Math.min(IMAGE_THUMBNAIL_MAX_EDGE, Math.round(maxEdge)))
      return [[filePath, `sylunae-media://thumbnail/${Buffer.from(filePath).toString('base64url')}?v=thumbnail-v3-${details.size}-${details.mtimeMs}&edge=${edge}`]]
    }))
  })

  ipcMain.handle('backup:export', async (_event, contents: string, defaultName?: string) => {
    const result = await dialog.showSaveDialog({
      title: '导出丝月工坊备份',
      defaultPath: typeof defaultName === 'string' && /^[a-zA-Z0-9_-]+\.json$/.test(defaultName) ? defaultName : `sylunae-backup-${new Date().toISOString().slice(0, 10)}.json`,
      filters: [{ name: 'JSON 备份', extensions: ['json'] }],
    })
    if (result.canceled || !result.filePath) return false
    writeFileSync(result.filePath, contents, 'utf8')
    return true
  })
  ipcMain.handle('backup:import', async () => {
    const result = await dialog.showOpenDialog({
      title: '导入丝月工坊备份',
      properties: ['openFile'],
      filters: [{ name: 'JSON 备份', extensions: ['json'] }],
    })
    if (result.canceled || !result.filePaths[0]) return null
    return readFileSync(result.filePaths[0], 'utf8')
  })
  ipcMain.handle('system:get-theme', () => nativeTheme.shouldUseDarkColors ? 'dark' : 'light')
  ipcMain.handle('system:open-external', (_event, url: string) => {
    if (/^https?:\/\//.test(url)) return shell.openExternal(url)
  })
  ipcMain.handle('system:find-favicon', (_event, url: string) => findFavicon(url))
  ipcMain.handle('system:get-link-preview', (_event, url: string) => getLinkPreview(url))
  ipcMain.handle('system:pick-pomodoro-alarm', async () => {
    const result = await dialog.showOpenDialog({
      title: '选择番茄钟提示音',
      properties: ['openFile'],
      filters: [{ name: '音频文件', extensions: [...AUDIO_EXTENSIONS].map((value) => value.slice(1)) }],
    })
    if (result.canceled || !result.filePaths[0]) return null
    const filePath = resolve(result.filePaths[0])
    sessionMediaPaths.add(filePath)
    return filePath
  })
  ipcMain.handle('system:get-pomodoro-alarm-url', (_event, filePath: string) => {
    const extension = extname(filePath).toLowerCase()
    if (!isIndexedPath(filePath) || !existsSync(filePath) || !AUDIO_EXTENSIONS.has(extension)) return null
    return `sylunae-media://audio/${Buffer.from(filePath).toString('base64url')}`
  })
  ipcMain.handle('system:notify-birthday', (_event, body: unknown) => {
    if (typeof body !== 'string' || body.length > 1000 || !Notification.isSupported()) return false
    const notification = new Notification({ title: '丝月工坊 · 生日提醒', body, silent: true })
    notification.on('click', () => { const owner = BrowserWindow.fromWebContents(_event.sender); owner?.show(); owner?.focus() })
    notification.on('failed', (_event, error) => console.warn('生日通知发送失败', error))
    notification.show()
    return true
  })
  ipcMain.handle('system:notify-pomodoro-complete', (_event, focusCompleted: boolean) => {
    if (!Notification.isSupported()) return
    new Notification({
      title: '丝月工坊',
      body: focusCompleted ? '本轮专注完成，休息一下吧。' : '休息结束，准备开始下一轮专注。',
      silent: true,
    }).show()
  })
}

app.whenReady().then(() => {
  if (process.platform === 'win32') app.setAppUserModelId('studio.sylunae.workshop')
  const rendererOrigin = process.env.ELECTRON_RENDERER_URL ? new URL(process.env.ELECTRON_RENDERER_URL).origin : 'null'
  protocol.handle('sylunae-media', async (request) => {
    const requestOrigin = request.headers.get('Origin')
    if (requestOrigin && requestOrigin !== rendererOrigin) return new Response('Forbidden', { status: 403 })
    const url = new URL(request.url)
    const encoded = url.pathname.slice(1)
    const filePath = Buffer.from(encoded, 'base64url').toString('utf8')
    const extension = extname(filePath).toLowerCase()
    if (!isIndexedPath(filePath) || !existsSync(filePath) || (!AUDIO_EXTENSIONS.has(extension) && !IMAGE_EXTENSIONS.has(extension))) {
      return new Response('Not found', { status: 404 })
    }
    if (url.hostname === 'thumbnail') {
      try {
        const requestedEdge = Number(url.searchParams.get('edge'))
        const thumbnail = await getImageThumbnail(filePath, Number.isFinite(requestedEdge) ? requestedEdge : IMAGE_THUMBNAIL_MAX_EDGE)
        return new Response(new Uint8Array(thumbnail), { status: 200, headers: { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=31536000, immutable', 'Access-Control-Allow-Origin': rendererOrigin } })
      } catch { return new Response('Not found', { status: 404 }) }
    }
    const size = statSync(filePath).size
    const headers = new Headers({
      'Accept-Ranges': 'bytes',
      'Access-Control-Allow-Origin': rendererOrigin,
      'Content-Type': AUDIO_MIME_TYPES[extension] || await imageMimeType(filePath, extension),
    })
    const range = request.headers.get('Range')
    if (!range) {
      headers.set('Content-Length', String(size))
      return new Response(Readable.toWeb(createReadStream(filePath)) as unknown as BodyInit, { status: 200, headers })
    }

    const match = /^bytes=(\d*)-(\d*)$/.exec(range)
    if (!match || (!match[1] && !match[2])) {
      headers.set('Content-Range', `bytes */${size}`)
      return new Response(null, { status: 416, headers })
    }
    const suffixLength = match[1] ? null : Number(match[2])
    const start = suffixLength === null ? Number(match[1]) : Math.max(0, size - suffixLength)
    const end = match[2] && suffixLength === null ? Math.min(Number(match[2]), size - 1) : size - 1
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start > end || start >= size) {
      headers.set('Content-Range', `bytes */${size}`)
      return new Response(null, { status: 416, headers })
    }
    headers.set('Content-Length', String(end - start + 1))
    headers.set('Content-Range', `bytes ${start}-${end}/${size}`)
    return new Response(Readable.toWeb(createReadStream(filePath, { start, end })) as unknown as BodyInit, { status: 206, headers })
  })
  registerIpc()
  createWindow()
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
})

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
app.on('before-quit', closeDatabase)
