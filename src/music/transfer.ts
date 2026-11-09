import type { MusicTrack } from '../shared/types'

const basename = (path: string) => path.replace(/\\/g, '/').split('/').at(-1)?.normalize('NFKC').toLocaleLowerCase() ?? ''
const text = (value: string) => value.normalize('NFKC').trim().toLocaleLowerCase()
export const isPrivateMusicPath = (path: string) => /^music\/[a-f0-9]{64}\/[^/]+$/.test(path)

/** Reconnect an unambiguous desktop index without losing its album assignment or edits. */
export function mergeTransferredTracks(existing: MusicTrack[], imported: MusicTrack[]): MusicTrack[] {
  const result = [...existing]
  for (const track of imported) {
    const exact = result.findIndex((entry) => entry.path === track.path)
    if (exact !== -1) {
      if (result[exact].missing) result[exact] = { ...result[exact], missing: false }
      continue
    }
    const candidates = result.filter((entry) => !isPrivateMusicPath(entry.path) && (
      basename(entry.path) === basename(track.path) && (entry.duration === 0 || track.duration === 0 || Math.abs(entry.duration - track.duration) < 2) ||
      text(entry.title) === text(track.title) && text(entry.artist) === text(track.artist) && Math.abs(entry.duration - track.duration) < 2
    ))
    if (candidates.length === 1) {
      const old = candidates[0]
      result[result.indexOf(old)] = { ...track, ...old, path: track.path, missing: false, duration: track.duration, cover: old.cover || track.cover, updatedAt: new Date().toISOString() }
    } else result.push(track)
  }
  return result
}
