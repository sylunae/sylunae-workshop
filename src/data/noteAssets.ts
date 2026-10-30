import Dexie, { type EntityTable } from 'dexie'
import type { JSONContent } from '@tiptap/core'
import type { AppSnapshot, Note } from '../shared/types'
import { applicationDatabaseName } from '../lib/storageEnvironment'

export const noteAssetPrefix = 'sylunae-note-asset:'
interface Asset { id: string; bytes: Uint8Array; mime: string }
class AssetDatabase extends Dexie {
  assets!: EntityTable<Asset, 'id'>
  constructor() { super(`${applicationDatabaseName}-note-assets`); this.version(1).stores({ assets: 'id' }) }
}
const db = new AssetDatabase()

export async function storeNoteImage(bytes: Uint8Array, mime: string): Promise<string> {
  if (!/^image\/[a-z0-9.+-]+$/i.test(mime)) throw new Error('不支持的图片格式')
  if (window.sylunae) return noteAssetPrefix + await window.sylunae.storage.putNoteAsset(bytes, mime)
  const hash = await crypto.subtle.digest('SHA-256', new Uint8Array(bytes))
  const id = Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join('')
  if (!await db.assets.get(id)) await db.assets.put({ id, bytes, mime })
  return noteAssetPrefix + id
}

async function readAsset(reference: string): Promise<Asset> {
  const id = reference.slice(noteAssetPrefix.length)
  if (!/^[a-f0-9]{64}$/.test(id)) throw new Error('无效的笔记图片引用')
  const asset = window.sylunae ? await window.sylunae.storage.getNoteAsset(id) : await db.assets.get(id)
  if (!asset) throw new Error('笔记图片资源缺失，未导出备份')
  return { ...asset, id }
}

/** Scope the cache to one operation so large Base64 strings are not retained. */
export function createImageExternalizer() {
  const sources = new Map<string, Promise<string>>()
  return (source: string): Promise<string> => {
    if (!/^data:image\/[a-z0-9.+-]+;base64,/i.test(source)) return Promise.resolve(source)
    let operation = sources.get(source)
    if (!operation) {
      operation = (async () => {
        const comma = source.indexOf(',')
        const mime = source.slice(5, source.indexOf(';'))
        const binary = atob(source.slice(comma + 1))
        const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0))
        return storeNoteImage(bytes, mime)
      })()
      sources.set(source, operation)
    }
    return operation
  }
}

export async function mapNoteImages(node: JSONContent, transform: (source: string) => Promise<string>): Promise<JSONContent> {
  let result = node
  if (node.type === 'image' && typeof node.attrs?.src === 'string') {
    const src = await transform(node.attrs.src)
    if (src !== node.attrs.src) result = { ...node, attrs: { ...node.attrs, src } }
  }
  if (node.content) {
    const content: JSONContent[] = []
    let changed = false
    for (const child of node.content) {
      const next = await mapNoteImages(child, transform)
      content.push(next)
      changed ||= next !== child
    }
    if (changed) result = { ...result, content }
  }
  return result
}

export async function externalizeNoteImages(notes: Note[]): Promise<Note[]> {
  const transform = createImageExternalizer()
  const result: Note[] = []
  for (const note of notes) {
    const content = await mapNoteImages(note.content, transform)
    result.push(content === note.content ? note : { ...note, content })
  }
  return result
}

export async function noteImageDataUrl(reference: string): Promise<string> {
  if (!reference.startsWith(noteAssetPrefix)) return reference
  const asset = await readAsset(reference)
  const bytes = new Uint8Array(asset.bytes)
  const blob = new Blob([bytes], { type: asset.mime })
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}

/** Exports remain self-contained and compatible with older installations. */
export async function portableNoteSnapshot(snapshot: AppSnapshot): Promise<AppSnapshot> {
  const cache = new Map<string, Promise<string>>()
  const notes: Note[] = []
  for (const note of snapshot.notes) {
    const content = await mapNoteImages(note.content, (source) => {
      if (!source.startsWith(noteAssetPrefix)) return Promise.resolve(source)
      if (!cache.has(source)) cache.set(source, noteImageDataUrl(source))
      return cache.get(source)!
    })
    notes.push(content === note.content ? note : { ...note, content })
  }
  return { ...snapshot, notes }
}

// Only mounted image nodes hold Blob URLs. Release on node removal or note switch.
const urls = new Map<string, { promise: Promise<string>; users: number }>()
export function acquireNoteImageUrl(reference: string) {
  let entry = urls.get(reference)
  if (!entry) {
    entry = { users: 0, promise: readAsset(reference).then((asset) => URL.createObjectURL(new Blob([new Uint8Array(asset.bytes)], { type: asset.mime }))) }
    urls.set(reference, entry)
  }
  entry.users++
  const current = entry
  let released = false
  return { url: entry.promise, release() {
    if (released) return
    released = true
    current.users--
    if (current.users === 0) {
      urls.delete(reference)
      void current.promise.then((url) => URL.revokeObjectURL(url), () => undefined)
    }
  } }
}
