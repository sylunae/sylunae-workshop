import { Capacitor, registerPlugin } from '@capacitor/core'
import { restoreDriveSnapshot } from '../data/driveRestore'
import { splitSnapshot } from '../data/snapshotSections'
import { decodeBytes, encodeBytes } from './binary'
import { nativeChunkSize } from './androidStorage'
import type { AppSnapshot, ResourceItem } from '../shared/types'
import { describeDriveBackup, driveAncestors, driveBackupFormat, driveExtensionForMime, driveExtensions, driveHeadChanged, driveManifestSchema, driveObjects, mapDriveSnapshotMedia, type DriveAccount, type DriveBackupAPI, type DriveManifest, type DriveMediaTransform, type DriveObject, type DriveUploadPlan, type DriveWhiteNoise } from '../shared/driveBackup'
import type { NativeCall } from './androidStorage'
import { notebookManifest } from '../shared/driveNotebook'
import { readLegacyNotebook } from '../data/readLegacyNotebook'

interface WorkshopDrive {
  status(): Promise<{ configured: boolean; connected: boolean; account?: DriveAccount }>
  connect(): Promise<DriveAccount>
  disconnect(): Promise<void>
  objects(options: { page?: string }): Promise<{ nextPageToken?: string; files: Array<{ id: string; size?: string; sha256Checksum?: string }> }>
  stage(options: { token: string; name: string; data: string; first: boolean }): Promise<{ path: string }>
  discard(options: { token: string }): Promise<void>
  inspect(options: { path: string }): Promise<{ name: string; size: number; sha256: string; mime: string }>
  upload(options: { path: string; size: number; sha256: string; manifest?: boolean; notebook?: boolean }): Promise<{ id: string }>
  latest(options?: { notebook: boolean }): Promise<{ id: null } | { id: string; uri: string }>
  revision(options: { id: string }): Promise<{ id: string; uri: string }>
  download(object: DriveObject): Promise<{ uri: string; reused: boolean }>
  materialize(options: { sha256: string; kind: string; extension: string; mime: string }): Promise<{ path: string; uri: string }>
  space(options: { objects: Array<Pick<DriveObject, 'sha256' | 'size'>> }): Promise<{ bytes: number; needed: number; cached: number }>
}

const native = registerPlugin<WorkshopDrive>('WorkshopDrive')

type Source = Omit<DriveObject, 'id'> & { path: string }
type Upload = { summary: DriveUploadPlan; sections: Array<{ key: string; source: Source }>; media: Map<string, Source> }

async function remoteObjects() {
  const objects = new Map<string, { id: string; size: number }>()
  let page: string | undefined
  do {
    const result = await native.objects({ page })
    for (const file of result.files) if (file.sha256Checksum && file.size !== undefined) objects.set(file.sha256Checksum, { id: file.id, size: Number(file.size) })
    page = result.nextPageToken
  } while (page)
  return objects
}

async function stage(token: string, name: string, bytes: Uint8Array, mime: string): Promise<Source> {
  let path = ''
  for (let start = 0; start < bytes.length; start += nativeChunkSize) {
    const result = await native.stage({ token, name, data: encodeBytes(bytes.subarray(start, start + nativeChunkSize)), first: start === 0 })
    path = result.path
  }
  const result = await native.inspect({ path })
  return { path, size: result.size, sha256: result.sha256, mime }
}

