import type { AppSnapshot, AppSnapshotPatch } from '../shared/types'

export const snapshotSectionKeys = [
  'version',
  'settings',
  'bangumi',
  'imageLibrary',
  'collectionExtras',
  'tracks',
  'albums',
  'folders',
  'notes',
  'goals',
  'todos',
  'recurringTodos',
  'todoCompletionRecords',
  'pomodoro',
  'countdowns',
  'clipboardSnippets',
  'launcherLinks',
  'birthdays',
] as const satisfies readonly (keyof AppSnapshot)[]

export type SnapshotSectionKey = typeof snapshotSectionKeys[number]

export function changedSnapshotSections(current: AppSnapshot, next: AppSnapshot): AppSnapshotPatch {
  const patch: AppSnapshotPatch = {}
  for (const key of snapshotSectionKeys) {
    if (current[key] !== next[key]) Object.assign(patch, { [key]: next[key] })
  }
  return patch
}

export function splitSnapshot(snapshot: AppSnapshot): Array<{ key: SnapshotSectionKey; value: unknown }> {
  return snapshotSectionKeys.map((key) => ({ key, value: snapshot[key] }))
}

export function joinSnapshotSections(rows: Array<{ key: string; value: unknown }>): Partial<AppSnapshot> {
  const allowed = new Set<string>(snapshotSectionKeys)
  const snapshot: Partial<AppSnapshot> = {}
  for (const row of rows) {
    if (allowed.has(row.key)) Object.assign(snapshot, { [row.key]: row.value })
  }
  return snapshot
}

export function snapshotPatchEntries(patch: AppSnapshotPatch): Array<{ key: SnapshotSectionKey; value: unknown }> {
  return snapshotSectionKeys.flatMap((key) => Object.prototype.hasOwnProperty.call(patch, key) && patch[key] !== undefined
    ? [{ key, value: patch[key] }]
    : [])
}
