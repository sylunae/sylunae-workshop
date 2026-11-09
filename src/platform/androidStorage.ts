import type { AppSnapshot, AppSnapshotPatch } from '../shared/types'
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
export async function writeAndroidSnapshot(run: NativeCall, value: AppSnapshot | AppSnapshotPatch, replace: boolean): Promise<void> {
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
    await run('storage:commit', { token, replace, deletedNotes: changes?.delete ?? [] })
  } catch (error) {
    await run('storage:abort', { token }).catch(() => undefined)
    throw error
  }
}
