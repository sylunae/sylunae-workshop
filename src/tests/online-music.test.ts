import { describe, expect, it } from 'vitest'
import { rememberOnlineMusicLink, youtubeVideoUrl } from '../music/online'

describe('online music links', () => {
  const canonical = 'https://www.youtube.com/watch?v=aqz-KE-bpKQ'

  it('normalizes alternate links and strips playlist and tracking parameters', () => {
    expect(youtubeVideoUrl(' https://youtu.be/aqz-KE-bpKQ?si=example ')).toBe(canonical)
    expect(youtubeVideoUrl('https://music.youtube.com/watch?v=aqz-KE-bpKQ&list=RD123')).toBe(canonical)
  })

  it('rejects unrelated hosts and links without a video', () => {
    expect(youtubeVideoUrl('https://www.youtube.com.example.org/watch?v=aqz-KE-bpKQ')).toBeNull()
    expect(youtubeVideoUrl('https://www.youtube.com/playlist?list=123')).toBeNull()
  })

  it('keeps five distinct links and preserves the title when replaying one', () => {
    const recent = Array.from({ length: 5 }, (_, index) => ({ url: `video-${index}`, title: `Title ${index}` }))
    const replayed = rememberOnlineMusicLink(recent, { url: 'video-2' })
    expect(replayed[0]).toEqual(recent[2])
    expect(replayed).toHaveLength(5)
    expect(rememberOnlineMusicLink(replayed, { url: canonical }).map(({ url }) => url))
      .toEqual([canonical, 'video-2', 'video-0', 'video-1', 'video-3'])
  })
})
