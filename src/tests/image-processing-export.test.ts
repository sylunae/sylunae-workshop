// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

const state = vi.hoisted(() => ({ root: '', selected: '', handlers: new Map<string, (...args: any[]) => Promise<any>>(), openPath: vi.fn(async () => ''), dialog: vi.fn() }))
vi.mock('electron', () => ({
  app: { once: vi.fn(), getPath: (name: string) => join(state.root, name) },
  ipcMain: { handle: (name: string, handler: (...args: any[]) => Promise<any>) => state.handlers.set(name, handler) },
  dialog: { showOpenDialog: async (options: unknown) => { state.dialog(options); return { canceled: !state.selected, filePaths: state.selected ? [state.selected] : [] } } },
  shell: { openPath: state.openPath },
}))
const call = (name: string, ...args: unknown[]) => state.handlers.get(`image-processing:${name}`)!(undefined, ...args)

beforeEach(async () => {
  state.root = await mkdtemp(join(tmpdir(), 'sylunae-image-export-'))
  state.selected = ''
  state.handlers.clear()
  state.openPath.mockClear()
  state.dialog.mockClear()
  await mkdir(join(state.root, 'userData'))
  await mkdir(join(state.root, 'temp'))
  vi.resetModules()
  const { registerImageProcessing } = await import('../../electron/main/imageProcessing')
  registerImageProcessing()
})
afterEach(async () => { await rm(state.root, { recursive: true, force: true }) })

describe('desktop image output', () => {
  it('keeps concurrent exports distinct and never overwrites existing images', async () => {
    const bytes = new Uint8Array([1, 2, 3]).buffer
    const paths = await Promise.all([call('save', 'photo.png', bytes), call('save', 'photo.png', bytes), call('save', 'photo.png', bytes)])
    expect(new Set(paths).size).toBe(3)
    for (const path of paths) expect(await readFile(path)).toEqual(Buffer.from(bytes))
  })
  it('confines filenames to the chosen folder and rejects invalid payloads', async () => {
    const directory = await call('get-directory')
    const path = await call('save', '../escape.png', new Uint8Array([1]).buffer)
    expect(dirname(path)).toBe(directory)
    await expect(call('save', 'bad.exe', new Uint8Array([1]).buffer)).rejects.toThrow('无效')
    await expect(call('save', 'bad.png', new ArrayBuffer(0))).rejects.toThrow('无效')
  })
  it('remembers the selected output directory and opens it', async () => {
    state.selected = join(state.root, 'chosen')
    expect(await call('pick-directory')).toBe(state.selected)
    expect(JSON.parse(await readFile(join(state.root, 'userData', 'image-processing.json'), 'utf8')).directory).toBe(state.selected)
    vi.resetModules()
    const { registerImageProcessing } = await import('../../electron/main/imageProcessing')
    registerImageProcessing()
    expect(await call('get-directory')).toBe(state.selected)
    await call('open-directory')
    expect(state.openPath).toHaveBeenCalledWith(state.selected)
    expect(await readdir(state.selected)).toEqual([])
  })
  it('scans recursively on request and stages original files until explicit download', async () => {
    state.selected = join(state.root, 'source')
    await mkdir(join(state.selected, 'nested'), { recursive: true })
    await writeFile(join(state.selected, 'same.png'), Buffer.from([1, 2, 3]))
    await writeFile(join(state.selected, 'nested', 'same.png'), Buffer.from([4, 5]))
    await writeFile(join(state.selected, 'notes.txt'), 'skip')
    expect(await call('pick-folder')).toMatchObject({ count: 1, bytes: 3, recursive: false, formats: { PNG: 1 } })
    expect(await call('scan-folder', true)).toMatchObject({ count: 2, bytes: 5, recursive: true })
    expect(await call('process-folder', 'image/webp', 'original')).toEqual({ count: 2, bytes: 5, errors: [] })
    const destination = join(state.root, 'download')
    expect(await readdir(state.selected)).toHaveLength(3)
    state.selected = destination
    await call('pick-directory')
    expect(state.dialog).toHaveBeenLastCalledWith(expect.objectContaining({ defaultPath: join(state.root, 'source') }))
    expect(await call('save-folder')).toEqual({ count: 2, errors: [] })
    expect((await readdir(destination)).sort()).toEqual(['same (1).png', 'same.png'])
    expect((await Promise.all(['same.png', 'same (1).png'].map(async (name) => [...await readFile(join(destination, name))]))).sort()).toEqual([[1, 2, 3], [4, 5]])
  })
  it('converts folder images, reports corrupt files, and never overwrites input', async () => {
    const { default: sharp } = await import('sharp')
    state.selected = join(state.root, 'source')
    await mkdir(state.selected)
    await sharp({ create: { width: 8, height: 8, channels: 4, background: '#fff' } }).png().toFile(join(state.selected, 'valid.png'))
    await writeFile(join(state.selected, 'broken.png'), 'invalid')
    await call('pick-folder')
    const output = await call('process-folder', 'image/webp', 'strong')
    expect(output.count).toBe(1)
    expect(output.errors).toHaveLength(1)
    expect(await readdir(state.selected)).toHaveLength(2)
    state.selected = join(state.root, 'output')
    await call('pick-directory')
    await call('save-folder')
    expect((await sharp(await readFile(join(state.selected, 'valid.webp'))).metadata()).format).toBe('webp')
  })
  it('keeps the previous directory when the picker is cancelled', async () => {
    const original = await call('get-directory')
    expect(await call('pick-directory')).toBeNull()
    expect(await call('get-directory')).toBe(original)
  })
})
