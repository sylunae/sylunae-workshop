export interface OnlineMusicLink {
  url: string
  title?: string
}

export function youtubeVideoUrl(input: string): string | null {
  try {
    const url = new URL(input.trim())
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.port) return null
    const [, route, videoId] = url.pathname.split('/')
    const id = url.hostname === 'youtu.be' ? route
      : ['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com'].includes(url.hostname)
        ? route === 'watch' ? url.searchParams.get('v') : ['shorts', 'live', 'embed'].includes(route) ? videoId : null
        : null
    return id && /^[\w-]{11}$/.test(id) ? `https://www.youtube.com/watch?v=${id}` : null
  } catch {
    return null
  }
}

export function rememberOnlineMusicLink(recent: OnlineMusicLink[], entry: OnlineMusicLink): OnlineMusicLink[] {
  const previous = recent.find(({ url }) => url === entry.url)
  return [{ ...previous, ...entry }, ...recent.filter(({ url }) => url !== entry.url)].slice(0, 5)
}
