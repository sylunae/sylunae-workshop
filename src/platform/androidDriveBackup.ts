import { Capacitor, registerPlugin } from '@capacitor/core'
import { validateBackup } from '../data/backup'
import { customWhiteNoiseSchema, driveManifestSchema, driveMediaRef, driveSectionKeys, mapDriveSnapshotMedia, type DriveAccount, type DriveBackupAPI, type DriveBackupInfo, type DriveManifest, type DriveMediaTransform, type DriveObject } from '../shared/driveBackup'
import type { NativeCall } from './androidStorage'

interface WorkshopDrive {
  status(): Promise<{ configured: boolean; connected: boolean; account?: DriveAccount }>
  connect(): Promise<DriveAccount>
  disconnect(): Promise<void>
  latest(): Promise<{ id: null } | { id: string; uri: string }>
  download(object: DriveObject): Promise<{ uri: string }>
  materialize(options: { sha256: string; kind: string; extension: string; mime: string }): Promise<{ path: string; uri: string }>
  space(options: { objects: Array<Pick<DriveObject, 'sha256' | 'size'>> }): Promise<{ bytes: number; needed: number }>
}

const native = registerPlugin<WorkshopDrive>('WorkshopDrive')

async function readJson(uri: string): Promise<unknown> {
  const response = await fetch(Capacitor.convertFileSrc(uri), { cache: 'no-store' })
  if (!response.ok) throw new Error('无法读取已校验的备份数据。')
  return response.json()
}

export function createAndroidDriveBackup(run: NativeCall): DriveBackupAPI {
  let selected: { id: string; manifest: DriveManifest } | undefined
  let busy = false
  const exclusive = async <T>(work: () => Promise<T>) => {
    if (busy) throw new Error('Google Drive 正在处理另一项操作。')
    busy = true
    try { return await work() }
    finally { busy = false }
  }
  return {
    mode: 'restore',
    status: () => native.status(),
    connect: () => exclusive(async () => { selected = undefined; return native.connect() }),
    disconnect: () => exclusive(async () => { selected = undefined; await native.disconnect() }),
    hasRollback: async () => (await run<{ available: boolean }>('storage:hasDriveRollback')).available,
    rollback: () => exclusive(() => run<void>('storage:rollbackDrive')),
    latest: () => exclusive(async (): Promise<DriveBackupInfo | null> => {
      selected = undefined
      const item = await native.latest()
      if (item.id === null) return null
      const manifest = driveManifestSchema.parse(await readJson(item.uri))
      selected = { id: item.id, manifest }
      const { createdAt, device, counts } = manifest
      const objects = new Map([...Object.values(manifest.sections), ...manifest.media].map((object) => [object.sha256, object]))
      const bytes = [...objects.values()].reduce((total, item) => total + item.size, 0)
      return { id: item.id, createdAt, device, counts, bytes }
    }),
    download: (id, onProgress) => exclusive(async () => {
      if (!selected || selected.id !== id) throw new Error('请重新检查 Google Drive 备份。')
      const { manifest } = selected
      const objects = new Map([...Object.values(manifest.sections), ...manifest.media].map((object) => [object.sha256, object]))
      let needed = 0
      let available = 0
      const entries = [...objects.values()]
      for (let start = 0; start < entries.length; start += 250) {
        const result = await native.space({ objects: entries.slice(start, start + 250).map(({ sha256, size }) => ({ sha256, size })) })
        needed += result.needed
        available = result.bytes
      }
      if (available < needed) throw new Error('手机可用空间不足，请清理空间后重试。')
      const downloaded = new Map<string, string>()
      const materialized = new Map<string, string>()
      const media = new Map(manifest.media.map((item) => [item.sha256, item]))
      const download = async (item: DriveObject) => {
        const existing = downloaded.get(item.sha256)
        if (existing) return existing
        onProgress({ message: '正在下载并校验文件', completed: downloaded.size, total: objects.size })
        const { uri } = await native.download(item)
        downloaded.set(item.sha256, uri)
        return uri
      }
      const sections: Record<string, unknown> = {}
      for (const key of driveSectionKeys) sections[key] = await readJson(await download(manifest.sections[key]))
      const { customWhiteNoise, ...state } = sections
      const transform: DriveMediaTransform = async (source, expected) => {
        const ref = driveMediaRef.exec(source)
        if (!ref) {
          if (expected === 'path' || /^(?:[a-z][a-z0-9+.-]*:|[\\/])/i.test(source) && !/^https?:\/\//i.test(source)) {
            throw new Error('备份包含无法恢复的媒体引用。')
          }
          return source
        }
        if (ref[1] !== expected) throw new Error('备份媒体类型不匹配。')
        const [, kind, sha256, extension = ''] = ref
        const object = media.get(sha256)
        if (!object) throw new Error('备份清单缺少媒体文件。')
        const existing = materialized.get(source)
        if (existing) return existing
        await download(object)
        const { path, uri } = await native.materialize({ sha256, kind, extension, mime: object.mime })
        const result = kind === 'note' ? 'sylunae-note-asset:' + sha256 : kind === 'path' ? path : new URL(Capacitor.convertFileSrc(uri)).pathname
        materialized.set(source, result)
        return result
      }
      const backup = validateBackup({ format: 'siyue-workshop-backup', version: 1, exportedAt: manifest.createdAt, snapshot: state })
      const snapshot = await mapDriveSnapshotMedia(backup.snapshot, transform)
      const whiteNoise = customWhiteNoiseSchema.parse(customWhiteNoise)
      for (const item of whiteNoise) item.localPath = await transform(item.localPath, 'path', item.title)
      for (const item of manifest.media) await download(item)
      snapshot.imageLibrary.roots = snapshot.imageLibrary.roots.map((root) => ({ ...root, path: '', missing: true }))
      onProgress({ message: '文件校验完成，正在应用备份', completed: objects.size, total: objects.size })
      return { snapshot, whiteNoise }
    }),
  }
}
