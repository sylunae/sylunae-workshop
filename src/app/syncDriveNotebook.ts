import { folderSchema, noteSchema } from '../data/backup'
import { notebookKinds, notebookRole, type DriveNotebookAPI, type Notebook, type NotebookEntry, type NotebookHead, type NotebookManifest } from '../shared/driveNotebook'
import type { DriveObject } from '../shared/driveBackup'
import type { Note, NoteFolder } from '../shared/types'
import { canonicalDriveJson, driveDigest } from './driveLocalState'

type Row = Note | NoteFolder
type Kind = typeof notebookKinds[number]
const encoder = new TextEncoder()
const decoder = new TextDecoder()
const encoded = new WeakMap<Row, { bytes: Uint8Array<ArrayBuffer>; digest: Promise<string> }>()
const attachmentRef = /^sylunae-note-asset:([a-f0-9]{64})$/

function encode(row: Row) {
  let cached = encoded.get(row)
  if (!cached) {
    const bytes = encoder.encode(canonicalDriveJson(row))
    cached = { bytes, digest: driveDigest(bytes) }
    encoded.set(row, cached)
  }
  return cached
}

function attachmentIds(row: Row) {
  const ids = new Set<string>()
  const visit = (node: Note['content']) => {
    const src = node.type === 'image' && node.attrs?.src
    const match = typeof src === 'string' ? attachmentRef.exec(src) : null
    if (match) ids.add(match[1])
    node.content?.forEach(visit)
  }
  if ('content' in row) visit(row.content)
  return ids
}

async function ensureAssets(api: DriveNotebookAPI, row: Row, assets: Map<string, DriveObject>) {
  const storage = window.sylunae!.storage
  for (const id of attachmentIds(row)) {
    const object = assets.get(id)
    if (!object) throw new Error('云端笔记缺少附件。')
    if (await storage.getNoteAsset(id)) continue
    const bytes = await api.read(object)
    if (await storage.putNoteAsset(bytes, object.mime) !== id) throw new Error('笔记附件校验失败。')
  }
}

async function readRow(api: DriveNotebookAPI, entry: NotebookEntry, kind: Kind) {
  const value = JSON.parse(decoder.decode(await api.read(entry.object)))
  const row = kind === 'notes' ? noteSchema.parse(value) : folderSchema.parse(value)
  if (row.id !== entry.id) throw new Error('云端笔记标识不匹配。')
  await ensureAssets(api, row, new Map(entry.assets.map((object) => [object.sha256, object])))
  return row
}

async function commonHead(api: DriveNotebookAPI, head: NotebookHead | null, baseId?: string) {
  if (!head || !baseId) return null
  if (head.id === baseId) return head
  const base = await api.revision(baseId)
  const local = new Set([base.id, ...base.ancestors])
  const visited = new Set<string>()
  let candidate = head
  while (!visited.has(candidate.id)) {
    if (local.has(candidate.id)) return candidate
    const shared = candidate.ancestors.find((id) => local.has(id))
    if (shared) return shared === base.id ? base : api.revision(shared)
    if (candidate.ancestors.length < 256) break
    visited.add(candidate.id)
    candidate = await api.revision(candidate.ancestors[255])
  }
  return null
}

export async function syncDriveNotebook(
  api: DriveNotebookAPI,
  local: Notebook,
  baseId: string | undefined,
  legacyBaseId: string | undefined,
  apply: (expected: Notebook, next: Notebook) => Promise<boolean>,
) {
  const head = await api.latest()
  const base = await commonHead(api, head, baseId)
  const legacy = head ? null : await api.legacy()
  const legacyBase = !baseId && legacyBaseId
    ? legacy?.id === legacyBaseId ? legacy : await api.legacy(legacyBaseId)
    : null
  const next: Notebook = { notes: [], folders: [] }
  const entries: NotebookManifest = { format: notebookRole, ancestors: head ? [head.id, ...head.ancestors].slice(0, 256) : [], notes: [], folders: [] }
  let conflicts = 0
  const cloudAssets = new Map<string, DriveObject>()
  for (const asset of legacy?.assets ?? []) cloudAssets.set(asset.sha256, asset)
  for (const entry of head?.notes ?? []) for (const asset of entry.assets) cloudAssets.set(asset.sha256, asset)
  const needsUpload: Array<{ kind: Kind; row: Row }> = []
  let localChanged = false
  let cloudChanged = false

  for (const kind of notebookKinds) {
    const localRows = new Map<string, Row>(local[kind].map((row) => [row.id, row]))
    const remote = new Map(head?.[kind].map((entry) => [entry.id, entry]))
    const legacyRows = new Map<string, Row>(legacy?.notebook[kind].map((row) => [row.id, row]))
    const previous = new Map(base?.[kind].map((entry) => [entry.id, entry.object.sha256]))
    for (const row of legacyBase?.notebook[kind] ?? []) previous.set(row.id, await encode(row).digest)
    const fetchRow = async (id: string) => {
      const row = legacyRows.get(id)
      if (!row) return readRow(api, remote.get(id)!, kind)
      await ensureAssets(api, row, cloudAssets)
      return row
    }
    const merged = new Map<string, Row>(localRows)
    for (const id of new Set([...localRows.keys(), ...remote.keys(), ...legacyRows.keys(), ...previous.keys()])) {
      const here = localRows.get(id)
      const there = remote.get(id)
      const legacyRow = legacyRows.get(id)
      const localHash = here ? await encode(here).digest : undefined
      const remoteHash = legacyRow ? await encode(legacyRow).digest : there?.object.sha256
      const baseHash = previous.get(id)
      if (localHash === remoteHash || remoteHash === baseHash) continue
      // Older clients published the displaced version as a conflict copy. Do not
      // interpret their replacement of the original as a clean remote edit.
      if (here && remoteHash && !id.startsWith('drive-conflict-')) {
        const displacedId = 'drive-conflict-' + await driveDigest(encoder.encode(id + ':' + localHash))
        if (remote.has(displacedId)) {
          conflicts++
          continue
        }
      }
      if (localHash === baseHash || !here) {
        if (!here && baseHash) { conflicts++; continue }
        if (remoteHash) merged.set(id, await fetchRow(id))
        else merged.delete(id)
        localChanged = true
      } else {
        conflicts++
      }
    }
    if (kind === 'notes') next.notes = [...merged.values()] as Note[]
    else next.folders = [...merged.values()] as NoteFolder[]
    if (merged.size !== remote.size) cloudChanged = true
    for (const row of merged.values()) {
      const entry = remote.get(row.id)
      if (entry && entry.object.sha256 === await encode(row).digest) entries[kind].push(entry)
      else { cloudChanged = true; needsUpload.push({ kind, row }) }
    }
  }

  if (conflicts) return { id: undefined, conflicts }
  if (localChanged && !await apply(local, next)) return null
  if (!cloudChanged) return { id: head?.id, conflicts }
  for (const { kind, row } of needsUpload) {
    const assets: DriveObject[] = []
    for (const id of attachmentIds(row)) {
      let asset = cloudAssets.get(id)
      if (!asset) {
        const stored = await window.sylunae!.storage.getNoteAsset(id)
        if (!stored) throw new Error('本地笔记缺少附件，请补齐后重试。')
        asset = await api.put(stored.bytes, stored.mime)
        if (asset.sha256 !== id) throw new Error('本地笔记附件校验失败。')
        cloudAssets.set(id, asset)
      }
      assets.push(asset)
    }
    const object = await api.put(encode(row).bytes, 'application/json')
    entries[kind].push({ id: row.id, object, assets })
  }
  return { id: await api.publish(entries, head?.id ?? null), conflicts }
}
