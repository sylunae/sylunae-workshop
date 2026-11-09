import type { AppSnapshot } from '../shared/types'
import { encodeBytes } from './binary'

/** Explicit exports embed managed attachments again, preserving desktop backup compatibility. */
export async function portableAndroidValue<T>(snapshot: T): Promise<T> {
  const assets = new Map<string, string>()
  const mediaFields = new Set(['src', 'image', 'cover', 'homeWallpaper', 'characterImage', 'pressSound', 'releaseSound', 'coverImagePath', 'coverPath', 'faviconUrl'])
  const walk = async (value: unknown, field = ''): Promise<unknown> => {
    if (typeof value === 'string') {
      if (!mediaFields.has(field)) return value
      const id = /^(?:sylunae-note-asset:|\/_capacitor_file_.*\/note-assets\/)([a-f0-9]{64})$/.exec(value)?.[1]
      if (!id) return value
      if (!assets.has(id)) {
        const asset = await window.sylunae!.storage.getNoteAsset(id)
        if (!asset) throw new Error('备份附件无法读取，请恢复附件后再导出。')
        assets.set(id, `data:${asset.mime};base64,${encodeBytes(asset.bytes)}`)
      }
      return assets.get(id)!
    }
    if (Array.isArray(value)) {
      const result: unknown[] = []; let changed = false
      for (const child of value) { const next = await walk(child, field); result.push(next); changed ||= next !== child }
      return changed ? result : value
    }
    if (value && typeof value === 'object') {
      const result: Record<string, unknown> = {}; let changed = false
      for (const [key, child] of Object.entries(value)) { const next = await walk(child, key); result[key] = next; changed ||= next !== child }
      return changed ? result : value
    }
    return value
  }
  return await walk(snapshot) as T
}
export const portableAndroidSnapshot = (snapshot: AppSnapshot) => portableAndroidValue(snapshot)
