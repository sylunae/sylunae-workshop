import { VirtualNoteList } from '../components/VirtualNoteList'
import { noteImageDataUrl } from '../data/noteAssets'
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { EditorContent, useEditor } from '@tiptap/react'
import { Markdown } from '@tiptap/markdown'
import StarterKit from '@tiptap/starter-kit'
import Link from '@tiptap/extension-link'
import Placeholder from '@tiptap/extension-placeholder'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import { TableKit } from '@tiptap/extension-table'
import { Details, DetailsContent, DetailsSummary } from '@tiptap/extension-details'
import { ArchiveRestore, Bold, CheckSquare, ChevronsUpDown, Code2, Columns3, Download, Folder, FolderPlus, Heading2, ImagePlus, Italic, Link2, List, ListOrdered, Minus, NotebookPen, Pin, PinOff, Plus, Quote, Rows3, Search, Strikethrough, Table2, Trash2, Undo2, Upload } from 'lucide-react'
import { NodeSelection } from '@tiptap/pm/state'
import { useAppStore } from '../app/AppStore'
import type { Note } from '../shared/types'
import { extractText, formatDate, newId, nowIso } from '../utils'
import { EmptyState } from '../components/Icons'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { PromptDialog } from '../components/PromptDialog'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../components/ui/dialog'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '../components/ui/sheet'
import { MarkdownPaste } from '../editor/markdownPaste'
import { createNoteContentSaver } from '../editor/noteContentSaver'
import { applyNotePatch } from '../editor/notePatch'
import { applyNoteLink } from '../editor/noteLink'
import { LinkBookmark } from '../editor/linkBookmark'
import { isImageNodeSelection, NoteImage, readImageFile } from '../editor/noteImage'
import { markdownExport, markdownFileName, splitMarkdownNote } from '../editor/noteMarkdown'
import { usePersistentState } from '../lib/usePersistentState'

type FolderFilter = 'all' | 'trash' | string
const NoteDetailsSummary = DetailsSummary.extend({ content: 'inline*' })

export function NotesPage({ createOnOpen = false }: { createOnOpen?: boolean }) {
  const { snapshot, update } = useAppStore()
  if (!snapshot) return null
  return <NotesWorkspace notes={snapshot.notes} folders={snapshot.folders} update={update} createOnOpen={createOnOpen} />
}

