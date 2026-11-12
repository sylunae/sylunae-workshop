import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { repository } from '../data/repository'
import { changedSnapshotSections, snapshotPatchEntries, type SnapshotSectionKey } from '../data/snapshotSections'
import type { AppSnapshot, AppSnapshotPatch } from '../shared/types'
import type { DriveWhiteNoise } from '../shared/driveBackup'
import { removeExpiredTodos, todoExpiresAt } from '../todos/cleanup'
import { flushSync } from 'react-dom'
import { App as CapacitorApp } from '@capacitor/app'
import { isAndroid } from '../platform/environment'
import { useDriveSync, type DriveSync } from './useDriveSync'
import { preserveDeviceState, sameDriveData } from './driveLocalState'
import type { Notebook } from '../shared/driveNotebook'

interface AppStoreValue {
  snapshot: AppSnapshot | null
  snapshotEpoch: number
  noteRevisions: ReadonlyMap<string, number>
  loading: boolean
  saving: boolean
  error: string
  update: (recipe: (current: AppSnapshot) => AppSnapshot) => void
  replace: (snapshot: AppSnapshot, whiteNoise?: DriveWhiteNoise) => Promise<AppSnapshot>
  rollbackDrive: () => Promise<void>
  flush: () => Promise<AppSnapshot | null>
  driveSync: DriveSync
}

const AppStoreContext = createContext<AppStoreValue | null>(null)

function applyNotebookRows<T extends { id: string }>(current: T[], expected: T[], next: T[], protectedId?: string) {
  const before = new Map(expected.map((row) => [row.id, row]))
  const after = new Map(next.map((row) => [row.id, row]))
  const rows = new Map(current.map((row) => [row.id, row]))
  const applied: string[] = []
  let deferred = false
  for (const id of new Set([...before.keys(), ...after.keys()])) {
    const original = before.get(id)
    const incoming = after.get(id)
    if (original === incoming) continue
    if (id === protectedId || rows.get(id) !== original) {
      deferred = true
      continue
    }
    if (incoming) rows.set(id, incoming)
    else rows.delete(id)
    if (original) applied.push(id)
  }
  return { rows: applied.length || rows.size !== current.length ? [...rows.values()] : current, applied, deferred }
}