async function prepareUpload(token: string, account: DriveAccount, snapshot: AppSnapshot, run: NativeCall, whiteNoise?: DriveWhiteNoise): Promise<Upload> {
  const cloud = await remoteObjects()
  const media = new Map<string, Source>()
  const sources = new Map<string, Promise<Source | undefined>>()
  const missing = new Set<string>()
  let index = 0
  const sourceFor = async (value: string, kind: string): Promise<Source | undefined> => {
    const data = /^data:((?:image|audio)\/[\w.+-]+);base64,(.+)$/is.exec(value)
    if (data) return stage(token, 'media' + index++, decodeBytes(data[2]), data[1].toLowerCase())
    const note = /^sylunae-note-asset:([a-f0-9]{64})$/.exec(value)
    const local = value.startsWith(window.location.origin + '/_capacitor_file_') ? new URL(value).pathname : value
    const localUrl = local.startsWith('/_capacitor_file_') || local.startsWith('file://')
    if (!note && !localUrl && kind !== 'path') {
      if (/^(?:blob|file|data|sylunae-[^:]+):/i.test(value)) throw new Error('无法读取本地媒体。')
      return undefined
    }
    const path = note ? 'note-assets/' + note[1] : local
    const info = await native.inspect({ path })
    if (note && info.sha256 !== note[1]) throw new Error('笔记附件损坏。')
    const suffix = /\.[a-z0-9]{1,10}$/i.exec(info.name)?.[0].toLowerCase()
    return { path, size: info.size, sha256: info.sha256, mime: suffix && driveExtensions[suffix] || info.mime }
  }
  const transform: DriveMediaTransform = async (value, kind, label) => {
    try {
      if (kind !== 'path' && /^\/(?:resources\/fun\/desk-companion|images)\/[\w.-]+$/.test(value)) return value.slice(1)
      const key = kind + ':' + value
      let pending = sources.get(key)
      if (!pending) { pending = sourceFor(value, kind); sources.set(key, pending) }
      const source = await pending
      if (!source) return value
      if (!source.size || (kind === 'note' && !source.mime.startsWith('image/'))) throw new Error('无法读取备份媒体。')
      const previous = media.get(source.sha256)
      if (!previous || kind === 'note') media.set(source.sha256, source)
      const suffix = kind === 'note' ? '' : /\.[a-z0-9]{1,10}$/i.exec(source.path)?.[0].toLowerCase() ?? driveExtensionForMime(source.mime)
      return 'sylunae-drive:' + kind + ':' + source.sha256 + suffix
    } catch {
      missing.add(label)
      return value
    }
  }
  const portable = await mapDriveSnapshotMedia(snapshot, transform)
  const items = whiteNoise ?? (await run<{ value: ResourceItem[] | null }>('record:get', { key: 'resources' })).value?.filter(({ origin }) => origin === 'custom') ?? []
  const customWhiteNoise = []
  for (const item of items) if (item.localPath) {
    customWhiteNoise.push({ id: item.id, title: item.title, duration: item.duration, size: item.size, localPath: await transform(item.localPath, 'path', item.title) })
  }
  const sections = []
  for (const { key, value } of [...splitSnapshot(portable), { key: 'customWhiteNoise', value: customWhiteNoise }]) {
    sections.push({ key, source: await stage(token, key, new TextEncoder().encode(JSON.stringify(value)), 'application/json') })
  }
  const distinct = new Map([...sections.map(({ source }) => [source.sha256, source] as const), ...media])
  const uploads = [...distinct.values()].filter((source) => cloud.get(source.sha256)?.size !== source.size)
  return {
    sections, media,
    summary: {
      token, account, notes: snapshot.notes.length, tracks: snapshot.tracks.length, images: snapshot.imageLibrary.assets.length,
      uploadFiles: uploads.length, reuseFiles: distinct.size - uploads.length, uploadBytes: uploads.reduce((sum, source) => sum + source.size, 0),
      missing: [...missing],
    },
  }
}

async function readJson(uri: string): Promise<unknown> {
  const response = await fetch(Capacitor.convertFileSrc(uri), { cache: 'no-store' })
  if (!response.ok) throw new Error('无法读取已校验的备份数据。')
  return response.json()
}

