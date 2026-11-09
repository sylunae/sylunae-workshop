// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'

const native = vi.hoisted(() => ({ run: vi.fn(), pick: vi.fn(), exportFile: vi.fn(), appearance: vi.fn(), openExternal: vi.fn() }))
vi.mock('@capacitor/core', () => ({ Capacitor: { getPlatform: () => 'android', convertFileSrc: (uri: string) => `served:${uri}` }, registerPlugin: () => native }))
vi.mock('@capacitor/local-notifications', () => ({ LocalNotifications: {} }))
import { createAndroidAPI, decodeBytes, encodeBytes } from '../platform/android'

beforeEach(() => vi.clearAllMocks())

describe('Android file adapters', () => {
  it('keeps binary file bytes intact across the bridge, including chunk boundaries', () => {
    const bytes = Uint8Array.from({ length: 20_001 }, (_, i) => i % 256)
    expect(decodeBytes(encodeBytes(bytes))).toEqual(bytes)
  })
  it('imports HTTPS audio into native content-addressed storage rather than a desktop directory', async () => {
    const track = { id: 'hash', path: 'music/hash/song.mp3', title: 'Song' }
    native.run.mockImplementation(async ({ op }) => op === 'download' ? { path: track.path } : track)
    const api = createAndroidAPI(), progress: string[] = []
    const dispose = api.music.onImportProgress((event) => progress.push(event.stage))
    const result = await api.music.importRemote({ taskId: 'task', source: 'audio-url', url: 'https://example.com/song.mp3', directory: 'C:\\Music' })
    expect(result).toEqual(track)
    expect(native.run.mock.calls[0][0]).toMatchObject({ op: 'download', music: true, name: 'song.mp3', url: 'https://example.com/song.mp3' })
    expect(JSON.stringify(native.run.mock.calls)).not.toContain('C:\\\\Music')
    expect(progress).toEqual(['downloading', 'metadata', 'complete'])
    dispose()
  })
  it('rejects unsupported remote imports before starting a native download', async () => {
    const api = createAndroidAPI()
    await expect(api.music.importRemote({ taskId: 'task', source: 'audio-url', url: 'http://example.com/song.mp3', directory: '' })).rejects.toThrow('HTTPS')
    await expect(api.music.importRemote({ taskId: 'task', source: 'youtube', url: 'https://youtube.com', directory: '' })).rejects.toThrow('桌面')
    expect(native.run).not.toHaveBeenCalled()
  })
})
