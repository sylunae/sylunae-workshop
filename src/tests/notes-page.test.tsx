// @vitest-environment jsdom
import { createContext, useContext, useState } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { Editor } from '@tiptap/core'
import { NotesPage } from '../pages/NotesPage'
import { createDefaultSnapshot } from '../shared/defaults'
import type { AppSnapshot, Note } from '../shared/types'

vi.mock('../app/AppStore', () => ({ useAppStore: () => useContext(TestStore) }))

const timestamp = '2026-01-01T00:00:00Z'
const folder = { id: 'travel', name: 'Travel', createdAt: timestamp, updatedAt: timestamp }
function note(id: string, title: string, folderId: string | null = null, deletedAt: string | null = null): Note {
  return { id, title, folderId, deletedAt, tags: [], pinned: false, createdAt: timestamp, updatedAt: timestamp,
    content: { type: 'doc', content: [{ type: 'paragraph' }] } }
}

let snapshot: AppSnapshot
const TestStore = createContext<ReturnType<typeof useTestStore> | null>(null)
function useTestStore() {
  const [value, setValue] = useState(snapshot)
  snapshot = value
  return { snapshot: value, update: setValue, driveSync: {}, snapshotEpoch: 0, noteRevisions: new Map() }
}
function mount() {
  function Harness() {
    return <TestStore.Provider value={useTestStore()}><NotesPage /></TestStore.Provider>
  }
  render(<Harness />)
}

function click(name: string | RegExp) {
  fireEvent.click(screen.getByRole('button', { name }))
}

function menu(name: string) {
  fireEvent.keyDown(screen.getByRole('button', { name }), { key: 'Enter' })
}

function search(value: string) {
  fireEvent.change(screen.getByLabelText('搜索笔记'), { target: { value } })
}

async function editor() {
  await screen.findByLabelText('笔记标题')
  return (document.querySelector('.tiptap') as HTMLElement & { editor: Editor }).editor
}

beforeEach(() => {
  window.localStorage.clear()
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  snapshot = createDefaultSnapshot()
})
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

it('validates names, renames in place, and deletes the folder while preserving live and trashed notes', async () => {
  snapshot.folders = [folder, { ...folder, id: 'other', name: 'Other' }]
  snapshot.notes = [note('live', 'Active', folder.id), note('trash', 'Trashed', folder.id, timestamp)]
  mount()
  click('新建文件夹')
  fireEvent.change(screen.getByRole('dialog').querySelector('input')!, { target: { value: ' travel ' } })
  click('创建')
  expect(screen.getByText(/已有同名文件夹/)).toBeTruthy()
  click('取消')

  menu('管理文件夹：Travel')
  fireEvent.click(screen.getByRole('menuitem', { name: '重命名' }))
  const input = screen.getByRole('dialog').querySelector('input')!
  expect(input.value).toBe('Travel')
  fireEvent.change(input, { target: { value: 'Other' } })
  click('保存')
  expect(screen.getByText(/已有同名文件夹/)).toBeTruthy()
  fireEvent.change(input, { target: { value: 'Journeys' } })
  click('保存')
  expect(snapshot.folders[0]).toMatchObject({ id: folder.id, name: 'Journeys' })

  click(/^Journeys/)
  menu('管理文件夹：Journeys')
  fireEvent.click(screen.getByRole('menuitem', { name: '删除文件夹' }))
  click('删除文件夹')
  await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
  expect(snapshot.folders.map(({ id }) => id)).toEqual(['other'])
  expect(snapshot.notes.map(({ id, folderId, deletedAt }) => [id, folderId, deletedAt]))
    .toEqual([['live', null, null], ['trash', null, timestamp]])
  expect(screen.getByRole('button', { name: /^无文件夹/ }).getAttribute('aria-pressed')).toBe('true')
  expect(screen.getByLabelText('笔记标题')).toHaveProperty('value', 'Active')
})

it('keeps editing when a search stops matching, and creates a focused note in the current folder', async () => {
  snapshot.folders = [folder]
  snapshot.notes = [{ ...note('target', 'Original', folder.id), content: { type: 'doc', content: [
    { type: 'paragraph', content: [{ type: 'text', text: 'unique phrase' }] },
  ] } }, note('other', 'Other', folder.id)]
  mount()
  click(/^Travel/)
  const instance = await editor()
  search('unique phrase')
  const title = screen.getByLabelText('笔记标题')
  act(() => {
    instance.commands.clearContent()
    instance.emit('blur', { editor: instance, event: new FocusEvent('blur'), transaction: instance.state.tr })
  })
  expect(screen.getByText('没有匹配的笔记')).toBeTruthy()
  expect(screen.getByLabelText('笔记标题')).toBe(title)
  expect(screen.getByRole('button', { name: '撤销编辑' })).toHaveProperty('disabled', false)
  click('新建笔记')
  await waitFor(() => expect(document.activeElement?.getAttribute('aria-label')).toBe('笔记标题'))
  expect(screen.getByLabelText('搜索笔记')).toHaveProperty('value', '')
  expect(screen.getByLabelText('笔记标题')).toHaveProperty('value', '无标题笔记')
  expect(snapshot.notes[0].folderId).toBe(folder.id)
  expect(screen.getByRole('button', { name: /^Travel/ }).getAttribute('aria-pressed')).toBe('true')
})

