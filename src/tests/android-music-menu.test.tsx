// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createDefaultSnapshot } from '../shared/defaults'
import type { SylunaeAPI } from '../shared/types'

const state = vi.hoisted(() => ({ snapshot: null as unknown, update: vi.fn() }))
vi.mock('../app/AppStore', () => ({ useAppStore: () => state }))
vi.mock('../platform/environment', () => ({ isAndroid: true }))
vi.mock('../components/MusicImportDialog', () => ({ MusicImportDialog: () => null }))
vi.mock('../platform/player', () => ({
  nativePlayer: { addListener: vi.fn(async () => ({ remove: vi.fn() })) },
  playerCommand: vi.fn(async () => ({ id: null, playing: false, position: 0, duration: 0, volume: 0.8, shuffle: false, repeat: 'off' })),
  setNativeQueue: vi.fn(),
}))
import { MusicPage } from '../pages/MusicPage'

beforeEach(() => {
  const snapshot = createDefaultSnapshot()
  snapshot.tracks = [{ id: 'song', path: 'music/hash/song.mp3', title: 'Test song', artist: 'Artist', album: '', albumArtist: '', albumId: null, duration: 120, cover: '', missing: false, createdAt: '', updatedAt: '' }]
  state.snapshot = snapshot
  window.sylunae = { platform: 'android', music: { checkPaths: vi.fn(async () => ({ 'music/hash/song.mp3': true })), onImportProgress: vi.fn(() => () => {}) } } as unknown as SylunaeAPI
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  Element.prototype.scrollIntoView = vi.fn()
})
afterEach(() => { cleanup(); delete window.sylunae; vi.unstubAllGlobals() })

it('keeps one action trigger in each Android song row and exposes actions in the shared menu', async () => {
  const { container } = render(<MusicPage onNowPlayingChange={vi.fn()} onOpenWhiteNoise={vi.fn()} />)
  expect(container.querySelectorAll('.track-row .track-actions button')).toHaveLength(1)
  const trigger = screen.getByRole('button', { name: '更多歌曲操作：Test song' })
  fireEvent.keyDown(trigger, { key: 'ArrowDown' })
  expect(await screen.findByRole('menuitem', { name: '导出音频文件' })).toBeTruthy()
  expect(screen.getByRole('menuitem', { name: '编辑元信息' })).toBeTruthy()
  fireEvent.click(screen.getByRole('menuitem', { name: '移除索引' }))
  expect(await screen.findByRole('alertdialog')).toBeTruthy()
})
