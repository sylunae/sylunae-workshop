import { isAndroid } from '../platform/environment'
import { useEffect, useState } from 'react'
import { CheckCircle2, Database, Download, ExternalLink, FolderOpen, HardDrive, LoaderCircle, Music2, PackageOpen, Trash2, Upload } from 'lucide-react'
import type { ManagedResourceDirectory, ResourceDownloadProgress, ResourceItem, ResourceSummary } from '../shared/types'
import { ConfirmDialog } from './ConfirmDialog'
import { Button } from './ui/button'
import { Progress } from './ui/progress'

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function broadcastChange() {
  window.dispatchEvent(new Event('sylunae-resources-changed'))
}

export function ResourceSettings() {
  const [summary, setSummary] = useState<ResourceSummary | null>(null)
  const [progress, setProgress] = useState<Record<string, ResourceDownloadProgress>>({})
  const [busyId, setBusyId] = useState('')
  const [error, setError] = useState('')
  const [removeTarget, setRemoveTarget] = useState<ResourceItem | null>(null)
  const desktop = Boolean(window.sylunae)

  const refresh = () => {
    if (!window.sylunae) return
    void window.sylunae.resources.list().then(setSummary).catch(() => setError('无法读取本地资源状态。'))
  }

  useEffect(() => {
    refresh()
    if (!window.sylunae) return
    return window.sylunae.resources.onDownloadProgress((value) => setProgress((current) => ({ ...current, [value.id]: value })))
  }, [])

  const download = async (item: ResourceItem) => {
    if (!window.sylunae) return
    setBusyId(item.id)
    setError('')
    try {
      await window.sylunae.resources.download(item.id)
      refresh()
      broadcastChange()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '下载失败，请稍后重试。')
    } finally { setBusyId('') }
  }

  const importAudio = async () => {
    if (!window.sylunae) return
    setBusyId('import')
    setError('')
    try {
      const item = await window.sylunae.resources.importWhiteNoise()
      if (item) { refresh(); broadcastChange() }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '无法添加这个音频。')
    } finally { setBusyId('') }
  }

  const remove = async () => {
    if (!window.sylunae || !removeTarget) return
    setBusyId(removeTarget.id)
    setError('')
    try {
      await window.sylunae.resources.remove(removeTarget.id)
      setRemoveTarget(null)
      refresh()
      broadcastChange()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '无法移除这个资源。')
    } finally { setBusyId('') }
  }

  const openDirectory = async (directory: ManagedResourceDirectory) => {
    if (!window.sylunae) return
    setError('')
    try {
      await window.sylunae.resources.openDirectory(directory)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '无法打开这个文件夹。')
    }
  }

  if (!desktop) return <section className="settings-pane resource-settings-empty"><PackageOpen /><h3>客户端专属</h3><p>支持扩展资源的客户端可以下载资源到本机，并在离线时继续使用。</p></section>

  return <div className="resource-settings">
    <section className="settings-pane resource-summary-pane">
      <div className="resource-summary-heading"><div><span><PackageOpen /></span><div><h3>扩展资源</h3><p>统一管理按需下载和自行添加的本地内容。</p></div></div><Button variant="outline" className="button secondary" onClick={() => void importAudio()} disabled={Boolean(busyId)}><Upload />{busyId === 'import' ? '正在添加…' : '添加白噪音'}</Button></div>
      <div className="resource-summary-grid"><div><HardDrive /><span><strong>{formatBytes(summary?.installedBytes || 0)}</strong><small>本地占用</small></span></div><div><Download /><span><strong>{summary?.items.filter((item) => item.state === 'installed' || item.state === 'builtin').length || 0}</strong><small>可离线资源</small></span></div><div><PackageOpen /><span><strong>{summary?.items.length || 0}</strong><small>资源总数</small></span></div></div>
      {!summary?.remoteConfigured && <p className="resource-config-note">尚未配置公开资源地址。内置和用户添加的资源仍可正常使用；下载资源前请在 <code>.env.local</code> 中填写 <code>MAIN_VITE_RESOURCE_PUBLIC_BASE_URL</code>。</p>}
    </section>

    {!isAndroid && <section className="settings-pane resource-folders-pane">
      <div className="resource-list-heading"><div><strong>本地文件夹</strong><small>在文件资源管理器中查看应用管理的本地内容</small></div></div>
      <div className="resource-folder-list">
        <div className="resource-folder-item"><span><Database /></span><div><strong>应用数据</strong><small>数据库、缓存与全部应用资源的根目录</small></div><Button variant="outline" size="sm" onClick={() => void openDirectory('app-data')}><FolderOpen />打开</Button></div>
        <div className="resource-folder-item"><span><Music2 /></span><div><strong>音乐下载</strong><small>仅包含从链接下载到默认位置的音乐</small></div><Button variant="outline" size="sm" onClick={() => void openDirectory('music')}><FolderOpen />打开</Button></div>
        <div className="resource-folder-item"><span><PackageOpen /></span><div><strong>扩展资源</strong><small>已下载或添加的白噪音等资源</small></div><Button variant="outline" size="sm" onClick={() => void openDirectory('resources')}><FolderOpen />打开</Button></div>
      </div>
      <p className="resource-folder-note">从电脑文件导入的音乐会保留在原位置，资料库只记录文件路径，不会复制到“音乐下载”文件夹。</p>
    </section>}

    <section className="settings-pane resource-list-pane">
      <div className="resource-list-heading"><div><strong>白噪音</strong><small>1 个内置资源，其余资源按需下载</small></div><span>{summary ? formatBytes(summary.availableBytes) : '—'} 可下载</span></div>
      {error && <div className="notice error resource-error">{error}</div>}
      <div className="resource-list">{summary?.items.map((item) => {
        const currentProgress = progress[item.id]
        const downloading = busyId === item.id && currentProgress?.stage !== 'complete'
        return <article className="resource-list-item" key={item.id}>
          <div className="resource-list-cover">{item.coverPath ? <img className={item.origin === 'custom' ? 'private-media' : undefined} src={item.coverPath} alt="" /> : <PackageOpen />}</div>
          <div className="resource-list-copy"><strong className={item.origin === 'custom' ? 'user-content' : undefined}>{item.title}</strong><small>{item.origin === 'custom' ? '用户添加 · 本地文件' : `${item.origin === 'builtin' ? '随应用内置' : `${formatBytes(item.size)} · ${Math.round(item.duration / 60)} 分钟`} · ${item.attribution.license} · ${item.attribution.creator}`}</small>{downloading && <div className="resource-inline-progress"><Progress value={currentProgress?.percent ?? 0} /><span>{currentProgress?.message}</span></div>}</div>
          <div className="resource-list-meta"><span className={`resource-state ${item.state}`}>{item.state === 'builtin' ? '内置' : item.state === 'installed' ? '已下载' : item.state === 'error' ? '不可用' : '未下载'}</span>{item.attribution.sourceUrl && <button type="button" title={`来源：${item.attribution.creator}`} onClick={() => window.sylunae?.system.openExternal(item.attribution.sourceUrl)}><ExternalLink /></button>}</div>
          {item.state === 'available' ? <Button variant="outline" size="sm" className="resource-action" disabled={Boolean(busyId) || !summary.remoteConfigured} onClick={() => void download(item)}>{downloading ? <LoaderCircle className="spin" /> : <Download />}{downloading ? `${currentProgress?.percent ?? 0}%` : '下载'}</Button> : item.origin !== 'builtin' ? <Button variant="ghost" size="icon-sm" className="resource-remove" disabled={Boolean(busyId)} onClick={() => setRemoveTarget(item)} title={item.origin === 'custom' ? '删除本地资源' : '移除本地下载'}><Trash2 /></Button> : <CheckCircle2 className="resource-ready" />}
        </article>
      })}</div>
    </section>
    <ConfirmDialog open={Boolean(removeTarget)} onOpenChange={(open) => { if (!open) setRemoveTarget(null) }} title={removeTarget?.origin === 'custom' ? '删除这个白噪音？' : '移除本地下载？'} description={removeTarget?.origin === 'custom' ? '应用资源库中的文件将被删除，此操作无法撤销。原始导入文件不会受到影响。' : '资源会从本机移除，之后仍可重新下载。'} confirmLabel={removeTarget?.origin === 'custom' ? '删除资源' : '移除下载'} destructive={removeTarget?.origin === 'custom'} icon={<Trash2 />} onConfirm={() => void remove()} />
  </div>
}
