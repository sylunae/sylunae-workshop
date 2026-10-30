import type { MusicAlbum, MusicTrack } from '../shared/types'

const UNKNOWN_ALBUM = '未知专辑'

function albumKey(title: string): string {
  return title.normalize('NFKC').trim().toLocaleLowerCase()
}

function cleanAlbumTitle(title: string): string {
  const value = title.trim()
  return value && value !== UNKNOWN_ALBUM ? value : ''
}

export function reconcileMusicLibrary(tracks: MusicTrack[], albums: MusicAlbum[]): { tracks: MusicTrack[]; albums: MusicAlbum[] } {
  const now = new Date().toISOString()
  const nextAlbums = albums.map((album) => ({ ...album }))
  const byId = new Map(nextAlbums.map((album) => [album.id, album]))
  const byKey = new Map(nextAlbums.map((album) => [albumKey(album.title), album]))
  const used = new Set<string>()

  const nextTracks = tracks.map((source) => {
    const track = {
      ...source,
      albumArtist: source.albumArtist || '',
      albumId: source.albumId || null,
    }
    const title = cleanAlbumTitle(track.album)
    if (!title) return { ...track, albumId: null }

    let album = track.albumId ? byId.get(track.albumId) : undefined
    album ??= byKey.get(albumKey(title))
    if (!album) {
      album = {
        id: crypto.randomUUID(),
        title,
        artist: track.albumArtist || track.artist,
        cover: '',
        createdAt: now,
        updatedAt: now,
      }
      nextAlbums.push(album)
      byId.set(album.id, album)
      byKey.set(albumKey(title), album)
    }
    used.add(album.id)
    return { ...track, albumId: album.id }
  })

  const activeAlbums = nextAlbums.filter((album) => used.has(album.id) || album.keepEmpty).map((album) => {
    const albumTracks = nextTracks.filter((track) => track.albumId === album.id)
    const explicitArtist = albumTracks.find((track) => track.albumArtist)?.albumArtist
    const artists = new Set(albumTracks.map((track) => track.artist).filter((artist) => artist && artist !== '未知艺术家'))
    const artist = explicitArtist || (artists.size === 1 ? [...artists][0] : artists.size > 1 ? '群星' : '未知艺术家')
    return album.artist === artist ? album : { ...album, artist, updatedAt: now }
  })

  return { tracks: nextTracks, albums: activeAlbums }
}

export function albumCover(album: MusicAlbum, tracks: MusicTrack[]): string {
  return album.cover || tracks.find((track) => track.albumId === album.id && track.cover)?.cover || ''
}

export function trackCover(track: MusicTrack, albums: MusicAlbum[], tracks: MusicTrack[]): string {
  if (track.cover) return track.cover
  const album = track.albumId ? albums.find((item) => item.id === track.albumId) : undefined
  return album ? albumCover(album, tracks) : ''
}
