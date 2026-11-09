import { useEffect, useState } from 'react'
import { Download, RotateCw } from 'lucide-react'
import { useAppStore } from '../app/AppStore'
import type { AppUpdateStatus } from '../shared/types'
import { Button } from './ui/button'

export function DesktopUpdate({ titlebar = false }: { titlebar?: boolean }) {
  const api = window.sylunae?.updates
  const { flush } = useAppStore()
  const [status, setStatus] = useState<AppUpdateStatus>({ phase: 'idle' })
  const [preparing, setPreparing] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!api) return
    let useInitialStatus = true
    const unsubscribe = api.onStatus((next) => {
      useInitialStatus = false
      setStatus(next)
    })
    void api.getStatus().then((initial) => {
      if (useInitialStatus) setStatus(initial)
    }).catch(() => {
      if (useInitialStatus) setStatus({ phase: 'error' })
    })
    return () => { useInitialStatus = false; unsubscribe() }
  }, [api])

  if (!api) return null
  const install = async () => {
    setPreparing(true)
    setError('')
    try {
      if (!await flush()) throw new Error('本地数据尚未就绪')
    } catch {
      setError('保存失败，请稍后重试更新。')
      setPreparing(false)
      return
    }
    try {
      if (!await api.install()) setError('更新尚未准备好，请稍后重试。')
    } catch {
      setError('无法启动安装，请稍后重试。')
    } finally {
      setPreparing(false)
    }
  }

  const { phase } = status
  const installLabel = preparing ? '正在保存…' : phase === 'installing' ? '正在重启…' : '重启并更新'
  if (titlebar) {
    if (phase !== 'ready' && phase !== 'installing') return null
    return <Button size="sm" variant="outline" className="desktop-update-titlebar" disabled={preparing || phase === 'installing'} title={error || `更新至 v${status.version}`} onClick={() => void install()}>
      <Download aria-hidden="true" /><span>{error ? '更新失败，重试' : installLabel}</span>
    </Button>
  }

  const description = {
    idle: '发现新版本后会在后台下载。',
    checking: '正在检查更新…',
    current: '当前已是最新版本。',
    error: '更新失败，请检查网络后重试。',
    downloading: status.phase === 'downloading' ? `正在下载 v${status.version} · ${status.percent}%` : '',
    ready: status.phase === 'ready' ? `v${status.version} 已下载，可以重启安装。` : '',
    installing: '正在重启并安装更新…',
  }[phase]

  return <>
    <p className="settings-note" role="status">{error || description}</p>
    <div className="settings-actions">
      {phase === 'ready' || phase === 'installing'
        ? <Button onClick={() => void install()} disabled={preparing || phase === 'installing'}><Download />{installLabel}</Button>
        : <Button variant="outline" disabled={phase === 'checking' || phase === 'downloading'} onClick={() => {
          setError('')
          void api.check().catch(() => setError('无法检查更新，请稍后重试。'))
        }}><RotateCw />检查更新</Button>}
      <Button variant="link" onClick={() => void window.sylunae?.system.openExternal('https://github.com/sylunae/sylunae-workshop/releases')}>查看更新说明</Button>
    </div>
  </>
}
