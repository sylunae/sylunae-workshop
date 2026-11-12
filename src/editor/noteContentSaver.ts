import type { Node } from '@tiptap/pm/model'
import type { Note } from '../shared/types'

/** Retain immutable document snapshots; serialize only when committing. */
export function createNoteContentSaver(save: (content: Note['content']) => void, delay = 500, maxDelay = 10_000) {
  let committed: Node | null = null
  let pending: Node | null = null
  let timer: ReturnType<typeof setTimeout> | null = null
  let deadline: ReturnType<typeof setTimeout> | null = null
  const clear = () => {
    if (timer !== null) clearTimeout(timer)
    if (deadline !== null) clearTimeout(deadline)
    timer = deadline = null
  }
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
    schedule(doc: Node) {
      pending = doc
      if (timer !== null) clearTimeout(timer)
      timer = setTimeout(flush, delay)
      deadline ??= setTimeout(flush, maxDelay)
    },
  }
}
