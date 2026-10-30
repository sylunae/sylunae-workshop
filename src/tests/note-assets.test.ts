// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { externalizeNoteImages, portableNoteSnapshot, noteAssetPrefix } from '../data/noteAssets'
import { NoteImage } from '../editor/noteImage'
import { createDefaultSnapshot } from '../shared/defaults'
import type { Note, SylunaeAPI } from '../shared/types'

const id = 'a'.repeat(64)
const reference = noteAssetPrefix + id
const source = 'data:image/png;base64,AQIDBA=='
const makeNote = (imageSource: string): Note => ({ id: 'one', title: '图片', content: { type: 'doc', content: [
  { type: 'paragraph', content: [{ type: 'text', text: '正文' }] },
  { type: 'image', attrs: { src: imageSource, caption: '说明' } },
  { type: 'image', attrs: { src: imageSource } },
] }, folderId: null, tags: [], pinned: false, deletedAt: null, createdAt: 'now', updatedAt: 'now' })

afterEach(() => { delete window.sylunae; vi.unstubAllGlobals() })

function mockStorage() {
  const putNoteAsset = vi.fn(async (_bytes: Uint8Array, _mime: string) => id)
  const getNoteAsset = vi.fn(async () => ({ bytes: new Uint8Array([1, 2, 3, 4]), mime: 'image/png' }))
  window.sylunae = { storage: { putNoteAsset, getNoteAsset } } as unknown as SylunaeAPI
  return { putNoteAsset, getNoteAsset }
}

describe('independent note images', () => {
  it('stores repeated image bytes once and leaves the imported source untouched', async () => {
    const { putNoteAsset } = mockStorage()
    const original = makeNote(source)
    const [migrated] = await externalizeNoteImages([original])
    expect(putNoteAsset).toHaveBeenCalledTimes(1)
    expect(Array.from(putNoteAsset.mock.calls[0][0] as unknown as Uint8Array)).toEqual([1, 2, 3, 4])
    expect(migrated.content.content?.[1].attrs).toEqual({ src: reference, caption: '说明' })
    expect(original.content.content?.[1].attrs?.src).toBe(source)
    const again = await externalizeNoteImages([migrated])
    expect(again[0]).toBe(migrated)
    expect(putNoteAsset).toHaveBeenCalledTimes(1)
  })

  it('propagates asset failure without modifying the original note', async () => {
    const storage = mockStorage()
    storage.putNoteAsset.mockRejectedValueOnce(new Error('disk full'))
    const note = makeNote(source)
    await expect(externalizeNoteImages([note])).rejects.toThrow('disk full')
    expect(note.content.content?.[1].attrs?.src).toBe(source)
  })

  it('exports original image bytes in a self-contained backup', async () => {
    const { getNoteAsset } = mockStorage()
    const snapshot = createDefaultSnapshot()
    snapshot.notes = [makeNote(reference)]
    const portable = await portableNoteSnapshot(snapshot)
    expect(portable.notes[0].content.content?.[1].attrs?.src).toBe(source)
    expect(getNoteAsset).toHaveBeenCalledTimes(1)
    expect(snapshot.notes[0].content.content?.[1].attrs?.src).toBe(reference)
  })

  it('keeps Blob URLs out of document JSON and releases them on editor destruction', async () => {
    const { getNoteAsset } = mockStorage()
    const createObjectURL = vi.fn(() => 'blob:preview')
    const revokeObjectURL = vi.fn()
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL, revokeObjectURL }))
    const editor = new Editor({ element: document.createElement('div'), extensions: [StarterKit, NoteImage], content: makeNote(reference).content })
    await vi.waitFor(() => expect(editor.view.dom.querySelector('img')?.getAttribute('src')).toBe('blob:preview'))
    expect(createObjectURL).toHaveBeenCalledTimes(1)
    editor.commands.insertContent('编辑文字')
    expect(getNoteAsset).toHaveBeenCalledTimes(1)
    expect(editor.getJSON().content?.[1].attrs?.src).toBe(reference)
    editor.destroy()
    await vi.waitFor(() => expect(revokeObjectURL).toHaveBeenCalledTimes(1))
  })
})
