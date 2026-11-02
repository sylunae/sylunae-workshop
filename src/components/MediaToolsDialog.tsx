import { useEffect, useRef, useState } from 'react'
import { CheckCircle2, Download, PackageOpen } from 'lucide-react'
import type { MediaToolsProgress, MediaToolsStatus } from '../shared/types'
import { Button } from './ui/button'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
} from './ui/alert-dialog'
import { Progress } from './ui/progress'

function readableError(error: unknown): string {
  if (!(error instanceof Error)) return '下载失败，请稍后重试。'
  return error.message.replace(/^Error invoking remote method '[^']+': Error: /, '').slice(0, 300)
}

function formatSize(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(0)} MB`
}

export function MediaToolsDialog({ open, onOpenChange, onReady, purpose = 'youtube' }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onReady?: () => void
  purpose?: 'youtube' | 'conversion'
}) {
  const [status, setStatus] = useState<MediaToolsStatus | null>(null)
  const [progress, setProgress] = useState<MediaToolsProgress | null>(null)
  const [installing, setInstalling] = useState(false)
  const [error, setError] = useState('')
  const completed = useRef(false)

  useEffect(() => window.sylunae?.music.onMediaToolsProgress(setProgress), [])
  useEffect(() => {
    if (!open || !window.sylunae) return
    completed.current = false
    setError('')
    setProgress(null)
    void window.sylunae.music.getMediaToolsStatus().then((next) => {
      setStatus(next)
      setInstalling(next.installing)
      if (next.ready && !completed.current) {
        completed.current = true
        setInstalling(false)
        onOpenChange(false)
        onReady?.()
      }
    }).catch((reason) => setError(readableError(reason)))
  }, [open])

  useEffect(() => {
    if (!open || !installing || !window.sylunae) return
    const checkCompletion = () => {
      void window.sylunae!.music.getMediaToolsStatus().then((next) => {
        setStatus(next)
        if (!next.ready || completed.current) return
        completed.current = true
        setInstalling(false)
        onOpenChange(false)
        onReady?.()
      }).catch(() => { /* The active installation call reports actionable errors. */ })
    }
    if (progress?.stage === 'complete') checkCompletion()
    const timer = window.setInterval(checkCompletion, 1000)
    return () => window.clearInterval(timer)
  }, [open, installing, progress?.stage, onOpenChange, onReady])

  const install = async () => {
    if (!window.sylunae) return
    completed.current = false
    setInstalling(true)
    setError('')
    try {
      const next = await window.sylunae.music.installMediaTools()
      setStatus(next)
      if (next.ready && !completed.current) {
        completed.current = true
        onOpenChange(false)
        onReady?.()
      }
    } catch (reason) {
      setError(readableError(reason))
    } finally {
      setInstalling(false)
    }
  }

  return <AlertDialog open={open} onOpenChange={(next) => { if (!installing) onOpenChange(next) }}>
    <AlertDialogContent className="media-tools-dialog">
      <AlertDialogHeader>
        <AlertDialogMedia>{status?.ready ? <CheckCircle2 /> : <PackageOpen />}</AlertDialogMedia>
        <AlertDialogTitle>下载媒体工具</AlertDialogTitle>
        <AlertDialogDescription>
          {purpose === 'conversion' ? '音视频格式转换需要 FFmpeg，将复用包含 FFmpeg 和 yt-dlp 的媒体工具包。' : 'YouTube 音频导入需要 FFmpeg 和 yt-dlp。'}工具只下载一次，保存在本机应用数据目录，不会加入备份。
        </AlertDialogDescription>
      </AlertDialogHeader>
      <div className="media-tools-summary">
        {(status?.components ?? []).map((component) => <div key={component.id}>
          <span><strong>{component.label}</strong><small>版本 {component.version}</small></span>
          <span className={component.installed ? 'installed' : ''}>{component.installed ? '已安装' : formatSize(component.installedBytes)}</span>
        </div>)}
        {!status && !error && <span className="media-tools-loading">正在检查本机组件…</span>}
      </div>
      {installing && <div className="media-tools-progress" aria-live="polite">
        <div><strong>{progress?.message || '正在准备下载…'}</strong><span>{progress?.percent === null || progress?.percent === undefined ? '' : `${progress.percent}%`}</span></div>
        <Progress value={progress?.percent ?? 0} className={progress?.percent === null ? 'indeterminate' : ''} />
        <small>请保持应用开启。下载完成后会进行 SHA-256 安全校验。</small>
      </div>}
      {error && <p className="media-tools-error">{error}</p>}
      <AlertDialogFooter>
        <AlertDialogCancel disabled={installing}>稍后再说</AlertDialogCancel>
        <Button onClick={() => void install()} disabled={installing || !status}>
          {installing ? <span className="spinner small" aria-hidden /> : <Download />}
          {installing ? '正在下载…' : error ? '重试下载' : '下载并启用'}
        </Button>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
}
