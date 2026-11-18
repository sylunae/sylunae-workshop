import type { QuickTodo } from '../shared/types'
import { newId, nowIso } from '../utils'

export function createQuickTodo(title: string): QuickTodo {
  const now = nowIso()
  return { id: newId(), title, priority: 'medium', dueDate: '', completed: false, completedAt: null, createdAt: now, updatedAt: now }
}
