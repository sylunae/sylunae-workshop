import { app, ipcMain } from 'electron'
import { createHash, randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { copyFile, mkdir, readFile, rename, stat, unlink } from 'node:fs/promises'
import { hostname } from 'node:os'
import { extname, isAbsolute, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { splitSnapshot } from '../../src/data/snapshotSections'
import { describeDriveBackup, driveAncestors, driveBackupFormat, driveExtensionForMime, driveExtensions, driveHeadChanged, driveManifestSchema, driveObjects, driveObjectSchema, drivePublishGuard, mapDriveSnapshotMedia, type DriveAccount, type DriveManifest, type DriveObject, type DriveProgress, type DriveUploadPlan, type DriveWhiteNoise } from '../../src/shared/driveBackup'
import { restoreDriveSnapshot } from '../../src/data/driveRestore'
import { notebookId, notebookManifest, notebookRole } from '../../src/shared/driveNotebook'
import { readLegacyNotebook } from '../../src/data/readLegacyNotebook'
import { getNoteAsset, hasDriveRollback, loadSnapshot, putNoteAsset, rollbackDriveSnapshot } from './database'
import { listResources } from './resourceManager'
import { GoogleDriveAuth } from './googleDriveAuth'
import { bufferHash, GoogleDriveFiles, type UploadSource } from './googleDriveFiles'

type ObjectSource = { sha256: string; size: number; mime: string; source: UploadSource }
const mediaHashes = new Map<string, { signature: string; object: ObjectSource }>()
type Prepared = {
  summary: DriveUploadPlan
  sections: Array<{ key: string; object: ObjectSource }>
  media: Map<string, ObjectSource>
}

export function driveMediaPath(name: string): string | undefined {
  if (/^[a-f0-9]{64}(?:\.[a-z0-9]{1,10})?$/.test(name)) return join(app.getPath('userData'), 'drive-media', name)
}

function bufferObject(source: Buffer, mime: string): ObjectSource {
  return { source, mime, sha256: bufferHash(source), size: source.length }
}

async function fileObject(path: string): Promise<ObjectSource> {
  const signature = async () => {
    const details = await stat(path, { bigint: true })
    if (!details.isFile() || details.size === 0n) throw new Error('文件不可读取')
    return { key: [details.ino, details.size, details.mtimeNs, details.ctimeNs].join(':'), size: Number(details.size) }
  }
  const before = await signature()
  const cached = mediaHashes.get(path)
  if (cached?.signature === before.key) return cached.object
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  if (before.key !== (await signature()).key) throw new Error('文件正在修改')
  const object = { source: path, mime: driveExtensions[extname(path).toLowerCase()] ?? 'application/octet-stream', sha256: hash.digest('hex'), size: before.size }
  if (mediaHashes.size >= 4096) mediaHashes.delete(mediaHashes.keys().next().value!)
  mediaHashes.set(path, { signature: before.key, object })
  return object
}

async function prepare(snapshot: ReturnType<typeof loadSnapshot>, account: DriveAccount, existing: Awaited<ReturnType<GoogleDriveFiles['objects']>>, whiteNoise?: DriveWhiteNoise): Promise<Prepared> {
  const files = new Map<string, Promise<ObjectSource>>()
  const media = new Map<string, ObjectSource>()
  const missing = new Set<string>()
  const portable = await mapDriveSnapshotMedia(snapshot, transform)
  const items = whiteNoise ?? (await listResources()).items.filter(({ origin }) => origin === 'custom')
  const customWhiteNoise = []
  for (const item of items) if (item.localPath) {
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
      if (source.startsWith('sylunae-media://drive/')) path = driveMediaPath(source.slice('sylunae-media://drive/'.length)) ?? source
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
      const suffix = kind === 'note' ? '' : isAbsolute(path) && /^\.[a-z0-9]{1,10}$/.test(ext) ? ext : driveExtensionForMime(object.mime)
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
  const cachedPath = (object: DriveObject) => join(app.getPath('userData'), 'drive-objects', object.sha256)
  const download = (object: DriveObject) => drive.download(object, cachedPath(object))
  const readJson = async (path: string): Promise<unknown> => JSON.parse(await readFile(path, 'utf8'))
  const readManifest = async (object: DriveObject) => driveManifestSchema.parse(await readJson((await download(object)).file))
  let plan: Prepared | undefined
  let busy = false
  let connecting: { controller: AbortController; task: Promise<DriveAccount> } | undefined
  const exclusive = <T>(action: () => Promise<T>) => async () => {
    if (busy) throw new Error('Google Drive 正在处理另一项操作。')
    busy = true
    try { return await action() }
    finally { busy = false }
  }
  ipcMain.handle('drive:status', () => auth.status())
  const readNotebook = async (object: DriveObject) => ({
    ...notebookManifest.parse(await readJson((await download(object)).file)), id: object.id,
  })
  ipcMain.handle('drive:notebook-latest', exclusive(async () => {
    const object = await drive.latest(notebookRole)
    return object ? readNotebook(object) : null
  }))
  ipcMain.handle('drive:notebook-revision', (_event, id: unknown) => exclusive(async () => readNotebook(await drive.revision(notebookId.parse(id))))())
  ipcMain.handle('drive:notebook-legacy', (_event, id?: string) => exclusive(async () => {
    const object = id ? await drive.revision(notebookId.parse(id)) : await drive.latest()
    if (!object) return null
    const manifest = await readManifest(object)
    return { id: object.id, assets: manifest.media, notebook: await readLegacyNotebook(manifest, async (entry) => readJson((await download(entry)).file)) }
  })())
  ipcMain.handle('drive:notebook-read', (_event, value: unknown) => exclusive(async () => {
    const { file } = await download(driveObjectSchema.parse(value))
    return new Uint8Array(await readFile(file))
  })())
  ipcMain.handle('drive:notebook-put', (_event, bytes: Uint8Array, mime: string) => exclusive(async () => {
    const body = Buffer.from(bytes)
    const sha256 = bufferHash(body)
    const id = await drive.upload(sha256, 'object-v1', body, body.length, sha256)
    return driveObjectSchema.parse({ id, sha256, mime, size: body.length })
  })())
  ipcMain.handle('drive:notebook-publish', (_event, value: unknown, expected: string | null) => exclusive(async () => {
    const body = Buffer.from(JSON.stringify(notebookManifest.parse(value)))
    const head = await drive.latest(notebookRole)
    if ((head?.id ?? null) !== expected) throw new Error(driveHeadChanged)
    const sha256 = bufferHash(body)
    return drive.upload('sylunae-notebook-' + sha256 + '.json', notebookRole, body, body.length, sha256)
  })())
  if (!app.isPackaged) ipcMain.handle('drive:import-development-client', exclusive(() => auth.importDevelopmentClient()))
  ipcMain.handle('drive:account', exclusive(() => drive.account()))
  const cancelConnect = () => connecting?.controller.abort(new Error('已取消 Google Drive 授权。'))
  ipcMain.handle('drive:cancel-connect', cancelConnect)
  ipcMain.handle('drive:connect', async () => {
    const previous = connecting
    if (previous) {
      cancelConnect()
      await previous.task.catch(() => undefined)
      if (connecting && connecting !== previous) return connecting.task
    }
    const controller = new AbortController()
    const task = exclusive(async () => {
      plan = undefined
      await auth.connect(controller.signal)
      return drive.account(controller.signal)
    })()
    const attempt = { controller, task }
    connecting = attempt
    try { return await task }
    finally { if (connecting === attempt) connecting = undefined }
  })
  ipcMain.handle('drive:disconnect', exclusive(async () => { plan = undefined; await auth.disconnect() }))
  ipcMain.handle('drive:has-rollback', () => hasDriveRollback())
  ipcMain.handle('drive:rollback', exclusive(async () => rollbackDriveSnapshot()))
  const latest = async () => {
    const item = await drive.latest()
    return item ? describeDriveBackup(item.id, await readManifest(item)) : null
  }
  ipcMain.handle('drive:latest', exclusive(latest))
  ipcMain.handle('drive:revision', (_event, id: string) => exclusive(async () => {
    const item = await drive.revision(id)
    return describeDriveBackup(item.id, await readManifest(item))
  })())
  ipcMain.handle('drive:preview-restore', exclusive(async () => {
    const item = await drive.latest()
    if (!item) return null
    const manifest = await readManifest(item)
    let downloadFiles = 0
    let reuseFiles = 0
    let downloadBytes = 0
    for (const object of driveObjects(manifest).values()) {
      const details = await stat(cachedPath(object)).catch(() => undefined)
      if (details?.isFile() && details.size === object.size) reuseFiles++
      else { downloadFiles++; downloadBytes += object.size }
    }
    return { ...describeDriveBackup(item.id, manifest), downloadFiles, reuseFiles, downloadBytes }
  }))
  ipcMain.handle('drive:download', (event, id: unknown) => exclusive(async () => {
    const item = await drive.latest()
    if (!item || item.id !== id) throw new Error('云端备份已更新，请重新打开恢复确认。')
    const manifest = await readManifest(item)
    return restoreDriveSnapshot(manifest, download, readJson, async (file, object, kind, extension) => {
      if (kind === 'note') return 'sylunae-note-asset:' + putNoteAsset(await readFile(file), object.mime)
      if (kind === 'inline' && object.mime === 'image/svg+xml') return 'data:image/svg+xml;base64,' + (await readFile(file)).toString('base64')
      const name = object.sha256 + (extension || driveExtensionForMime(object.mime))
      const target = driveMediaPath(name)!
      await mkdir(join(app.getPath('userData'), 'drive-media'), { recursive: true })
      const partial = target + '.' + randomUUID() + '.part'
      try {
        await copyFile(file, partial)
        await rename(partial, target)
      } finally { await unlink(partial).catch(() => undefined) }
      return kind === 'path' ? target : 'sylunae-media://drive/' + name
    }, (progress) => { if (!event.sender.isDestroyed()) event.sender.send('drive:progress', progress) })
  })())
  ipcMain.handle('drive:prepare', (_event, value?: ReturnType<typeof loadSnapshot>, whiteNoise?: DriveWhiteNoise) => exclusive(async () => {
    plan = undefined
    const snapshot = value ?? loadSnapshot()
    const account = await drive.account()
    plan = await prepare(snapshot, account, await drive.objects(), whiteNoise)
    return plan.summary
  })())
  ipcMain.handle('drive:upload', (event, token: unknown, options: unknown) => exclusive(async () => {
    const guard = drivePublishGuard.optional().parse(options)
    const current = plan
    if (!current || current.summary.token !== token) throw new Error('请重新检查本次备份。')
    if (current.summary.missing.length) throw new Error('请先补齐缺失文件，再上传完整备份。')
    const account = await drive.account()
    if (account.id !== current.summary.account.id) throw new Error('Google Drive 账号已更换，请重新检查备份。')
    if (guard && account.id !== guard.accountId) throw new Error('Google Drive 账号已更换，请重新检查备份。')
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
    const head = guard ? await latest() : null
    if (guard && (head?.id ?? null) !== guard.head) throw new Error(driveHeadChanged)
    const { notes, tracks, images } = current.summary
    const manifest: DriveManifest = driveManifestSchema.parse({
      format: driveBackupFormat, version: 1, createdAt: new Date().toISOString(), device: hostname(),
      sections, media, counts: { notes, tracks, images }, ...(guard && { ancestors: driveAncestors(head), writeId: guard.writeId }),
    })
    progress('正在发布可恢复备份')
    const contents = Buffer.from(JSON.stringify(manifest))
    const id = await drive.upload('sylunae-backup-' + manifest.createdAt + '.json', 'manifest-v1', contents, contents.length, bufferHash(contents))
    plan = undefined
    return { id, createdAt: manifest.createdAt, uploaded, reused: new Set([...Object.values(sections), ...media].map((item) => item.id)).size - uploaded }
  })())
}
