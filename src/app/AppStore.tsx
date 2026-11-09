import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { repository } from '../data/repository'
import { changedSnapshotSections, snapshotPatchEntries } from '../data/snapshotSections'
import type { AppSnapshot, AppSnapshotPatch } from '../shared/types'
import { removeExpiredTodos, todoExpiresAt } from '../todos/cleanup'
import { flushSync } from 'react-dom'
import { App as CapacitorApp } from '@capacitor/app'
import { isAndroid } from '../platform/environment'

interface AppStoreValue {
  snapshot: AppSnapshot | null
  loading: boolean
  saving: boolean
  error: string
  update: (recipe: (current: AppSnapshot) => AppSnapshot) => void
  replace: (snapshot: AppSnapshot) => Promise<void>
  flush: () => Promise<AppSnapshot | null>
}

const AppStoreContext = createContext<AppStoreValue | null>(null)

export function AppStoreProvider({ children }: { children: ReactNode }) {
  const [snapshot, setSnapshot] = useState<AppSnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const latest = useRef<AppSnapshot | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingPatch = useRef<AppSnapshotPatch>({})
  const saveQueue = useRef<Promise<void>>(Promise.resolve())
  const queuedSaveId = useRef(0)
  const replacing = useRef(false)

  useEffect(() => {
    repository.load()
      .then((value) => { latest.current = value; setSnapshot(value) })
      .catch(() => setError('无法读取本地数据'))
      .finally(() => setLoading(false))
  }, [])

  const persist = useCallback((patch: AppSnapshotPatch): Promise<void> => {
    if (snapshotPatchEntries(patch).length === 0) return saveQueue.current
    const saveId = ++queuedSaveId.current
    setSaving(true)
    const operation = saveQueue.current.then(() => repository.save(patch))
    saveQueue.current = operation.catch(() => undefined)
    void operation
      .then(() => setError(''))
      .catch(() => setError('保存失败，请稍后重试'))
      .finally(() => {
        if (saveId === queuedSaveId.current && snapshotPatchEntries(pendingPatch.current).length === 0) setSaving(false)
      })
    return operation
  }, [])

  const drainPending = useCallback(() => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null }
    const patch = pendingPatch.current
    pendingPatch.current = {}
    return persist(patch)
  }, [persist])

  const update = useCallback((recipe: (current: AppSnapshot) => AppSnapshot) => {
    if (replacing.current) return
    setSnapshot((current) => {
      if (!current || replacing.current) return current
      const next = recipe(current)
      if (next === current) return current
      latest.current = next
      Object.assign(pendingPatch.current, changedSnapshotSections(current, next))
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => { void drainPending() }, 350)
      return next
    })
  }, [drainPending])

  const todos = snapshot?.todos
  useEffect(() => {
    if (!todos) return
    let cleanupTimer: ReturnType<typeof setTimeout>
    const sweep = () => {
      clearTimeout(cleanupTimer)
      const now = Date.now()
      update((current) => {
        const remaining = removeExpiredTodos(current.todos, now)
        return remaining === current.todos ? current : { ...current, todos: remaining }
      })
      // Recheck after sleep or clock changes, even while another page is open.
      const expirations = (latest.current?.todos ?? []).map(todoExpiresAt).filter((time): time is number => time !== null && time > now)
      const delay = expirations.reduce((next, time) => Math.min(next, time - now), 60_000)
      cleanupTimer = setTimeout(sweep, delay)
    }
    sweep()
    window.addEventListener('focus', sweep)
    document.addEventListener('visibilitychange', sweep)
    return () => {
      clearTimeout(cleanupTimer)
      window.removeEventListener('focus', sweep)
      document.removeEventListener('visibilitychange', sweep)
    }
  }, [todos, update])

  const flush = useCallback(async () => {
    flushSync(() => window.dispatchEvent(new Event('sylunae:flush-editors')))
    await drainPending()
    await saveQueue.current
    return latest.current
  }, [drainPending])

  useEffect(() => {
    const saveBeforeSuspend = () => { if (document.visibilityState === 'hidden') void flush().catch(() => setError('保存失败，请重新打开后重试')) }
    document.addEventListener('visibilitychange', saveBeforeSuspend)
    const mobile = isAndroid ? CapacitorApp.addListener('appStateChange', ({ isActive }) => { if (!isActive) void flush().catch(() => setError('保存失败，请重新打开后重试')) }) : null
    return () => { document.removeEventListener('visibilitychange', saveBeforeSuspend); void mobile?.then((handle) => handle.remove()) }
  }, [flush])

  const replace = useCallback(async (value: AppSnapshot) => {
    if (replacing.current) throw new Error('正在导入，请等待当前操作完成。')
    flushSync(() => window.dispatchEvent(new Event('sylunae:flush-editors')))
    replacing.current = true
    try {
      await drainPending()
      const operation = saveQueue.current.then(() => repository.replace(value))
      saveQueue.current = operation.then(() => undefined, () => undefined)
      const persisted = await operation; latest.current = persisted; setSnapshot(persisted)
    }
    finally { replacing.current = false }
  }, [drainPending])

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current)
    if (snapshotPatchEntries(pendingPatch.current).length > 0) void repository.save(pendingPatch.current)
  }, [])

  const value = useMemo(() => ({ snapshot, loading, saving, error, update, replace, flush }), [snapshot, loading, saving, error, update, replace, flush])
  return <AppStoreContext.Provider value={value}>{children}</AppStoreContext.Provider>
}

export function useAppStore(): AppStoreValue {
  const value = useContext(AppStoreContext)
  if (!value) throw new Error('useAppStore must be used inside AppStoreProvider')
  return value
}
