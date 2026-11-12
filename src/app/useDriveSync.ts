import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { App as CapacitorApp } from '@capacitor/app'
import { z } from 'zod'
import { isAndroid } from '../platform/environment'
import { driveFileId, driveHeadChanged, followsDriveRevision, type DriveWhiteNoise } from '../shared/driveBackup'
import type { AppSnapshot } from '../shared/types'
import { driveLocalHash, readDriveResources, sameDriveData, withUnchangedDriveResources } from './driveLocalState'
import type { Notebook } from '../shared/driveNotebook'
import { syncDriveNotebook } from './syncDriveNotebook'

const key = 'sylunae.drive-sync'
const idleDelay = 5_000
const maxDelay = 60_000
const canApply = () => document.visibilityState === 'visible'
  && !document.activeElement?.closest('input, textarea, select, [contenteditable="true"]')
const preferences = z.object({
  enabled: z.boolean(),
  base: z.object({
    accountId: z.string(),
    id: z.string().regex(driveFileId),
    hash: z.string(),
    otherHash: z.string().optional(),
    syncedAt: z.string(),
  }).optional(),
  pending: z.object({ accountId: z.string(), writeId: z.uuid(), hash: z.string(), otherHash: z.string().optional() }).optional(),
  notebook: z.object({ accountId: z.string(), id: z.string().regex(driveFileId), syncedAt: z.string().optional() }).optional(),
})
type Preferences = z.infer<typeof preferences>
type Base = NonNullable<Preferences['base']>

function readPreferences(): Preferences {
  try { return preferences.parse(JSON.parse(localStorage.getItem(key) ?? 'null')) }
  catch { return { enabled: false } }
}

type SyncStatus = { phase: 'idle' | 'syncing' | 'setup' | 'conflict' | 'retry' | 'auth'; message?: string }

export interface DriveSync {
  enabled: boolean
  lastSyncedAt?: string
  status: SyncStatus
  notebookSyncedAt?: string
  notebookMessage: string
  setEnabled: (enabled: boolean) => void
  setPreviewOpen: (open: boolean) => void
  runManual: <T>(work: () => Promise<T>) => Promise<T>
  markSynced: (accountId: string, id: string, hash: string, otherHash?: string) => void
}

