import { ipcMain } from 'electron'
import { createHash, randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { hostname } from 'node:os'
import { extname, isAbsolute } from 'node:path'
import { fileURLToPath } from 'node:url'
import { splitSnapshot } from '../../src/data/snapshotSections'
import { driveBackupFormat, driveManifestSchema, mapDriveSnapshotMedia, type DriveAccount, type DriveManifest, type DriveProgress, type DriveUploadPlan } from '../../src/shared/driveBackup'
import { getNoteAsset, loadSnapshot } from './database'
import { listResources } from './resourceManager'
import { GoogleDriveAuth } from './googleDriveAuth'
import { bufferHash, GoogleDriveFiles, type UploadSource } from './googleDriveFiles'

type ObjectSource = { sha256: string; size: number; mime: string; source: UploadSource }
type Prepared = {
  summary: DriveUploadPlan
  sections: Array<{ key: string; object: ObjectSource }>
  media: Map<string, ObjectSource>
}

const extensions: Record<string, string> = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp',
  '.gif': 'image/gif', '.bmp': 'image/bmp', '.avif': 'image/avif', '.svg': 'image/svg+xml',
  '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.wav': 'audio/wav',
  '.ogg': 'audio/ogg', '.oga': 'audio/ogg', '.opus': 'audio/ogg', '.flac': 'audio/flac',
}
const extensionForMime = (mime: string) => Object.keys(extensions).find((extension) => extensions[extension] === mime) ?? '.bin'

function bufferObject(source: Buffer, mime: string): ObjectSource {
  return { source, mime, sha256: bufferHash(source), size: source.length }
}

async function fileObject(path: string): Promise<ObjectSource> {
  const before = await stat(path)
  if (!before.isFile() || before.size === 0) throw new Error('文件不可读取')
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  const after = await stat(path)
  if (before.size !== after.size || before.mtimeMs !== after.mtimeMs) throw new Error('文件正在修改')
  return { source: path, mime: extensions[extname(path).toLowerCase()] ?? 'application/octet-stream', sha256: hash.digest('hex'), size: before.size }
}

async function prepare(account: DriveAccount, existing: Awaited<ReturnType<GoogleDriveFiles['objects']>>): Promise<Prepared> {
  const snapshot = loadSnapshot()
  const files = new Map<string, Promise<ObjectSource>>()
  const media = new Map<string, ObjectSource>()
  const missing = new Set<string>()
  const portable = await mapDriveSnapshotMedia(snapshot, transform)
  const { items } = await listResources()
  const customWhiteNoise = []
  for (const item of items) if (item.origin === 'custom' && item.localPath) {
    const localPath = await transform(item.localPath, 'path', item.title)
    customWhiteNoise.push({ id: item.id, title: item.title, localPath, duration: item.duration, size: item.size })
  }
  const sections = [...splitSnapshot(portable), { key: 'customWhiteNoise', value: customWhiteNoise }].map(({ key, value }) => ({
    key, object: bufferObject(Buffer.from(JSON.stringify(value)), 'application/json'),
  }))
  const distinct = new Map([...sections.map(({ object }) => [object.sha256, object] as const), ...media])
  const newObjects = [...distinct.values()].filter((item) => existing.get(item.sha256)?.size !== item.size)
  return {
    sections, media,
    summary: {
      token: randomUUID(), account,
      notes: snapshot.notes.length, tracks: snapshot.tracks.length, images: snapshot.imageLibrary.assets.length,
      uploadBytes: newObjects.reduce((total, item) => total + item.size, 0),
      uploadFiles: newObjects.length, reuseFiles: distinct.size - newObjects.length,
      missing: [...missing],
    },
  }

  async function transform(source: string, kind: 'path' | 'inline' | 'note', label: string) {
    try {
      if (kind !== 'path' && /^\/(?:resources\/fun\/desk-companion|images)\/[\w.-]+$/.test(source)) return source.slice(1)
      const embedded = /^data:((?:image|audio)\/[\w.+-]+);base64,(.+)$/is.exec(source)
      const note = /^sylunae-note-asset:([a-f0-9]{64})$/.exec(source)
      let path = source
      if (source.startsWith('file://')) path = fileURLToPath(source)
      const mediaUrl = /^sylunae-media:\/\/(?:image|audio)\/([A-Za-z0-9_-]+)$/.exec(source)
      if (mediaUrl) path = Buffer.from(mediaUrl[1], 'base64url').toString()
      const object = embedded
        ? bufferObject(Buffer.from(embedded[2], 'base64'), embedded[1].toLowerCase())
        : note ? storedNote(note[1]) : isAbsolute(path) ? await readPath(path) : undefined
      if (!object) {
        if (kind === 'path' || /^(?:blob|file|data|sylunae-[^:]+):/i.test(source)) throw new Error('无法读取本地媒体')
        return source
      }
      if (kind === 'note' && !object.mime.startsWith('image/')) throw new Error('不支持的笔记图片')
      media.set(object.sha256, object)
      const ext = extname(path).toLowerCase()
      const suffix = kind === 'note' ? '' : isAbsolute(path) && /^\.[a-z0-9]{1,10}$/.test(ext) ? ext : extensionForMime(object.mime)
      return 'sylunae-drive:' + kind + ':' + object.sha256 + suffix
    } catch {
      missing.add(label + (source.length < 400 && isAbsolute(source) ? ' · ' + source : ''))
      return source
    }
  }

  function readPath(path: string) {
    let operation = files.get(path)
    if (!operation) { operation = fileObject(path); files.set(path, operation) }
    return operation
  }
}

