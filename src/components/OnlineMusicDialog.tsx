import { useState } from 'react'
import { Play } from 'lucide-react'
import { usePersistentState } from '../lib/usePersistentState'
import { rememberOnlineMusicLink, youtubeVideoUrl, type OnlineMusicLink } from '../music/online'
import type { SylunaeAPI } from '../shared/types'
import { MediaToolsDialog } from './MediaToolsDialog'
import { Button } from './ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog'
import { Input } from './ui/input'

export type ResolvedOnlineMusic = Awaited<ReturnType<NonNullable<SylunaeAPI['music']['resolveYoutubeAudio']>>>

export function OnlineMusicDialog({ open, onOpenChange, onPlay }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onPlay: (url: string, music: ResolvedOnlineMusic) => void
}) {
  const [input, setInput] = useState('')
  const [recent, setRecent] = usePersistentState<OnlineMusicLink[]>('music.onlineRecent', [])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [mediaToolsOpen, setMediaToolsOpen] = useState(false)

  const play = async (value: string) => {
    const resolve = window.sylunae?.music.resolveYoutubeAudio
    if (!resolve || busy) return
    const url = youtubeVideoUrl(value)
    setInput(value)
    if (!url) { setError('请输入有效的 YouTube 视频链接'); return }
    setRecent((entries) => rememberOnlineMusicLink(entries, { url }))
    setError('')
    setBusy(true)
    try {
      const music = await resolve(url)
      setRecent((entries) => rememberOnlineMusicLink(entries, { url, title: music.title }))
      onPlay(url, music)
      onOpenChange(false)
    } catch (reason) {
      const message = reason instanceof Error ? reason.message.replace(/^Error invoking remote method '[^']+': Error: /, '') : ''
      if (message === 'MEDIA_TOOLS_REQUIRED') setMediaToolsOpen(true)
      else setError(message || '无法打开在线音乐，请重试。')
    } finally {
      setBusy(false)
    }
  }

  return <>
    <Dialog open={open} onOpenChange={(next) => { if (!busy) { setError(''); onOpenChange(next) } }}>
      <DialogContent className="music-import-dialog" size="md">
        <DialogHeader>
          <DialogTitle>在线音乐</DialogTitle>
          <DialogDescription>粘贴 YouTube 视频链接，临时串流播放。</DialogDescription>
        </DialogHeader>
        <form className="music-import-form" onSubmit={(event) => { event.preventDefault(); void play(input) }}>
          <label htmlFor="online-music-url">YouTube 链接</label>
          <Input id="online-music-url" value={input} onChange={(event) => { setInput(event.target.value); setError('') }} placeholder="https://www.youtube.com/watch?v=…" disabled={busy} />
          {recent.length > 0 && <>
            <label id="online-music-recent">最近链接</label>
            <div className="youtube-search-results" role="group" aria-labelledby="online-music-recent">
              {recent.map(({ url, title }) => <button type="button" key={url} className="youtube-search-result" onClick={() => void play(url)} disabled={busy}>
                <span className="youtube-search-copy"><strong>{title || url}</strong>{title && <small>{url}</small>}</span>
                <Play size={15} aria-hidden />
              </button>)}
            </div>
          </>}
          {error && <p className="music-import-error" role="alert">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>取消</Button>
            <Button type="submit" disabled={busy || !input.trim()}>{busy ? '正在读取…' : '播放'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
    <MediaToolsDialog open={mediaToolsOpen} onOpenChange={setMediaToolsOpen} onReady={() => void play(input)} />
  </>
}