export function createAndroidDriveBackup(run: NativeCall): DriveBackupAPI {
  let plan: Upload | undefined
  const discard = async () => {
    const token = plan?.summary.token
    plan = undefined
    if (token) await native.discard({ token }).catch(() => undefined)
  }
  let busy = false
  const exclusive = async <T>(work: () => Promise<T>) => {
    if (busy) throw new Error('Google Drive 正在处理另一项操作。')
    busy = true
    try { return await work() }
    finally { busy = false }
  }
  const latest = async () => {
    const item = await native.latest()
    return item.id === null ? null : describeDriveBackup(item.id, driveManifestSchema.parse(await readJson(item.uri)))
  }
  const restoreSpace = async (manifest: DriveManifest) => {
    const entries = [...driveObjects(manifest).values()]
    let downloadBytes = 0
    let reuseFiles = 0
    let available = 0
    for (let start = 0; start < entries.length; start += 250) {
      const result = await native.space({ objects: entries.slice(start, start + 250).map(({ sha256, size }) => ({ sha256, size })) })
      downloadBytes += result.needed
      reuseFiles += result.cached
      available = result.bytes
    }
    return { downloadBytes, reuseFiles, downloadFiles: entries.length - reuseFiles, available }
  }
  const account = async () => {
    const status = await native.status()
    if (!status.connected || !status.account) throw new Error('请先连接 Google Drive。')
    return status.account
  }
  const readNotebook = async (item: { id: string; uri: string }) => ({
    ...notebookManifest.parse(await readJson(item.uri)), id: item.id,
  })
  const putNotebookObject = async (bytes: Uint8Array, mime: string, beforePublish?: () => Promise<void>) => {
    const token = crypto.randomUUID()
    try {
      const { path, size, sha256 } = await stage(token, 'notebook', bytes, mime)
      await beforePublish?.()
      const { id } = await native.upload({ path, size, sha256, notebook: Boolean(beforePublish) })
      return { id, sha256, size, mime }
    } finally { await native.discard({ token }).catch(() => undefined) }
  }
  return {
    notebook: {
      latest: () => exclusive(async () => {
        const item = await native.latest({ notebook: true })
        return item.id === null ? null : readNotebook(item)
      }),
      revision: (id) => exclusive(async () => readNotebook(await native.revision({ id }))),
      legacy: (id) => exclusive(async () => {
        const item = id ? await native.revision({ id }) : await native.latest()
        if (item.id === null) return null
        const manifest = driveManifestSchema.parse(await readJson(item.uri))
        const notebook = await readLegacyNotebook(manifest, async (object) => readJson((await native.download(object)).uri))
        return { id: item.id, assets: manifest.media, notebook }
      }),
      read: (object) => exclusive(async () => {
        const { uri } = await native.download(object)
        const response = await fetch(Capacitor.convertFileSrc(uri), { cache: 'no-store' })
        if (!response.ok) throw new Error('无法读取已下载的笔记文件。')
        return new Uint8Array(await response.arrayBuffer())
      }),
      put: (bytes, mime) => exclusive(() => putNotebookObject(bytes, mime)),
      publish: (manifest, expected) => exclusive(async () => {
        const bytes = new TextEncoder().encode(JSON.stringify(notebookManifest.parse(manifest)))
        const result = await putNotebookObject(bytes, 'application/json', async () => {
          const head = await native.latest({ notebook: true })
          if (head.id !== expected) throw new Error(driveHeadChanged)
        })
        return result.id
      }),
    },
    status: () => native.status(),
    account,
    connect: () => exclusive(async () => { await discard(); return native.connect() }),
    disconnect: () => exclusive(async () => { await discard(); await native.disconnect() }),
    hasRollback: async () => (await run<{ available: boolean }>('storage:hasDriveRollback')).available,
    rollback: () => exclusive(() => run<void>('storage:rollbackDrive')),
    prepare: (snapshot, whiteNoise) => exclusive(async () => {
      await discard()
      const currentAccount = await account()
      const token = crypto.randomUUID()
      try {
        plan = await prepareUpload(token, currentAccount, snapshot, run, whiteNoise)
        return plan.summary
      } catch (error) {
        await native.discard({ token }).catch(() => undefined)
        throw error
      }
    }),
    upload: (token, onProgress, guard) => exclusive(async () => {
      if (!plan || plan.summary.token !== token || plan.summary.missing.length) throw new Error('请重新检查本次备份。')
      const { summary, sections, media } = plan
      const currentAccount = await account()
      if (currentAccount.id !== summary.account.id || (guard && currentAccount.id !== guard.accountId)) throw new Error('Google Drive 账号已更换，请重新检查备份。')
      const cloud = await remoteObjects()
      let completed = 0
      let uploaded = 0
      const total = sections.length + media.size
      const store = async ({ path, size, sha256, mime }: Source): Promise<DriveObject> => {
        let entry = cloud.get(sha256)
        if (!entry || entry.size !== size) {
          onProgress({ message: '正在上传备份文件', completed, total })
          const { id } = await native.upload({ path, size, sha256 })
          entry = { id, size }
          cloud.set(sha256, entry)
          uploaded++
        }
        completed++
        return { id: entry.id, sha256, size, mime }
      }
      const objects: Record<string, DriveObject> = {}
      for (const { key, source } of sections) objects[key] = await store(source)
      const assets = []
      for (const source of media.values()) assets.push(await store(source))
      const head = guard ? await latest() : null
      if (guard && (head?.id ?? null) !== guard.head) throw new Error(driveHeadChanged)
      const createdAt = new Date().toISOString()
      const manifest: DriveManifest = driveManifestSchema.parse({
        format: driveBackupFormat, version: 1, createdAt, device: 'Android',
        sections: objects, media: assets, counts: { notes: summary.notes, tracks: summary.tracks, images: summary.images },
        ...(guard && { ancestors: driveAncestors(head), writeId: guard.writeId }),
      })
      onProgress({ message: '正在发布最新备份', completed, total })
      const { path, size, sha256 } = await stage(token, 'manifest', new TextEncoder().encode(JSON.stringify(manifest)), 'application/json')
      const { id } = await native.upload({ path, size, sha256, manifest: true })
      await discard()
      return { id, createdAt, uploaded, reused: new Set([...Object.values(objects), ...assets].map(({ id }) => id)).size - uploaded }
    }),
    latest: () => exclusive(latest),
    revision: (id) => exclusive(async () => {
      const item = await native.revision({ id })
      return describeDriveBackup(item.id, driveManifestSchema.parse(await readJson(item.uri)))
    }),
    previewRestore: () => exclusive(async () => {
      const item = await native.latest()
      if (item.id === null) return null
      const manifest = driveManifestSchema.parse(await readJson(item.uri))
      const { downloadBytes, reuseFiles, downloadFiles } = await restoreSpace(manifest)
      return { ...describeDriveBackup(item.id, manifest), downloadBytes, reuseFiles, downloadFiles }
    }),
    download: (id, onProgress) => exclusive(async () => {
      const item = await native.latest()
      if (item.id !== id) throw new Error('云端备份已更新，请重新打开恢复确认。')
      const manifest = driveManifestSchema.parse(await readJson(item.uri))
      const { available, downloadBytes } = await restoreSpace(manifest)
      if (available < downloadBytes) throw new Error('手机可用空间不足，请清理空间后重试。')
      return restoreDriveSnapshot(manifest, async (object) => {
        const { uri, reused } = await native.download(object)
        return { file: uri, reused }
      }, readJson, async (_file, object, kind, extension) => {
        const { path, uri } = await native.materialize({ sha256: object.sha256, kind, extension, mime: object.mime })
        return kind === 'note' ? 'sylunae-note-asset:' + object.sha256 : kind === 'path' ? path : new URL(Capacitor.convertFileSrc(uri)).pathname
      }, onProgress)
    }),
  }
}
