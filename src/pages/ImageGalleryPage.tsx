import { isAndroid } from '../platform/environment'
import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertCircle, CalendarPlus, CheckSquare2, ChevronRight, FolderInput, FolderOpen, HardDrive, Image as ImageIcon, Images, LocateFixed, Maximize2, MoreHorizontal, Pencil, Plus, RefreshCw, Search, SlidersHorizontal, Trash2, X } from 'lucide-react'
import { useAppStore } from '../app/AppStore'
import { Button } from '../components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select'
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '../components/ui/sheet'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { ContentPagination } from '../components/ContentPagination'
import { ImageViewer } from '../components/ImageViewer'
import { PromptDialog } from '../components/PromptDialog'
import { Checkbox } from '../components/ui/checkbox'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '../components/ui/dropdown-menu'
import type { ImageAspectType, ImageAsset, ImageCollection, ImageLibraryRoot, ImageLibraryState, ImageScanProgress } from '../shared/types'

type GallerySort = 'recent' | 'name'

const typeLabels: Record<ImageAspectType, string> = { landscape: '横图', portrait: '竖图', square: '方图' }
const IMAGE_PAGE_SIZE = 12

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function shortPath(path: string): string {
  return path.length > 54 ? `…${path.slice(-53)}` : path
}

function pathKey(path: string): string {
  return path.replace(/\\/g, '/').toLocaleLowerCase()
}

function imageIpcUnavailable(error: unknown): boolean {
  return error instanceof Error && error.message.includes('No handler registered for')
}

function formatScanTime(value: string | null): string {
  if (!value) return '尚未扫描'
  return new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value))
}

