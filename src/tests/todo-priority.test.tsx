// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppStoreProvider, useAppStore } from '../app/AppStore'
import { TasksPage, type TaskView } from '../pages/TasksPage'
import { createDefaultSnapshot } from '../shared/defaults'
import type { QuickTodo, RecurringTodo } from '../shared/types'
import { localDateKey } from '../todos/recurring'

const storage = vi.hoisted(() => ({ load: vi.fn(), save: vi.fn() }))
vi.mock('../data/repository', () => ({ repository: storage }))
vi.mock('../pages/GoalsPage', () => ({ GoalsPage: () => null }))
vi.mock('canvas-confetti', () => ({ default: { create: () => vi.fn() } }))

const timestamp = new Date().toISOString()
const base: QuickTodo = { id: 'medium', title: '普通事项', priority: 'medium', dueDate: '', completed: false, completedAt: null, createdAt: timestamp, updatedAt: timestamp }
const routine: RecurringTodo = { id: 'routine', title: '每日拉伸', priority: 'low', frequency: 'daily', startDate: localDateKey(), paused: false, createdAt: timestamp, updatedAt: timestamp }
let store: ReturnType<typeof useAppStore>
function TestPage({ view = 'todos' }: { view?: TaskView }) { store = useAppStore(); return <TasksPage view={view} onViewChange={() => undefined} /> }

async function open() {
  const snapshot = createDefaultSnapshot()
  snapshot.todos = [base, { ...base, id: 'high', title: '重要事项', priority: 'high' }, { ...base, id: 'low', title: '稍后处理', priority: 'low' }, { ...base, id: 'done', title: '已经完成', priority: 'high', completed: true, completedAt: timestamp }]
  snapshot.recurringTodos = [routine, { ...routine, id: 'routine-high', title: '每日阅读', priority: 'high' }]
  storage.load.mockResolvedValue(snapshot)
  let rendered!: ReturnType<typeof render>
  await act(async () => { rendered = render(<AppStoreProvider><TestPage /></AppStoreProvider>) })
  return rendered
}

