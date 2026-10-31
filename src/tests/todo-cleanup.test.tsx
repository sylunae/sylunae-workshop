// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppStoreProvider, useAppStore } from '../app/AppStore'
import { createDefaultSnapshot } from '../shared/defaults'
import type { AppSnapshot, QuickTodo } from '../shared/types'
import { COMPLETED_TODO_RETENTION_MS, removeExpiredTodos } from '../todos/cleanup'

const storage = vi.hoisted(() => ({ load: vi.fn(), save: vi.fn(), replace: vi.fn() }))
vi.mock('../data/repository', () => ({ repository: storage }))

const now = Date.parse('2026-10-30T10:00:00Z')
const completedAt = new Date(now - COMPLETED_TODO_RETENTION_MS + 1000).toISOString()
const todo: QuickTodo = { id: 'one', title: '临时事项', priority: 'medium', dueDate: '', completed: true, completedAt, createdAt: completedAt, updatedAt: completedAt }
let store: ReturnType<typeof useAppStore>
function OtherPage() { store = useAppStore(); return <div>其他页面</div> }

async function open(todos: QuickTodo[]) {
  storage.load.mockResolvedValue({ ...createDefaultSnapshot(), todos })
  await act(async () => { render(<AppStoreProvider><OtherPage /></AppStoreProvider>) })
}

describe('completed temporary todo cleanup', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(now)
    vi.clearAllMocks()
    storage.save.mockResolvedValue(undefined)
    storage.replace.mockImplementation(async (value: AppSnapshot) => value)
  })
  afterEach(() => { cleanup(); vi.useRealTimers() })

  it('keeps todos until exactly 24 hours and only persists the changed domain', async () => {
    await open([todo])
    await act(async () => { await vi.advanceTimersByTimeAsync(999) })
    expect(store.snapshot!.todos).toEqual([todo])
    expect(storage.save).not.toHaveBeenCalled()
    await act(async () => { await vi.advanceTimersByTimeAsync(1) })
    expect(store.snapshot!.todos).toEqual([])
    await act(async () => { await store.flush() })
    expect(storage.save).toHaveBeenCalledExactlyOnceWith({ todos: [] })
  })

  it('cleans overdue legacy todos when reopening while preserving open and recent items', async () => {
    const legacy = { ...todo, id: 'legacy', completedAt: null, updatedAt: new Date(now - COMPLETED_TODO_RETENTION_MS).toISOString() }
    const openTodo = { ...legacy, id: 'open', completed: false }
    await open([legacy, openTodo, todo])
    expect(store.snapshot!.todos).toEqual([openTodo, todo])
  })

  it('cancels cleanup when restored and starts a new 24 hour period when completed again', async () => {
    await open([todo])
    act(() => store.update((state) => ({ ...state, todos: [{ ...todo, completed: false, completedAt: null }] })))
    await act(async () => { await vi.advanceTimersByTimeAsync(2000) })
    expect(store.snapshot!.todos).toHaveLength(1)
    act(() => store.update((state) => ({ ...state, todos: [{ ...todo, completedAt: new Date(Date.now()).toISOString() }] })))
    await act(async () => { await vi.advanceTimersByTimeAsync(COMPLETED_TODO_RETENTION_MS - 1) })
    expect(store.snapshot!.todos).toHaveLength(1)
    await act(async () => { await vi.advanceTimersByTimeAsync(1) })
    expect(store.snapshot!.todos).toEqual([])
  })

  it('checks imported data and rechecks on resume after the clock moves forward', async () => {
    await open([])
    await act(async () => { await store.replace({ ...createDefaultSnapshot(), todos: [todo] }) })
    vi.setSystemTime(now + COMPLETED_TODO_RETENTION_MS)
    act(() => { window.dispatchEvent(new Event('focus')) })
    expect(store.snapshot!.todos).toEqual([])
    await act(async () => { await store.flush() })
    expect(storage.save).toHaveBeenLastCalledWith({ todos: [] })
  })

  it('keeps invalid timestamps and returns the same array when no cleanup is needed', () => {
    const todos = [todo, { ...todo, completedAt: 'invalid' }]
    expect(removeExpiredTodos(todos, now)).toBe(todos)
    expect(removeExpiredTodos(todos, now + 1000)).toEqual([todos[1]])
  })
})
