// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import sharp from 'sharp'

const state = vi.hoisted(() => ({ handlers: new Map<string, (...args: any[]) => any>(), directory: '', ffmpeg: process.env.SYLUNAE_TEST_FFMPEG || '', destination: '', cancelSave: false }))
vi.mock('electron', () => ({
  app: { getPath: (name: string) => name === 'temp' ? tmpdir() : state.directory },
  ipcMain: { handle: (channel: string, handler: (...args: any[]) => any) => state.handlers.set(channel, handler) },
  dialog: {
    showSaveDialog: vi.fn(async () => ({ canceled: state.cancelSave, filePath: state.destination })),
    showOpenDialog: vi.fn(async () => ({ canceled: state.cancelSave, filePaths: [state.directory] })),
  },
}))
vi.mock('../../electron/main/mediaTools', () => ({ getFFmpegPath: () => state.ffmpeg || null }))
import { registerFormatConversion } from '../../electron/main/formatConversion'
const event = { sender: { id: 42, once: vi.fn() } }
const call = (channel: string, ...args: unknown[]) => state.handlers.get(`conversion:${channel}`)!(event, ...args)
const run = promisify(execFile)

let dispose: () => Promise<void>
beforeAll(async () => { state.directory = await mkdtemp(join(tmpdir(), 'sylunae-conversion-test-')); dispose = registerFormatConversion() })
afterAll(async () => { await dispose(); await rm(state.directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }) })

describe('native format conversion', () => {
  it('detects image contents even with a misleading extension and produces real image encodings', async () => {
    const path = join(state.directory, 'photo.txt')
    await sharp({ create: { width: 20, height: 12, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 0 } } }).png().toFile(path)
    const source = await call('inspect', path)
    expect(source.category).toBe('image'); expect(source.detected).toBe('PNG')
    expect(source.path).toBeUndefined()
    for (const format of ['jpg', 'png', 'webp', 'avif', 'gif', 'tiff']) {
      if (!source.targets.includes(format)) continue
      const result = await call('convert', source.id, format, 82)
      state.destination = join(state.directory, result.name)
      expect(await call('save', [result.id])).toBe(1)
      const metadata = await sharp(state.destination).metadata()
      expect(metadata.width).toBe(20); expect(metadata.height).toBe(12)
      expect(metadata.format).toBe(format === 'jpg' ? 'jpeg' : format === 'avif' ? 'heif' : format)
      if (format === 'jpg') {
        const { data } = await sharp(state.destination).raw().toBuffer({ resolveWithObject: true })
        expect([...data.subarray(0, 3)].every((channel) => channel >= 250)).toBe(true)
      }
      await call('release', [result.id])
      await expect(call('save', [result.id])).rejects.toThrow('无效')
    }
    await call('release', [source.id])
  })
  it('converts real UTF-8 files and saves batches without overwriting existing files', async () => {
    const path = join(state.directory, 'table.csv')
    await writeFile(path, '名称,备注\r\n丝月,"a,b"', 'utf8')
    const source = await call('inspect', path)
    const first = await call('convert', source.id, 'json', 82)
    const second = await call('convert', source.id, 'json', 82)
    await writeFile(join(state.directory, 'table.json'), 'existing')
    expect(await call('save', [first.id, second.id])).toBe(2)
    expect(await readFile(join(state.directory, 'table.json'), 'utf8')).toBe('existing')
    expect(JSON.parse(await readFile(join(state.directory, 'table (1).json'), 'utf8'))).toEqual([['名称', '备注'], ['丝月', 'a,b']])
    expect(await stat(join(state.directory, 'table (2).json'))).toBeTruthy()
    state.cancelSave = true
    expect(await call('save', [first.id])).toBe(0)
    state.cancelSave = false
    await call('release', [source.id, first.id, second.id])
  })
  it('does not offer table conversions for scalar JSON or trust renderer supplied targets', async () => {
    const path = join(state.directory, 'scalar.json'); await writeFile(path, '{"x":1}')
    const source = await call('inspect', path)
    expect(source.targets).not.toContain('csv'); expect(source.targets).not.toContain('tsv')
    await expect(call('convert', source.id, '../mp3', 82)).rejects.toThrow('无效')
    await expect(call('convert', source.id, 'txt', NaN)).rejects.toThrow('无效')
    await call('release', [source.id])
  })
})

describe.skipIf(!state.ffmpeg)('installed FFmpeg conversion integration', () => {
  it('extracts MP3 from MP4, handles other media formats, and reads BMP / ICO', async () => {
    const path = join(state.directory, 'clip.mp4')
    await run(state.ffmpeg, ['-nostdin', '-f', 'lavfi', '-i', 'color=c=blue:s=32x24:d=0.25', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=0.25', '-c:v', 'libx264', '-c:a', 'aac', '-shortest', path], { windowsHide: true })
    const source = await call('inspect', path)
    expect(source.category).toBe('video'); expect(source.targets).toContain('mp3')
    for (const target of source.targets) {
      const result = await call('convert', source.id, target, 82)
      state.destination = join(state.directory, result.name)
      await call('save', [result.id])
      const probe = await run(state.ffmpeg, ['-v', 'error', '-i', state.destination, '-f', 'null', '-'], { windowsHide: true })
      expect(probe.stderr).toBe('')
      await call('release', [result.id])
    }
    const silent = join(state.directory, 'silent.mp4')
    await run(state.ffmpeg, ['-i', path, '-an', '-c:v', 'copy', silent], { windowsHide: true })
    const silentSource = await call('inspect', silent)
    expect(silentSource.targets).not.toContain('mp3')
    expect(silentSource.targets).toContain('webm')
    const image = join(state.directory, 'icon.png')
    await sharp({ create: { width: 32, height: 32, channels: 4, background: '#ff0055' } }).png().toFile(image)
    const imageSource = await call('inspect', image)
    for (const target of ['bmp', 'ico']) {
      expect(imageSource.targets).toContain(target)
      const result = await call('convert', imageSource.id, target, 82)
      state.destination = join(state.directory, result.name); await call('save', [result.id])
      const roundtrip = await call('inspect', state.destination)
      const png = await call('convert', roundtrip.id, 'png', 82)
      expect(png.size).toBeGreaterThan(0)
      await call('release', [result.id, roundtrip.id, png.id])
    }
    await call('release', [source.id, silentSource.id, imageSource.id])
  }, 120_000)
})
