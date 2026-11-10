// @vitest-environment node
import { createHash } from 'node:crypto'
import { afterEach, expect, it, vi } from 'vitest'
import { createAndroidDriveBackup } from '../platform/androidDriveBackup'
import type { NativeCall } from '../platform/androidStorage'
import { createDefaultSnapshot } from '../shared/defaults'
import { driveBackupFormat, driveSectionKeys, type DriveObject } from '../shared/driveBackup'

const native = vi.hoisted(() => ({
  latest: vi.fn(), download: vi.fn(), materialize: vi.fn(), space: vi.fn(),
}))
vi.mock('@capacitor/core', () => ({
  Capacitor: { convertFileSrc: (uri: string) => uri },
  registerPlugin: () => native,
}))
afterEach(() => vi.unstubAllGlobals())

it('restores an entire version from separate objects and translates its attachment, image, and music references', async () => {
  const snapshot = createDefaultSnapshot()
  const now = snapshot.settings.updatedAt
  const bodies = new Map<string, string>()
  const object = (text: string, mime = 'application/json'): DriveObject => {
    const sha256 = createHash('sha256').update(text).digest('hex')
    const id = 'object-' + sha256
    bodies.set(id, text)
    return { id, sha256, size: Buffer.byteLength(text), mime }
  }
  const picture = object('picture-bytes', 'image/png')
  const music = object('music-bytes', 'audio/mpeg')
  const noteRef = 'sylunae-drive:note:' + picture.sha256
  const imageRef = 'sylunae-drive:path:' + picture.sha256 + '.png'
  const musicRef = 'sylunae-drive:path:' + music.sha256 + '.mp3'
  snapshot.notes = [{
    id: 'note', title: '测试笔记', folderId: null, tags: [], pinned: false, deletedAt: null, createdAt: now, updatedAt: now,
    content: { type: 'doc', content: [{ type: 'image', attrs: { src: noteRef } }] },
  }]
  snapshot.tracks = [{
    id: 'track', path: musicRef, title: '测试音乐', artist: '', album: '', albumArtist: '', albumId: null, duration: 1,
    cover: 'sylunae-drive:inline:' + picture.sha256 + '.png', missing: false, createdAt: now, updatedAt: now,
  }]
  snapshot.imageLibrary.assets = [{
    id: 'picture', path: imageRef, name: '测试原图', rootId: null, collectionIds: [], relativePath: 'test.png',
    extension: '.png', size: picture.size, mtimeMs: 0, width: 1, height: 1, aspectType: 'square', identity: 'picture',
    hash: picture.sha256, missing: false, metadata: {}, createdAt: now, updatedAt: now,
  }]
  const payloads = { ...snapshot, customWhiteNoise: [{ id: 'custom', title: '音效', localPath: musicRef, duration: 1, size: music.size }] }
  const manifest = object(JSON.stringify({
    format: driveBackupFormat, version: 1, createdAt: now, device: 'desktop',
    sections: Object.fromEntries(driveSectionKeys.map((key) => [key, object(JSON.stringify(payloads[key]))])),
    media: [picture, music], counts: { notes: 1, images: 1, tracks: 1 },
  }))
  const uri = (id: string) => 'https://localhost/' + id
  vi.stubGlobal('fetch', async (url: string) => new Response(bodies.get(url.split('/').at(-1)!) ?? null))
  native.latest.mockResolvedValue({ id: manifest.id, uri: uri(manifest.id) })
  native.download.mockImplementation(async (entry: DriveObject) => ({ uri: uri(entry.id) }))
  native.space.mockResolvedValue({ bytes: 1_000_000, needed: 1_000 })
  native.materialize.mockImplementation(async ({ sha256, kind, extension }) => ({
    path: 'drive-media/' + sha256 + extension,
    uri: 'https://localhost/_capacitor_file_/drive-media/' + sha256 + extension,
    kind,
  }))
  const storage = vi.fn()
  const backup = createAndroidDriveBackup(storage as unknown as NativeCall)
  if (backup.mode !== 'restore') throw new Error('Wrong platform')
  expect(await backup.latest()).toMatchObject({ id: manifest.id, device: 'desktop', counts: { notes: 1, images: 1, tracks: 1 } })
  const restore = await backup.download(manifest.id, () => {})
  expect(restore.snapshot.notes[0].content.content?.[0].attrs?.src).toBe('sylunae-note-asset:' + picture.sha256)
  expect(restore.snapshot.tracks[0].path).toBe('drive-media/' + music.sha256 + '.mp3')
  expect(restore.snapshot.tracks[0].cover).toBe('/_capacitor_file_/drive-media/' + picture.sha256 + '.png')
  expect(restore.snapshot.imageLibrary.assets[0].path).toBe('drive-media/' + picture.sha256 + '.png')
  expect(restore.whiteNoise[0].localPath).toBe(restore.snapshot.tracks[0].path)
  expect(native.download.mock.calls.filter(([entry]) => entry.sha256 === picture.sha256)).toHaveLength(1)

  native.download.mockImplementation(async (entry: DriveObject) => {
    if (entry.id === music.id) throw new Error('摘要校验失败')
    return { uri: uri(entry.id) }
  })
  await expect(backup.download(manifest.id, () => {})).rejects.toThrow('摘要校验失败')
  expect(storage).not.toHaveBeenCalled()
})