function storedNote(id: string) {
  const asset = getNoteAsset(id)
  if (!asset) throw new Error('笔记附件缺失')
  const object = bufferObject(Buffer.from(asset.bytes), asset.mime)
  if (object.sha256 !== id) throw new Error('笔记附件损坏')
  return object
}

export function registerGoogleDriveBackup() {
  const auth = new GoogleDriveAuth()
  const drive = new GoogleDriveFiles((force) => auth.token(force))
  let plan: Prepared | undefined
  let busy = false
  const exclusive = <T>(action: () => Promise<T>) => async () => {
    if (busy) throw new Error('Google Drive 正在处理另一项操作。')
    busy = true
    try { return await action() }
    finally { busy = false }
  }
  ipcMain.handle('drive:status', () => auth.status())
  ipcMain.handle('drive:configure', exclusive(async () => { plan = undefined; return auth.configure() }))
  ipcMain.handle('drive:connect', exclusive(async () => { plan = undefined; await auth.connect(); return drive.account() }))
  ipcMain.handle('drive:disconnect', exclusive(async () => { plan = undefined; await auth.disconnect() }))
  ipcMain.handle('drive:prepare', exclusive(async () => {
    plan = undefined
    const account = await drive.account()
    plan = await prepare(account, await drive.objects())
    return plan.summary
  }))
  ipcMain.handle('drive:upload', (event, token: unknown) => exclusive(async () => {
    const current = plan
    if (!current || current.summary.token !== token) throw new Error('请重新检查本次备份。')
    if (current.summary.missing.length) throw new Error('请先补齐缺失文件，再上传完整备份。')
    const account = await drive.account()
    if (account.id !== current.summary.account.id) throw new Error('Google Drive 账号已更换，请重新检查备份。')
    const existing = await drive.objects()
    const total = current.sections.length + current.media.size
    let completed = 0
    let uploaded = 0
    const progress = (message: string) => {
      if (!event.sender.isDestroyed()) event.sender.send('drive:progress', { message, completed, total } satisfies DriveProgress)
    }
    const store = async ({ source, sha256, size, mime }: ObjectSource) => {
      let entry = existing.get(sha256)
      if (!entry || entry.size !== size) {
        progress('正在上传备份文件')
        const id = await drive.upload(sha256, 'object-v1', source, size, sha256)
        entry = { id, size }
        existing.set(sha256, entry)
        uploaded++
      }
      completed++
      return { id: entry.id, sha256, size, mime }
    }
    const sections: Record<string, Awaited<ReturnType<typeof store>>> = {}
    for (const { key, object } of current.sections) sections[key] = await store(object)
    const media = []
    for (const item of current.media.values()) media.push(await store(item))
    const { notes, tracks, images } = current.summary
    const manifest: DriveManifest = driveManifestSchema.parse({
      format: driveBackupFormat, version: 1, createdAt: new Date().toISOString(), device: hostname(),
      sections, media, counts: { notes, tracks, images },
    })
    progress('正在发布可恢复备份')
    const contents = Buffer.from(JSON.stringify(manifest))
    await drive.upload('sylunae-backup-' + manifest.createdAt + '.json', 'manifest-v1', contents, contents.length, bufferHash(contents))
    plan = undefined
    return { createdAt: manifest.createdAt, uploaded, reused: new Set([...Object.values(sections), ...media].map((item) => item.id)).size - uploaded }
  })())
}