describe('todo priority controls', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    HTMLElement.prototype.scrollTo = vi.fn()
    storage.save.mockResolvedValue(undefined)
  })
  afterEach(cleanup)

  it('toggles progress ahead of priority, persists it, and clears it on completion', async () => {
    const rendered = await open()
    const titles = () => [...document.querySelectorAll<HTMLInputElement>('.quick-list .todo-copy input')].map((input) => input.value)
    fireEvent.click(screen.getByRole('button', { name: '稍后处理：标记为正在进行中' }))
    expect(titles()).toEqual(['稍后处理', '重要事项', '普通事项', '已经完成'])
    expect(screen.getByRole('button', { name: '稍后处理：正在进行中，点击关闭' }).getAttribute('aria-pressed')).toBe('true')
    await act(async () => { await store.flush() })
    expect(storage.save).toHaveBeenLastCalledWith({ todos: store.snapshot!.todos })
    expect(store.snapshot!.todos.find((todo) => todo.id === 'low')?.inProgress).toBe(true)
    rendered.rerender(<AppStoreProvider><TestPage view="goals" /></AppStoreProvider>)
    rendered.rerender(<AppStoreProvider><TestPage view="todos" /></AppStoreProvider>)
    expect(titles()[0]).toBe('稍后处理')
    fireEvent.click(screen.getByRole('button', { name: '稍后处理：正在进行中，点击关闭' }))
    expect(titles()).toEqual(['重要事项', '普通事项', '稍后处理', '已经完成'])
    fireEvent.click(screen.getByRole('button', { name: '稍后处理：标记为正在进行中' }))
    fireEvent.click(screen.getAllByRole('button', { name: '完成待办' })[0])
    expect(store.snapshot!.todos.find((todo) => todo.id === 'low')).toMatchObject({ completed: true, inProgress: false })
    expect(titles().slice(0, 2)).toEqual(['重要事项', '普通事项'])
  })

  it('cycles temporary todo priority in place and persists only todos', async () => {
    await open()
    const titles = () => [...document.querySelectorAll<HTMLInputElement>('.quick-list .todo-copy input')].map((input) => input.value)
    expect(titles()).toEqual(['重要事项', '普通事项', '稍后处理', '已经完成'])
    fireEvent.click(screen.getByRole('button', { name: '重要事项：高优先级，点击切换为低优先级' }))
    expect(titles()).toEqual(['重要事项', '普通事项', '稍后处理', '已经完成'])
    expect(screen.getByRole('button', { name: '重要事项：低优先级，点击切换为中优先级' }).closest('.todo-row')?.classList.contains('priority-low')).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: '重要事项：低优先级，点击切换为中优先级' }))
    expect(titles()).toEqual(['重要事项', '普通事项', '稍后处理', '已经完成'])
    fireEvent.click(screen.getByRole('button', { name: '重要事项：中优先级，点击切换为高优先级' }))
    expect(titles()[0]).toBe('重要事项')
    expect(screen.getByRole('button', { name: '重要事项：高优先级，点击切换为低优先级' }).closest('.todo-row')?.classList.contains('priority-high')).toBe(true)
    await act(async () => { await store.flush() })
    expect(storage.save).toHaveBeenLastCalledWith({ todos: store.snapshot!.todos })
  })

  it('supports routines in both views, keeps completions last, and preserves recurrence settings', async () => {
    await open()
    const titles = () => [...document.querySelectorAll('.routine-list .todo-title')].map((node) => node.textContent)
    expect(titles()).toEqual(['每日阅读', '每日拉伸'])
    fireEvent.click(screen.getByRole('button', { name: '每日阅读：高优先级，点击切换为低优先级' }))
    expect(titles()).toEqual(['每日阅读', '每日拉伸'])
    expect(store.snapshot!.recurringTodos[1]).toMatchObject({ priority: 'low', frequency: 'daily', startDate: routine.startDate })
    fireEvent.click(screen.getAllByRole('button', { name: '完成例行待办' })[0])
    expect(titles()).toEqual(['每日拉伸', '每日阅读'])
    fireEvent.click(screen.getByRole('button', { name: '全部例行' }))
    fireEvent.click(screen.getByRole('button', { name: '每日阅读：低优先级，点击切换为中优先级' }))
    expect(store.snapshot!.recurringTodos[1].priority).toBe('medium')
    await act(async () => { await store.flush() })
    expect(storage.save).toHaveBeenLastCalledWith({ recurringTodos: store.snapshot!.recurringTodos, todoCompletionRecords: store.snapshot!.todoCompletionRecords })
  })

  it('applies the latest priorities after leaving and reentering the page', async () => {
    const rendered = await open()
    const quickTitles = () => [...document.querySelectorAll<HTMLInputElement>('.quick-list .todo-copy input')].map((input) => input.value)
    const routineTitles = () => [...document.querySelectorAll('.routine-list .todo-title')].map((node) => node.textContent)
    fireEvent.click(screen.getByRole('button', { name: '重要事项：高优先级，点击切换为低优先级' }))
    fireEvent.click(screen.getByRole('button', { name: '每日阅读：高优先级，点击切换为低优先级' }))
    // Other edits and switching routine filters must not apply the new priority order.
    const titleInput = screen.getByDisplayValue('普通事项')
    fireEvent.change(titleInput, { target: { value: '普通事项已编辑' } })
    fireEvent.blur(titleInput)
    fireEvent.click(screen.getByRole('button', { name: '全部例行' }))
    expect(quickTitles()).toEqual(['重要事项', '普通事项已编辑', '稍后处理', '已经完成'])
    expect(routineTitles()).toEqual(['每日阅读', '每日拉伸'])
    rendered.rerender(<AppStoreProvider><TestPage view="goals" /></AppStoreProvider>)
    rendered.rerender(<AppStoreProvider><TestPage view="todos" /></AppStoreProvider>)
    expect(quickTitles()).toEqual(['普通事项已编辑', '重要事项', '稍后处理', '已经完成'])
    expect(routineTitles()).toEqual(['每日拉伸', '每日阅读'])
    expect(storage.load).toHaveBeenCalledOnce()
  })
})