const NotesWorkspace = memo(function NotesWorkspace({ notes, folders, update, createOnOpen }: { notes: Note[]; folders: import('../shared/types').NoteFolder[]; update: ReturnType<typeof useAppStore>['update']; createOnOpen: boolean }) {
  const [folderFilter, setFolderFilter] = useState<FolderFilter>('all')
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = usePersistentState<string | null>('navigation.notesSelectedId', null)
  const [creatingFolder, setCreatingFolder] = useState(false)
  const [browserOpen, setBrowserOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<Note | null>(null)
  const createdOnOpen = useRef(false)
  const noteById = useMemo(() => new Map(notes.map((note) => [note.id, note])), [notes])
  const selected = selectedId ? noteById.get(selectedId) ?? null : null
  const counts = useMemo(() => {
    const result = { all: 0, trash: 0, folders: new Map<string, number>() }
    for (const note of notes) {
      if (note.deletedAt) { result.trash++; continue }
      result.all++
      if (note.folderId) result.folders.set(note.folderId, (result.folders.get(note.folderId) ?? 0) + 1)
    }
    return result
  }, [notes])

  const visibleNotes = useMemo(() => {
    const clean = query.trim().toLowerCase()
    return notes.filter((note) => {
      const trashMatch = folderFilter === 'trash' ? Boolean(note.deletedAt) : !note.deletedAt
      const folderMatch = folderFilter === 'all' || folderFilter === 'trash' || note.folderId === folderFilter
      const textMatch = !clean || `${note.title.toLowerCase()} ${noteSearchText(note)}`.includes(clean)
      return trashMatch && folderMatch && textMatch
    }).sort((a, b) => Number(b.pinned) - Number(a.pinned) || noteTime(b) - noteTime(a))
  }, [notes, folderFilter, query])

  useEffect(() => {
    if (selectedId && !visibleNotes.some((note) => note.id === selectedId)) setSelectedId(visibleNotes[0]?.id || null)
    else if (!selectedId && visibleNotes[0]) setSelectedId(visibleNotes[0].id)
  }, [visibleNotes, selectedId])

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
    const note: Note = { id: newId(), title: '无标题笔记', content: { type: 'doc', content: [{ type: 'paragraph' }] }, folderId: folderFilter !== 'all' && folderFilter !== 'trash' ? folderFilter : null, tags: [], pinned: false, deletedAt: null, createdAt: now, updatedAt: now }
    update((state) => ({ ...state, notes: [note, ...state.notes] }))
    setFolderFilter('all'); setSelectedId(note.id)
  }
  useEffect(() => {
    if (!createOnOpen || createdOnOpen.current) return
    createdOnOpen.current = true
    addNote()
  }, [createOnOpen])
  const addFolder = (name: string) => {
    const now = nowIso(); const id = newId()
    update((state) => ({ ...state, folders: [...state.folders, { id, name, createdAt: now, updatedAt: now }] }))
    setFolderFilter(id)
  }
  const selectFromBrowser = useCallback((id: string) => { setSelectedId(id); setBrowserOpen(false) }, [setSelectedId])
  const moveToTrash = (note: Note) => saveNote(note.id, { deletedAt: nowIso() })
  const restore = (note: Note) => saveNote(note.id, { deletedAt: null })
  const destroy = (note: Note) => {
    update((state) => ({ ...state, notes: state.notes.filter((item) => item.id !== note.id) }))
    setSelectedId(null)
  }

  return <section className="page notes-page">
    <header className="page-header compact"><div><span className="eyebrow">NOTES</span><h1>笔记</h1></div><div className="notes-page-actions"><Button variant="outline" className="button notes-browser-trigger" onClick={() => setBrowserOpen(true)}><NotebookPen size={17} />笔记列表</Button><Button className="button primary" onClick={addNote}><Plus size={17} />新建笔记</Button></div></header>
    <div className="notes-workspace">
      <aside className="folder-pane">
        <button className={folderFilter === 'all' ? 'active' : ''} onClick={() => setFolderFilter('all')} title="全部笔记"><NotebookPen size={17} />全部笔记<span>{counts.all}</span></button>
        <div className="pane-label"><span>文件夹</span><button onClick={() => setCreatingFolder(true)} title="新建文件夹"><FolderPlus size={15} /></button></div>
        {folders.map((folder) => <button key={folder.id} className={folderFilter === folder.id ? 'active' : ''} onClick={() => setFolderFilter(folder.id)} title={folder.name}><Folder size={16} /><span className="user-content">{folder.name}</span><span>{counts.folders.get(folder.id) ?? 0}</span></button>)}
        <button className={`trash-link ${folderFilter === 'trash' ? 'active' : ''}`} onClick={() => setFolderFilter('trash')} title="回收站"><Trash2 size={16} />回收站<span>{counts.trash}</span></button>
      </aside>
      <div className="note-list-pane">
        <label className="search-box small"><Search size={15} /><Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索笔记" /></label>
        <VirtualNoteList notes={visibleNotes} selectedId={selectedId} onSelect={setSelectedId} resetKey={`${folderFilter}:${query}`} />
      </div>
      <div className="editor-pane">{selected ? <MemoNoteEditor key={selected.id} note={selected} folders={folders} inTrash={Boolean(selected.deletedAt)} onSave={(patch) => saveNote(selected.id, patch)} onTrash={() => moveToTrash(selected)} onRestore={() => restore(selected)} onDestroy={() => setDeleteTarget(selected)} /> : <EmptyState icon={<NotebookPen size={25} />} title={folderFilter === 'trash' ? '回收站是空的' : '开始写一点什么'} description={folderFilter === 'trash' ? '删除的笔记会在这里等待你决定。' : '新建一条笔记，记下此刻的想法。'} action={folderFilter !== 'trash' ? <Button className="button primary" onClick={addNote}>新建笔记</Button> : undefined} />}</div>
    </div>
    <Sheet open={browserOpen} onOpenChange={setBrowserOpen}><SheetContent side="left" className="notes-browser-sheet"><SheetHeader><SheetTitle>笔记</SheetTitle><SheetDescription>选择文件夹或继续编辑一篇笔记。</SheetDescription></SheetHeader><div className="notes-browser-body"><div className="notes-browser-folders"><button className={folderFilter === 'all' ? 'active' : ''} onClick={() => setFolderFilter('all')}><NotebookPen size={17} />全部笔记<span>{counts.all}</span></button><div className="notes-browser-folder-heading"><span>文件夹</span><button onClick={() => { setBrowserOpen(false); setCreatingFolder(true) }} title="新建文件夹"><FolderPlus size={15} /></button></div>{folders.map((folder) => <button key={folder.id} className={folderFilter === folder.id ? 'active' : ''} onClick={() => setFolderFilter(folder.id)}><Folder size={16} /><span className="user-content">{folder.name}</span><span>{counts.folders.get(folder.id) ?? 0}</span></button>)}<button className={`notes-browser-trash ${folderFilter === 'trash' ? 'active' : ''}`} onClick={() => setFolderFilter('trash')}><Trash2 size={16} />回收站<span>{counts.trash}</span></button></div><div className="notes-browser-list"><label className="search-box small"><Search size={15} /><Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索笔记" /></label><VirtualNoteList notes={visibleNotes} selectedId={selectedId} onSelect={selectFromBrowser} resetKey={`${folderFilter}:${query}`} compact /></div></div></SheetContent></Sheet>
    <PromptDialog open={creatingFolder} onOpenChange={setCreatingFolder} title="新建文件夹" description="为笔记创建一个新分类。" placeholder="文件夹名称" confirmLabel="创建" onSubmit={addFolder} />
    <ConfirmDialog open={Boolean(deleteTarget)} onOpenChange={(open) => { if (!open) setDeleteTarget(null) }} title="永久删除笔记？" description={deleteTarget ? <><span>《</span><span className="user-content">{deleteTarget.title}</span><span>》将被永久删除，此操作无法撤销。</span></> : ''} confirmLabel="永久删除" destructive icon={<Trash2 />} onConfirm={() => { if (deleteTarget) destroy(deleteTarget); setDeleteTarget(null) }} />
  </section>
})

