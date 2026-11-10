export const homeQuickActionIds = [
  'new-todo', 'music', 'pomodoro', 'collection', 'new-note',
  'goals', 'countdown', 'white-noise', 'images', 'rss', 'clipboard', 'notes',
] as const

export type HomeQuickActionId = typeof homeQuickActionIds[number]

export const maxHomeQuickActions = 7
export const defaultHomeQuickActions = homeQuickActionIds.slice(0, 5)

export function normalizeHomeQuickActions(ids: readonly HomeQuickActionId[] = []): HomeQuickActionId[] {
  const selected = [...new Set(ids)].filter((id) => homeQuickActionIds.includes(id)).slice(0, maxHomeQuickActions)
  return selected.length ? selected : [...defaultHomeQuickActions]
}
