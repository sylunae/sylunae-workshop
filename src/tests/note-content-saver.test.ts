import { afterEach, describe, expect, it, vi } from 'vitest'
import { Schema } from '@tiptap/pm/model'
import { createNoteContentSaver } from '../editor/noteContentSaver'
import { contentPreview } from '../editor/notePreview'
const schema = new Schema({ nodes: { doc: { content: 'paragraph*' }, paragraph: { content: 'text*' }, text: {} } })
const doc = (text: string) => schema.node('doc', null, [schema.node('paragraph', null, schema.text(text))])
afterEach(() => vi.useRealTimers())
describe('deferred note commits', () => {
  it('serializes only the last document after the debounce', () => {
    vi.useFakeTimers()
    const save = vi.fn()
    const saver = createNoteContentSaver(save)
    saver.reset(doc('initial'))
    const first = doc('first'), last = doc('last')
    const firstJSON = vi.spyOn(first, 'toJSON'), lastJSON = vi.spyOn(last, 'toJSON')
    saver.schedule(first); saver.schedule(last)
    expect(firstJSON).not.toHaveBeenCalled(); expect(lastJSON).not.toHaveBeenCalled()
    vi.advanceTimersByTime(500)
    expect(firstJSON).not.toHaveBeenCalled(); expect(lastJSON).toHaveBeenCalledTimes(1)
    expect(save).toHaveBeenCalledTimes(1)
  })
  it('flushes on switch and cancels stale content on import', () => {
    vi.useFakeTimers()
    const save = vi.fn(), saver = createNoteContentSaver(save)
    saver.reset(doc('initial')); saver.schedule(doc('edited')); saver.flush()
    vi.advanceTimersByTime(500); expect(save).toHaveBeenCalledTimes(1)
    saver.schedule(doc('stale')); saver.reset(doc('imported'))
    vi.advanceTimersByTime(500); expect(save).toHaveBeenCalledTimes(1)
    saver.schedule(doc('imported')); saver.flush()
    expect(save).toHaveBeenCalledTimes(1)
  })
  it('bounds previews without visiting the remainder of a large document', () => {
    const expensive = { get text(): string { throw new Error('should not traverse remainder') } }
    expect(contentPreview({ type: 'doc', content: [{ text: 'a'.repeat(200) }, expensive] })).toHaveLength(160)
  })
})
