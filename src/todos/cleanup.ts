import type { QuickTodo } from '../shared/types'

export const COMPLETED_TODO_RETENTION_MS = 24 * 60 * 60 * 1000

export function todoExpiresAt(todo: QuickTodo): number | null {
  if (!todo.completed) return null
  // Older backups did not record completedAt; use their last update instead.
  const completedAt = Date.parse(todo.completedAt ?? todo.updatedAt)
  return Number.isFinite(completedAt) ? completedAt + COMPLETED_TODO_RETENTION_MS : null
}

export function removeExpiredTodos(todos: QuickTodo[], now: number): QuickTodo[] {
  const remaining = todos.filter((todo) => {
    const expiresAt = todoExpiresAt(todo)
    return expiresAt === null || expiresAt > now
  })
  return remaining.length === todos.length ? todos : remaining
}
