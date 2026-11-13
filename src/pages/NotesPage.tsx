import { saveBlob } from '../platform/saveFile'
import { VirtualNoteList } from '../components/VirtualNoteList'
import { noteImageDataUrl } from '../data/noteAssets'
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { EditorContent, useEditor, useEditorState } from '@tiptap/react'
import { Markdown } from '@tiptap/markdown'
import StarterKit from '@tiptap/starter-kit'
import Link from '@tiptap/extension-link'
import Placeholder from '@tiptap/extension-placeholder'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import { TableKit } from '@tiptap/extension-table'
import { Details, DetailsContent, DetailsSummary } from '@tiptap/extension-details'
import { ArchiveRestore, Bold, CheckSquare, ChevronsUpDown, Code2, Columns3, Download, ExternalLink, Folder, FolderPlus, Heading2, ImagePlus, Italic, Link2, List, ListOrdered, MoreHorizontal, NotebookPen, Pin, PinOff, Plus, Quote, RefreshCw, Rows3, Search, Strikethrough, Table2, Trash2, Undo2, Upload, X } from 'lucide-react'
import { NodeSelection } from '@tiptap/pm/state'
import { useAppStore } from '../app/AppStore'
import type { Note, NoteFolder } from '../shared/types'
import { formatDate, newId, nowIso } from '../utils'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '../components/ui/dropdown-menu'
import { noteSearchText } from '../editor/noteSearch'
import { EmptyState } from '../components/Icons'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { PromptDialog } from '../components/PromptDialog'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../components/ui/dialog'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from '../components/ui/sheet'
import { MarkdownPaste } from '../editor/markdownPaste'
import { createNoteContentSaver } from '../editor/noteContentSaver'
import { applyNotePatch } from '../editor/notePatch'
import { applyNoteLink, noteLinkAtSelection, removeNoteLink } from '../editor/noteLink'
import { LinkBookmark } from '../editor/linkBookmark'
import { isImageNodeSelection, NoteImage, readImageFile } from '../editor/noteImage'
import { markdownExport, markdownFileName, splitMarkdownNote } from '../editor/noteMarkdown'
import { usePersistentState } from '../lib/usePersistentState'

type FolderFilter = 'all' | 'trash' | 'unfiled' | `folder:${string}`
const folderKey = (id: string): FolderFilter => `folder:${id}`
function matchesFolder(note: Note, filter: FolderFilter) {
  if (filter === 'trash') return Boolean(note.deletedAt)
  if (note.deletedAt) return false
  return filter === 'all' || (note.folderId === null ? filter === 'unfiled' : filter === folderKey(note.folderId))
}
const NoteDetailsSummary = DetailsSummary.extend({ content: 'inline*' })

function NotebookSyncButton() {
  const { driveSync } = useAppStore()
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  if (!driveSync.syncNotebookNow) return null
  const sync = async () => {
    setBusy(true)
    setMessage('')
    try { setMessage(await driveSync.syncNotebookNow!()) }
    catch (error) {
      setMessage(error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '') : '笔记同步失败，请重试。')
    } finally { setBusy(false) }
  }
  return <>
    <Button variant="outline" className="button" disabled={busy} onClick={() => void sync()}>
      <RefreshCw size={17} />{busy ? '同步中…' : '立即同步'}
    </Button>
    {message && <span className="notebook-sync-message" role="status">{message}</span>}
  </>
}

export function NotesPage({ createOnOpen = false }: { createOnOpen?: boolean }) {
  const { snapshot, snapshotEpoch, noteRevisions, update } = useAppStore()
  if (!snapshot) return null
  return <NotesWorkspace notes={snapshot.notes} folders={snapshot.folders} snapshotEpoch={snapshotEpoch} noteRevisions={noteRevisions} update={update} createOnOpen={createOnOpen} />
}