export function useDriveSync(
  snapshot: AppSnapshot | null,
  flush: () => Promise<AppSnapshot | null>,
  replaceIfUnchanged: (expected: AppSnapshot, next: AppSnapshot, noise: DriveWhiteNoise, keepNotebook?: boolean) => Promise<AppSnapshot | null>,
  applyNotebook?: (expected: Notebook, next: Notebook) => Promise<boolean>,
): DriveSync {
  const api = window.sylunae?.driveBackup
  const [settings, setSettings] = useState(readPreferences)
  const [status, setStatus] = useState<SyncStatus>({ phase: 'idle' })
  const [notebookMessage, setNotebookMessage] = useState('')
  const current = useRef(settings)
  const active = useRef<Promise<unknown> | null>(null)
  const retryAfterActive = useRef(false)
  const previewOpen = useRef(false)
  const schedule = useRef<() => void>(() => undefined)
  const closing = useRef(false)
  const suspended = useRef(false)
  const previousSnapshot = useRef(snapshot)

  const saveSettings = useCallback((value: Preferences) => {
    localStorage.setItem(key, JSON.stringify(value))
    current.current = value
    setSettings(value)
  }, [])

  const setEnabled = useCallback((enabled: boolean) => {
    saveSettings({ ...current.current, enabled })
    setStatus({ phase: 'idle' })
  }, [saveSettings])

  const markSynced = useCallback((accountId: string, id: string, hash: string, otherHash?: string) => {
    const base: Base = { accountId, id, hash, otherHash, syncedAt: new Date().toISOString() }
    saveSettings({ ...current.current, base, pending: undefined })
    setStatus({ phase: 'idle' })
  }, [saveSettings])

  const setPreviewOpen = useCallback((open: boolean) => {
    previewOpen.current = open
    if (!open) schedule.current()
  }, [])

  const runManual = useCallback(async <T,>(work: () => Promise<T>) => {
    if (active.current) throw new Error('Google Drive 正在同步，请稍后重试。')
    const task = Promise.resolve().then(work)
    active.current = task
    try { return await task }
    finally {
      active.current = null
      if (retryAfterActive.current) {
        retryAfterActive.current = false
        schedule.current()
      }
    }
  }, [])

  const sync = useCallback(async (allowPull: boolean) => {
    if (!api || !current.current.enabled || previewOpen.current || active.current) return
    const task = (async () => {
      if (!navigator.onLine) throw new Error('等待网络恢复，之后会自动重试。')
      const local = await flush()
      if (!local) return
      const account = await api.account()
      const boundAccount = current.current.base?.accountId ?? current.current.notebook?.accountId
      if (boundAccount && boundAccount !== account.id) {
        setStatus({ phase: 'setup', message: 'Google Drive 账号已更换，请先手动备份或恢复一次，确认同步起点。' })
        return
      }
      const notebook = api.notebook
      if (notebook && applyNotebook && current.current.enabled) {
        try {
          const baseline = current.current.notebook
          const legacy = current.current.base
          const result = await syncDriveNotebook(notebook, local, baseline?.accountId === account.id ? baseline.id : undefined,
            legacy?.accountId === account.id ? legacy.id : undefined,
            (expected, next) => allowPull && current.current.enabled && !closing.current && !suspended.current
              ? applyNotebook(expected, next) : Promise.resolve(false))
          if (result?.id && result.id !== baseline?.id) {
            saveSettings({ ...current.current, notebook: { accountId: account.id, id: result.id, syncedAt: new Date().toISOString() } })
          }
          if (result?.conflicts) setNotebookMessage('笔记同步检测到冲突，已保留有内容的版本。请检查笔记本中的同步冲突副本。')
          else setNotebookMessage((message) => message.startsWith('笔记同步暂时') ? '' : message)
        } catch (error) {
          setNotebookMessage('笔记同步暂时失败，稍后会重试。' + (error instanceof Error ? error.message : ''))
        }
      }
      const resources = await readDriveResources()
      const hash = await driveLocalHash(local, resources)
      const otherHash = notebook ? await driveLocalHash(local, resources, true) : undefined
      const head = await api.latest()
      if (!current.current.enabled || previewOpen.current) return
      const pending = current.current.pending
      if (head && pending?.accountId === account.id && head.writeId === pending.writeId) {
        markSynced(account.id, head.id, pending.hash, pending.otherHash)
      }
      let base = current.current.base?.accountId === account.id ? current.current.base : undefined
      if (base && !base.otherHash && otherHash && hash === base.hash) {
        base = { ...base, otherHash }
        saveSettings({ ...current.current, base })
      }
      if (!base && head) {
        setStatus({ phase: 'setup', message: '请先手动上传或恢复一次，选择以哪台设备的数据为起点。' })
        return
      }
      const dirty = !base || (base.otherHash && otherHash ? otherHash !== base.otherHash : hash !== base.hash)
      if (base && head?.id !== base.id) {
        if (dirty || !head || !await followsDriveRevision(head, base.id, api.revision)) {
          setStatus({ phase: 'conflict', message: '本地与云端版本发生分歧。请核对两端数据，再手动上传或恢复以继续同步。' })
          return
        }
        if (!allowPull || closing.current || suspended.current || !canApply()) return
        setStatus({ phase: 'syncing' })
        const restored = await api.download(head.id, () => undefined)
        if (!current.current.enabled || closing.current || suspended.current || !canApply()) return
        if ((await api.latest())?.id !== head.id) return
        await withUnchangedDriveResources(resources, async () => {
          if (!current.current.enabled || closing.current || suspended.current || !canApply()) return
          const installed = await replaceIfUnchanged(local, restored.snapshot, restored.whiteNoise, Boolean(notebook))
          if (!installed) return
          const installedResources = await readDriveResources()
          markSynced(account.id, head.id, await driveLocalHash(installed, installedResources),
            notebook ? await driveLocalHash(installed, installedResources, true) : undefined)
          window.dispatchEvent(new Event('sylunae-resources-changed'))
        })
      } else if (dirty) {
        setStatus({ phase: 'syncing' })
        const backup = notebook ? await flush() : local
        if (!backup) return
        const plan = await api.prepare(backup, resources)
        if (plan.missing.length) throw new Error('部分本地文件无法读取，请在手动备份中检查。')
        if (plan.account.availableBytes !== undefined && plan.uploadBytes > plan.account.availableBytes) {
          throw new Error('Google Drive 可用空间不足。')
        }
        if (!current.current.enabled) return
        const writeId = crypto.randomUUID()
        const uploadedHash = notebook ? await driveLocalHash(backup, resources) : hash
        const uploadedOtherHash = notebook ? await driveLocalHash(backup, resources, true) : undefined
        saveSettings({ ...current.current, pending: { accountId: account.id, writeId, hash: uploadedHash, otherHash: uploadedOtherHash } })
        const result = await api.upload(plan.token, () => undefined, { accountId: account.id, head: head?.id ?? null, writeId })
        markSynced(account.id, result.id, uploadedHash, uploadedOtherHash)
      }
      setStatus({ phase: 'idle' })
    })()
    active.current = task
    try { await task }
    catch (error) {
      const message = error instanceof Error ? error.message : '同步暂时失败。'
      if (message.includes('授权已失效') || message.includes('请先连接') || message.includes('账号已切换')) {
        setStatus({ phase: 'auth', message: '请重新连接 Google Drive，之后会继续自动同步。' })
      } else {
        setStatus({ phase: 'retry', message: message.includes(driveHeadChanged) ? '云端版本已更新，稍后将重新检查。' : message })
      }
    } finally {
      active.current = null
      if (retryAfterActive.current) {
        retryAfterActive.current = false
        schedule.current()
      }
      setStatus((value) => value.phase === 'syncing' ? { phase: 'idle' } : value)
    }
  }, [api, flush, markSynced, replaceIfUnchanged, applyNotebook, saveSettings])

  const loaded = Boolean(snapshot)
  useEffect(() => {
    if (!api || !loaded || !settings.enabled) return
    let idle: ReturnType<typeof setTimeout> | undefined
    let deadline: ReturnType<typeof setTimeout> | undefined
    const clear = () => {
      clearTimeout(idle)
      clearTimeout(deadline)
      idle = deadline = undefined
    }
    const run = () => {
      clear()
      if (active.current) retryAfterActive.current = true
      else void sync(true)
    }
    const changed = () => {
      if (closing.current) return
      clearTimeout(idle)
      idle = setTimeout(run, idleDelay)
      deadline ??= setTimeout(run, maxDelay)
    }
    const wake = () => { if (!closing.current && document.visibilityState !== 'hidden') run() }
    const visibility = () => { if (document.visibilityState === 'visible') wake() }
    const poll = setInterval(() => {
      if (!deadline && !closing.current && document.visibilityState !== 'hidden') void sync(true)
    }, maxDelay)
    const mobile = isAndroid ? CapacitorApp.addListener('appStateChange', async ({ isActive }) => {
      suspended.current = !isActive
      if (isActive) wake()
      else {
        await active.current?.catch(() => undefined)
        if (suspended.current) await sync(false)
      }
    }) : null
    schedule.current = changed
    idle = setTimeout(run, 0)
    window.addEventListener('sylunae:note-edited', changed)
    window.addEventListener('sylunae-resources-changed', changed)
    window.addEventListener('online', wake)
    window.addEventListener('focus', wake)
    document.addEventListener('visibilitychange', visibility)
    document.addEventListener('focusout', changed)
    return () => {
      clear()
      clearInterval(poll)
      schedule.current = () => undefined
      window.removeEventListener('sylunae:note-edited', changed)
      window.removeEventListener('sylunae-resources-changed', changed)
      window.removeEventListener('online', wake)
      window.removeEventListener('focus', wake)
      document.removeEventListener('visibilitychange', visibility)
      document.removeEventListener('focusout', changed)
      void mobile?.then((handle) => handle.remove())
    }
  }, [api, loaded, settings.enabled, sync])

  useEffect(() => {
    const previous = previousSnapshot.current
    previousSnapshot.current = snapshot
    if (previous && snapshot && !sameDriveData(previous, snapshot)) schedule.current()
  }, [snapshot])

  useEffect(() => window.sylunae?.system.onBeforeClose?.(async () => {
    closing.current = true
    await flush()
    if (active.current) await active.current.catch(() => undefined)
    await sync(false)
  }), [flush, sync])

  return useMemo(() => ({
    enabled: settings.enabled, lastSyncedAt: settings.base?.syncedAt, status, setEnabled, markSynced, runManual, setPreviewOpen,
    notebookSyncedAt: settings.notebook?.syncedAt, notebookMessage,
  }), [settings, status, setEnabled, markSynced, runManual, setPreviewOpen, notebookMessage])
}
