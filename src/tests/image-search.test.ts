// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, mkdir, readFile, rename, rm, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import sharp from 'sharp'
import { imageFingerprint, imageSimilarity, rankImageMatches } from '../shared/imageSearch'
import { searchImageFolder, registerImageSearch } from '../../electron/main/imageSearch'

const native = vi.hoisted(() => ({ handlers: new Map<string, (...args: any[]) => any>(), selected: '', openPath: vi.fn(async () => ''), reveal: vi.fn() }))
vi.mock('electron', () => ({
  ipcMain: { handle: (channel: string, handler: (...args: any[]) => any) => native.handlers.set(channel, handler) },
  dialog: { showOpenDialog: async () => ({ canceled: !native.selected, filePaths: native.selected ? [native.selected] : [] }) },
  shell: { openPath: native.openPath, showItemInFolder: native.reveal },
}))

let root = ''
let reference = ''
let folder = ''
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'sylunae-image-search-'))
  reference = join(root, 'reference.png')
  folder = join(root, 'pictures')
  await mkdir(folder)
  const pixels = Buffer.alloc(160 * 120 * 3)
  for (let y = 0; y < 120; y++) for (let x = 0; x < 160; x++) {
    const i = (y * 160 + x) * 3
    const circle = (x - 55) ** 2 + (y - 40) ** 2 < 25 ** 2
    pixels[i] = circle ? 230 : x * 1.4
    pixels[i + 1] = circle ? 80 : y * 1.8
    pixels[i + 2] = x > 100 && y > 70 ? 210 : 60
  }
  await sharp(pixels, { raw: { width: 160, height: 120, channels: 3 } }).png().toFile(reference)
  native.handlers.clear(); native.selected = ''; native.openPath.mockClear(); native.reveal.mockClear()
})
afterEach(async () => { await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }) })
const options = { recursive: false, minScore: 80 }
const run = (recursive = false, minScore = 80) => searchImageFolder(reference, folder, { recursive, minScore }, new AbortController().signal, () => {})

describe('local image matching', () => {
  it('finds resized, compressed, and lightly recolored copies ahead of unrelated images without changing sources', async () => {
    const original = await readFile(reference)
    await writeFile(join(folder, 'exact.png'), original)
    await sharp(original).resize(80, 60).jpeg({ quality: 55 }).toFile(join(folder, 'small.jpg'))
    await sharp(original).modulate({ brightness: 1.08, saturation: .9 }).webp().toFile(join(folder, 'tinted.webp'))
    await sharp({ create: { width: 160, height: 120, channels: 3, background: '#192cdd' } }).png().toFile(join(folder, 'different.png'))
    const result = await run()
    expect(result.checked).toBe(4)
    expect(result.results.map((match) => match.name)).toEqual(['exact.png', expect.stringMatching(/small.jpg|tinted.webp/), expect.stringMatching(/small.jpg|tinted.webp/)])
    expect(result.results[0].score).toBe(100)
    expect(new Set(result.results.map((match) => match.name)).size).toBe(3)
    expect(result.results.every((match) => match.preview.startsWith('data:image/jpeg;base64,'))).toBe(true)
    expect(await readFile(reference)).toEqual(original)
    expect(await readFile(join(folder, 'exact.png'))).toEqual(original)
    // Scanning and previews must release Windows file handles immediately.
    await rename(join(folder, 'tinted.webp'), join(folder, 'renamed.webp'))
  })
  it('only includes nested images when requested and reports corrupt images', async () => {
    await mkdir(join(folder, 'nested'))
    await writeFile(join(folder, 'nested', 'copy.PNG'), await readFile(reference))
    await writeFile(join(folder, 'broken.jpg'), 'invalid')
    await writeFile(join(folder, 'notes.txt'), 'skip')
    expect(await run()).toMatchObject({ checked: 0, failed: 1, matches: 0 })
    expect(await run(true)).toMatchObject({ checked: 1, failed: 1, matches: 1 })
    expect((await run(true)).results[0].name).toBe('copy.PNG')
  })
  it('normalizes EXIF orientation and supports transparent and TIFF copies', async () => {
    const original = await readFile(reference)
    await sharp(original).rotate(90).withMetadata({ orientation: 8 }).jpeg({ quality: 95 }).toFile(join(folder, 'oriented.jpg'))
    await sharp(original).ensureAlpha().png().toFile(join(folder, 'alpha.png'))
    await sharp(original).tiff().toFile(join(folder, 'copy.tiff'))
    expect((await run()).results.map((match) => match.name).sort()).toEqual(['alpha.png', 'copy.tiff', 'oriented.jpg'])
  })
  it('excludes junctions from recursive scanning', async () => {
    const outside = join(root, 'outside')
    await mkdir(outside)
    await writeFile(join(outside, 'copy.png'), await readFile(reference))
    await symlink(outside, join(folder, 'link'), process.platform === 'win32' ? 'junction' : 'dir')
    expect(await run(true)).toMatchObject({ checked: 0, matches: 0 })
  })
  it('stops during a scan and returns matches already found', async () => {
    for (let i = 0; i < 5; i++) await writeFile(join(folder, `${i}.png`), await readFile(reference))
    const job = new AbortController()
    const result = await searchImageFolder(reference, folder, options, job.signal, () => job.abort())
    expect(result.cancelled).toBe(true)
    expect(result.checked).toBe(1)
    expect(result.matches).toBe(1)
    expect(result.results).toHaveLength(1)
  })
  it('handles empty folders and missing roots distinctly', async () => {
    expect(await run()).toMatchObject({ checked: 0, matches: 0, results: [], cancelled: false })
    await expect(searchImageFolder(reference, join(root, 'missing'), options, new AbortController().signal, () => {})).rejects.toThrow('无法读取')
  })
  it('keeps a bounded, stable ranking and separates solid colors', () => {
    const black = imageFingerprint(new Uint8Array(3072), 1)
    const white = imageFingerprint(new Uint8Array(3072).fill(255), 1)
    expect(imageSimilarity(black, black)).toBe(100)
    expect(imageSimilarity(black, white)).toBeLessThan(70)
    const ranked = rankImageMatches(Array.from({ length: 120 }, (_, index) => ({ path: String(index).padStart(3, '0'), score: index })))
    expect(ranked).toHaveLength(100)
    expect(ranked[0].score).toBe(119)
  })
})

it('opens only results authorized by this window and validates search options', async () => {
  registerImageSearch()
  const sender = { id: 1, once: vi.fn(), isDestroyed: () => false, send: vi.fn() }
  const other = { ...sender, id: 2 }
  const call = (name: string, ...args: unknown[]) => native.handlers.get(`image-search:${name}`)!({ sender }, ...args)
  native.selected = reference
  await call('pick-reference')
  native.selected = folder
  await call('pick-folder')
  const path = join(folder, 'copy.png')
  await writeFile(path, await readFile(reference))
  await expect(call('search', { ...options, minScore: NaN })).rejects.toThrow('参数')
  await call('search', options)
  await call('open-result', path, true)
  expect(native.reveal).toHaveBeenCalledWith(path)
  await expect(call('open-result', reference, false)).rejects.toThrow('当前查找结果')
  await expect(native.handlers.get('image-search:open-result')!({ sender: other }, path, false)).rejects.toThrow('当前查找结果')
  native.selected = ''
  expect(await call('pick-folder')).toBeNull()
  await call('open-result', path, false)
  expect(native.openPath).toHaveBeenCalledWith(path)
})
