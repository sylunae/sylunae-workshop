// @vitest-environment node
import { createHash } from 'node:crypto'
import { afterEach, expect, it, vi } from 'vitest'
import { syncDriveNotebook } from '../app/syncDriveNotebook'
import { notebookRole, type DriveNotebookAPI, type Notebook, type NotebookHead } from '../shared/driveNotebook'
import type { Note } from '../shared/types'

const date = '2026-11-12T00:00:00.000Z'
const note = (id: string, title = id): Note => ({
  id, title, folderId: null, tags: [], pinned: false, deletedAt: null, createdAt: date, updatedAt: date,
  content: { type: 'doc', content: [{ type: 'paragraph' }] },
})
const notebook = (...notes: Note[]): Notebook => ({ notes, folders: [] })

function setup() {
  const heads = new Map<string, NotebookHead>()
  const objects = new Map<string, Uint8Array>()
  let head: NotebookHead | null = null
  const getNoteAsset = vi.fn()
  const putNoteAsset = vi.fn()
  vi.stubGlobal('window', { sylunae: { storage: { getNoteAsset, putNoteAsset } } })
  const api = {
    latest: vi.fn(async () => head),
    revision: vi.fn(async (id) => heads.get(id)!),
    legacy: vi.fn<DriveNotebookAPI['legacy']>(async () => null),
    read: vi.fn(async (object) => objects.get(object.id)!),
    put: vi.fn<DriveNotebookAPI['put']>(async (bytes, mime) => {
      const sha256 = createHash('sha256').update(bytes).digest('hex')
      const id = 'object-' + objects.size
      objects.set(id, bytes)
      return { id, sha256, size: bytes.length, mime }
    }),
    publish: vi.fn<DriveNotebookAPI['publish']>(async (manifest, expected) => {
      expect(manifest.format).toBe(notebookRole)
      expect(expected).toBe(head?.id ?? null)
      const id = 'head-' + heads.size
      head = { ...manifest, id }
      heads.set(id, head)
      return id
    }),
  } satisfies DriveNotebookAPI
  const apply = vi.fn(async (_expected: Notebook, _next: Notebook) => true)
  const sync = (local: Notebook, base?: string, legacy?: string) => syncDriveNotebook(api, local, base, legacy, apply)
  return { api, sync, apply, getNoteAsset, putNoteAsset }
}

afterEach(() => vi.unstubAllGlobals())

it('uploads only the changed note and pulls it alongside an unrelated local edit', async () => {
  const { api, sync, apply } = setup()
  const a = note('a'), b = note('b')
  const base = await sync(notebook(a, b))
  api.put.mockClear()
  await sync(notebook(note('a', '电脑编辑'), b), base?.id)
  expect(api.put).toHaveBeenCalledTimes(1)
  await sync(notebook(a, note('b', '手机编辑')), base?.id)
  expect(api.read).toHaveBeenCalledTimes(1)
  expect(apply.mock.lastCall?.[1].notes.map(({ title }) => title)).toEqual(['电脑编辑', '手机编辑'])
  expect(api.put).toHaveBeenCalledTimes(2)
})

it('uses the last full backup as a base on upgrade and keeps both simultaneous edits', async () => {
  const { api, sync, apply } = setup()
  const original = notebook(note('a'))
  api.legacy.mockImplementation(async () => ({ id: 'full', notebook: original, assets: [] }))
  const base = await sync(original, undefined, 'full')
  await sync(notebook(note('a', '电脑编辑')), base?.id)
  const phone = await sync(original, undefined, 'full')
  expect(apply.mock.lastCall?.[1].notes.map(({ title }) => title)).toEqual(['电脑编辑'])
  expect(phone?.conflicts).toBe(0)
  await sync(notebook(note('a', '手机编辑')), base?.id)
  expect(apply.mock.lastCall?.[1].notes.map(({ title }) => title)).toEqual(['手机编辑', '电脑编辑（同步冲突副本）'])
})

it('propagates deletions and does not publish a partially applied pull', async () => {
  const { api, sync, apply } = setup()
  const a = note('a')
  const base = await sync(notebook(a))
  await sync(notebook(), base?.id)
  apply.mockResolvedValueOnce(false)
  expect(await sync(notebook(a, note('b')), base?.id)).toBeNull()
  expect(apply.mock.lastCall?.[1].notes.map(({ id }) => id)).toEqual(['b'])
  expect(api.publish).toHaveBeenCalledTimes(2)
})

it('uploads an attachment once and validates it before applying a downloaded note', async () => {
  const { api, sync, apply, getNoteAsset, putNoteAsset } = setup()
  const bytes = new Uint8Array([1, 2, 3])
  const id = createHash('sha256').update(bytes).digest('hex')
  const withImage = {
    ...note('image'), content: { type: 'doc', content: [{ type: 'image', attrs: { src: 'sylunae-note-asset:' + id } }] },
  }
  getNoteAsset.mockResolvedValueOnce({ bytes, mime: 'image/png' }).mockResolvedValue(null)
  putNoteAsset.mockResolvedValue(id)
  const base = await sync(notebook(withImage))
  await sync(notebook({ ...withImage, title: '改过标题' }), base?.id)
  expect(api.put.mock.calls.filter(([, mime]) => mime === 'image/png')).toHaveLength(1)
  await sync(notebook())
  expect(putNoteAsset).toHaveBeenCalledWith(bytes, 'image/png')
  expect(putNoteAsset.mock.invocationCallOrder[0]).toBeLessThan(apply.mock.invocationCallOrder[0])
})
