import { validateBackup } from './backup'
import { customWhiteNoiseSchema, driveMediaRef, driveObjects, driveSectionKeys, mapDriveSnapshotMedia, type DriveManifest, type DriveMediaKind, type DriveMediaTransform, type DriveObject, type DriveProgress, type DriveRestoredObject } from '../shared/driveBackup'

export async function restoreDriveSnapshot(
  manifest: DriveManifest,
  fetchObject: (object: DriveObject) => Promise<DriveRestoredObject>,
  readJson: (file: string) => Promise<unknown>,
  materialize: (file: string, object: DriveObject, kind: DriveMediaKind, extension: string) => Promise<string>,
  onProgress: (progress: DriveProgress) => void,
) {
  const total = driveObjects(manifest).size
  const restored = new Map<string, string>()
  let reused = 0
  const materialized = new Map<string, string>()
  const media = new Map(manifest.media.map((item) => [item.sha256, item]))
  const download = async (item: DriveObject) => {
    const existing = restored.get(item.sha256)
    if (existing) return existing
    onProgress({ message: '正在检查缓存并读取备份文件', completed: restored.size, total })
    const { file, reused: fromCache } = await fetchObject(item)
    restored.set(item.sha256, file)
    if (fromCache) reused++
    return file
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
    const [, , sha256, extension = ''] = ref
    const object = media.get(sha256)
    if (!object) throw new Error('备份清单缺少媒体文件。')
    const existing = materialized.get(source)
    if (existing) return existing
    const result = await materialize(await download(object), object, expected, extension)
    materialized.set(source, result)
    return result
  }
  const backup = validateBackup({ format: 'siyue-workshop-backup', version: 1, exportedAt: manifest.createdAt, snapshot: state })
  const snapshot = await mapDriveSnapshotMedia(backup.snapshot, transform)
  const whiteNoise = customWhiteNoiseSchema.parse(customWhiteNoise)
  for (const item of whiteNoise) item.localPath = await transform(item.localPath, 'path', item.title)
  snapshot.imageLibrary.roots = snapshot.imageLibrary.roots.map((root) => ({ ...root, path: '', missing: true }))
  onProgress({ message: '正在应用备份', completed: total, total })
  return { snapshot, whiteNoise, downloaded: restored.size - reused, reused }
}
