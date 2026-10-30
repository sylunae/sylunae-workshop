import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { repository } from '../data/repository'
import { changedSnapshotSections, snapshotPatchEntries } from '../data/snapshotSections'
import type { AppSnapshot, AppSnapshotPatch } from '../shared/types'

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
    setSnapshot((current) => {
      if (!current) return current
      const next = recipe(current)
      if (next === current) return current
      latest.current = next
      Object.assign(pendingPatch.current, changedSnapshotSections(current, next))
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => { void drainPending() }, 350)
      return next
    })
  }, [drainPending])

  const flush = useCallback(async () => {
    await drainPending()
    await saveQueue.current
    return latest.current
  }, [drainPending])

  const replace = useCallback(async (value: AppSnapshot) => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null }
    pendingPatch.current = {}
    await saveQueue.current
    const persisted = await repository.replace(value)
    latest.current = persisted
    setSnapshot(persisted)
  }, [])

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
