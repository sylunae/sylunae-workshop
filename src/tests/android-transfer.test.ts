import { describe, expect, it, vi } from 'vitest'
import { mergeTransferredTracks } from '../music/transfer'
import { resolveAndroidFiles } from '../platform/transfer'
import { createDefaultSnapshot } from '../shared/defaults'
import type { MusicTrack } from '../shared/types'

function track(id: string, path: string, extra: Partial<MusicTrack> = {}): MusicTrack {
  return { id, path, title: 'Song', artist: 'Artist', album: 'Album', albumArtist: '', albumId: 'album-1', duration: 123, missing: false, cover: '', createdAt: '2026-01-01', updatedAt: '2026-01-01', ...extra }
}
const imported = track('phone', `music/${'a'.repeat(64)}/Song.mp3`, { albumId: null })

describe('desktop to Android file transfer', () => {
  it('reconnects a desktop path and preserves edited metadata and album identity', () => {
    const desktop = track('old-id', 'C:\\Music\\Song.mp3', { missing: true, title: 'My title', cover: 'my-cover' })
    const result = mergeTransferredTracks([desktop], [imported])
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ id: 'old-id', path: imported.path, missing: false, title: 'My title', albumId: 'album-1', createdAt: desktop.createdAt, cover: 'my-cover' })
    expect(desktop.path).toBe('C:\\Music\\Song.mp3')
  })
  it('does not guess when more than one desktop file can match', () => {
    const result = mergeTransferredTracks([track('one', 'C:\\A\\Song.mp3'), track('two', 'D:\\B\\Song.mp3')], [imported])
    expect(result).toHaveLength(3)
    expect(result[2]).toEqual(imported)
  })
  it('deduplicates repeated imports without overwriting an existing mobile track', () => {
    const edited = { ...imported, title: 'Edited' }
    expect(mergeTransferredTracks([edited], [imported, imported])).toEqual([edited])
  })
  it('does not reconnect a same-named file with a different duration', () => {
    const desktop = track('old', 'C:\\Music\\Song.mp3', { title: 'Different song', artist: 'Different artist', duration: 500 })
    expect(mergeTransferredTracks([desktop], [imported])).toHaveLength(2)
  })
  it('checks imported paths on this device rather than trusting desktop missing flags', async () => {
    const snapshot = createDefaultSnapshot()
    snapshot.tracks = [track('desktop', 'C:\\Music\\Song.mp3'), { ...imported, missing: true }]
    const check = vi.fn(async () => ({ [imported.path]: true }))
    const result = await resolveAndroidFiles(snapshot, check)
    expect(result.tracks.map((item) => item.missing)).toEqual([true, false])
    expect(snapshot.tracks[0].missing).toBe(false)
    expect(check).toHaveBeenCalledTimes(1)
  })
})
