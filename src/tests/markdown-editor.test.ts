// @vitest-environment jsdom

import { Editor } from '@tiptap/core'
import { Image } from '@tiptap/extension-image'
import { Link } from '@tiptap/extension-link'
import { TaskItem } from '@tiptap/extension-task-item'
import { TaskList } from '@tiptap/extension-task-list'
import { TableKit } from '@tiptap/extension-table'
import { Details, DetailsContent, DetailsSummary } from '@tiptap/extension-details'
import { Markdown } from '@tiptap/markdown'
import StarterKit from '@tiptap/starter-kit'
import { describe, expect, it } from 'vitest'
import { handleMarkdownPaste, looksLikeMarkdown, MarkdownPaste, normalizeOrderedListMarkers } from '../editor/markdownPaste'
import { LinkBookmark } from '../editor/linkBookmark'
import { applyNotePatch } from '../editor/notePatch'
import { applyNoteLink } from '../editor/noteLink'
import { markdownExport, markdownFileName, splitMarkdownNote } from '../editor/noteMarkdown'
import type { Note } from '../shared/types'

const DetailsSummaryWithBreaks = DetailsSummary.extend({ content: 'inline*' })

function pasteEvent(text: string) {
  const event = new Event('paste', { bubbles: true, cancelable: true }) as ClipboardEvent
  Object.defineProperty(event, 'clipboardData', {
    value: { getData: (type: string) => type === 'text/plain' ? text : '' },
  })
  return event
}

describe('note editor markdown paste', () => {
  it('turns a directly pasted URL into a link bookmark', () => {
    const editor = new Editor({
      element: document.createElement('div'),
      extensions: [StarterKit, LinkBookmark, MarkdownPaste],
      content: '',
    })
    const event = pasteEvent('https://example.com/guide')

    expect(handleMarkdownPaste(editor, event)).toBe(true)
    expect(event.defaultPrevented).toBe(true)
    expect(editor.getJSON().content?.[0]).toMatchObject({ type: 'linkBookmark', attrs: { href: 'https://example.com/guide', host: 'example.com', label: 'example.com' } })
    editor.destroy()
  })

  it('exports a link bookmark as a usable Markdown link', () => {
    const editor = new Editor({
      element: document.createElement('div'),
      extensions: [StarterKit, LinkBookmark, Markdown],
      content: { type: 'doc', content: [{ type: 'linkBookmark', attrs: { href: 'https://example.com/guide', host: 'example.com', label: '示例指南' } }] },
    })

    expect(editor.getMarkdown()).toBe('[示例指南](https://example.com/guide)')
    editor.destroy()
  })

  it('leaves a URL to the native text paste path with Ctrl/Cmd + Shift + V', () => {
    const editor = new Editor({ element: document.createElement('div'), extensions: [StarterKit, LinkBookmark, MarkdownPaste], content: '' })
    const event = pasteEvent('https://example.com')

    expect(handleMarkdownPaste(editor, event, true)).toBe(false)
    expect(event.defaultPrevented).toBe(false)
    editor.destroy()
  })

  it('inserts a visible link when no text is selected', () => {
    const editor = new Editor({
      element: document.createElement('div'),
      extensions: [StarterKit.configure({ link: false }), Link],
      content: '<p></p>',
    })

    expect(applyNoteLink(editor, 'https://example.com')).toBe(true)
    expect(editor.getJSON().content?.[0]).toMatchObject({ content: [{ text: 'https://example.com', marks: [{ type: 'link', attrs: { href: 'https://example.com' } }] }] })
    editor.destroy()
  })

  it('normalizes repeated numbered-list markers in pasted text', () => {
    expect(normalizeOrderedListMarkers('1. 第一项\n1. 第二项\n2. 第三项\n3. 第四项')).toBe('1. 第一项\n2. 第二项\n3. 第三项\n4. 第四项')
  })

  it('creates collapsible blocks whose open state is stored in note content', () => {
    const editor = new Editor({
      element: document.createElement('div'),
      extensions: [StarterKit, Details.configure({ persist: true }), DetailsSummaryWithBreaks, DetailsContent],
      content: '<p>可折叠的正文</p>',
    })

    expect(editor.commands.setDetails()).toBe(true)
    expect(editor.getJSON().content?.[0]).toMatchObject({
      type: 'details',
      attrs: { open: false },
      content: [{ type: 'detailsSummary' }, { type: 'detailsContent', content: [{ type: 'paragraph', content: [{ text: '可折叠的正文' }] }] }],
    })

    const toggle = editor.view.dom.querySelector('[data-type="details"] > button') as HTMLButtonElement
    toggle.click()
    expect(editor.getJSON().content?.[0]).toMatchObject({ attrs: { open: true } })

    editor.commands.insertContent({ type: 'hardBreak' })
    expect(editor.getJSON().content?.[0]?.content?.[0]).toMatchObject({ type: 'detailsSummary', content: [{ type: 'hardBreak' }] })
    editor.destroy()
  })

  it('inserts markdown as structured rich text', () => {
    const editor = new Editor({
      element: document.createElement('div'),
      extensions: [
        StarterKit.configure({ link: false }),
        Link.configure({ openOnClick: false }),
        Image.configure({ allowBase64: true }),
        TaskList,
        TaskItem.configure({ nested: true }),
        Markdown,
        MarkdownPaste,
      ],
      content: '',
    })

    const event = pasteEvent('# 标题\n\n**粗体**、*斜体*与[链接](https://example.com)\n\n- 第一项\n- 第二项\n\n- [x] 已完成\n- [ ] 待处理')
    expect(editor.view.dom.dispatchEvent(event)).toBe(false)
    expect(event.defaultPrevented).toBe(true)

    const content = editor.getJSON().content
    expect(content?.[0]).toMatchObject({ type: 'heading', attrs: { level: 1 } })
    expect(content?.[1].content?.[0]).toMatchObject({ type: 'text', marks: [{ type: 'bold' }] })
    expect(content?.[1].content?.[2]).toMatchObject({ type: 'text', marks: [{ type: 'italic' }] })
    expect(content?.[1].content?.[4]).toMatchObject({ type: 'text', marks: [{ type: 'link', attrs: { href: 'https://example.com' } }] })
    expect(content?.[2]).toMatchObject({ type: 'bulletList' })
    expect(content?.[3]).toMatchObject({
      type: 'taskList',
      content: [
        { type: 'taskItem', attrs: { checked: true } },
        { type: 'taskItem', attrs: { checked: false } },
      ],
    })

    editor.destroy()
  })

  it('recognizes inline emphasis and leaves ordinary text to the normal paste handler', () => {
    expect(looksLikeMarkdown('*斜体*')).toBe(true)
    expect(looksLikeMarkdown('**粗体**')).toBe(true)
    expect(looksLikeMarkdown('普通文本')).toBe(false)
  })

  it('converts Markdown tables into editable table nodes', () => {
    const editor = new Editor({
      element: document.createElement('div'),
      extensions: [StarterKit, TableKit, Markdown, MarkdownPaste],
      content: '',
    })

    const event = pasteEvent('| 名称 | 状态 |\n| --- | --- |\n| 读书 | 进行中 |')
    editor.view.dom.dispatchEvent(event)

    expect(event.defaultPrevented).toBe(true)
    expect(editor.getJSON().content?.[0]).toMatchObject({
      type: 'table',
      content: [
        { type: 'tableRow', content: [{ type: 'tableHeader' }, { type: 'tableHeader' }] },
        { type: 'tableRow', content: [{ type: 'tableCell' }, { type: 'tableCell' }] },
      ],
    })

    editor.destroy()
  })

  it('continues a list item for every pasted plain-text line', () => {
    const editor = new Editor({
      element: document.createElement('div'),
      extensions: [StarterKit, MarkdownPaste],
      content: {
        type: 'doc',
        content: [{
          type: 'bulletList',
          content: [
            { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: '已有内容' }] }] },
            { type: 'listItem', content: [{ type: 'paragraph' }] },
          ],
        }],
      },
    })

    editor.commands.focus('end')
    const event = pasteEvent('第一行\n第二行\n第三行')
    editor.view.dom.dispatchEvent(event)

    expect(event.defaultPrevented).toBe(true)
    expect(editor.getJSON().content?.[0]).toMatchObject(
      {
        type: 'bulletList',
        content: [
          { content: [{ content: [{ text: '已有内容' }] }] },
          { content: [{ content: [{ text: '第一行' }] }] },
          { content: [{ content: [{ text: '第二行' }] }] },
          { content: [{ content: [{ text: '第三行' }] }] },
        ],
      },
    )

    editor.destroy()
  })
})

