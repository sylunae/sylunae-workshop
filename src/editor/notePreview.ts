import type { JSONContent } from '@tiptap/core'
import type { Note } from '../shared/types'

const cache = new WeakMap<Note, string>()
export function contentPreview(content: JSONContent, limit = 160): string {
  let result = ''
  const visit = (node: JSONContent) => {
    if (result.length >= limit) return
    if (node.text) result += node.text.slice(0, limit - result.length)
    for (const child of node.content ?? []) {
      if (result.length >= limit) break
      if (result) result += ' '
      visit(child)
    }
  }
  visit(content)
  return result.slice(0, limit).trim()
}
export function notePreview(note: Note): string {
  if (note.preview !== undefined) return note.preview
  let value = cache.get(note)
  if (value === undefined) { value = contentPreview(note.content); cache.set(note, value) }
  return value
}
