import { useEffect, useId, useRef, useState } from 'react'
import { ArrowLeft, Clock3, FileAudio, FolderOpen, Link2, Search, Video } from 'lucide-react'
import type { MusicImportProgress, MusicImportStage, MusicRemoteSource, MusicTrack, YoutubeVideoSearchResult } from '../shared/types'
import { Button } from './ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog'
import { Input } from './ui/input'
import { Progress } from './ui/progress'
import { MediaToolsDialog } from './MediaToolsDialog'

type ImportStep = 'choose' | MusicRemoteSource

const methodCopy: Record<MusicRemoteSource, { title: string; description: string; placeholder: string }> = {
  youtube: {
    title: '从 YouTube 链接导入',
    description: '下载视频中的最佳音频，转换为 MP3，并写入可获取的标题、作者与封面等信息。',
    placeholder: 'https://www.youtube.com/watch?v=…',
  },
  'audio-url': {
    title: '从音频链接下载',
    description: '把 HTTP 或 HTTPS 音频文件下载到本地，再加入音乐资料库。',
    placeholder: 'https://example.com/music.mp3',
  },
}

function readableError(error: unknown): string {
  if (!(error instanceof Error)) return '导入失败，请稍后重试。'
  const message = error.message.replace(/^Error invoking remote method '[^']+': Error: /, '')
  const lines = message.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  const useful = [...lines].reverse().find((line) => /^ERROR:/i.test(line)) || lines.at(-1)
  return useful?.replace(/^ERROR:\s*/i, '').slice(0, 400) || '导入失败，请稍后重试。'
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function formatDuration(seconds: number | null): string {
  if (seconds === null) return ''
  const minutes = Math.floor(seconds / 60)
  const remainder = Math.floor(seconds % 60).toString().padStart(2, '0')
  return `${minutes}:${remainder}`
}

const youtubeStages: Array<{ stage: Exclude<MusicImportStage, 'complete'>; label: string }> = [
  { stage: 'reading', label: '读取信息' },
  { stage: 'downloading', label: '下载音频' },
  { stage: 'converting', label: '转换 MP3' },
  { stage: 'metadata', label: '写入信息' },
]

export function MusicImportDialog({ open, onOpenChange, onImported }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onImported: (tracks: MusicTrack[]) => void
}) {
  const inputId = useId()
  const [step, setStep] = useState<ImportStep>('choose')
  const [url, setUrl] = useState('')
  const [directory, setDirectory] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [progress, setProgress] = useState<MusicImportProgress | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<YoutubeVideoSearchResult[]>([])
  const [searching, setSearching] = useState(false)
  const [searched, setSearched] = useState(false)
  const [mediaToolsOpen, setMediaToolsOpen] = useState(false)
  const activeTaskId = useRef<string | null>(null)

  useEffect(() => window.sylunae?.music.onImportProgress((next) => {
    if (next.taskId === activeTaskId.current) setProgress(next)
  }), [])

  useEffect(() => {
    if (!open || !window.sylunae) return
    setStep('choose')
    setUrl('')
    setError('')
    setProgress(null)
    setSearchQuery('')
    setSearchResults([])
    setSearched(false)
    activeTaskId.current = null
    void window.sylunae.music.getDownloadDirectory().then(setDirectory).catch((reason) => setError(readableError(reason)))
  }, [open])

  const importFiles = async () => {
    if (!window.sylunae) return
    setError('')
    try {
      const tracks = await window.sylunae.music.pick()
      if (tracks.length) { onImported(tracks); onOpenChange(false) }
    } catch (reason) { setError(readableError(reason)) }
  }

  const chooseDirectory = async () => {
    if (!window.sylunae) return
    setError('')
    try {
      const selected = await window.sylunae.music.pickDownloadDirectory(directory)
      if (selected) setDirectory(selected)
    } catch (reason) { setError(readableError(reason)) }
  }

  const chooseYoutube = async () => {
    if (!window.sylunae) return
    setError('')
    try {
      const status = await window.sylunae.music.getMediaToolsStatus()
      if (status.ready) setStep('youtube')
      else setMediaToolsOpen(true)
    } catch (reason) {
      setError(readableError(reason))
    }
  }

  const searchYoutube = async () => {
    if (!window.sylunae || !searchQuery.trim() || searching) return
    setSearching(true)
    setSearched(true)
    setError('')
    setSearchResults([])
    try {
      setSearchResults(await window.sylunae.music.searchYoutube(searchQuery))
    } catch (reason) {
      setError(readableError(reason))
    } finally {
      setSearching(false)
    }
  }

  const selectYoutubeResult = (video: YoutubeVideoSearchResult) => {
    setUrl(video.url)
    setError('')
  }

  const importRemote = async () => {
    if (!window.sylunae || step === 'choose') return
    const cleanUrl = url.trim()
    if (!cleanUrl) { setError('请输入链接'); return }
    try {
      const parsed = new URL(cleanUrl)
      if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error()
    } catch { setError('请输入有效的 HTTP 或 HTTPS 链接'); return }
    if (!directory) { setError('请先选择文件保存位置'); return }
    const taskId = crypto.randomUUID()
    activeTaskId.current = taskId
    setBusy(true)
    setError('')
    setProgress(null)
    try {
    const track = await window.sylunae.music.importRemote({ taskId, source: step, url: cleanUrl, directory })
      onImported([track])
      onOpenChange(false)
    } catch (reason) {
      setError(readableError(reason))
    } finally {
      activeTaskId.current = null
      setBusy(false)
    }
  }

  const copy = step === 'choose' ? null : methodCopy[step]

  return <Dialog open={open} onOpenChange={(next) => { if (!busy) onOpenChange(next) }}>
    <DialogContent className="music-import-dialog" size="md">
      {step === 'choose' ? <>
        <DialogHeader>
          <DialogTitle>添加音乐</DialogTitle>
          <DialogDescription>选择一种方式加入音乐资料库。</DialogDescription>
        </DialogHeader>
        <div className="music-import-methods">
          <button type="button" onClick={() => void importFiles()}>
            <span><FileAudio /></span>
            <div><strong>从文件导入</strong><small>选择电脑中已有的一个或多个音频文件</small></div>
          </button>
          <button type="button" onClick={() => void chooseYoutube()}>
            <span><Video /></span>
            <div><strong>从 YouTube 链接导入</strong><small>转换为 MP3，并提取视频元信息</small></div>
          </button>
          <button type="button" onClick={() => setStep('audio-url')}>
            <span><Link2 /></span>
            <div><strong>从音频链接下载</strong><small>下载在线音频文件并保存在本地</small></div>
          </button>
        </div>
        {error && <p className="music-import-error">{error}</p>}
      </> : <>
        <DialogHeader className="music-import-header">
          <button type="button" className="music-import-back" onClick={() => { setStep('choose'); setError('') }} disabled={busy} aria-label="返回导入方式"><ArrowLeft /></button>
          <div><DialogTitle>{copy?.title}</DialogTitle><DialogDescription>{copy?.description}</DialogDescription></div>
        </DialogHeader>
        <div className="music-import-form">
          {step === 'youtube' && <>
            <label htmlFor="youtube-search-query">搜索 YouTube 视频</label>
            <div className="youtube-search-row">
              <Input id="youtube-search-query" value={searchQuery} onChange={(event) => { setSearchQuery(event.target.value); setSearchResults([]); setSearched(false); setError('') }} onKeyDown={(event) => { if (event.key === 'Enter' && !searching) void searchYoutube() }} placeholder="搜索歌曲、歌手或视频标题" disabled={searching || busy} />
              <Button type="button" variant="outline" onClick={() => void searchYoutube()} disabled={searching || busy || !searchQuery.trim()}>{searching ? <span className="spinner small" aria-hidden /> : <Search size={16} />}{searching ? '搜索中' : '搜索'}</Button>
            </div>
            {searchResults.length > 0 && <div className="youtube-search-results" aria-label="YouTube 搜索结果">
              {searchResults.map((video) => <button type="button" key={video.id} className={`youtube-search-result ${url === video.url ? 'selected' : ''}`} onClick={() => selectYoutubeResult(video)} disabled={busy} aria-pressed={url === video.url}>
                <span className="youtube-search-copy"><strong>{video.title}</strong><small>{video.channel || 'YouTube'}{video.duration !== null && <> · <Clock3 size={12} /> {formatDuration(video.duration)}</>}</small></span>
                {url === video.url && <span className="youtube-search-selected">已选择</span>}
              </button>)}
            </div>}
            {searchResults.length === 0 && !searching && searched && <p className="music-import-hint">没有找到视频。你可以换个关键词，或直接粘贴视频链接。</p>}
          </>}
          <label htmlFor={inputId}>链接</label>
          <Input id={inputId} autoFocus value={url} onChange={(event) => { setUrl(event.target.value); setError('') }} onKeyDown={(event) => { if (event.key === 'Enter' && !busy) void importRemote() }} placeholder={copy?.placeholder} disabled={busy} />
          <label>文件保存位置</label>
          <button type="button" className="music-import-directory" onClick={() => void chooseDirectory()} disabled={busy} title={directory || '选择文件保存位置'}>
            <FolderOpen /><span>{directory || '正在读取默认位置…'}</span><strong>更改</strong>
          </button>
          <p className="music-import-hint">下载完成后会自动加入资料库。默认保存在丝月工坊的应用数据文件夹中。</p>
          {busy && progress && <div className="music-import-progress" aria-live="polite">
            <div className="music-import-progress-label"><strong>{progress.message}</strong>{progress.source === 'audio-url' && <span>{progress.percent === null ? (progress.receivedBytes ? formatBytes(progress.receivedBytes) : '') : `${progress.percent}%`}</span>}</div>
            {progress.source === 'audio-url' ? <>
              <Progress value={progress.percent ?? 0} className={progress.percent === null ? 'indeterminate' : ''} />
              {progress.receivedBytes !== undefined && <small>{formatBytes(progress.receivedBytes)}{progress.totalBytes ? ` / ${formatBytes(progress.totalBytes)}` : ' · 服务器未提供文件大小'}</small>}
            </> : <div className="music-import-stages">
              {youtubeStages.map((item, index) => {
                const currentIndex = progress.stage === 'complete' ? youtubeStages.length : youtubeStages.findIndex((candidate) => candidate.stage === progress.stage)
                const state = index < currentIndex ? 'done' : index === currentIndex ? 'active' : ''
                return <span key={item.stage} className={state}>{item.label}</span>
              })}
            </div>}
          </div>}
          {error && <p className="music-import-error">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>取消</Button>
          <Button onClick={() => void importRemote()} disabled={busy || !url.trim() || !directory}>
            {busy && <span className="spinner small" aria-hidden />}{busy ? '正在处理…' : '下载并导入'}
          </Button>
        </DialogFooter>
      </>}
    </DialogContent>
    <MediaToolsDialog open={mediaToolsOpen} onOpenChange={setMediaToolsOpen} onReady={() => setStep('youtube')} />
  </Dialog>
}