export function ImageGalleryPage() {
  const contentRef = useRef<HTMLDivElement>(null)
  const galleryGridRef = useRef<HTMLDivElement>(null)
  const { snapshot, update } = useAppStore()
  const library = snapshot?.imageLibrary ?? { roots: [], collections: [], assets: [] }
  const [selectedCollection, setSelectedCollection] = useState('all')
  const [sort, setSort] = useState<GallerySort>('recent')
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)
  const [urls, setUrls] = useState<Record<string, string>>({})
  const [thumbnailUrls, setThumbnailUrls] = useState<Record<string, string>>({})
  const [thumbnailEdges, setThumbnailEdges] = useState<Record<string, number>>({})
  const [thumbnailLayout, setThumbnailLayout] = useState({ columnWidth: 0, dpr: 1 })
  const [detailPreviewElement, setDetailPreviewElement] = useState<HTMLButtonElement | null>(null)
  const [detailThumbnail, setDetailThumbnail] = useState<{ path: string; edge: number; url: string } | null>(null)
  const [viewerOpen, setViewerOpen] = useState(false)
  const [viewerThumbnail, setViewerThumbnail] = useState<{ path: string; edge: number; url: string } | null>(null)
  const [thumbnailFallbackPaths, setThumbnailFallbackPaths] = useState<Set<string>>(() => new Set())
  const [loadedPaths, setLoadedPaths] = useState<Set<string>>(() => new Set())
  const [failedPaths, setFailedPaths] = useState<Set<string>>(() => new Set())
  const [selected, setSelected] = useState<ImageAsset | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set())
  const [removeSelectedOpen, setRemoveSelectedOpen] = useState(false)
  const [folderImportOpen, setFolderImportOpen] = useState(false)
  const [createCollectionOpen, setCreateCollectionOpen] = useState(false)
  const [renameCollection, setRenameCollection] = useState<ImageCollection | null>(null)
  const [removeCollection, setRemoveCollection] = useState<ImageCollection | null>(null)
  const [removeRoot, setRemoveRoot] = useState<ImageLibraryRoot | null>(null)
  const [removeRootAssets, setRemoveRootAssets] = useState(false)
  const [recursive, setRecursive] = useState(true)
  const [busy, setBusy] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [progress, setProgress] = useState<ImageScanProgress | null>(null)
  const [message, setMessage] = useState('')
  const [removeAsset, setRemoveAsset] = useState<ImageAsset | null>(null)
  const taskRef = useRef<string | null>(null)
  const progressTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const thumbnailUrlRequestsRef = useRef<Set<string>>(new Set())
  const fullUrlRequestsRef = useRef<Set<string>>(new Set())
  const mountedRef = useRef(true)

  const saveLibrary = (next: ImageLibraryState) => update((state) => ({ ...state, imageLibrary: next }))

  const hideProgressLater = (taskId: string) => {
    if (progressTimer.current) clearTimeout(progressTimer.current)
    progressTimer.current = setTimeout(() => setProgress((current) => current?.taskId === taskId ? null : current), 1800)
  }

  const scan = async (source = library, rootId?: string) => {
    if (!window.sylunae) return
    const taskId = crypto.randomUUID()
    taskRef.current = taskId
    setBusy(true)
    setCancelling(false)
    setProgress({ taskId, stage: 'discovering', message: '正在准备扫描…', completed: 0, total: null })
    setMessage('')
    try {
      const next = await window.sylunae.images.scan(taskId, source, rootId)
      saveLibrary(next)
      setProgress((current) => current?.taskId === taskId ? { ...current, stage: 'complete', message: `已完成 · ${next.assets.filter((asset) => !asset.missing).length} 张图片`, completed: current.total ?? current.completed, total: current.total } : current)
      hideProgressLater(taskId)
    } catch (error) {
      if (error instanceof Error && error.message.includes('扫描已取消')) {
        setProgress({ taskId, stage: 'cancelled', message: '扫描已取消', completed: 0, total: null })
        hideProgressLater(taskId)
      } else setMessage('刷新图片库失败，请检查文件夹访问权限。')
    } finally {
      if (taskRef.current === taskId) { taskRef.current = null; setBusy(false); setCancelling(false) }
    }
  }

  useEffect(() => {
    if (!window.sylunae) return
    return window.sylunae.images.onScanProgress((next) => {
      if (taskRef.current !== next.taskId) return
      setProgress(next)
      if (next.stage === 'complete' || next.stage === 'cancelled') hideProgressLater(next.taskId)
    })
  }, [])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      if (progressTimer.current) clearTimeout(progressTimer.current)
    }
  }, [])

  useEffect(() => {
    if (!window.sylunae || !library.assets.length) return
    let active = true
    window.sylunae.images.checkPaths(library.assets.map((asset) => asset.path)).then((availability) => {
      if (!active) return
      const changed = library.assets.some((asset) => asset.missing === Boolean(availability[asset.path]))
      if (changed) saveLibrary({ ...library, assets: library.assets.map((asset) => ({ ...asset, missing: !availability[asset.path] })) })
    }).catch(() => undefined)
    return () => { active = false }
  }, [])

  const cancelScan = () => {
    if (!window.sylunae || !taskRef.current || cancelling) return
    setCancelling(true)
    void window.sylunae.images.cancelScan(taskRef.current)
  }

  useEffect(() => {
    if (!selected) return
    setSelected(library.assets.find((asset) => asset.id === selected.id) ?? null)
  }, [library.assets])

  useEffect(() => {
    const assetIds = new Set(library.assets.map((asset) => asset.id))
    setSelectedIds((current) => {
      const next = new Set([...current].filter((id) => assetIds.has(id)))
      return next.size === current.size ? current : next
    })
  }, [library.assets])

  const visible = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase()
    return library.assets
      .filter((asset) => selectedCollection === 'all' || asset.collectionIds.includes(selectedCollection))
      .filter((asset) => !normalized || asset.name.toLocaleLowerCase().includes(normalized) || asset.path.toLocaleLowerCase().includes(normalized))
      .sort((a, b) => sort === 'recent' ? b.createdAt.localeCompare(a.createdAt) : a.name.localeCompare(b.name, 'zh-CN'))
  }, [library.assets, selectedCollection, query, sort])

  const pageCount = Math.max(1, Math.ceil(visible.length / IMAGE_PAGE_SIZE))
  const pagedVisible = useMemo(() => visible.slice((page - 1) * IMAGE_PAGE_SIZE, page * IMAGE_PAGE_SIZE), [visible, page])

  useEffect(() => { setPage(1); setSelectedIds(new Set()) }, [selectedCollection, query, sort])
  useEffect(() => { if (page > pageCount) setPage(pageCount) }, [page, pageCount])

  useEffect(() => {
    const grid = galleryGridRef.current
    if (!grid) return
    const updateLayout = () => {
      const styles = getComputedStyle(grid)
      const columnCount = Math.max(1, Number.parseInt(styles.columnCount, 10) || 1)
      const columnGap = Number.parseFloat(styles.columnGap) || 0
      const columnWidth = Math.max(1, (grid.clientWidth - columnGap * (columnCount - 1)) / columnCount)
      const dpr = window.devicePixelRatio || 1
      setThumbnailLayout((current) => Math.abs(current.columnWidth - columnWidth) < 0.5 && current.dpr === dpr ? current : { columnWidth, dpr })
    }
    updateLayout()
    const observer = new ResizeObserver(updateLayout)
    observer.observe(grid)
    window.addEventListener('resize', updateLayout)
    return () => { observer.disconnect(); window.removeEventListener('resize', updateLayout) }
  }, [pagedVisible.length])

  useEffect(() => {
    if (!window.sylunae) return
    if (!thumbnailLayout.columnWidth) return
    const requests = pagedVisible.flatMap((asset) => {
      if (asset.missing) return []
      const renderedLongEdge = thumbnailLayout.columnWidth * Math.max(1, asset.height / Math.max(1, asset.width))
      const maxEdge = Math.min(960, Math.ceil(renderedLongEdge * thumbnailLayout.dpr * 1.03 / 16) * 16)
      const requestKey = `${asset.path}\0${maxEdge}`
      if (thumbnailEdges[asset.path] === maxEdge || thumbnailUrlRequestsRef.current.has(requestKey)) return []
      return [{ path: asset.path, maxEdge, requestKey }]
    })
    if (!requests.length) return
    requests.forEach(({ requestKey }) => thumbnailUrlRequestsRef.current.add(requestKey))
    window.sylunae.images.getThumbnailUrls(requests.map(({ path, maxEdge }) => ({ path, maxEdge }))).then((next) => {
      if (!mountedRef.current) return
      setThumbnailUrls((current) => ({ ...current, ...next }))
      setThumbnailEdges((current) => ({ ...current, ...Object.fromEntries(requests.flatMap(({ path, maxEdge }) => next[path] ? [[path, maxEdge]] : [])) }))
      setThumbnailFallbackPaths((current) => {
        const fallback = new Set(current)
        requests.forEach(({ path }) => { if (next[path]) fallback.delete(path) })
        return fallback
      })
      setFailedPaths((current) => {
        const failed = new Set(current)
        requests.forEach(({ path }) => next[path] ? failed.delete(path) : failed.add(path))
        return failed
      })
    }).catch(() => { if (mountedRef.current) setFailedPaths((current) => new Set([...current, ...requests.map(({ path }) => path)])) })
      .finally(() => requests.forEach(({ requestKey }) => thumbnailUrlRequestsRef.current.delete(requestKey)))
  }, [pagedVisible, thumbnailEdges, thumbnailLayout])

  const requestOriginalUrl = (path: string) => {
    if (!window.sylunae || urls[path] || fullUrlRequestsRef.current.has(path)) return
    fullUrlRequestsRef.current.add(path)
    window.sylunae.images.getUrls([path]).then((next) => {
      if (!mountedRef.current) return
      setUrls((current) => ({ ...current, ...next }))
      if (!next[path]) setFailedPaths((current) => new Set(current).add(path))
    }).catch(() => {
      if (mountedRef.current) setFailedPaths((current) => new Set(current).add(path))
    }).finally(() => fullUrlRequestsRef.current.delete(path))
  }

  useEffect(() => {
    if (!window.sylunae || !selected || selected.missing) return
    const preview = detailPreviewElement
    if (!preview) return
    let active = true
    const selectedPath = selected.path
    const requestPreview = () => {
      const edge = Math.min(2560, Math.ceil(Math.max(preview.clientWidth, preview.clientHeight) * (window.devicePixelRatio || 1) * 1.03 / 16) * 16)
      const requestKey = `detail:${selectedPath}\0${edge}`
      if ((detailThumbnail?.path === selectedPath && detailThumbnail.edge === edge) || thumbnailUrlRequestsRef.current.has(requestKey)) return
      thumbnailUrlRequestsRef.current.add(requestKey)
      window.sylunae!.images.getThumbnailUrls([{ path: selectedPath, maxEdge: edge }]).then((next) => {
        if (!active || !mountedRef.current) return
        if (next[selectedPath]) setDetailThumbnail({ path: selectedPath, edge, url: next[selectedPath] })
        else requestOriginalUrl(selectedPath)
      }).catch(() => { if (active && mountedRef.current) requestOriginalUrl(selectedPath) })
        .finally(() => thumbnailUrlRequestsRef.current.delete(requestKey))
    }
    requestPreview()
    const observer = new ResizeObserver(requestPreview)
    observer.observe(preview)
    return () => { active = false; observer.disconnect() }
  }, [selected?.path, detailPreviewElement, detailThumbnail])

  useEffect(() => {
    if (!window.sylunae || !viewerOpen || !selected || selected.missing) return
    let active = true
    const selectedPath = selected.path
    const requestPreview = () => {
      const viewportLongEdge = Math.max(window.innerWidth * 0.94, window.innerHeight * 0.86)
      const edge = Math.min(2560, Math.ceil(viewportLongEdge * (window.devicePixelRatio || 1) * 1.03 / 32) * 32)
      const requestKey = `viewer:${selectedPath}\0${edge}`
      if ((viewerThumbnail?.path === selectedPath && viewerThumbnail.edge === edge) || thumbnailUrlRequestsRef.current.has(requestKey)) return
      thumbnailUrlRequestsRef.current.add(requestKey)
      window.sylunae!.images.getThumbnailUrls([{ path: selectedPath, maxEdge: edge }]).then((next) => {
        if (!active || !mountedRef.current) return
        if (next[selectedPath]) setViewerThumbnail({ path: selectedPath, edge, url: next[selectedPath] })
        else requestOriginalUrl(selectedPath)
      }).catch(() => { if (active && mountedRef.current) requestOriginalUrl(selectedPath) })
        .finally(() => thumbnailUrlRequestsRef.current.delete(requestKey))
    }
    requestPreview()
    window.addEventListener('resize', requestPreview)
    return () => { active = false; window.removeEventListener('resize', requestPreview) }
  }, [viewerOpen, selected?.path, viewerThumbnail])

  const handleCardImageError = (path: string, usedOriginal: boolean) => {
    if (usedOriginal) {
      setFailedPaths((current) => new Set(current).add(path))
      return
    }
    setThumbnailFallbackPaths((current) => new Set(current).add(path))
    requestOriginalUrl(path)
  }

  const toggleSelected = (assetId: string) => {
    setSelectedIds((current) => {
      const next = new Set(current)
      if (next.has(assetId)) next.delete(assetId)
      else next.add(assetId)
      return next
    })
  }

  const pageAssetIds = pagedVisible.map((asset) => asset.id)
  const allPageSelected = pageAssetIds.length > 0 && pageAssetIds.every((id) => selectedIds.has(id))
  const togglePageSelection = () => setSelectedIds((current) => {
    const next = new Set(current)
    if (allPageSelected) pageAssetIds.forEach((id) => next.delete(id))
    else pageAssetIds.forEach((id) => next.add(id))
    return next
  })

  const addSelectedToCollection = (collectionId: string) => {
    const now = new Date().toISOString()
    saveLibrary({ ...library, assets: library.assets.map((asset) => selectedIds.has(asset.id) && !asset.collectionIds.includes(collectionId) ? { ...asset, collectionIds: [...asset.collectionIds, collectionId], updatedAt: now } : asset) })
  }

  const removeSelectedFromCollection = () => {
    if (selectedCollection === 'all') return
    const now = new Date().toISOString()
    saveLibrary({ ...library, assets: library.assets.map((asset) => selectedIds.has(asset.id) ? { ...asset, collectionIds: asset.collectionIds.filter((id) => id !== selectedCollection), updatedAt: now } : asset) })
    setSelectedIds(new Set())
  }

  const openAsset = (asset: ImageAsset) => {
    if (selectedIds.size) toggleSelected(asset.id)
    else { setViewerOpen(false); setSelected(asset) }
  }

  const addImages = async () => {
    if (!window.sylunae || busy) return
    setBusy(true)
    setMessage('')
    try {
      const additions = await window.sylunae.images.pick()
      if (!additions.length) return
      const existingByPath = new Map(library.assets.map((asset) => [pathKey(asset.path), asset]))
      let addedCount = 0
      const assets = library.assets.map((asset) => ({ ...asset, collectionIds: [...asset.collectionIds] }))
      for (const addition of additions) {
        const existing = existingByPath.get(pathKey(addition.path))
        if (existing) {
          if (selectedCollection !== 'all' && !existing.collectionIds.includes(selectedCollection)) {
            const target = assets.find((asset) => asset.id === existing.id)
            if (target) target.collectionIds.push(selectedCollection)
          }
          continue
        }
        const next = { ...addition, collectionIds: selectedCollection === 'all' ? [] : [selectedCollection] }
        assets.push(next)
        existingByPath.set(pathKey(next.path), next)
        addedCount += 1
      }
      saveLibrary({ ...library, assets })
      if (!addedCount) setMessage('所选图片已在资料库中；已更新其收藏夹归类。')
    } catch (error) { setMessage(imageIpcUnavailable(error) ? '桌面主进程尚未加载图片功能，请完全退出并重新启动丝月工坊。' : '无法添加所选图片。') }
    finally { setBusy(false) }
  }

  const importFolder = async () => {
    if (!window.sylunae) return
    setBusy(true)
    try {
      const root = await window.sylunae.images.pickRoot(recursive)
      if (!root) return
      const newPath = pathKey(root.path).replace(/\/$/, '')
      const overlap = library.roots.find((item) => {
        const existingPath = pathKey(item.path).replace(/\/$/, '')
        return newPath === existingPath || newPath.startsWith(`${existingPath}/`) || existingPath.startsWith(`${newPath}/`)
      })
      if (overlap) {
        if (overlap.collectionId) setSelectedCollection(overlap.collectionId)
        setFolderImportOpen(false)
        setMessage('这个文件夹与已有导入来源范围重叠。')
        return
      }
      const now = new Date().toISOString()
      const collection: ImageCollection = { id: crypto.randomUUID(), name: root.name, createdAt: now, updatedAt: now }
      const source = { roots: [...library.roots, { ...root, collectionId: collection.id }], collections: [...library.collections, collection], assets: library.assets }
      setSelectedCollection(collection.id)
      setFolderImportOpen(false)
      await scan(source, root.id)
    } catch (error) { setMessage(imageIpcUnavailable(error) ? '桌面主进程尚未加载图片功能，请完全退出并重新启动丝月工坊。' : '无法导入这个文件夹。') }
    finally { setBusy(false) }
  }

  const relocateRoot = async (rootId: string) => {
    if (!window.sylunae || busy) return
    const taskId = crypto.randomUUID()
    taskRef.current = taskId
    setBusy(true)
    setCancelling(false)
    setProgress({ taskId, stage: 'discovering', message: '正在重新定位导入来源…', completed: 0, total: null })
    setMessage('')
    try {
      const next = await window.sylunae.images.relocateRoot(taskId, rootId, library)
      if (!next) { setProgress(null); return }
      saveLibrary(next)
      setProgress((current) => current?.taskId === taskId ? { ...current, stage: 'complete', message: '来源已重新定位', completed: current.total ?? current.completed } : current)
      hideProgressLater(taskId)
    } catch (error) {
      setProgress(null)
      setMessage(imageIpcUnavailable(error) ? '桌面主进程尚未加载图片功能，请完全退出并重新启动丝月工坊。' : '无法重新定位这个导入来源。')
    } finally {
      if (taskRef.current === taskId) { taskRef.current = null; setBusy(false); setCancelling(false) }
    }
  }

  const createCollection = (name: string) => {
    const now = new Date().toISOString()
    const collection = { id: crypto.randomUUID(), name, createdAt: now, updatedAt: now }
    saveLibrary({ ...library, collections: [...library.collections, collection] })
    setSelectedCollection(collection.id)
  }

  const rename = (name: string) => {
    if (!renameCollection) return
    saveLibrary({ ...library, collections: library.collections.map((collection) => collection.id === renameCollection.id ? { ...collection, name, updatedAt: new Date().toISOString() } : collection) })
    setRenameCollection(null)
  }

  const toggleAssetCollection = (collectionId: string) => {
    if (!selected) return
    const hasCollection = selected.collectionIds.includes(collectionId)
    saveLibrary({ ...library, assets: library.assets.map((asset) => asset.id === selected.id ? { ...asset, collectionIds: hasCollection ? asset.collectionIds.filter((id) => id !== collectionId) : [...asset.collectionIds, collectionId], updatedAt: new Date().toISOString() } : asset) })
  }

  const relocateAsset = async (asset: ImageAsset) => {
    if (!window.sylunae) return
    setBusy(true)
    try {
      const next = await window.sylunae.images.relocateAsset(asset.id, library)
      if (next) saveLibrary(next)
    } finally { setBusy(false) }
  }

  const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000
  const addedThisWeek = library.assets.filter((asset) => new Date(asset.createdAt).getTime() >= weekAgo).length
  const detailPreviewSrc = selected
    ? detailThumbnail?.path === selected.path ? detailThumbnail.url : urls[selected.path]
    : undefined
  const viewerPreviewSrc = selected
    ? viewerThumbnail?.path === selected.path ? viewerThumbnail.url : detailPreviewSrc
    : undefined

  const closeDetails = () => {
    setViewerOpen(false)
    setSelected(null)
  }

  const openImageViewer = () => {
    if (!selected || selected.missing) return
    requestOriginalUrl(selected.path)
    setViewerOpen(true)
  }

  if (!window.sylunae) return <div className="image-desktop-only"><HardDrive size={30} /><h2>客户端专属</h2><p>请使用支持本地图片库的丝月工坊客户端建立图片收藏。</p></div>

  return <div ref={contentRef} className="image-library-shell">
    <div className="image-library-toolbar">
      <label className="image-search"><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索文件名或路径" /></label>
      <div className="image-toolbar-actions">
        <Select value={sort} onValueChange={(value) => setSort(value as GallerySort)}><SelectTrigger className="image-sort"><SlidersHorizontal size={15} /><SelectValue /></SelectTrigger><SelectContent><SelectItem value="recent">按最近收藏</SelectItem><SelectItem value="name">按文件名</SelectItem></SelectContent></Select>
        {!isAndroid && <Button variant="outline" onClick={() => setFolderImportOpen(true)}><FolderInput size={16} />导入文件夹</Button>}
        <Button onClick={() => void addImages()} disabled={busy}><Plus size={16} />添加图片</Button>
      </div>
    </div>

    {progress && <div className={`image-scan-progress ${progress.stage}`}><div><span>{progress.message}</span>{progress.total !== null && <strong>{Math.round((progress.completed / Math.max(1, progress.total)) * 100)}%</strong>}</div><div className={`image-scan-track ${progress.total === null ? 'indeterminate' : ''}`}><i style={progress.total === null ? undefined : { width: `${(progress.completed / Math.max(1, progress.total)) * 100}%` }} /></div>{busy && <button onClick={cancelScan} disabled={cancelling} aria-label="取消扫描"><X size={15} />{cancelling ? '正在取消' : '取消'}</button>}</div>}
    {message && <div className="notice error"><AlertCircle size={16} />{message}<button onClick={() => setMessage('')}>关闭</button></div>}

    <div className="image-library-layout">
      <aside className="image-folder-panel">
        <div className="image-folder-heading"><strong>收藏夹</strong><button aria-label="新建收藏夹" onClick={() => setCreateCollectionOpen(true)}><Plus size={18} /></button></div>
        <button className={`image-folder-row ${selectedCollection === 'all' ? 'active' : ''}`} onClick={() => setSelectedCollection('all')}><FolderOpen size={18} /><span>全部图片</span><small>{library.assets.length}</small></button>
        {library.collections.map((collection) => <div className={`image-folder-row-wrap ${selectedCollection === collection.id ? 'active' : ''}`} key={collection.id}><button className="image-folder-row" onClick={() => setSelectedCollection(collection.id)}><Images size={18} /><span className="private-collection-name">{collection.name}</span><small>{library.assets.filter((asset) => asset.collectionIds.includes(collection.id)).length}</small></button><button className="image-folder-action image-folder-edit" title="重命名收藏夹" onClick={() => setRenameCollection(collection)}><Pencil size={13} /></button><button className="image-folder-action" title="删除收藏夹" onClick={() => setRemoveCollection(collection)}><Trash2 size={14} /></button></div>)}
        <div className="image-source-section">
          <div className="image-source-heading"><strong>文件夹来源</strong><small>{library.roots.length}</small></div>
          {library.roots.length === 0 ? <p className="image-source-empty">尚未导入文件夹。通过上方“导入文件夹”建立可刷新的来源。</p> : library.roots.map((root) => {
            const collection = library.collections.find((item) => item.id === root.collectionId)
            const assetCount = library.assets.filter((asset) => asset.rootId === root.id).length
            return <div className={`image-source-card ${root.missing ? 'missing' : ''}`} key={root.id}>
              <div className="image-source-title"><FolderInput size={15} /><strong className="private-source-name">{root.name}</strong><span>{root.missing ? '不可用' : '正常'}</span></div>
              <p className="private-source-path" title={root.path}>{root.path}</p>
              <div className="image-source-meta"><span>{root.recursive ? '包含子文件夹' : '仅当前文件夹'}</span><span>{assetCount} 张图片</span>{collection && <span>归入 <span className="user-content">{collection.name}</span></span>}</div>
              <small>最近扫描：{formatScanTime(root.lastScannedAt)}</small>
              <div className="image-root-actions"><button disabled={busy} onClick={() => void scan(library, root.id)}><RefreshCw size={13} />刷新</button><DropdownMenu><DropdownMenuTrigger asChild><button className="image-root-more" disabled={busy} aria-label={`更多来源操作：${root.name}`}><MoreHorizontal size={15} /></button></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuItem onSelect={() => void relocateRoot(root.id)}><LocateFixed />重新定位</DropdownMenuItem><DropdownMenuItem variant="destructive" onSelect={() => { setRemoveRootAssets(false); setRemoveRoot(root) }}><Trash2 />移除来源</DropdownMenuItem></DropdownMenuContent></DropdownMenu></div>
            </div>
          })}
        </div>
      </aside>

      <section className="image-gallery-main">
        <div className="image-library-stats"><div><ImageIcon size={20} /><span>已收藏<strong>{library.assets.length}</strong></span><ChevronRight size={16} /></div><div><Images size={20} /><span>收藏夹<strong>{library.collections.length}</strong></span></div><div><CalendarPlus size={20} /><span>本周新增<strong>{addedThisWeek}</strong></span></div>{library.roots.length > 0 && <Button variant="ghost" className="image-refresh" onClick={() => busy ? cancelScan() : void scan()}><RefreshCw className={busy ? 'spin' : ''} size={16} />{busy ? (cancelling ? '正在取消' : '取消扫描') : '刷新导入来源'}</Button>}</div>
        {selectedIds.size > 0 && <div className="image-selection-toolbar">
          <div><CheckSquare2 size={17} /><strong>已选择 {selectedIds.size} 张</strong></div>
          <Button variant="ghost" size="sm" onClick={togglePageSelection}>{allPageSelected ? '取消本页全选' : '全选本页'}</Button>
          {library.collections.length > 0 && <Select onValueChange={addSelectedToCollection}><SelectTrigger className="image-batch-collection" size="sm"><FolderInput size={15} /><SelectValue className="private-select-value" placeholder="加入收藏夹" /></SelectTrigger><SelectContent>{library.collections.map((collection) => <SelectItem key={collection.id} value={collection.id}><span className="user-content">{collection.name}</span></SelectItem>)}</SelectContent></Select>}
          {selectedCollection !== 'all' && <Button variant="ghost" size="sm" onClick={removeSelectedFromCollection}>移出当前收藏夹</Button>}
          <Button variant="ghost" size="sm" className="image-batch-remove" onClick={() => setRemoveSelectedOpen(true)}><Trash2 size={15} />移除索引</Button>
          <Button variant="ghost" size="icon-sm" aria-label="退出多选" onClick={() => setSelectedIds(new Set())}><X size={16} /></Button>
        </div>}
        {library.assets.length === 0 ? <div className="image-gallery-empty"><span><Images size={28} /></span><h2>建立你的私人图片收藏</h2><p>选择一张或多张本地图片建立索引，原始文件不会被移动、复制或修改。</p><Button onClick={() => void addImages()}><Plus size={16} />添加第一批图片</Button></div> : visible.length === 0 ? <div className="image-gallery-empty compact"><span><Search size={25} /></span><h2>没有找到图片</h2><p>可以调整筛选条件，或者向当前收藏夹添加图片。</p><Button onClick={() => void addImages()}><Plus size={16} />添加图片</Button></div> : <><div ref={galleryGridRef} className={`image-gallery-grid ${selectedIds.size ? 'selecting' : ''}`}>{pagedVisible.map((asset) => {
          const isSelected = selectedIds.has(asset.id)
          const useOriginal = thumbnailFallbackPaths.has(asset.path)
          const imageUrl = useOriginal ? urls[asset.path] : thumbnailUrls[asset.path]
          return <div key={asset.id} role="button" tabIndex={0} aria-label={`${isSelected ? '取消选择' : selectedIds.size ? '选择' : '查看'} ${asset.name}`} aria-pressed={selectedIds.size ? isSelected : undefined} className={`image-gallery-card ${asset.missing ? 'missing' : ''} ${isSelected ? 'selected' : ''}`} style={{ aspectRatio: `${Math.max(1, asset.width)} / ${Math.max(1, asset.height)}` }} onClick={() => openAsset(asset)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openAsset(asset) } }}>
            <Checkbox className="image-card-checkbox" checked={isSelected} aria-label={`${isSelected ? '取消选择' : '选择'} ${asset.name}`} onClick={(event) => event.stopPropagation()} onCheckedChange={() => toggleSelected(asset.id)} />
            {asset.missing ? <span className="image-missing"><AlertCircle size={22} />文件已移动或删除</span> : <>{imageUrl && !failedPaths.has(asset.path) && <img className={loadedPaths.has(asset.path) ? 'loaded' : ''} src={imageUrl} alt={asset.name} loading="lazy" decoding="async" onLoad={() => setLoadedPaths((current) => new Set(current).add(asset.path))} onError={() => handleCardImageError(asset.path, useOriginal)} />}{!loadedPaths.has(asset.path) && !failedPaths.has(asset.path) && <span className="image-card-loading" aria-label="正在加载图片"><i /></span>}{failedPaths.has(asset.path) && <span className="image-card-unavailable"><AlertCircle size={22} />图片暂时无法加载</span>}</>}
            <span className="image-card-overlay"><strong className="private-image-name">{asset.name}</strong><small>{typeLabels[asset.aspectType]} · {asset.width} × {asset.height}</small></span>
          </div>
        })}</div><ContentPagination page={page} pageCount={pageCount} onPageChange={setPage} scrollTargetRef={contentRef} /></>}
      </section>
    </div>

    <Dialog open={folderImportOpen} onOpenChange={setFolderImportOpen}><DialogContent className="image-folder-dialog"><DialogHeader><DialogTitle>批量导入图片文件夹</DialogTitle><DialogDescription>文件夹只作为导入来源；系统会创建同名收藏夹，你之后可以自由调整归类。</DialogDescription></DialogHeader><div className="image-recursive-options"><button className={recursive ? 'active' : ''} onClick={() => setRecursive(true)}><FolderOpen size={20} /><strong>包含子文件夹</strong><span>递归导入目录中的所有图片</span></button><button className={!recursive ? 'active' : ''} onClick={() => setRecursive(false)}><FolderInput size={20} /><strong>仅当前文件夹</strong><span>忽略所有下级目录</span></button></div><DialogFooter><Button variant="outline" onClick={() => setFolderImportOpen(false)}>取消</Button><Button disabled={busy} onClick={() => void importFolder()}>选择并导入</Button></DialogFooter></DialogContent></Dialog>

    <Sheet open={Boolean(selected)} onOpenChange={(open) => { if (!open) closeDetails() }}><SheetContent className="detail-drawer metadata-drawer" showCloseButton><SheetHeader className="metadata-sheet-header"><SheetTitle>图片详情</SheetTitle><SheetDescription>查看索引信息并调整收藏夹归类。</SheetDescription></SheetHeader>{selected && <div className="metadata-sheet-body image-detail-body"><button ref={setDetailPreviewElement} type="button" className="image-detail-preview" style={{ aspectRatio: `${Math.max(1, selected.width)} / ${Math.max(1, selected.height)}` }} disabled={selected.missing} aria-label={selected.missing ? `${selected.name} 的原文件不可用` : `放大查看 ${selected.name}`} onClick={openImageViewer}>{selected.missing ? <AlertCircle size={34} /> : detailPreviewSrc ? <><img src={detailPreviewSrc} alt={selected.name} /><span className="image-detail-zoom-hint"><Maximize2 size={14} />点击放大</span></> : <RefreshCw className="spin" size={25} aria-label="正在生成清晰预览" />}</button>{selected.missing && <div className="notice error"><AlertCircle size={16} />原文件已移动或删除，索引信息仍然保留。</div>}<div className="image-detail-section"><h3>所属收藏夹</h3><div className="image-collection-choices">{library.collections.length ? library.collections.map((collection) => <button key={collection.id} className={selected.collectionIds.includes(collection.id) ? 'active' : ''} onClick={() => toggleAssetCollection(collection.id)}><span className="private-collection-name">{collection.name}</span></button>) : <p>还没有收藏夹，可以先在图片库左侧新建。</p>}</div></div><dl className="image-detail-list"><div><dt>文件名</dt><dd className="private-image-value">{selected.name}</dd></div><div><dt>尺寸类型</dt><dd>{typeLabels[selected.aspectType]}</dd></div><div><dt>分辨率</dt><dd>{selected.width} × {selected.height}</dd></div><div><dt>格式</dt><dd>{selected.extension.replace('.', '').toUpperCase()}</dd></div><div><dt>文件大小</dt><dd>{formatBytes(selected.size)}</dd></div><div><dt>完整路径</dt><dd className="private-image-value" title={selected.path}>{shortPath(selected.path)}</dd></div></dl><Button variant="ghost" className="button image-index-remove" onClick={() => setRemoveAsset(selected)}><Trash2 size={16} />移除图片索引</Button></div>}<SheetFooter className="metadata-sheet-footer"><Button variant="outline" className="button secondary" onClick={closeDetails}>取消</Button>{selected?.missing ? <Button className="button primary" disabled={busy} onClick={() => void relocateAsset(selected)}><LocateFixed size={16} />重新定位</Button> : <Button className="button primary" onClick={closeDetails}>完成</Button>}</SheetFooter></SheetContent></Sheet>

    <ImageViewer open={viewerOpen} onOpenChange={setViewerOpen} src={viewerPreviewSrc} originalSrc={selected ? urls[selected.path] : undefined} alt={selected?.name ?? '图片预览'} />

    <PromptDialog open={createCollectionOpen} onOpenChange={setCreateCollectionOpen} title="新建收藏夹" description="收藏夹只存在于丝月工坊中，不会更改本地文件夹。" placeholder="收藏夹名称" confirmLabel="创建" onSubmit={createCollection} />
    <PromptDialog open={Boolean(renameCollection)} onOpenChange={(open) => { if (!open) setRenameCollection(null) }} title="重命名收藏夹" description="本地图片和文件夹名称不会改变。" initialValue={renameCollection?.name} placeholder="收藏夹名称" confirmLabel="保存" onSubmit={rename} />
    <ConfirmDialog open={Boolean(removeCollection)} onOpenChange={(open) => { if (!open) setRemoveCollection(null) }} title="删除收藏夹？" description="只会删除这个分类，收藏夹中的图片仍会保留在全部图片中。" confirmLabel="删除收藏夹" destructive icon={<Images size={19} />} onConfirm={() => { if (!removeCollection) return; saveLibrary({ ...library, collections: library.collections.filter((collection) => collection.id !== removeCollection.id), roots: library.roots.map((root) => root.collectionId === removeCollection.id ? { ...root, collectionId: null } : root), assets: library.assets.map((asset) => ({ ...asset, collectionIds: asset.collectionIds.filter((id) => id !== removeCollection.id) })) }); if (selectedCollection === removeCollection.id) setSelectedCollection('all'); setRemoveCollection(null) }} />
    <ConfirmDialog open={Boolean(removeRoot)} onOpenChange={(open) => { if (!open) { setRemoveRoot(null); setRemoveRootAssets(false) } }} title="移除文件夹来源？" description={<div className="image-remove-source-options"><p>丝月工坊将停止跟踪和刷新“<span className="private-source-name">{removeRoot?.name}</span>”，不会删除本地文件夹或其中的图片。</p><label><Checkbox checked={removeRootAssets} onCheckedChange={(checked) => setRemoveRootAssets(checked === true)} /><span><strong>同时移除该来源的图片索引</strong><small>仅从丝月工坊中移除；本地图片仍会保留。</small></span></label></div>} confirmLabel="移除来源" destructive icon={<FolderInput size={19} />} onConfirm={() => { if (!removeRoot) return; saveLibrary({ ...library, roots: library.roots.filter((root) => root.id !== removeRoot.id), assets: removeRootAssets ? library.assets.filter((asset) => asset.rootId !== removeRoot.id) : library.assets.map((asset) => asset.rootId === removeRoot.id ? { ...asset, rootId: null } : asset) }); setRemoveRoot(null); setRemoveRootAssets(false) }} />
    <ConfirmDialog open={Boolean(removeAsset)} onOpenChange={(open) => { if (!open) setRemoveAsset(null) }} title="移除图片索引？" description="图片原文件会保留在本地。若它来自已保留的文件夹导入来源，刷新来源时可能再次被索引。" confirmLabel="移除索引" destructive icon={<ImageIcon size={19} />} onConfirm={() => { if (!removeAsset) return; saveLibrary({ ...library, assets: library.assets.filter((asset) => asset.id !== removeAsset.id) }); setSelected(null); setRemoveAsset(null) }} />
    <ConfirmDialog open={removeSelectedOpen} onOpenChange={setRemoveSelectedOpen} title={`移除选中的 ${selectedIds.size} 张图片索引？`} description="图片原文件会保留在本地。若图片来自已保留的文件夹导入来源，刷新来源时可能再次被索引。" confirmLabel="批量移除索引" destructive icon={<Images size={19} />} onConfirm={() => { saveLibrary({ ...library, assets: library.assets.filter((asset) => !selectedIds.has(asset.id)) }); setSelectedIds(new Set()); setRemoveSelectedOpen(false) }} />
  </div>
}
