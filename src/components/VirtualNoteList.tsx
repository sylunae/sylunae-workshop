import { memo, useEffect, useRef, useState, type CSSProperties } from 'react'
import { Pin } from 'lucide-react'
import type { Note } from '../shared/types'
import { notePreview } from '../editor/notePreview'
import { formatDate } from '../utils'

export const VirtualNoteList = memo(function VirtualNoteList({ notes, selectedId, onSelect, resetKey, compact = false }: {
  notes: Note[]; selectedId: string | null; onSelect: (id: string) => void; resetKey: string; compact?: boolean
}) {
  const viewport = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [height, setHeight] = useState(600)
  const rowHeight = compact ? 96 : 112
  useEffect(() => {
    const element = viewport.current
    if (!element) return
    const observer = new ResizeObserver(() => setHeight(element.clientHeight))
    observer.observe(element)
    setHeight(element.clientHeight)
    return () => observer.disconnect()
  }, [])
  useEffect(() => { if (viewport.current) viewport.current.scrollTop = 0; setScrollTop(0) }, [resetKey])
  const start = Math.min(Math.max(0, notes.length - 1), Math.max(0, Math.floor(scrollTop / rowHeight) - 6))
  const end = Math.min(notes.length, start + Math.ceil(height / rowHeight) + 12)
  return <div ref={viewport} className={`note-list virtual-note-list${compact ? ' compact' : ''}`} onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)} style={{ '--note-row-height': `${rowHeight}px` } as CSSProperties}>
    <div aria-hidden="true" style={{ height: start * rowHeight }} />
    {notes.slice(start, end).map((note) => <NoteListItem key={note.id} note={note} selected={selectedId === note.id} onSelect={onSelect} />)}
    <div aria-hidden="true" style={{ height: (notes.length - end) * rowHeight }} />
  </div>
})

const NoteListItem = memo(function NoteListItem({ note, selected, onSelect }: { note: Note; selected: boolean; onSelect: (id: string) => void }) {
  const preview = notePreview(note)
  return <button className={selected ? 'active' : ''} onClick={() => onSelect(note.id)}><div><strong className={note.title ? 'private-note-title' : undefined}>{note.title || '无标题笔记'}</strong>{note.pinned && <Pin size={12} fill="currentColor" />}</div><p className={preview ? 'private-note-preview' : undefined}>{preview || '空白笔记'}</p><span>{formatDate(note.updatedAt, true)}</span></button>
})
