import { registerPlugin } from '@capacitor/core'
import { Download, RotateCw } from 'lucide-react'
import { useState } from 'react'
import { useAppStore } from '../app/AppStore'
import { Button } from './ui/button'

type CheckResult =
  | { status: 'current' | 'disabled' }
  | { status: 'available'; version: string; size: number }

const updates = registerPlugin<{
  check(): Promise<CheckResult>
  prepare(): Promise<{ status: 'permission' | 'ready' }>
  install(): Promise<void>
}>('WorkshopUpdates')

export function AndroidUpdate() {
  const { flush } = useAppStore()
  const [result, setResult] = useState<CheckResult | null>(null)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)

  const check = async () => {
    setBusy(true)
    setMessage('正在检查更新…')
    try {
      setResult(await updates.check())
      setMessage('')
    } catch {
      setMessage('无法检查更新，请稍后重试。')
    } finally {
      setBusy(false)
    }
  }

  const install = async () => {
    setBusy(true)
    setMessage('正在下载并验证更新…')
    try {
      const { status } = await updates.prepare()
      if (status === 'permission') {
        setMessage('请允许丝月工坊安装应用，返回后再次点击「下载并安装」。')
        return
      }
      setMessage('正在保存数据…')
      try {
        if (!await flush()) throw new Error('本地数据尚未就绪')
      } catch {
        setMessage('本地数据保存失败，请稍后重试安装。')
        return
      }
      await updates.install()
      setMessage('请在 Android 系统界面确认安装。')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '无法安装更新，请稍后重试。')
    } finally {
      setBusy(false)
    }
  }

  const description = result?.status === 'available'
    ? `发现 v${result.version} · ${(result.size / 1024 / 1024).toFixed(1)} MB`
    : result?.status === 'current' ? '当前已是最新版本。'
      : result?.status === 'disabled' ? '开发版使用独立包名，更新功能仅适用于正式版。'
        : '下载更新后，通过 Android 系统界面确认安装。'

  return <>
    <p className="settings-note" role="status">{message || description}</p>
    <div className="settings-actions">
      {result?.status === 'available' && <Button disabled={busy} onClick={() => void install()}><Download />下载并安装</Button>}
      {result?.status !== 'disabled' && <Button variant="outline" disabled={busy} onClick={() => void check()}><RotateCw />检查更新</Button>}
    </div>
  </>
}