it('filters unfiled notes, finds bookmark metadata, and reopens a note after undoing trash', async () => {
  snapshot.notes = [
    { ...note('bookmark', 'Reference'), content: { type: 'doc', content: [{ type: 'linkBookmark',
      attrs: { label: 'Trail Guide', description: 'Mountain routes', host: 'example.org', href: 'https://example.org/maps' } }] } },
    note('filed', 'Filed note', folder.id),
  ]
  snapshot.folders = [folder]
  mount()
  click(/^无文件夹/)
  const list = within(document.querySelector('.note-list-pane') as HTMLElement)
  expect(list.queryByText('Filed note')).toBeNull()
  search('mountain routes')
  fireEvent.click(list.getByRole('button', { name: /^Reference/ }))
  await editor()
  menu('笔记操作')
  fireEvent.click(screen.getByRole('menuitem', { name: '移至回收站' }))
  expect(snapshot.notes[0].deletedAt).toBeTruthy()
  click('撤销')
  expect(snapshot.notes[0].deletedAt).toBeNull()
  expect(await screen.findByLabelText('笔记标题')).toHaveProperty('value', 'Reference')
})

it('updates formatting, link, and table controls on editor transactions', async () => {
  snapshot.notes = [note('editor', 'Formatting')]
  mount()
  const instance = await editor()
  act(() => { instance.commands.setContent('<p><strong>Bold</strong> Plain <a href="https://example.org">Link</a></p>') })
  act(() => { instance.commands.setTextSelection(2) })
  expect(screen.getByRole('button', { name: '粗体' }).getAttribute('aria-pressed')).toBe('true')
  act(() => { instance.commands.setTextSelection(13) })
  expect(screen.getByRole('button', { name: '粗体' }).getAttribute('aria-pressed')).toBe('false')
  menu('链接操作')
  const open = vi.spyOn(window, 'open').mockImplementation(() => null)
  fireEvent.click(screen.getByRole('menuitem', { name: '打开链接' }))
  expect(open).toHaveBeenCalledWith('https://example.org', '_blank', 'noopener,noreferrer')
  menu('链接操作')
  fireEvent.click(screen.getByRole('menuitem', { name: '修改链接' }))
  const input = screen.getByRole('dialog').querySelector('input')!
  fireEvent.change(input, { target: { value: 'https://example.com/updated' } })
  click('应用链接')
  expect(instance.getHTML()).toContain('href="https://example.com/updated"')
  expect(instance.getText()).toBe('Bold Plain Link')
  menu('链接操作')
  fireEvent.click(screen.getByRole('menuitem', { name: '移除链接' }))
  expect(instance.getHTML()).not.toContain('<a ')
  click('插入表格')
  menu('表格操作')
  fireEvent.click(screen.getByRole('menuitem', { name: '在下方添加行' }))
  expect(instance.view.dom.querySelectorAll('tr')).toHaveLength(4)
})

it('keeps the compact browser open while creating, renaming, and deleting a folder', async () => {
  snapshot.notes = [note('original', 'Original')]
  mount()
  click('笔记列表')
  const browser = screen.getByRole('dialog', { name: '笔记列表' })
  expect(within(browser).getByRole('combobox', { name: '筛选笔记文件夹' }).textContent).toContain('全部笔记')
  click('新建文件夹')
  const create = screen.getByRole('dialog', { name: '新建文件夹' })
  fireEvent.change(within(create).getByRole('textbox'), { target: { value: 'Ideas' } })
  click('创建')
  expect(screen.getByRole('dialog', { name: '笔记列表' })).toBe(browser)
  menu('管理文件夹：Ideas')
  fireEvent.click(screen.getByRole('menuitem', { name: '重命名' }))
  const rename = screen.getByRole('dialog', { name: '重命名文件夹' })
  fireEvent.change(within(rename).getByRole('textbox'), { target: { value: 'Drafts' } })
  click('保存')
  expect(within(browser).getByRole('combobox', { name: '筛选笔记文件夹' }).textContent).toContain('Drafts')
  menu('管理文件夹：Drafts')
  fireEvent.click(screen.getByRole('menuitem', { name: '删除文件夹' }))
  click('删除文件夹')
  await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
  expect(within(browser).getByRole('combobox', { name: '筛选笔记文件夹' }).textContent).toContain('无文件夹')
  expect(within(browser).getByRole('button', { name: /^Original/ })).toBeTruthy()
})