describe('note updates', () => {
  const note: Note = {
    id: 'note-1',
    title: '笔记',
    content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '正文' }] }] },
    folderId: null,
    tags: ['标签'],
    pinned: false,
    deletedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }

  it('keeps the original note and timestamp for the same content reference', () => {
    const result = applyNotePatch(note, { content: note.content }, '2026-02-01T00:00:00.000Z')
    expect(result).toBe(note)
    expect(result.updatedAt).toBe('2026-01-01T00:00:00.000Z')
  })

  it('updates the timestamp only when a field actually changes', () => {
    const result = applyNotePatch(note, { title: '新标题' }, '2026-02-01T00:00:00.000Z')
    expect(result).not.toBe(note)
    expect(result).toMatchObject({ title: '新标题', updatedAt: '2026-02-01T00:00:00.000Z' })
  })
})

describe('single-note Markdown files', () => {
  it('exports a title as a Markdown heading and a safe filename', () => {
    expect(markdownExport('旅行 / 清单', '- 订机票')).toBe('# 旅行 / 清单\n\n- 订机票\n')
    expect(markdownFileName('旅行 / 清单')).toBe('旅行 - 清单.md')
  })

  it('uses a leading level-one heading as the imported note title', () => {
    expect(splitMarkdownNote('\uFEFF# 新笔记\n\n正文')).toEqual({ title: '新笔记', content: '正文' })
    expect(splitMarkdownNote('没有标题')).toEqual({ title: null, content: '没有标题' })
  })
})
