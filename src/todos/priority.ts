import type { QuickTodo, TodoPriority } from '../shared/types'

export const todoPriorityLabel: Record<TodoPriority, string> = { low: '低', medium: '中', high: '高' }
const priorityRank: Record<TodoPriority, number> = { low: 0, medium: 1, high: 2 }

export function nextTodoPriority(priority: TodoPriority): TodoPriority {
  return priority === 'low' ? 'medium' : priority === 'medium' ? 'high' : 'low'
}

export function compareTodoPriority(a: { priority: TodoPriority }, b: { priority: TodoPriority }): number {
  return priorityRank[b.priority] - priorityRank[a.priority]
}

export function compareQuickTodos(a: QuickTodo, b: QuickTodo): number {
  return Number(a.completed) - Number(b.completed)
    || (a.completed
      ? (b.completedAt ?? b.updatedAt).localeCompare(a.completedAt ?? a.updatedAt)
      : Number(Boolean(b.inProgress)) - Number(Boolean(a.inProgress)) || compareTodoPriority(a, b) || b.createdAt.localeCompare(a.createdAt))
}