const MemoNoteEditor = memo(NoteEditor, (previous, next) => previous.note === next.note && previous.folders === next.folders && previous.inTrash === next.inTrash)

const searchTexts = new WeakMap<Note['content'], string>()
function noteSearchText(note: Note) {
  let text = searchTexts.get(note.content)
  if (text === undefined) { text = extractText(note.content).toLowerCase(); searchTexts.set(note.content, text) }
  return text
}
const noteTimes = new WeakMap<Note, number>()
function noteTime(note: Note) {
  let value = noteTimes.get(note)
  if (value === undefined) { value = Date.parse(note.updatedAt) || 0; noteTimes.set(note, value) }
  return value
}


function NoteEditor({ note, folders, inTrash, onSave, onTrash, onRestore, onDestroy }: { note: Note; folders: { id: string; name: string }[]; inTrash: boolean; onSave: (patch: Partial<Note>) => void; onTrash: () => void; onRestore: () => void; onDestroy: () => void }) {
  const [operationError, setOperationError] = useState('')
  const [promptKind, setPromptKind] = useState<'link' | 'image-link' | null>(null)
  const [imageSourceOpen, setImageSourceOpen] = useState(false)
  const [captionPosition, setCaptionPosition] = useState<number | null>(null)
  const [pendingImport, setPendingImport] = useState<string | null>(null)
  const [titleDraft, setTitleDraft] = useState(note.title)
  const imageInput = useRef<HTMLInputElement>(null)
  const markdownInput = useRef<HTMLInputElement>(null)
  const saveRef = useRef(onSave)
  const titleTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const contentSaver = useRef<ReturnType<typeof createNoteContentSaver> | null>(null)
  if (!contentSaver.current) contentSaver.current = createNoteContentSaver((content) => saveRef.current({ content }))
  const pendingTitle = useRef<string | null>(null)
  saveRef.current = onSave

  const commitContent = () => contentSaver.current?.flush()
  const commitTitle = () => {
    if (titleTimer.current) { clearTimeout(titleTimer.current); titleTimer.current = null }
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
      if (transaction.docChanged) contentSaver.current?.schedule(instance.state.doc)
    },
    onBlur: commitContent,
  })

  useEffect(() => {
    if (!editor || editor.isDestroyed) return
    editor.setEditable(!inTrash)
  }, [editor, inTrash])

  useEffect(() => setTitleDraft(note.title), [note.title])

  useEffect(() => () => {
    if (titleTimer.current) clearTimeout(titleTimer.current)
    contentSaver.current?.flush()
    if (pendingTitle.current !== null) saveRef.current({ title: pendingTitle.current })
  }, [])

  if (!editor || editor.isDestroyed) return null
  const setLink = (url: string) => applyNoteLink(editor, url)
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
      const url = URL.createObjectURL(file)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = markdownFileName(titleDraft)
      anchor.click()
      URL.revokeObjectURL(url)
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
    if (titleTimer.current) clearTimeout(titleTimer.current)
    pendingTitle.current = null
    onSave(patch)
    setPendingImport(null)
  }
  const action = (active: boolean, title: string, icon: React.ReactNode, run: () => void) => <button className={active ? 'active' : ''} title={title} onClick={run}>{icon}</button>
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

  return <div className="note-editor-wrap">
    <div className="note-editor-top"><Select value={note.folderId || 'none'} disabled={inTrash} onValueChange={(value) => onSave({ folderId: value === 'none' ? null : value })}><SelectTrigger className="select-control"><SelectValue className={note.folderId ? 'user-content' : undefined} /></SelectTrigger><SelectContent><SelectItem value="none">无文件夹</SelectItem>{folders.map((folder) => <SelectItem key={folder.id} value={folder.id}><span className="user-content">{folder.name}</span></SelectItem>)}</SelectContent></Select><Input className="note-title-input" value={titleDraft} disabled={inTrash} onChange={(event) => scheduleTitle(event.target.value)} onBlur={commitTitle} placeholder="无标题笔记" /><div>
      {!inTrash && <><button className="icon-button" onClick={exportMarkdown} title="导出 Markdown"><Download size={17} /></button><button className="icon-button" onClick={() => markdownInput.current?.click()} title="导入 Markdown"><Upload size={17} /></button><button className="icon-button" onClick={() => onSave({ pinned: !note.pinned })} title={note.pinned ? '取消置顶' : '置顶'}>{note.pinned ? <PinOff size={17} /> : <Pin size={17} />}</button></>}
      {inTrash ? <><button className="icon-button" onClick={onRestore} title="恢复"><ArchiveRestore size={17} /></button><button className="icon-button danger" onClick={onDestroy} title="永久删除"><Trash2 size={17} /></button></> : <button className="icon-button" onClick={onTrash} title="移至回收站"><Trash2 size={17} /></button>}
    </div></div>
    {!inTrash && <div className="editor-toolbar">
      {action(editor.isActive('bold'), '粗体', <Bold size={16} />, () => { editor.chain().focus().toggleBold().run() })}
      {action(editor.isActive('italic'), '斜体', <Italic size={16} />, () => { editor.chain().focus().toggleItalic().run() })}
      {action(editor.isActive('strike'), '删除线', <Strikethrough size={16} />, () => { editor.chain().focus().toggleStrike().run() })}
      <i />
      {action(editor.isActive('heading', { level: 2 }), '二级标题', <Heading2 size={17} />, () => { editor.chain().focus().toggleHeading({ level: 2 }).run() })}
      {action(editor.isActive('bulletList'), '项目列表', <List size={17} />, () => { editor.chain().focus().toggleBulletList().run() })}
      {action(editor.isActive('orderedList'), '编号列表', <ListOrdered size={17} />, () => { editor.chain().focus().toggleOrderedList().run() })}
      {action(editor.isActive('taskList'), '待办列表', <CheckSquare size={16} />, () => { editor.chain().focus().toggleTaskList().run() })}
      {action(editor.isActive('blockquote'), '引用', <Quote size={16} />, () => { editor.chain().focus().toggleBlockquote().run() })}
      {action(editor.isActive('codeBlock'), '代码块', <Code2 size={16} />, () => { editor.chain().focus().toggleCodeBlock().run() })}
      <i />
      {action(editor.isActive('link'), '链接', <Link2 size={16} />, () => setPromptKind('link'))}
      {action(false, '图片', <ImagePlus size={16} />, () => setImageSourceOpen(true))}
      {action(editor.isActive('table'), '插入表格', <Table2 size={16} />, () => { editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run() })}
      {action(editor.isActive('details'), '插入折叠区块', <ChevronsUpDown size={16} />, insertDetails)}
      {editor.isActive('table') && <>
        {action(false, '在下方添加行', <Rows3 size={16} />, () => { editor.chain().focus().addRowAfter().run() })}
        {action(false, '在右侧添加列', <Columns3 size={16} />, () => { editor.chain().focus().addColumnAfter().run() })}
        {action(false, '删除当前行', <Minus size={16} />, () => { editor.chain().focus().deleteRow().run() })}
        {action(false, '删除当前列', <Minus size={16} />, () => { editor.chain().focus().deleteColumn().run() })}
        {action(false, '删除当前表格', <Trash2 size={16} />, () => { editor.chain().focus().deleteTable().run() })}
      </>}
      {action(false, '撤销', <Undo2 size={16} />, () => { editor.chain().focus().undo().run() })}
    </div>}
    <EditorContent className="note-editor-content" editor={editor} />
    {operationError && <div className="notice" role="alert">{operationError}</div>}
    <div className="editor-status">{inTrash ? `删除于 ${formatDate(note.deletedAt || '', true)}` : `自动保存 · ${formatDate(note.updatedAt, true)}`}</div>
    <input ref={markdownInput} hidden type="file" accept="text/markdown,.md,.markdown,text/plain,.txt" onChange={(event) => { const file = event.target.files?.[0]; if (file) void file.text().then(setPendingImport); event.currentTarget.value = '' }} />
    <PromptDialog open={promptKind === 'link'} onOpenChange={(open) => { if (!open) setPromptKind(null) }} title="添加链接" description="为选中文字设置链接；未选中文字时，会在光标处插入链接。" initialValue={editor.getAttributes('link').href || 'https://'} placeholder="https://example.com" confirmLabel="应用链接" validate={(value) => /^https?:\/\//i.test(value) ? null : '请输入 http 或 https 链接'} onSubmit={setLink} />
    <Dialog open={imageSourceOpen} onOpenChange={setImageSourceOpen}><DialogContent className="image-source-dialog"><DialogHeader><DialogTitle>插入图片</DialogTitle><DialogDescription>通过网络链接或从本地文件夹选择图片。</DialogDescription></DialogHeader><div className="image-source-actions"><Button variant="outline" className="button secondary" onClick={() => { setImageSourceOpen(false); setPromptKind('image-link') }}><Link2 size={17} />使用图片链接</Button><Button className="button primary" onClick={() => imageInput.current?.click()}><Folder size={17} />从文件夹选择</Button></div><input ref={imageInput} hidden type="file" accept="image/*" onChange={(event) => { const file = event.target.files?.[0]; if (file) { setImageSourceOpen(false); void addImageFile(file) } event.currentTarget.value = '' }} /></DialogContent></Dialog>
    <PromptDialog open={promptKind === 'image-link'} onOpenChange={(open) => { if (!open) setPromptKind(null) }} title="通过链接插入图片" description="请输入可直接访问的 HTTPS 图片地址。" placeholder="https://example.com/image.png" confirmLabel="插入图片" validate={(value) => /^https:\/\//i.test(value) ? null : '请输入 HTTPS 图片地址'} onSubmit={addImage} />
    <PromptDialog open={captionPosition !== null} onOpenChange={(open) => { if (!open) setCaptionPosition(null) }} title="图片说明" description="为图片添加 caption；留空保存可移除已有说明。" initialValue={caption} placeholder="输入图片说明" confirmLabel="保存说明" destructiveLabel="删除图片" allowEmpty onSubmit={saveCaption} onDestructive={deleteCaptionedImage} />
    <ConfirmDialog open={pendingImport !== null} onOpenChange={(open) => { if (!open) setPendingImport(null) }} title="导入 Markdown？" description="将用导入文件替换当前笔记的正文；若文件以一级标题开头，笔记标题也会同步更新。" confirmLabel="导入并替换" icon={<Upload size={20} />} onConfirm={importMarkdown} />
  </div>
}
