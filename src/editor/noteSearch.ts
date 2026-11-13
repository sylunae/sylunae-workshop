import type { JSONContent } from '@tiptap/core'
import type { Note } from '../shared/types'

const searchText = new WeakMap<Note['content'], string>()

function collectText(node: JSONContent, parts: string[]) {
  if (node.text) parts.push(node.text)
  const attributes = node.type === 'linkBookmark' ? ['label', 'description', 'host', 'href']
    : node.type === 'image' ? ['caption', 'alt'] : []
  for (const key of attributes) {
    const value = node.attrs?.[key]
    if (typeof value === 'string' && value) parts.push(value)
  }
  for (const child of node.content ?? []) collectText(child, parts)
}

export function noteSearchText(note: Note) {
  let body = searchText.get(note.content)
  if (body === undefined) {
    const parts: string[] = []
    collectText(note.content, parts)
    body = parts.join(' ').toLowerCase()
    searchText.set(note.content, body)
  }
  return `${note.title.toLowerCase()} ${body}`
}
