export const homeQuickActionIds = [
  'new-todo', 'music', 'pomodoro', 'collection', 'new-note',
  'goals', 'countdown', 'white-noise', 'images', 'clipboard', 'notes',
] as const

export type HomeQuickActionId = typeof homeQuickActionIds[number]

export const maxHomeQuickActions = 7
export const defaultHomeQuickActions = homeQuickActionIds.slice(0, 5)

export function normalizeHomeQuickActions(ids: readonly string[] = []): HomeQuickActionId[] {
  const selected = [...new Set(ids)].filter((id): id is HomeQuickActionId => homeQuickActionIds.some((actionId) => actionId === id)).slice(0, maxHomeQuickActions)
  return selected.length ? selected : [...defaultHomeQuickActions]
}
