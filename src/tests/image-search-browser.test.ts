// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { browserImageFingerprint, searchBrowserImages, selectSearchFiles } from '../lib/imageSearch'

let currentName = ''
const close = vi.fn()
beforeEach(() => {
  close.mockClear()
  vi.stubGlobal('createImageBitmap', vi.fn(async (file: File) => {
    if (file.name === 'broken.png') throw new Error('decode failed')
    return { width: 32, height: 32, name: file.name, close }
  }))
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => ({
    fillRect() {},
    drawImage(bitmap: { name: string }) { currentName = bitmap.name },
    getImageData() {
      const data = new Uint8ClampedArray(32 * 32 * 4)
      for (let i = 0; i < 1024; i++) {
        const color = currentName === 'different.png' ? [0, 0, 255] : [255, 0, 0]
        data.set([...color, 255], i * 4)
      }
      return { data }
    },
  }) as unknown as CanvasRenderingContext2D)
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })
const file = (name: string, path = `photos/${name}`) => Object.defineProperty(new File(['image'], name), 'webkitRelativePath', { value: path }) as File

it('filters formats and includes nested paths only when requested', () => {
  const files = [file('one.PNG'), file('nested.jpg', 'photos/sub/deeper/nested.jpg'), file('notes.txt')]
  expect(selectSearchFiles(files, false).map((item) => item.name)).toEqual(['one.PNG'])
  expect(selectSearchFiles(files, true).map((item) => item.name)).toEqual(['one.PNG', 'nested.jpg'])
})
it('ranks local matches, skips decode errors, and releases decoded bitmaps', async () => {
  const result = await searchBrowserImages(file('reference.png'), [file('copy.png'), file('different.png'), file('broken.png')], { recursive: false, minScore: 80 }, new AbortController().signal, () => {})
  expect(result).toMatchObject({ checked: 2, failed: 1, matches: 1, cancelled: false })
  expect(result.results[0]).toMatchObject({ name: 'copy.png', score: 100 })
  expect(close).toHaveBeenCalledTimes(3)
})
it('cancels after a progress update and retains partial matches', async () => {
  const job = new AbortController()
  const result = await searchBrowserImages(file('reference.png'), [file('one.png'), file('two.png')], { recursive: false, minScore: 80 }, job.signal, () => job.abort())
  expect(result).toMatchObject({ checked: 1, matches: 1, cancelled: true })
})
it('closes the bitmap even when canvas pixel access fails', async () => {
  vi.mocked(HTMLCanvasElement.prototype.getContext).mockReturnValue(null)
  await expect(browserImageFingerprint(file('reference.png'))).rejects.toThrow('浏览器无法读取')
  expect(close).toHaveBeenCalledTimes(1)
})
