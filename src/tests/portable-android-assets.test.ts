// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { portableAndroidValue } from '../platform/portableAssets'
import type { SylunaeAPI } from '../shared/types'

afterEach(() => { delete window.sylunae })
it('embeds managed image fields once while preserving literal asset references in note text', async () => {
  const id = 'a'.repeat(64), reference = `sylunae-note-asset:${id}`
  const get = vi.fn(async () => ({ bytes: new Uint8Array([1, 2, 3]), mime: 'image/png' }))
  window.sylunae = { storage: { getNoteAsset: get } } as unknown as SylunaeAPI
  const source = { image: `/_capacitor_file_/data/data/app/files/note-assets/${id}`, content: [{ type: 'image', attrs: { src: reference } }, { type: 'text', text: reference }] }
  const result = await portableAndroidValue(source)
  expect(result.image).toBe('data:image/png;base64,AQID')
  expect(result.content[0].attrs?.src).toBe('data:image/png;base64,AQID')
  expect(result.content[1].text).toBe(reference)
  expect(get).toHaveBeenCalledTimes(1)
  expect(source.content[0].attrs?.src).toBe(reference)
})