export function AppStoreProvider({ children }: { children: ReactNode }) {
  const [snapshot, setSnapshot] = useState<AppSnapshot | null>(null)
  const [snapshotEpoch, setSnapshotEpoch] = useState(0)
  const [noteRevisions, setNoteRevisions] = useState<ReadonlyMap<string, number>>(() => new Map())
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const latest = useRef<AppSnapshot | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingPatch = useRef<AppSnapshotPatch>({})
  const saveQueue = useRef<Promise<void>>(Promise.resolve())
  const queuedSaveId = useRef(0)
  const failedSections = useRef(new Set<SnapshotSectionKey>())
  const replacing = useRef(false)

  useEffect(() => {
    repository.load()
      .then((value) => { latest.current = value; setSnapshot(value) })
      .catch(() => setError('无法读取本地数据'))
      .finally(() => setLoading(false))
  }, [])

  const persist = useCallback((patch: AppSnapshotPatch): Promise<void> => {
    const entries = snapshotPatchEntries(patch)
    if (entries.length === 0) return saveQueue.current
    const saveId = ++queuedSaveId.current
    setSaving(true)
    const operation = saveQueue.current.then(async () => {
      try {
        await repository.save(patch)
        entries.forEach(({ key }) => failedSections.current.delete(key))
      } catch (cause) {
        entries.forEach(({ key }) => failedSections.current.add(key))
        throw cause
      }
    })
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
    if (replacing.current) throw new Error('正在导入，请等待当前操作完成。')
    flushSync(() => window.dispatchEvent(new Event('sylunae:flush-editors')))
    const current = latest.current
    await drainPending()
    if (current && failedSections.current.size > 0) {
      if (latest.current !== current) throw new Error('本地数据仍在保存，请稍后重试。')
      const retry: AppSnapshotPatch = {}
      failedSections.current.forEach((key) => Object.assign(retry, { [key]: current[key] }))
      await persist(retry)
    }
    return current
  }, [drainPending, persist])

  useEffect(() => {
    const saveBeforeSuspend = () => { if (document.visibilityState === 'hidden') void flush().catch(() => setError('保存失败，请重新打开后重试')) }
    document.addEventListener('visibilitychange', saveBeforeSuspend)
    const mobile = isAndroid ? CapacitorApp.addListener('appStateChange', ({ isActive }) => { if (!isActive) void flush().catch(() => setError('保存失败，请重新打开后重试')) }) : null
    return () => { document.removeEventListener('visibilitychange', saveBeforeSuspend); void mobile?.then((handle) => handle.remove()) }
  }, [flush])

  const replaceWith = useCallback(async (replaceStored: (previous: AppSnapshot | null) => Promise<AppSnapshot>, preservePrevious: boolean, expected?: AppSnapshot, keepNotebook = false) => {
    if (replacing.current) throw new Error('正在导入，请等待当前操作完成。')
    flushSync(() => window.dispatchEvent(new Event('sylunae:flush-editors')))
    const previous = latest.current
    if (expected && (!previous || !sameDriveData(expected, previous, keepNotebook))) return null
    const root = expected && document.body
    const wasInert = root ? root.inert : false
    replacing.current = true
    if (root) root.inert = true
    try {
      await drainPending()
      if (preservePrevious && latest.current && failedSections.current.size) {
        const retry: AppSnapshotPatch = {}
        for (const key of failedSections.current) Object.assign(retry, { [key]: latest.current[key] })
        await persist(retry)
      }
      const operation = saveQueue.current.then(() => replaceStored(previous))
      saveQueue.current = operation.then(() => undefined, () => undefined)
      const persisted = await operation
      failedSections.current.clear()
      latest.current = persisted
      flushSync(() => {
        setSnapshot(persisted)
        setSnapshotEpoch((epoch) => epoch + 1)
        setNoteRevisions(new Map())
      })
      return persisted
    }
    finally {
      if (root) root.inert = wasInert
      replacing.current = false
    }
  }, [drainPending, persist])

  const replace = useCallback(async (value: AppSnapshot, whiteNoise?: DriveWhiteNoise) =>
    (await replaceWith(() => repository.replace(value, whiteNoise), whiteNoise !== undefined))!, [replaceWith])

  const replaceIfUnchanged = useCallback((expected: AppSnapshot, value: AppSnapshot, whiteNoise: DriveWhiteNoise, keepNotebook = false) =>
    replaceWith((previous) => {
      const restored = preserveDeviceState(previous!, value)
      if (keepNotebook && previous) {
        restored.notes = previous.notes
        restored.folders = previous.folders
      }
      return repository.replace(restored, whiteNoise)
    }, true, expected, keepNotebook), [replaceWith])

  const applyNotebook = useCallback(async (expected: Notebook, next: Notebook) => {
    if (replacing.current) return false
    flushSync(() => window.dispatchEvent(new Event('sylunae:flush-editors')))
    const current = latest.current
    if (!current) return false
    const focused = document.activeElement?.closest('input, textarea, [contenteditable="true"]')?.closest<HTMLElement>('[data-notebook-note]')
    const notes = applyNotebookRows(current.notes, expected.notes, next.notes, focused?.dataset.notebookNote)
    const folders = applyNotebookRows(current.folders, expected.folders, next.folders)
    const complete = !notes.deferred && !folders.deferred
    if (notes.rows === current.notes && folders.rows === current.folders) return complete
    const value = { ...current, notes: notes.rows, folders: folders.rows }
    latest.current = value
    Object.assign(pendingPatch.current, changedSnapshotSections(current, value))
    const save = drainPending()
    flushSync(() => {
      setSnapshot(value)
      if (notes.applied.length) setNoteRevisions((revisions) => {
        const updated = new Map(revisions)
        const present = new Set(notes.rows.map(({ id }) => id))
        for (const id of notes.applied) {
          if (present.has(id)) updated.set(id, (revisions.get(id) ?? 0) + 1)
          else updated.delete(id)
        }
        return updated
      })
    })
    await save
    return complete
  }, [drainPending])

  const rollbackDrive = useCallback(async () => { await replaceWith(async () => {
    const drive = window.sylunae?.driveBackup
    if (!drive) throw new Error('当前设备没有云端恢复记录。')
    await drive.rollback()
    return repository.load()
  }, true) }, [replaceWith])

  const driveSync = useDriveSync(snapshot, flush, replaceIfUnchanged, applyNotebook)

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current)
    if (snapshotPatchEntries(pendingPatch.current).length > 0) void repository.save(pendingPatch.current)
  }, [])

  const value = useMemo(() => ({ snapshot, snapshotEpoch, noteRevisions, loading, saving, error, update, replace, rollbackDrive, flush, driveSync }), [snapshot, snapshotEpoch, noteRevisions, loading, saving, error, update, replace, rollbackDrive, flush, driveSync])
  return <AppStoreContext.Provider value={value}>{children}</AppStoreContext.Provider>
}

export function useAppStore(): AppStoreValue {
  const value = useContext(AppStoreContext)
  if (!value) throw new Error('useAppStore must be used inside AppStoreProvider')
  return value
}
