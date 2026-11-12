import { useEffect, useState } from 'react'
import { Cloud, Download, FileWarning, Upload } from 'lucide-react'
import { useAppStore } from '../app/AppStore'
import { driveLocalHash, readDriveResources } from '../app/driveLocalState'
import type { DriveAccount, DriveBackupAPI, DriveBackupInfo, DriveProgress, DriveRestorePlan, DriveUploadPlan } from '../shared/driveBackup'
import { ConfirmDialog } from './ConfirmDialog'
import { Button } from './ui/button'
import { Progress } from './ui/progress'
import { Switch } from './ui/switch'

const countText = ({ notes, tracks, images }: DriveUploadPlan | DriveBackupInfo['counts']) =>
  '笔记 ' + notes + ' 条 · 音乐 ' + tracks + ' 首 · 图片 ' + images + ' 张'

function sizeText(bytes: number) {
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 ** 2) return (bytes / 1024).toFixed(1) + ' KiB'
  if (bytes < 1024 ** 3) return (bytes / 1024 ** 2).toFixed(1) + ' MiB'
  return (bytes / 1024 ** 3).toFixed(2) + ' GiB'
}

function dateText(date: string) { return new Date(date).toLocaleString() }

export function GoogleDriveBackupSettings({ api }: { api: DriveBackupAPI }) {
  const { flush, replace, rollbackDrive, driveSync } = useAppStore()
  const { setPreviewOpen, runManual, markSynced } = driveSync
  const [configured, setConfigured] = useState<boolean>()
  const [connected, setConnected] = useState(false)
  const [account, setAccount] = useState<DriveAccount>()
  const [busy, setBusy] = useState(false)
  const [connecting, setConnecting] = useState(false)
  const [progress, setProgress] = useState<DriveProgress>()
  const [upload, setUpload] = useState<{ plan: DriveUploadPlan; hash: string; otherHash?: string; head: string | null }>()
  const [restore, setRestore] = useState<DriveRestorePlan>()
  const [missing, setMissing] = useState<string[]>([])
  const [rollbackAvailable, setRollbackAvailable] = useState(false)
  const [confirmRollback, setConfirmRollback] = useState(false)
  const [message, setMessage] = useState<{ text: string; error?: boolean }>()

  useEffect(() => () => setPreviewOpen(false), [setPreviewOpen])

  useEffect(() => {
    let active = true
    void api.status().then((status) => {
      if (active) {
        setConfigured(status.configured)
        setConnected(status.connected)
        setAccount(status.account)
      }
    }).catch(() => { if (active) setMessage({ text: '无法读取 Google Drive 连接状态。', error: true }) })
    const refreshRollback = () => void api.hasRollback().then((available) => {
      if (active) setRollbackAvailable(available)
    }).catch(() => { /* The restore itself can still be used. */ })
    refreshRollback()
    window.addEventListener('sylunae-resources-changed', refreshRollback)
    return () => { active = false; window.removeEventListener('sylunae-resources-changed', refreshRollback) }
  }, [api])

  const run = async (work: () => Promise<void>, showInDialog = false) => {
    setBusy(true)
    setMessage(undefined)
    try { await runManual(work) }
    catch (error) {
      if (showInDialog) throw error
      setMessage({ text: error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '') : 'Google Drive 操作失败。', error: true })
    } finally { setBusy(false); setProgress(undefined) }
  }

  const connect = () => void run(async () => {
    setConnecting(true)
    try {
      setAccount(await api.connect())
      setConnected(true)
      setMessage({ text: '已连接 Google Drive。' })
    } finally { setConnecting(false) }
  })

  const cancelConnect = () => void api.cancelConnect?.().catch(() => {
    setMessage({ text: '取消授权失败，请稍后重试。', error: true })
  })

  const importClient = () => void run(async () => {
    if (await api.importDevelopmentClient?.()) {
      setConfigured(true)
      setMessage({ text: '桌面 OAuth 配置已导入，可以连接 Google Drive。' })
    }
  })

  const disconnect = () => void run(async () => {
    await api.disconnect()
    driveSync.setEnabled(false)
    setConnected(false)
    setAccount(undefined)
    setMissing([])
    setMessage({ text: '已断开此设备的连接。' })
  })

  const checkUpload = () => void run(async () => {
    setMissing([])
    setProgress({ message: '正在检查本地文件和 Drive 中已有的内容', completed: 0, total: 0 })
    const snapshot = await flush()
    if (!snapshot) throw new Error('本地数据尚未加载。')
    const resources = await readDriveResources()
    const hash = await driveLocalHash(snapshot, resources)
    const otherHash = api.notebook ? await driveLocalHash(snapshot, resources, true) : undefined
    const head = await api.latest()
    const plan = await api.prepare(snapshot, resources)
    setAccount(plan.account)
    if (plan.missing.length) {
      setMissing(plan.missing)
      setMessage({ text: '以下本地文件无法读取。请补齐或移除对应的失效引用后重试。', error: true })
    } else if (plan.account.availableBytes !== undefined && plan.uploadBytes > plan.account.availableBytes) {
      setMessage({ text: 'Google Drive 可用空间不足。', error: true })
    } else {
      setPreviewOpen(true)
      setUpload({ plan, hash, otherHash, head: head?.id ?? null })
    }
  })

  const checkRestore = () => void run(async () => {
    setMissing([])
    setProgress({ message: '正在检查云端备份和本地缓存', completed: 0, total: 0 })
    const backup = await api.previewRestore()
    if (backup) {
      setPreviewOpen(true)
      setRestore(backup)
    }
    else setMessage({ text: '此账号还没有云端备份。请先在一台设备上上传。' })
  })

  const progressView = progress && <div role="status">
    <p>{progress.message}{progress.total > 0 && ' · ' + progress.completed + ' / ' + progress.total}</p>
    {progress.total > 0 && <Progress value={progress.completed * 100 / progress.total} />}
  </div>
  const working = busy || driveSync.status.phase === 'syncing'
  return <section className="settings-pane google-drive-settings">
    <div className="settings-title">
      <span><Cloud aria-hidden="true" size={20} /></span>
      <div><h3>Google Drive 备份</h3><p>自动同步、手动备份与恢复。</p></div>
    </div>
    {account && <p className="settings-note">当前账号 · <span className="user-content">{account.label}</span></p>}
    {configured === false && <p className="settings-note">{api.importDevelopmentClient
      ? '桌面开发版需要先导入 Google Cloud 的桌面 OAuth 客户端 JSON。'
      : '此版本暂不支持连接 Google Drive。'}</p>}
    {connected && <div className="settings-actions">
      <label htmlFor="drive-auto-sync">自动同步</label>
      <Switch id="drive-auto-sync" checked={driveSync.enabled} disabled={working} onCheckedChange={driveSync.setEnabled} />
      {driveSync.enabled && <span className="settings-note" role="status">
        {driveSync.status.phase === 'syncing' ? '正在同步…' : driveSync.lastSyncedAt && '上次同步 · ' + dateText(driveSync.lastSyncedAt)}
      </span>}
    </div>}
    {driveSync.enabled && driveSync.status.message && <p className="settings-note" role="status">{driveSync.status.message}</p>}
    {driveSync.enabled && driveSync.notebookSyncedAt && <p className="settings-note">上次笔记同步 · {dateText(driveSync.notebookSyncedAt)}</p>}
    {driveSync.enabled && driveSync.notebookMessage && <p className="settings-note" role="status">{driveSync.notebookMessage}</p>}
    {connecting && api.cancelConnect && <p className="settings-note" role="status">请在浏览器完成授权。若页面报错或已关闭，可以取消后重试。</p>}
    <div className="settings-actions">
      {configured === false && api.importDevelopmentClient && <Button variant="outline" disabled={working} onClick={importClient}>导入桌面 OAuth 配置</Button>}
      {configured && <Button variant="outline" disabled={working} onClick={connected && driveSync.status.phase !== 'auth' ? disconnect : connect}>
        {connected ? driveSync.status.phase === 'auth' ? '重新连接 Google Drive' : '断开连接' : '连接 Google Drive'}
      </Button>}
      {connecting && api.cancelConnect && <Button variant="outline" onClick={cancelConnect}>取消授权</Button>}
      {connected && <>
        <Button disabled={working} onClick={checkUpload}><Upload size={16} />备份到 Google Drive</Button>
        <Button variant="outline" disabled={working} onClick={checkRestore}><Download size={16} />从 Google Drive 恢复</Button>
      </>}
      {rollbackAvailable && <Button variant="outline" disabled={working} onClick={() => { setPreviewOpen(true); setConfirmRollback(true) }}>回退本次恢复</Button>}
    </div>
    {!upload && !restore && progressView}
    {message && <p className={'notice ' + (message.error ? 'error' : 'success')} role={message.error ? 'alert' : 'status'}>{message.text}</p>}
    {missing.length > 0 && <ul className="google-drive-missing">{missing.map((item) => <li className="user-content" key={item}>{item}</li>)}</ul>}
    <ConfirmDialog open={Boolean(upload)} onOpenChange={(open) => { if (!open) { setUpload(undefined); setPreviewOpen(false) } }}
      title="替换云端最新备份？" confirmLabel="开始上传" destructive icon={<FileWarning />}
      description={upload && <>
        <span className="backup-preview">{upload.plan.account.label}{'\n'}{countText(upload.plan)}</span>
        <span className="backup-preview">上传完成后，此设备的数据将成为云端最新版。其他设备尚未上传的修改不会合并进来。</span>
        <span className="backup-preview">本次新增 {upload.plan.uploadFiles} 个文件（{sizeText(upload.plan.uploadBytes)}），复用 {upload.plan.reuseFiles} 个云端文件。</span>
        {progressView}
      </>}
      onConfirm={() => run(async () => {
        if (!upload) return
        const accountId = upload.plan.account.id
        const result = await api.upload(upload.plan.token, setProgress, { accountId, head: upload.head })
        markSynced(accountId, result.id, upload.hash, upload.otherHash)
        setMessage({ text: '备份已发布。上传 ' + result.uploaded + ' 个文件，复用 ' + result.reused + ' 个文件。' })
      }, true)} />
    <ConfirmDialog open={Boolean(restore)} onOpenChange={(open) => { if (!open) { setRestore(undefined); setPreviewOpen(false) } }}
      title="用云端备份替换此设备的数据？" confirmLabel="下载并恢复" destructive icon={<FileWarning />}
      description={restore && <>
        <span className="backup-preview">{dateText(restore.createdAt)} · {restore.device}{'\n'}{countText(restore.counts)} · {sizeText(restore.bytes)}</span>
        <span className="backup-preview">预计下载 {restore.downloadFiles} 个文件（{sizeText(restore.downloadBytes)}），复用 {restore.reuseFiles} 个本地缓存文件。恢复时会校验缓存。</span>
        <span className="backup-preview">此设备尚未上传的修改会被覆盖。恢复前的本地版本可以回退一次。</span>
        {driveSync.enabled && api.notebook && <span className="backup-preview">恢复后会暂停自动同步。重新开启前，请确认是否要同步恢复出来的笔记。</span>}
        {progressView}
      </>}
      onConfirm={() => run(async () => {
        if (!restore) return
        const { id: accountId } = await api.account()
        const result = await api.download(restore.id, setProgress)
        const installed = await replace(result.snapshot, result.whiteNoise)
        if (api.notebook) driveSync.setEnabled(false)
        const resources = await readDriveResources()
        markSynced(accountId, restore.id, await driveLocalHash(installed, resources),
          api.notebook ? await driveLocalHash(installed, resources, true) : undefined)
        window.dispatchEvent(new Event('sylunae-resources-changed'))
        setRollbackAvailable(true)
        setMessage({ text: '备份已恢复。下载 ' + result.downloaded + ' 个文件，复用 ' + result.reused + ' 个本地缓存文件。' })
      }, true)} />
    <ConfirmDialog open={confirmRollback} onOpenChange={(open) => { setConfirmRollback(open); setPreviewOpen(open) }}
      title="回到云端恢复之前？" confirmLabel="回退本地数据" destructive icon={<FileWarning />}
      description="回退会替换当前数据、清除这次恢复以后的本地修改，并关闭自动同步。"
      onConfirm={() => run(async () => {
        await rollbackDrive()
        driveSync.setEnabled(false)
        window.dispatchEvent(new Event('sylunae-resources-changed'))
        setRollbackAvailable(false)
        setMessage({ text: '已回到云端恢复之前的本地版本。' })
      }, true)} />
  </section>
}