const NotesWorkspace = memo(function NotesWorkspace({ notes, folders, snapshotEpoch, noteRevisions, update, createOnOpen }: { notes: Note[]; folders: import('../shared/types').NoteFolder[]; snapshotEpoch: number; noteRevisions: ReadonlyMap<string, number>; update: ReturnType<typeof useAppStore>['update']; createOnOpen: boolean }) {
  const [requestedFilter, setFolderFilter] = useState<FolderFilter>('all')
  const activeFolder = folders.find((folder) => folderKey(folder.id) === requestedFilter)
  const folderFilter = requestedFilter.startsWith('folder:') && !activeFolder ? 'all' : requestedFilter
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = usePersistentState<string | null>('navigation.notesSelectedId', null)
  const [folderPrompt, setFolderPrompt] = useState<NoteFolder | 'new' | null>(null)
  const [deleteFolderTarget, setDeleteFolderTarget] = useState<NoteFolder | null>(null)
  const [trashed, setTrashed] = useState<{ id: string; deletedAt: string } | null>(null)
  const [newNoteId, setNewNoteId] = useState<string | null>(null)
  const clearNewNoteFocus = useCallback(() => setNewNoteId(null), [])
  const [browserOpen, setBrowserOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<Note | null>(null)
  const createdOnOpen = useRef(false)
  const noteById = useMemo(() => new Map(notes.map((note) => [note.id, note])), [notes])
  const selected = selectedId ? noteById.get(selectedId) ?? null : null
  const counts = useMemo(() => {
    const result = { all: 0, trash: 0, unfiled: 0, folders: new Map<string, number>() }
    for (const note of notes) {
      if (note.deletedAt) { result.trash++; continue }
      result.all++
      if (note.folderId !== null) result.folders.set(note.folderId, (result.folders.get(note.folderId) ?? 0) + 1)
      else result.unfiled++
    }
    return result
  }, [notes])

  const cleanQuery = query.trim().toLowerCase()
  const visibleNotes = useMemo(() => notes
    .filter((note) => matchesFolder(note, folderFilter) && (!cleanQuery || noteSearchText(note).includes(cleanQuery)))
    .sort((a, b) => Number(b.pinned) - Number(a.pinned) || noteTime(b) - noteTime(a)),
  [notes, folderFilter, cleanQuery])

  // Search can hide the current row without taking focus or undo history away from the editor.
  const editorNote = selected && Boolean(selected.deletedAt) === (folderFilter === 'trash') ? selected : null
  useEffect(() => {
    if (!editorNote && selectedId !== (visibleNotes[0]?.id ?? null)) setSelectedId(visibleNotes[0]?.id ?? null)
  }, [editorNote, visibleNotes, selectedId, setSelectedId])

  const changeFolder = (filter: FolderFilter) => {
    setFolderFilter(filter)
    if (selected && !matchesFolder(selected, filter)) setSelectedId(null)
  }

  const saveNote = useCallback((id: string, patch: Partial<Note>) => update((state) => {
    const index = state.notes.findIndex((note) => note.id === id)
    if (index < 0) return state
    const nextNote = applyNotePatch(state.notes[index], patch, nowIso())
    if (nextNote === state.notes[index]) return state
    const nextNotes = [...state.notes]
    nextNotes[index] = nextNote
    return { ...state, notes: nextNotes }
  }), [update])
  const addNote = () => {
    const now = nowIso()
    const note: Note = { id: newId(), title: '无标题笔记', content: { type: 'doc', content: [{ type: 'paragraph' }] }, folderId: activeFolder?.id ?? null, tags: [], pinned: false, deletedAt: null, createdAt: now, updatedAt: now }
    update((state) => ({ ...state, notes: [note, ...state.notes] }))
    setQuery('')
    if (folderFilter === 'trash') setFolderFilter('all')
    setBrowserOpen(false)
    setSelectedId(note.id)
    setNewNoteId(note.id)
  }
  useEffect(() => {
    if (!createOnOpen || createdOnOpen.current) return
    createdOnOpen.current = true
    addNote()
  }, [createOnOpen])
  const renameTarget = typeof folderPrompt === 'object' ? folderPrompt : null
  const validateFolderName = (name: string) => folders.some((folder) =>
    folder.id !== renameTarget?.id && folder.name.trim().toLowerCase() === name.toLowerCase())
    ? '已有同名文件夹，请使用其他名称。' : null
  const saveFolder = (name: string) => {
    const now = nowIso()
    if (folderPrompt === 'new') {
      const id = newId()
      update((state) => ({ ...state, folders: [...state.folders, { id, name, createdAt: now, updatedAt: now }] }))
      setQuery('')
      changeFolder(folderKey(id))
    } else if (renameTarget && renameTarget.name !== name) {
      update((state) => ({
        ...state, folders: state.folders.map((folder) => folder.id === renameTarget.id ? { ...folder, name, updatedAt: now } : folder),
      }))
    }
  }
  const deleteFolder = (folder: NoteFolder) => {
    const now = nowIso()
    update((state) => ({
      ...state,
      folders: state.folders.filter((item) => item.id !== folder.id),
      notes: state.notes.some((note) => note.folderId === folder.id)
        ? state.notes.map((note) => note.folderId === folder.id ? applyNotePatch(note, { folderId: null }, now) : note)
        : state.notes,
    }))
    if (folderFilter === folderKey(folder.id)) setFolderFilter('unfiled')
  }
  const selectFromBrowser = useCallback((id: string) => { setSelectedId(id); setBrowserOpen(false) }, [setSelectedId])
  const moveToTrash = (note: Note) => {
    const deletedAt = nowIso()
    saveNote(note.id, { deletedAt })
    setTrashed({ id: note.id, deletedAt })
  }
  const lastTrashed = trashed ? noteById.get(trashed.id) : undefined
  const undoable = lastTrashed?.deletedAt && lastTrashed.deletedAt === trashed?.deletedAt ? lastTrashed : null
  const undoTrash = () => {
    if (!undoable) return
    saveNote(undoable.id, { deletedAt: null })
    if (!matchesFolder({ ...undoable, deletedAt: null }, folderFilter)) setFolderFilter('all')
    setQuery('')
    setSelectedId(undoable.id)
    setTrashed(null)
  }
  const restore = (note: Note) => saveNote(note.id, { deletedAt: null })
  const destroy = (note: Note) => {
    update((state) => ({ ...state, notes: state.notes.filter((item) => item.id !== note.id) }))
    setSelectedId(null)
  }

  const folderActions = (folder: NoteFolder) => <DropdownMenu modal={false}>
    <DropdownMenuTrigger asChild><button className="icon-button" aria-label={`管理文件夹：${folder.name}`}><MoreHorizontal size={18} /></button></DropdownMenuTrigger>
    <DropdownMenuContent align="end">
      <DropdownMenuItem onSelect={() => setFolderPrompt(folder)}>重命名</DropdownMenuItem>
      <DropdownMenuItem variant="destructive" onSelect={() => setDeleteFolderTarget(folder)}>删除文件夹</DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>
  const filterButton = (filter: FolderFilter, label: string, count: number, icon: React.ReactNode) =>
    <button className={folderFilter === filter ? 'active' : ''} aria-pressed={folderFilter === filter} onClick={() => changeFolder(filter)}>
      {icon}<span className={filter.startsWith('folder:') ? 'notes-folder-name user-content' : 'notes-folder-name'}>{label}</span><span className="notes-folder-count">{count}</span>
    </button>
  const renderList = (compact = false) => <>
    <div className="notes-search">
      <label className="search-box small"><Search size={16} /><Input aria-label="搜索笔记" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索笔记" /></label>
      {query && <button className="icon-button" aria-label="清除搜索" onClick={() => setQuery('')}><X size={16} /></button>}
    </div>
    {visibleNotes.length > 0
      ? <VirtualNoteList notes={visibleNotes} selectedId={selectedId} onSelect={compact ? selectFromBrowser : setSelectedId} resetKey={`${folderFilter}:${cleanQuery}`} compact={compact} revealId={newNoteId} />
      : <div className="notes-list-empty" role="status">{cleanQuery ? '没有匹配的笔记' : folderFilter === 'trash' ? '回收站是空的' : '这里还没有笔记'}</div>}
  </>

  return <Sheet open={browserOpen} onOpenChange={setBrowserOpen}><section className="page notes-page">
    <header className="page-header compact"><div><span className="eyebrow">NOTES</span><h1>笔记</h1></div><div className="notes-page-actions"><NotebookSyncButton /><SheetTrigger asChild><Button variant="outline" className="button notes-browser-trigger"><NotebookPen size={17} />笔记列表</Button></SheetTrigger><Button className="button primary" onClick={addNote}><Plus size={17} />新建笔记</Button></div></header>
    {undoable && <div className="notes-trash-feedback">
      <span role="status">笔记已移至回收站</span>
      <Button variant="ghost" onClick={undoTrash}>撤销</Button>
      <button className="icon-button" aria-label="关闭提示" onClick={() => setTrashed(null)}><X size={16} /></button>
    </div>}
    <div className="notes-workspace">
      <aside className="folder-pane">
        {filterButton('all', '全部笔记', counts.all, <NotebookPen size={17} />)}
        {filterButton('unfiled', '无文件夹', counts.unfiled, <Folder size={16} />)}
        <div className="pane-label"><span>文件夹</span><button className="icon-button" onClick={() => setFolderPrompt('new')} aria-label="新建文件夹"><FolderPlus size={16} /></button></div>
        {folders.map((folder) => <div className="notes-folder-row" key={folder.id}>
          {filterButton(folderKey(folder.id), folder.name, counts.folders.get(folder.id) ?? 0, <Folder size={16} />)}
          {folderActions(folder)}
        </div>)}
        {filterButton('trash', '回收站', counts.trash, <Trash2 size={16} />)}
      </aside>
      <div className="note-list-pane">{renderList()}</div>
      <div className="editor-pane">{editorNote
        ? <NoteEditor key={snapshotEpoch + ":" + editorNote.id + ":" + (noteRevisions.get(editorNote.id) ?? 0)}
            note={editorNote} folders={folders} inTrash={Boolean(editorNote.deletedAt)}
            focusTitle={newNoteId === editorNote.id} onTitleFocused={clearNewNoteFocus}
            onSave={(patch) => saveNote(editorNote.id, patch)} onTrash={() => moveToTrash(editorNote)}
            onRestore={() => restore(editorNote)} onDestroy={() => setDeleteTarget(editorNote)} />
        : <EmptyState icon={<NotebookPen size={25} />}
            title={cleanQuery ? '没有匹配的笔记' : folderFilter === 'trash' ? '回收站是空的' : '这里还没有笔记'}
            description={cleanQuery ? '可以修改或清除搜索词。' : folderFilter === 'trash' ? '移入回收站的笔记会显示在这里。' : '新建一篇笔记，开始记录。'}
            action={cleanQuery ? <Button variant="outline" onClick={() => setQuery('')}>清除搜索</Button> : folderFilter !== 'trash' ? <Button className="button primary" onClick={addNote}>新建笔记</Button> : undefined} />}
      </div>
    </div>
    <SheetContent side="left" className="notes-browser-sheet" onCloseAutoFocus={(event) => {
      if (newNoteId) event.preventDefault()
    }}>
        <SheetHeader><SheetTitle>笔记列表</SheetTitle><SheetDescription className="sr-only">按文件夹浏览和搜索笔记。</SheetDescription></SheetHeader>
        <div className="notes-browser-controls">
          <Select value={folderFilter} onValueChange={(value) => changeFolder(value as FolderFilter)}>
            <SelectTrigger aria-label="筛选笔记文件夹"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部笔记（{counts.all}）</SelectItem>
              <SelectItem value="unfiled">无文件夹（{counts.unfiled}）</SelectItem>
              {folders.map((folder) => <SelectItem key={folder.id} value={folderKey(folder.id)}><span className="user-content">{folder.name}</span>（{counts.folders.get(folder.id) ?? 0}）</SelectItem>)}
              <SelectItem value="trash">回收站（{counts.trash}）</SelectItem>
            </SelectContent>
          </Select>
          {activeFolder && folderActions(activeFolder)}
          <button className="icon-button" onClick={() => setFolderPrompt('new')} aria-label="新建文件夹"><FolderPlus size={18} /></button>
        </div>
        <div className="notes-browser-list">{renderList(true)}</div>
    </SheetContent>
    <PromptDialog open={folderPrompt !== null} onOpenChange={(open) => { if (!open) setFolderPrompt(null) }}
      title={renameTarget ? '重命名文件夹' : '新建文件夹'} initialValue={renameTarget?.name}
      placeholder="文件夹名称" confirmLabel={renameTarget ? '保存' : '创建'} validate={validateFolderName} onSubmit={saveFolder} />
    <ConfirmDialog open={deleteFolderTarget !== null} onOpenChange={(open) => { if (!open) setDeleteFolderTarget(null) }}
      title="删除文件夹？" description={<>删除「<span className="user-content">{deleteFolderTarget?.name}</span>」后，文件夹内的笔记会归入「无文件夹」。已在回收站的笔记仍留在回收站。</>}
      confirmLabel="删除文件夹" destructive icon={<Trash2 />} onConfirm={() => { if (deleteFolderTarget) deleteFolder(deleteFolderTarget) }} />
    <ConfirmDialog open={Boolean(deleteTarget)} onOpenChange={(open) => { if (!open) setDeleteTarget(null) }} title="永久删除笔记？" description={deleteTarget ? <><span>《</span><span className="user-content">{deleteTarget.title}</span><span>》将被永久删除，此操作无法撤销。</span></> : ''} confirmLabel="永久删除" destructive icon={<Trash2 />} onConfirm={() => { if (deleteTarget) destroy(deleteTarget); setDeleteTarget(null) }} />
  </section></Sheet>
})

const noteTimes = new WeakMap<Note, number>()
function noteTime(note: Note) {
  let value = noteTimes.get(note)
  if (value === undefined) { value = Date.parse(note.updatedAt) || 0; noteTimes.set(note, value) }
  return value
}


function NoteEditor({ note, folders, inTrash, focusTitle, onTitleFocused, onSave, onTrash, onRestore, onDestroy }: { note: Note; folders: NoteFolder[]; inTrash: boolean; focusTitle: boolean; onTitleFocused: () => void; onSave: (patch: Partial<Note>) => void; onTrash: () => void; onRestore: () => void; onDestroy: () => void }) {
  const [operationError, setOperationError] = useState('')
  const [promptKind, setPromptKind] = useState<'link' | 'image-link' | null>(null)
  const [imageSourceOpen, setImageSourceOpen] = useState(false)
  const [captionPosition, setCaptionPosition] = useState<number | null>(null)
  const [pendingImport, setPendingImport] = useState<string | null>(null)
  const [titleDraft, setTitleDraft] = useState(note.title)
  const titleInput = useRef<HTMLInputElement>(null)
  const imageInput = useRef<HTMLInputElement>(null)
  const markdownInput = useRef<HTMLInputElement>(null)
  const saveRef = useRef(onSave)
  const titleTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const titleDeadline = useRef<ReturnType<typeof setTimeout> | null>(null)
  const contentSaver = useRef<ReturnType<typeof createNoteContentSaver> | null>(null)
  if (!contentSaver.current) contentSaver.current = createNoteContentSaver((content) => saveRef.current({ content }))
  const pendingTitle = useRef<string | null>(null)
  saveRef.current = onSave

  const commitContent = () => contentSaver.current?.flush()
  const clearTitleTimers = () => {
    if (titleTimer.current) clearTimeout(titleTimer.current)
    if (titleDeadline.current) clearTimeout(titleDeadline.current)
    titleTimer.current = titleDeadline.current = null
  }
  const commitTitle = () => {
    clearTitleTimers()
    if (pendingTitle.current === null) return
    const title = pendingTitle.current
    pendingTitle.current = null
    saveRef.current({ title })
  }
  const scheduleTitle = (title: string) => {
    setTitleDraft(title)
    pendingTitle.current = title
    if (titleTimer.current) clearTimeout(titleTimer.current)
    titleTimer.current = setTimeout(commitTitle, 500)
    titleDeadline.current ??= setTimeout(commitTitle, 10_000)
    window.dispatchEvent(new Event('sylunae:note-edited'))
  }
  const editor = useEditor({
    // Creating the editor during render can leave a destroyed instance behind
    // when React abandons or replays the initial render (for example on reload).
    immediatelyRender: false,
    extensions: [StarterKit.configure({ link: false }), Link.configure({ openOnClick: false, autolink: true }), NoteImage.configure({ allowBase64: true }), Placeholder.configure({ placeholder: '从这里开始书写…' }), TaskList, TaskItem.configure({ nested: true }), TableKit.configure({ table: { resizable: true } }), Details.configure({ persist: true, HTMLAttributes: { class: 'note-details' }, renderToggleButton: ({ element, isOpen, node }) => { const label = node.textContent || '折叠内容'; element.setAttribute('aria-label', isOpen ? `收起：${label}` : `展开：${label}`); element.setAttribute('title', isOpen ? '收起内容' : '展开内容') } }), NoteDetailsSummary, DetailsContent, LinkBookmark, Markdown, MarkdownPaste],
    content: note.content,
    editable: !inTrash,
    editorProps: {
      attributes: { class: 'tiptap-editor' },
      handleClickOn: (view, _pos, node, nodePos, _event, direct) => {
        if (!direct || node.type.name !== 'image' || inTrash) return false
        view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, nodePos)))
        setCaptionPosition(nodePos)
        return true
      },
      handleKeyDown: (view, event) => {
        if (event.key !== 'Enter' || inTrash || !isImageNodeSelection(view.state.selection)) return false
        event.preventDefault()
        setCaptionPosition(view.state.selection.from)
        return true
      },
      handleDrop: (view, event) => {
        if (inTrash) return false
        const files = Array.from(event.dataTransfer?.files ?? []).filter((file) => file.type.startsWith('image/'))
        if (!files.length) return false

        event.preventDefault()
        const dropPosition = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos ?? view.state.selection.from
        void Promise.all(files.map(readImageFile)).then((sources) => {
          if (!editor || editor.isDestroyed) return
          const position = Math.min(dropPosition, view.state.doc.content.size)
          const images = sources.map((src) => ({ type: 'image', attrs: { src } }))
          editor.chain().focus().insertContentAt(position, images).run()
        }).catch(() => setOperationError('图片保存失败，请重试。'))
        return true
      },
    },
    onCreate: ({ editor: instance }) => contentSaver.current?.reset(instance.state.doc),
    onUpdate: ({ editor: instance, transaction }) => {
      if (transaction.docChanged) {
        contentSaver.current?.schedule(instance.state.doc)
        window.dispatchEvent(new Event('sylunae:note-edited'))
      }
    },
    onBlur: commitContent,
  })

  useEffect(() => {
    if (!editor || editor.isDestroyed) return
    editor.setEditable(!inTrash)
  }, [editor, inTrash])

  useEffect(() => setTitleDraft(note.title), [note.title])

  useEffect(() => {
    const commitBeforeSuspend = () => { commitTitle(); commitContent() }
    window.addEventListener('sylunae:flush-editors', commitBeforeSuspend)
    return () => window.removeEventListener('sylunae:flush-editors', commitBeforeSuspend)
  }, [])

  useEffect(() => () => {
    commitTitle()
    commitContent()
  }, [])

  const toolbar = useEditorState({
    editor,
    selector: ({ editor }) => editor && {
      bold: editor.isActive('bold'),
      italic: editor.isActive('italic'),
      strike: editor.isActive('strike'),
      heading: editor.isActive('heading', { level: 2 }),
      bulletList: editor.isActive('bulletList'),
      orderedList: editor.isActive('orderedList'),
      taskList: editor.isActive('taskList'),
      blockquote: editor.isActive('blockquote'),
      codeBlock: editor.isActive('codeBlock'),
      details: editor.isActive('details'),
      table: editor.isActive('table'),
      link: noteLinkAtSelection(editor),
      canUndo: editor.can().undo(),
    },
  })
  const toolbarReady = Boolean(toolbar)
  useEffect(() => {
    if (!toolbarReady || !focusTitle || !titleInput.current) return
    titleInput.current.focus()
    titleInput.current.select()
    onTitleFocused()
  }, [toolbarReady, focusTitle, onTitleFocused])
  if (!editor || editor.isDestroyed || !toolbar) return null
  const setLink = (url: string) => applyNoteLink(editor, url)
  const openLink = (url: string) => {
    if (!/^https?:\/\//i.test(url)) return
    if (window.sylunae) void window.sylunae.system.openExternal(url).catch(() => setOperationError('无法打开链接，请重试。'))
    else window.open(url, '_blank', 'noopener,noreferrer')
  }
  const addImage = (url: string) => editor.chain().focus().setImage({ src: url }).run()
  const addImageFile = async (file: File) => {
    try {
      const src = await readImageFile(file)
      if (!editor.isDestroyed) { addImage(src); setOperationError('') }
    } catch { setOperationError('图片保存失败，请重试。') }
  }
  const caption = captionPosition === null ? '' : editor.state.doc.nodeAt(captionPosition)?.attrs.caption || ''
  const saveCaption = (value: string) => {
    if (captionPosition === null) return
    editor.chain().focus().command(({ tr }) => {
      const image = tr.doc.nodeAt(captionPosition)
      if (image?.type.name !== 'image') return false
      tr.setNodeMarkup(captionPosition, undefined, { ...image.attrs, caption: value || null })
      return true
    }).run()
  }
  const deleteCaptionedImage = () => {
    if (captionPosition === null) return
    editor.chain().focus().command(({ tr }) => {
      const image = tr.doc.nodeAt(captionPosition)
      if (image?.type.name !== 'image') return false
      tr.delete(captionPosition, captionPosition + image.nodeSize)
      return true
    }).run()
    setCaptionPosition(null)
  }
  const exportMarkdown = async () => {
    try {
      commitTitle()
      commitContent()
      let markdown = editor.getMarkdown()
      const references = new Set(markdown.match(/sylunae-note-asset:[a-f0-9]{64}/g) ?? [])
      for (const reference of references) markdown = markdown.replaceAll(reference, await noteImageDataUrl(reference))
      const file = new Blob([markdownExport(titleDraft, markdown)], { type: 'text/markdown;charset=utf-8' })
      await saveBlob(markdownFileName(titleDraft), file)
    } catch { setOperationError('导出失败，请确认笔记图片可读取后重试。') }
  }
  const importMarkdown = () => {
    if (pendingImport === null) return
    const imported = splitMarkdownNote(pendingImport)
    editor.commands.setContent(imported.content, { contentType: 'markdown', emitUpdate: false })
    const patch: Partial<Note> = { content: editor.getJSON() }
    if (imported.title) {
      setTitleDraft(imported.title)
      patch.title = imported.title
    }
    contentSaver.current?.reset(editor.state.doc)
    clearTitleTimers()
    pendingTitle.current = null
    onSave(patch)
    setPendingImport(null)
  }
  const action = (title: string, icon: React.ReactNode, run: () => void, pressed?: boolean, disabled = false) =>
    <button aria-label={title} title={title} aria-pressed={pressed} disabled={disabled} onClick={run}>{icon}</button>
  const insertDetails = () => editor.chain().focus().setDetails().command(({ tr }) => {
    let detailsPosition: number | null = null
    for (let depth = tr.selection.$from.depth; depth > 0; depth -= 1) {
      if (tr.selection.$from.node(depth).type.name === 'details') {
        detailsPosition = tr.selection.$from.before(depth)
        break
      }
    }
    if (detailsPosition === null) return false
    const details = tr.doc.nodeAt(detailsPosition)
    if (!details) return false
    tr.setNodeMarkup(detailsPosition, undefined, { ...details.attrs, open: true })
    return true
  }).run()

  return <div className="note-editor-wrap" data-notebook-note={note.id}>
    <div className="note-editor-top">
      <Input ref={titleInput} className="note-title-input" aria-label="笔记标题" value={titleDraft} disabled={inTrash} onChange={(event) => scheduleTitle(event.target.value)} onBlur={commitTitle} placeholder="无标题笔记" />
      <Select value={note.folderId !== null && folders.some((folder) => folder.id === note.folderId) ? folderKey(note.folderId) : 'unfiled'}
        disabled={inTrash} onValueChange={(value) => onSave({ folderId: value === 'unfiled' ? null : value.slice('folder:'.length) })}>
        <SelectTrigger aria-label="笔记所属文件夹" className="select-control"><SelectValue className={note.folderId !== null ? 'user-content' : undefined} /></SelectTrigger>
        <SelectContent><SelectItem value="unfiled">无文件夹</SelectItem>{folders.map((folder) => <SelectItem key={folder.id} value={folderKey(folder.id)}><span className="user-content">{folder.name}</span></SelectItem>)}</SelectContent>
      </Select>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild><button className="icon-button" aria-label="笔记操作"><MoreHorizontal size={19} /></button></DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {inTrash ? <>
            <DropdownMenuItem onSelect={onRestore}><ArchiveRestore />恢复笔记</DropdownMenuItem>
            <DropdownMenuItem variant="destructive" onSelect={onDestroy}><Trash2 />永久删除</DropdownMenuItem>
          </> : <>
            <DropdownMenuItem onSelect={() => onSave({ pinned: !note.pinned })}>{note.pinned ? <PinOff /> : <Pin />}{note.pinned ? '取消置顶' : '置顶'}</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => markdownInput.current?.click()}><Upload />导入 Markdown</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => void exportMarkdown()}><Download />导出 Markdown</DropdownMenuItem>
            <DropdownMenuItem variant="destructive" onSelect={onTrash}><Trash2 />移至回收站</DropdownMenuItem>
          </>}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
    {!inTrash && <div className="editor-toolbar">
      {action('粗体', <Bold size={16} />, () => editor.chain().focus().toggleBold().run(), toolbar.bold)}
      {action('斜体', <Italic size={16} />, () => editor.chain().focus().toggleItalic().run(), toolbar.italic)}
      {action('删除线', <Strikethrough size={16} />, () => editor.chain().focus().toggleStrike().run(), toolbar.strike)}
      {action('二级标题', <Heading2 size={17} />, () => editor.chain().focus().toggleHeading({ level: 2 }).run(), toolbar.heading)}
      {action('项目列表', <List size={17} />, () => editor.chain().focus().toggleBulletList().run(), toolbar.bulletList)}
      {action('编号列表', <ListOrdered size={17} />, () => editor.chain().focus().toggleOrderedList().run(), toolbar.orderedList)}
      {action('待办列表', <CheckSquare size={16} />, () => editor.chain().focus().toggleTaskList().run(), toolbar.taskList)}
      {action('引用', <Quote size={16} />, () => editor.chain().focus().toggleBlockquote().run(), toolbar.blockquote)}
      {action('代码块', <Code2 size={16} />, () => editor.chain().focus().toggleCodeBlock().run(), toolbar.codeBlock)}
      {toolbar.link ? <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild><button className="active" aria-label="链接操作" title="链接操作"><Link2 size={16} /></button></DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem disabled={!/^https?:\/\//i.test(toolbar.link)} onSelect={() => openLink(toolbar.link)}><ExternalLink />打开链接</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setPromptKind('link')}>修改链接</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => removeNoteLink(editor)}>移除链接</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu> : action('添加链接', <Link2 size={16} />, () => setPromptKind('link'))}
      {action('插入图片', <ImagePlus size={16} />, () => setImageSourceOpen(true))}
      {toolbar.table ? <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild><button className="active" aria-label="表格操作" title="表格操作"><Table2 size={16} /></button></DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem onSelect={() => editor.chain().focus().addRowAfter().run()}><Rows3 />在下方添加行</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => editor.chain().focus().addColumnAfter().run()}><Columns3 />在右侧添加列</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => editor.chain().focus().deleteRow().run()}>删除当前行</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => editor.chain().focus().deleteColumn().run()}>删除当前列</DropdownMenuItem>
          <DropdownMenuItem variant="destructive" onSelect={() => editor.chain().focus().deleteTable().run()}><Trash2 />删除当前表格</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu> : action('插入表格', <Table2 size={16} />, () => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run())}
      {action('插入折叠区块', <ChevronsUpDown size={16} />, insertDetails, toolbar.details)}
      {action('撤销编辑', <Undo2 size={16} />, () => editor.chain().focus().undo().run(), undefined, !toolbar.canUndo)}
    </div>}
    <EditorContent className="note-editor-content" editor={editor} />
    {operationError && <div className="notice" role="alert">{operationError}</div>}
    <div className="editor-status">{inTrash ? `删除于 ${formatDate(note.deletedAt || '', true)}` : `自动保存 · ${formatDate(note.updatedAt, true)}`}</div>
    <input ref={markdownInput} hidden type="file" accept="text/markdown,.md,.markdown,text/plain,.txt" onChange={(event) => { const file = event.target.files?.[0]; if (file) void file.text().then(setPendingImport); event.currentTarget.value = '' }} />
    <PromptDialog open={promptKind === 'link'} onOpenChange={(open) => { if (!open) setPromptKind(null) }} title={toolbar.link ? '修改链接' : '添加链接'} description={toolbar.link ? undefined : '为选中文字设置链接；未选中文字时，会在光标处插入链接。'} initialValue={toolbar.link || 'https://'} placeholder="https://example.com" confirmLabel="应用链接" validate={(value) => /^https?:\/\/[^\s]+$/i.test(value) ? null : '请输入完整的 HTTP 或 HTTPS 链接'} onSubmit={setLink} />
    <Dialog open={imageSourceOpen} onOpenChange={setImageSourceOpen}><DialogContent className="image-source-dialog"><DialogHeader><DialogTitle>插入图片</DialogTitle><DialogDescription>通过网络链接或从本地文件夹选择图片。</DialogDescription></DialogHeader><div className="image-source-actions"><Button variant="outline" className="button secondary" onClick={() => { setImageSourceOpen(false); setPromptKind('image-link') }}><Link2 size={17} />使用图片链接</Button><Button className="button primary" onClick={() => imageInput.current?.click()}><Folder size={17} />从文件夹选择</Button></div><input ref={imageInput} hidden type="file" accept="image/*" onChange={(event) => { const file = event.target.files?.[0]; if (file) { setImageSourceOpen(false); void addImageFile(file) } event.currentTarget.value = '' }} /></DialogContent></Dialog>
    <PromptDialog open={promptKind === 'image-link'} onOpenChange={(open) => { if (!open) setPromptKind(null) }} title="通过链接插入图片" description="请输入可直接访问的 HTTPS 图片地址。" placeholder="https://example.com/image.png" confirmLabel="插入图片" validate={(value) => /^https:\/\//i.test(value) ? null : '请输入 HTTPS 图片地址'} onSubmit={addImage} />
    <PromptDialog open={captionPosition !== null} onOpenChange={(open) => { if (!open) setCaptionPosition(null) }} title="图片说明" description="为图片添加 caption；留空保存可移除已有说明。" initialValue={caption} placeholder="输入图片说明" confirmLabel="保存说明" destructiveLabel="删除图片" allowEmpty onSubmit={saveCaption} onDestructive={deleteCaptionedImage} />
    <ConfirmDialog open={pendingImport !== null} onOpenChange={(open) => { if (!open) setPendingImport(null) }} title="导入 Markdown？" description="将用导入文件替换当前笔记的正文；若文件以一级标题开头，笔记标题也会同步更新。" confirmLabel="导入并替换" icon={<Upload size={20} />} onConfirm={importMarkdown} />
  </div>
}
