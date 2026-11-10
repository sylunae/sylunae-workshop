import type { AppSnapshot, AppSnapshotPatch } from '../shared/types'
import type { DriveWhiteNoise } from '../shared/driveBackup'
import { snapshotSectionKeys } from '../data/snapshotSections'
import { decodeBytes, encodeBytes } from './binary'

export type NativeCall = <T = unknown>(op: string, options?: Record<string, unknown>) => Promise<T>
export const nativeChunkSize = 128 * 1024

export async function readAndroidSnapshot(run: NativeCall): Promise<Partial<AppSnapshot>> {
  const manifest = await run<{ records: string[]; notes: string[] }>('storage:manifest')
  const read = async (scope: string, id: string) => {
    const decoder = new TextDecoder(), parts: string[] = []
    for (let part = 0; ; part++) {
      const { data } = await run<{ data: string | null }>('storage:readChunk', { scope, id, part })
      if (data === null) break
      parts.push(decoder.decode(decodeBytes(data), { stream: true }))
    }
    parts.push(decoder.decode())
    return JSON.parse(parts.join('')) as unknown
  }
  const snapshot: Record<string, unknown> = { notes: [] }
  for (const id of manifest.records) if (id !== 'notes' && (snapshotSectionKeys as readonly string[]).includes(id)) snapshot[id] = await read('records', id)
  const notes: unknown[] = []
  for (const id of manifest.notes) notes.push(await read('notes', id))
  snapshot.notes = notes
  return snapshot as Partial<AppSnapshot>
}

/** Stage small bridge messages, then atomically publish all rows. Never clear live data first. */
export async function writeAndroidSnapshot(run: NativeCall, value: AppSnapshot | AppSnapshotPatch, replace: boolean, whiteNoise?: DriveWhiteNoise): Promise<void> {
  const token = crypto.randomUUID()
  const stage = async (scope: string, id: string, item: unknown) => {
    const bytes = new TextEncoder().encode(JSON.stringify(item))
    for (let start = 0, part = 0; start < bytes.length; start += nativeChunkSize, part++) {
      await run('storage:stage', { token, scope, id, part, data: encodeBytes(bytes.subarray(start, start + nativeChunkSize)) })
    }
  }
  try {
    for (const key of snapshotSectionKeys) if (key !== 'notes' && Object.prototype.hasOwnProperty.call(value, key) && value[key] !== undefined) await stage('records', key, value[key])
    const changes = 'noteChanges' in value ? value.noteChanges : undefined
    for (const note of value.notes ?? changes?.put ?? []) await stage('notes', note.id, note)
    if (whiteNoise) await stage('records', 'drive:whiteNoise', whiteNoise.map((item) => ({
      ...item, kind: 'white-noise', description: '从 Google Drive 恢复的白噪音', tags: [],
      coverPath: '', audioPath: '', sha256: '', builtin: false, origin: 'custom', state: 'installed', installedSize: item.size,
      attribution: { creator: '用户导入', sourceTitle: '', sourceUrl: '', license: '本地文件', licenseUrl: '' },
    })))
    await run('storage:commit', { token, replace, deletedNotes: changes?.delete ?? [], ...(whiteNoise ? { driveRestore: true } : {}) })
  } catch (error) {
    await run('storage:abort', { token }).catch(() => undefined)
    throw error
  }
}
