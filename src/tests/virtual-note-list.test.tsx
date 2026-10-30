// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { VirtualNoteList } from '../components/VirtualNoteList'
import type { Note } from '../shared/types'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('virtual notebook list', () => {
  it('bounds mounted rows and can reach the last note and reset after filtering', () => {
    vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
    const notes: Note[] = Array.from({ length: 10000 }, (_, index) => ({
      id: `${index}`, title: `Note ${index}`, preview: 'Preview', content: { type: 'doc' },
      folderId: null, tags: [], pinned: false, deletedAt: null,
      createdAt: '2026-01-01', updatedAt: '2026-01-01',
    }))
    const onSelect = vi.fn()
    const { container, rerender } = render(<VirtualNoteList notes={notes} selectedId="0" onSelect={onSelect} resetKey="all" />)
    const viewport = container.querySelector('.virtual-note-list') as HTMLDivElement
    expect(viewport.querySelectorAll('button').length).toBeLessThan(40)
    fireEvent.click(viewport.querySelector('button')!)
    expect(onSelect).toHaveBeenCalledWith('0')
    fireEvent.scroll(viewport, { target: { scrollTop: 9999 * 112 } })
    expect(viewport.textContent).toContain('Note 9999')
    expect(viewport.querySelectorAll('button').length).toBeLessThan(40)
    rerender(<VirtualNoteList notes={[notes[42]]} selectedId="42" onSelect={onSelect} resetKey="search" />)
    expect(viewport.scrollTop).toBe(0)
    expect(viewport.querySelectorAll('button')).toHaveLength(1)
    expect(viewport.textContent).toContain('Note 42')
  })
})
