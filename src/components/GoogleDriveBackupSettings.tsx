import { useEffect, useState } from 'react'
import { Cloud, Download, FileWarning, Upload } from 'lucide-react'
import { useAppStore } from '../app/AppStore'
import type { DriveAccount, DriveBackupAPI, DriveBackupInfo, DriveProgress, DriveUploadPlan } from '../shared/driveBackup'
import { ConfirmDialog } from './ConfirmDialog'
import { Button } from './ui/button'
import { Progress } from './ui/progress'

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
  const { flush, replace, rollbackDrive } = useAppStore()
  const [configured, setConfigured] = useState(api.mode === 'restore')
  const [connected, setConnected] = useState(false)
  const [account, setAccount] = useState<DriveAccount>()
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<DriveProgress>()
  const [upload, setUpload] = useState<DriveUploadPlan>()
  const [restore, setRestore] = useState<DriveBackupInfo>()
  const [missing, setMissing] = useState<string[]>([])
  const [rollbackAvailable, setRollbackAvailable] = useState(false)
  const [confirmRollback, setConfirmRollback] = useState(false)
  const [message, setMessage] = useState<{ text: string; error?: boolean }>()

  useEffect(() => {
    let active = true
    void api.status().then((status) => {
      if (active) {
        setConfigured(status.configured)
        setConnected(status.connected)
        setAccount(status.account)
      }
    }).catch(() => { if (active) setMessage({ text: '无法读取 Google Drive 连接状态。', error: true }) })
    if (api.mode === 'restore') void api.hasRollback().then((available) => {
      if (active) setRollbackAvailable(available)
    }).catch(() => { /* The restore itself can still be used. */ })
    const unsubscribe = api.mode === 'upload' ? api.onProgress(setProgress) : undefined
    return () => { active = false; unsubscribe?.() }
  }, [api])

  const run = async (work: () => Promise<void>, showInDialog = false) => {
    setBusy(true)
    setMessage(undefined)
    try { await work() }
    catch (error) {
      if (showInDialog) throw error
      setMessage({ text: error instanceof Error ? error.message : 'Google Drive 操作失败。', error: true })
    } finally { setBusy(false); setProgress(undefined) }
  }

  const configure = () => {
    if (api.mode !== 'upload') return
    void run(async () => {
      if (await api.configure()) {
        setConfigured(true)
        setConnected(false)
        setAccount(undefined)
        setMissing([])
        setMessage({ text: '桌面 OAuth 配置已导入，可以连接 Google Drive。' })
      }
    })
  }

  const connect = () => void run(async () => {
    setAccount(await api.connect())
    setConnected(true)
    setMessage({ text: '已连接 Google Drive。' })
  })

  const disconnect = () => void run(async () => {
    await api.disconnect()
    setConnected(false)
    setAccount(undefined)
    setMissing([])
    setMessage({ text: '已断开此设备的连接。' })
  })

  const checkBackup = () => void run(async () => {
    if (api.mode === 'upload') {
      setMissing([])
      setProgress({ message: '正在检查本地文件和 Drive 中已有的内容', completed: 0, total: 0 })
      await flush()
      const plan = await api.prepare()
      setAccount(plan.account)
      if (plan.missing.length) {
        setMissing(plan.missing)
        setMessage({ text: '以下本地文件无法读取。请补齐或移除对应的失效引用后重试。', error: true })
      } else if (plan.account.availableBytes !== undefined && plan.uploadBytes > plan.account.availableBytes) {
        setMessage({ text: 'Google Drive 可用空间不足。', error: true })
      } else setUpload(plan)
    } else {
      setProgress({ message: '正在读取最新云端备份', completed: 0, total: 0 })
      const backup = await api.latest()
      if (backup) setRestore(backup)
      else setMessage({ text: '此账号还没有云端备份。请先在桌面端上传。' })
    }
  })

  const progressView = progress && <div role="status">
    <p>{progress.message}{progress.total > 0 && ' · ' + progress.completed + ' / ' + progress.total}</p>
    {progress.total > 0 && <Progress value={progress.completed * 100 / progress.total} />}
  </div>
  return <section className="settings-pane google-drive-settings">
    <div className="settings-title">
      <span><Cloud aria-hidden="true" size={20} /></span>
      <div><h3>Google Drive 备份</h3><p>{api.mode === 'upload'
        ? '备份工坊数据、音乐和图片原件。重复备份会复用云端已有文件。'
        : '连接桌面端使用的 Google 账号，将最新一份备份恢复到手机。'}</p></div>
    </div>
    {account && <p className="settings-note">当前账号 · <span className="user-content">{account.label}</span></p>}
    <div className="settings-actions">
      {api.mode === 'upload' && <Button variant="outline" disabled={busy} onClick={configure}>{configured ? '更换桌面 OAuth 配置' : '导入桌面 OAuth 配置'}</Button>}
      {configured && <Button variant="outline" disabled={busy} onClick={connected ? disconnect : connect}>{connected ? '断开连接' : '连接 Google Drive'}</Button>}
      {connected && <Button disabled={busy} onClick={checkBackup}>
        {api.mode === 'upload' ? <><Upload size={16} />备份到 Google Drive</> : <><Download size={16} />从 Google Drive 恢复</>}
      </Button>}
      {rollbackAvailable && <Button variant="outline" disabled={busy} onClick={() => setConfirmRollback(true)}>回退本次恢复</Button>}
    </div>
    {!upload && !restore && progressView}
    {message && <p className={'notice ' + (message.error ? 'error' : 'success')} role={message.error ? 'alert' : 'status'}>{message.text}</p>}
    {missing.length > 0 && <ul className="google-drive-missing">{missing.map((item) => <li className="user-content" key={item}>{item}</li>)}</ul>}
    <ConfirmDialog open={Boolean(upload)} onOpenChange={(open) => { if (!open) setUpload(undefined) }}
      title="备份到 Google Drive？" confirmLabel="开始上传"
      description={upload && <>
        <span className="backup-preview">{upload.account.label}{'\n'}{countText(upload)}</span>
        <span className="backup-preview">本次新增 {upload.uploadFiles} 个文件（{sizeText(upload.uploadBytes)}），复用 {upload.reuseFiles} 个云端文件。</span>
        {progressView}
      </>}
      onConfirm={() => run(async () => {
        if (api.mode !== 'upload' || !upload) return
        const result = await api.upload(upload.token)
        setMessage({ text: '备份已发布。上传 ' + result.uploaded + ' 个文件，复用 ' + result.reused + ' 个文件。' })
      }, true)} />
    <ConfirmDialog open={Boolean(restore)} onOpenChange={(open) => { if (!open) setRestore(undefined) }}
      title="用云端备份替换手机数据？" confirmLabel="下载并恢复" destructive icon={<FileWarning />}
      description={restore && <>
        <span className="backup-preview">{dateText(restore.createdAt)} · {restore.device}{'\n'}{countText(restore.counts)} · {sizeText(restore.bytes)}</span>
        <span className="backup-preview">下载校验完成后才会替换手机上的数据。恢复前的本地版本可以回退一次。</span>
        {progressView}
      </>}
      onConfirm={() => run(async () => {
        if (api.mode !== 'restore' || !restore) return
        const result = await api.download(restore.id, setProgress)
        await replace(result.snapshot, result.whiteNoise)
        setRollbackAvailable(true)
        setMessage({ text: '备份已恢复到手机。音乐和图片可离线使用。' })
      }, true)} />
    <ConfirmDialog open={confirmRollback} onOpenChange={setConfirmRollback}
      title="回到云端恢复之前？" confirmLabel="回退本地数据" destructive icon={<FileWarning />}
      description="回退会替换当前数据，并清除这次恢复以后在手机上做的修改。"
      onConfirm={() => run(async () => {
        await rollbackDrive()
        setRollbackAvailable(false)
        setMessage({ text: '已回到云端恢复之前的本地版本。' })
      }, true)} />
  </section>
}
