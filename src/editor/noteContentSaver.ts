import type { Node } from '@tiptap/pm/model'
import type { Note } from '../shared/types'

/** Retain immutable document snapshots; serialize only when committing. */
export function createNoteContentSaver(save: (content: Note['content']) => void, delay = 500) {
  let committed: Node | null = null
  let pending: Node | null = null
  let timer: ReturnType<typeof setTimeout> | null = null
  const clear = () => { if (timer !== null) clearTimeout(timer); timer = null }
  const flush = () => {
    clear()
    if (!pending) return
    const doc = pending
    pending = null
    if (committed?.eq(doc)) return
    save(doc.toJSON())
    committed = doc
  }
  return {
    flush,
    reset(doc: Node) { clear(); pending = null; committed = doc },
    schedule(doc: Node) { pending = doc; clear(); timer = setTimeout(flush, delay) },
  }
}
