import { contentPreview } from './notePreview'
import type { Note } from '../shared/types'

function noteFieldEquals(current: Note[keyof Note], next: Note[keyof Note]): boolean {
  if (Object.is(current, next)) return true
  if (typeof current !== 'object' || current === null || typeof next !== 'object' || next === null) return false
  const left = current as Record<string, unknown>
  const right = next as Record<string, unknown>
  const keys = Object.keys(left)
  return keys.length === Object.keys(right).length && keys.every((key) =>
    Object.prototype.hasOwnProperty.call(right, key) && noteFieldEquals(left[key] as Note[keyof Note], right[key] as Note[keyof Note]))
}

export function applyNotePatch(note: Note, patch: Partial<Note>, updatedAt: string) {
  const changed = (Object.keys(patch) as (keyof Note)[])
    .some((key) => key === 'content' ? note.content !== patch.content : !noteFieldEquals(note[key], patch[key] as Note[keyof Note]))

  return changed ? { ...note, ...patch, preview: patch.content ? contentPreview(patch.content) : note.preview ?? contentPreview(note.content), updatedAt } : note
}
