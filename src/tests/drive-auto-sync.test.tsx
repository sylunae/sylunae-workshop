// @vitest-environment jsdom
import { createHash, randomUUID } from 'node:crypto'
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useDriveSync } from '../app/useDriveSync'
import { createDefaultSnapshot } from '../shared/defaults'
import type { AppSnapshot, SylunaeAPI } from '../shared/types'
import type { DriveBackupInfo, DrivePublishGuard } from '../shared/driveBackup'

const account = { id: 'account', label: 'test' }
const revision = (id: string, ancestors: string[] = [], writeId?: string): DriveBackupInfo => ({
  id, ancestors, writeId, createdAt: '2026-11-11T00:00:00.000Z', device: 'test',
  counts: { notes: 0, tracks: 0, images: 0 }, bytes: 0,
})

function setup() {
  let local = createDefaultSnapshot()
  let cloud: DriveBackupInfo | null = null
  let close: (() => Promise<void>) | undefined
  const upload = vi.fn(async (_token: string, _progress: unknown, guard: DrivePublishGuard) => {
    cloud = revision('published', guard.head ? [guard.head] : [], guard.writeId)
    return { id: cloud.id, createdAt: cloud.createdAt, uploaded: 1, reused: 0 }
  })
  const download = vi.fn(async () => ({ snapshot: createDefaultSnapshot(), whiteNoise: [] }))
  const prepare = vi.fn(async (_snapshot: AppSnapshot) => ({
    token: 'token', account, missing: [], uploadFiles: 1, uploadBytes: 1, reuseFiles: 0, notes: 0, tracks: 0, images: 0,
  }))
  window.sylunae = {
    driveBackup: { account: async () => account, latest: async () => cloud, download, prepare, upload },
    resources: { list: async () => ({ items: [] }) },
    system: { onBeforeClose: (listener: () => Promise<void>) => { close = listener; return () => { close = undefined } } },
  } as unknown as SylunaeAPI
  const flush = async () => local
  const replace = vi.fn(async (_expected: AppSnapshot, installed: AppSnapshot) => {
    local = installed
    return installed
  })
  const { result, rerender } = renderHook(({ snapshot }) => useDriveSync(snapshot, flush, replace), { initialProps: { snapshot: local } })
  const edit = (displayName: string) => {
    local = { ...local, settings: { ...local.settings, displayName } }
    rerender({ snapshot: local })
    window.dispatchEvent(new Event('sylunae:note-edited'))
  }
  return {
    upload, download, prepare, replace, result, edit,
    close: () => close!(),
    setCloud: (value: DriveBackupInfo) => { cloud = value },
    enable: async () => {
      act(() => result.current.setEnabled(true))
      await advance(0)
    },
  }
}

const advance = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms) })
beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('crypto', {
    subtle: { digest: async (_algorithm: string, data: Uint8Array) => createHash('sha256').update(data).digest() },
    randomUUID,
  })
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
  localStorage.clear()
})
afterEach(() => {
  cleanup()
  delete window.sylunae
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

it('uploads during continuous editing and flushes the last edit on normal close', async () => {
  const sync = setup()
  await sync.enable()
  expect(sync.upload).toHaveBeenCalledTimes(1)
  sync.upload.mockClear()
  for (let i = 0; i < 15; i++) {
    act(() => sync.edit('edit ' + i))
    await advance(4_000)
  }
  expect(sync.upload).toHaveBeenCalledTimes(1)
  expect(sync.prepare.mock.lastCall?.[0].settings.displayName).toBe('edit 14')
  act(() => sync.edit('last edit'))
  await act(sync.close)
  expect(sync.upload).toHaveBeenCalledTimes(2)
  expect(sync.prepare.mock.lastCall?.[0].settings.displayName).toBe('last edit')
})

it('applies a descendant to a clean device but preserves both sides after divergence', async () => {
  const sync = setup()
  await sync.enable()
  sync.setCloud(revision('other-device', ['published']))
  await advance(60_000)
  expect(sync.replace).toHaveBeenCalledTimes(1)
  act(() => sync.edit('local edit'))
  sync.setCloud(revision('other-edit', ['other-device']))
  await advance(5_000)
  expect(sync.result.current.status.phase).toBe('conflict')
  expect(sync.replace).toHaveBeenCalledTimes(1)
  expect(sync.upload).toHaveBeenCalledTimes(1)
})

it('recognizes a published snapshot when the upload acknowledgment is lost', async () => {
  const sync = setup()
  sync.upload.mockImplementationOnce(async (_token, _progress, guard) => {
    sync.setCloud(revision('published', [], guard.writeId))
    throw new Error('Connection lost')
  })
  await sync.enable()
  expect(sync.result.current.status.phase).toBe('retry')
  await advance(60_000)
  expect(sync.result.current.status.phase).toBe('idle')
  expect(sync.result.current.lastSyncedAt).toBeTruthy()
  expect(sync.upload).toHaveBeenCalledTimes(1)
})
