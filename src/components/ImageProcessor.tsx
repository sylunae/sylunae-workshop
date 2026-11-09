import { saveBlob } from '../platform/saveFile'
import { isElectron } from '../platform/environment'
import { useEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent, type PointerEvent } from 'react'
import { Crop, Download, FileImage, FolderOpen, Check, Upload, RotateCcw, RotateCw, Trash2, X } from 'lucide-react'
import { Button } from './ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select'
import { Checkbox } from './ui/checkbox'
import { Input } from './ui/input'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog'
import type { ImageFolderSummary, ImageFolderOutput } from '../shared/types'
import { centeredCrop, encodeImage, outputName, encodingQuality, type EncodingLevel, type CropRect, type ImageEdits } from '../lib/imageProcessing'

import { imageDownloadNames, moveImage, validateImageNaming, type ImageNamingRule } from '../shared/imageNaming'

interface SourceImage extends ImageEdits { id: string; file: File; url: string; width: number; height: number }
interface EncodedImage { id: string; name: string; blob: Blob; url: string; width: number; height: number; originalSize: number }
type ResultImage = EncodedImage
const sizeLabel = (bytes: number) => bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 / 1024).toFixed(2)} MB`
const errorLabel = (error: unknown) => error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': Error: /, '') : '处理失败'

function CropNumberInput({ label, value, min, onCommit }: { label: string; value: number; min: number; onCommit: (value: number) => void }) {
  const [draft, setDraft] = useState(String(Math.round(value)))
  const editing = useRef(false)
  useEffect(() => { if (!editing.current) setDraft(String(Math.round(value))) }, [value])
  return <label>{label}<Input type="number" min={min} value={draft}
    onFocus={() => { editing.current = true }} onChange={(event) => setDraft(event.target.value)}
    onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur() }}
    onBlur={() => { editing.current = false; const number = Number(draft); if (draft !== '' && Number.isFinite(number)) onCommit(Math.round(number)); setDraft(String(Math.round(value))) }} /></label>
}

// Native drag on desktop; touch/pen use the same drop targets without extra controls.
function useResultSorting(onMove: (from: string, to: string) => void, disabled: boolean) {
  const [dragged, setDragged] = useState<string | null>(null)
  const [target, setTarget] = useState<string | null>(null)
  const source = useRef<string | null>(null)
  const touch = useRef<{ x: number; y: number; id: string; target: string; moved: boolean } | null>(null)
  const suppressClick = useRef(false)
  const finish = () => { source.current = null; touch.current = null; setDragged(null); setTarget(null); window.setTimeout(() => { suppressClick.current = false }, 0) }
  const props = (id: string) => ({
    'data-sort-id': id,
    draggable: !disabled,
    tabIndex: 0,
    className: `image-result-card${dragged === id ? ' is-dragging' : ''}${target === id && dragged !== id ? ' is-drop-target' : ''}`,
    onDragStart: (event: DragEvent<HTMLElement>) => {
      if (disabled || touch.current || (event.target as HTMLElement).closest('[data-no-sort]')) { event.preventDefault(); return }
      source.current = id; suppressClick.current = true; setDragged(id)
      event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', id)
    },
    onDragOver: (event: DragEvent<HTMLElement>) => {
      if (disabled || !source.current) return
      event.preventDefault(); event.dataTransfer.dropEffect = 'move'; setTarget(id)
    },
    onDrop: (event: DragEvent<HTMLElement>) => {
      if (!source.current || disabled) return
      event.preventDefault(); event.stopPropagation(); onMove(source.current, id); finish()
    },
    onDragEnd: finish,
    onClickCapture: (event: React.MouseEvent<HTMLElement>) => { if (suppressClick.current && !(event.target as HTMLElement).closest('[data-no-sort]')) { event.preventDefault(); event.stopPropagation() } },
    onPointerDown: (event: PointerEvent<HTMLElement>) => {
      if (disabled || event.pointerType === 'mouse' || (event.target as HTMLElement).closest('[data-no-sort]')) return
      touch.current = { x: event.clientX, y: event.clientY, id, target: id, moved: false }
    },
    onPointerMove: (event: PointerEvent<HTMLElement>) => {
      const current = touch.current
      if (!current || disabled) return
      if (!current.moved && Math.hypot(event.clientX - current.x, event.clientY - current.y) < 8) return
      event.currentTarget.setPointerCapture(event.pointerId)
      current.moved = true; suppressClick.current = true; setDragged(current.id)
      const card = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('[data-sort-id]')
      if (card?.dataset.sortId) { current.target = card.dataset.sortId; setTarget(current.target) }
    },
    onPointerUp: () => { const current = touch.current; if (!current) return; if (current.moved && !disabled) onMove(current.id, current.target); finish() },
    onPointerCancel: () => { if (touch.current) finish() },
    onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
      if (disabled || event.target !== event.currentTarget || !event.altKey || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return
      const cards = Array.from(event.currentTarget.parentElement!.querySelectorAll<HTMLElement>('[data-sort-id]'))
      const index = cards.indexOf(event.currentTarget)
      const next = cards[index + (['ArrowLeft', 'ArrowUp'].includes(event.key) ? -1 : 1)]
      if (next?.dataset.sortId) { event.preventDefault(); onMove(id, next.dataset.sortId) }
    },
  })
  return props
}

export function ImageProcessor() {
  const input = useRef<HTMLInputElement>(null)
  const resultSection = useRef<HTMLElement>(null)
  const urls = useRef(new Set<string>())
  const alive = useRef(true)
  const [items, setItems] = useState<SourceImage[]>([])
  const [activeId, setActiveId] = useState('')
  const [format, setFormat] = useState('image/webp')
  const [level, setLevel] = useState<EncodingLevel>('standard')
  const quality = encodingQuality(level)
  const [folder, setFolder] = useState<ImageFolderSummary | null>(null)
  const [folderOrder, setFolderOrder] = useState<number[]>([])
  const [customNaming, setCustomNaming] = useState(false)
  const [template, setTemplate] = useState('{n}')
  const [start, setStart] = useState('0')
  const [digits, setDigits] = useState('2')
  const [step, setStep] = useState('1')
  const namingRule: ImageNamingRule | undefined = customNaming ? { template, start: start === '' ? NaN : Number(start), digits: digits === '' ? NaN : Number(digits), step: step === '' ? NaN : Number(step) } : undefined
  const namingError = namingRule ? validateImageNaming(namingRule) : ''
  const [folderOutput, setFolderOutput] = useState<ImageFolderOutput | null>(null)
  const [notice, setNotice] = useState('')
  const [cropping, setCropping] = useState(false)
  const [ratio, setRatio] = useState('free')
  const [preview, setPreview] = useState<{ key: string; images: EncodedImage[]; errors: string[] } | null>(null)
  const [results, setResults] = useState<ResultImage[]>([])
  const [viewResult, setViewResult] = useState<ResultImage | null>(null)
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(false)
  const [progress, setProgress] = useState('')
  const [error, setError] = useState('')
  const drag = useRef<{ x: number; y: number; previous: CropRect | null; mode: 'move' | 'draw' | 'resize'; corner?: string } | null>(null)
  const active = items.find((item) => item.id === activeId) ?? items[0]
  const key = useMemo(() => JSON.stringify([items.map(({ id, crop, rotation }) => [id, crop, rotation]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))), format, level]), [items, format, level])
  const currentPreview = preview?.key === key ? preview : null
  const namedResults = useMemo(() => {
    const names = imageDownloadNames(results.map((image) => image.name), namingError ? undefined : namingRule)
    return results.map((image, index) => ({ ...image, name: names[index] }))
  }, [results, customNaming, template, start, digits, step, namingError])
  const displayedResult = namedResults.find((image) => image.id === viewResult?.id)
  const sortResults = useResultSorting((from, to) => {
    setResults((previous) => moveImage(previous, previous.findIndex((image) => image.id === from), previous.findIndex((image) => image.id === to)))
  }, busy || loading)
  const sortFolderResults = useResultSorting((from, to) => {
    setFolderOrder((previous) => moveImage(previous, previous.indexOf(Number(from)), previous.indexOf(Number(to))))
  }, busy || loading)
  const folderNames = imageDownloadNames(folderOrder.map((index) => folderOutput?.files?.[index] ?? '图片.png'), namingError ? undefined : namingRule)
  const activePreview = currentPreview?.images.find((item) => item.id === active?.id)
  const makeUrl = (blob: Blob) => { const url = URL.createObjectURL(blob); urls.current.add(url); return url }
  const release = (url: string) => { URL.revokeObjectURL(url); urls.current.delete(url) }

  useEffect(() => {
    alive.current = true
    return () => { alive.current = false; urls.current.forEach((url) => URL.revokeObjectURL(url)); urls.current.clear() }
  }, [])

  useEffect(() => {
    if (results.length) resultSection.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [results.length])

  useEffect(() => {
    if (folder) return
    let cancelled = false
    const generated: string[] = []
    const timer = window.setTimeout(() => {
      void (async () => {
        const images: EncodedImage[] = []
        const errors: string[] = []
        for (const item of items) {
          if (cancelled) return
          try {
            const encoded = await encodeImage(item.file, item, format, quality, level === 'original')
            if (cancelled) return
            const url = makeUrl(encoded.blob)
            generated.push(url)
            images.push({ ...encoded, id: item.id, name: outputName(item.file.name, level === 'original' && !item.crop && !item.rotation ? 'original' : format), url, originalSize: item.file.size })
          } catch (reason) { errors.push(`${item.file.name}：${errorLabel(reason)}`) }
        }
        if (!cancelled) setPreview({ key, images, errors })
      })()
    }, 300)
    return () => { cancelled = true; window.clearTimeout(timer); generated.forEach(release) }
  }, [key, folder])

  const addFiles = async (files: File[]) => {
    if (busy || loading) return
    setFolder(null)
    setFolderOutput(null)
    setNotice('')
    setLoading(true)
    if (files[0] && window.sylunae) void window.sylunae.imageProcessing.rememberImport(files[0]).catch(() => {})
    setError('')
    const next: SourceImage[] = []
    const failures: string[] = []
    for (const file of files) {
      try {
        const bitmap = await createImageBitmap(file)
        const dimensions = { width: bitmap.width, height: bitmap.height }
        bitmap.close()
        if (!alive.current) return
        next.push({ id: crypto.randomUUID(), file, url: makeUrl(file), ...dimensions, crop: null, rotation: 0 })
      } catch { failures.push(`${file.name}：无法读取图片`) }
    }
    if (!alive.current) return
    setItems((previous) => [...previous, ...next])
    if (next.length) setActiveId(next[0].id)
    setCropping(false)
    setError(failures.join('；'))
    setLoading(false)
  }
  const patchActive = (patch: Partial<ImageEdits>) => setItems((previous) => previous.map((item) => item.id === active?.id ? { ...item, ...patch } : item))
  const rotate = (delta: number, all = false) => setItems((previous) => previous.map((item) => all || item.id === active?.id ? { ...item, rotation: (item.rotation + delta + 360) % 360 } : item))
  const cropRatio = ratio === 'original' && active ? active.width / active.height : ratio === 'free' ? null : Number(ratio)
  const changeRatio = (value: string) => {
    setRatio(value)
    if (!active) return
    const number = value === 'original' ? active.width / active.height : value === 'free' ? null : Number(value)
    if (number) patchActive({ crop: centeredCrop(active.width, active.height, number) })
  }
  const point = (event: PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    return { x: Math.max(0, Math.min(active!.width, (event.clientX - rect.left) / rect.width * active!.width)), y: Math.max(0, Math.min(active!.height, (event.clientY - rect.top) / rect.height * active!.height)) }
  }
  const cropMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!drag.current || !active) return
    const end = point(event)
    const start = drag.current
    if (start.mode === 'move' && start.previous) {
      const previous = start.previous
      patchActive({ crop: { ...previous, x: Math.max(0, Math.min(active.width - previous.width, previous.x + end.x - start.x)), y: Math.max(0, Math.min(active.height - previous.height, previous.y + end.y - start.y)) } })
      return
    }
    const anchor = start.mode === 'resize' && start.previous ? { x: start.corner?.includes('w') ? start.previous.x + start.previous.width : start.previous.x, y: start.corner?.includes('n') ? start.previous.y + start.previous.height : start.previous.y } : start
    let width = Math.abs(end.x - anchor.x)
    let height = Math.abs(end.y - anchor.y)
    if (cropRatio) {
      width = Math.min(width, height * cropRatio)
      height = width / cropRatio
    }
    if (width >= 1 && height >= 1) patchActive({ crop: { x: end.x < anchor.x ? anchor.x - width : anchor.x, y: end.y < anchor.y ? anchor.y - height : anchor.y, width, height } })
  }
  const chooseFolder = async (recursive?: boolean) => {
    if (!window.sylunae || busy || loading) return
    setLoading(true)
    setError('')
    try {
      const summary = recursive === undefined ? await window.sylunae.imageProcessing.pickFolder() : await window.sylunae.imageProcessing.scanFolder(recursive)
      if (summary && alive.current) {
        items.forEach((item) => release(item.url)); results.forEach((item) => release(item.url))
        setItems([]); setResults([]); setViewResult(null); setCropping(false)
        setFolder(summary); setFolderOrder([]); setFolderOutput(null); setNotice('')
      }
    } catch (reason) { setError(errorLabel(reason)) }
    finally { setLoading(false) }
  }
  const downloadAll = async (images: EncodedImage[] = namedResults) => {
    if (busy || namingError) return
    setBusy(true)
    setError('')
    setNotice('')
    try {
      if (window.sylunae) {
        if (!await window.sylunae.imageProcessing.pickDirectory()) return
        if (folder) {
          const saved = await window.sylunae.imageProcessing.saveFolder(namingRule, folderOrder)
          setNotice(`已下载 ${saved.count} 张图片`)
          setError(saved.errors.join('；'))
        } else {
          let count = 0
          const failures: string[] = []
          for (const image of images) {
            try { await window.sylunae.imageProcessing.save(image.name, await image.blob.arrayBuffer()); count++ }
            catch (reason) { failures.push(`${image.name}：${errorLabel(reason)}`) }
          }
          setNotice(`已下载 ${count} 张图片`)
          setError(failures.join('；'))
        }
      } else {
        for (const image of images) { download(image); await new Promise((resolve) => window.setTimeout(resolve, 150)) }
        setNotice('已提交全部下载，请在浏览器下载列表中查看；如有提示，请允许下载多个文件。')
      }
    } catch (reason) { setError(errorLabel(reason)) }
    finally { if (alive.current) setBusy(false) }
  }
  const download = (item: EncodedImage) => {
    void saveBlob(item.name, item.blob).catch((reason) => setError(errorLabel(reason)))
  }
  const exportImages = async () => {
    if (!currentPreview?.images.length || busy) return
    setBusy(true)
    setError('')
    setNotice('')
    const exported: ResultImage[] = []
    try {
      const ordered = items.flatMap((item) => currentPreview.images.filter((image) => image.id === item.id))
      for (const [index, image] of ordered.entries()) {
        setProgress(`${index + 1} / ${currentPreview.images.length}`)
        const result: ResultImage = { ...image, url: makeUrl(image.blob) }
        exported.push(result)
      }
      if (!alive.current) { exported.forEach((item) => release(item.url)); return }
      results.forEach((item) => release(item.url))
      setViewResult(null)
      setResults(exported)
    } finally { if (alive.current) { setBusy(false); setProgress('') } }
  }

  return <div className="tool-workspace image-processor">
    <div className="panel-heading"><div><h2>图片处理器</h2><p>裁剪、旋转与压缩图片，批量生成需要的格式</p></div></div>
    <input ref={input} type="file" accept="image/*" multiple hidden onChange={(event) => { const files = Array.from(event.target.files ?? []); event.target.value = ''; void addFiles(files) }} />
    {error && <p className="image-processing-error" role="alert">{error}</p>}
    {!active && !folder ? <div className="image-import">
      <button className={`audio-editor-dropzone ${loading ? 'loading' : ''}`} disabled={loading} onClick={() => input.current?.click()} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); void addFiles(Array.from(event.dataTransfer.files)) }}><span className="audio-editor-drop-icon"><FileImage size={30} /></span><strong>{loading ? '正在读取…' : '选择或拖入图片'}</strong><span>支持批量选择，文件只在本机处理</span><span className="audio-editor-file-action"><Upload size={14} />选择文件</span></button>
      {isElectron() && <Button variant="outline" disabled={loading} onClick={() => void chooseFolder()}><FolderOpen size={16} />选择文件夹批量处理</Button>}
    </div> : <div className="audio-editor-shell" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); if (!busy && !loading) void addFiles(Array.from(event.dataTransfer.files)) }}>
      <div className="image-edit-area audio-editor-main">
        <div className="audio-editor-filebar image-filebar"><span className="audio-editor-file-icon">{folder ? <FolderOpen size={19} /> : <FileImage size={19} />}</span><div><strong>{folder ? folder.path : active?.file.name}</strong><span>{folder ? `${folder.count} 张图片 · ${sizeLabel(folder.bytes)}` : `${items.length} 张图片 · ${sizeLabel(items.reduce((sum, item) => sum + item.file.size, 0))}`}</span></div><Button variant="outline" disabled={busy || loading} onClick={() => { if (folder) void chooseFolder(); else input.current?.click() }}><Upload size={15} />{folder ? '更换' : '选择图片'}</Button>{folder && <Button variant="outline" disabled={busy || loading} onClick={() => input.current?.click()}>选择图片</Button>}{isElectron() && !folder && <Button variant="outline" disabled={busy || loading} onClick={() => void chooseFolder()}><FolderOpen size={15} />文件夹</Button>}</div>
        {folder ? <div className="image-folder-summary"><FolderOpen size={42} /><h3>文件夹批量处理</h3><p>仅统计与批量转换，不加载图片预览</p><label className="image-recursive"><Checkbox checked={folder.recursive} disabled={busy || loading} onCheckedChange={(checked) => void chooseFolder(checked === true)} />包含子文件夹</label><div className="image-folder-stats"><div><span>图片数量</span><strong>{folder.count} 张</strong></div><div><span>原始体积</span><strong>{sizeLabel(folder.bytes)}</strong></div>{Object.entries(folder.formats).map(([name, count]) => <div key={name}><span>{name}</span><strong>{count} 张</strong></div>)}</div>{!folder.count && <p>文件夹中没有支持的图片，请尝试包含子文件夹或更换文件夹。</p>}</div> : active && <>
          <div className="image-source-list" aria-label="待处理图片">{items.map((item) => <div key={item.id} className={`image-source-item ${item.id === active?.id ? 'active' : ''}`}>
            <button disabled={busy} onClick={() => { setActiveId(item.id); setCropping(false); setRatio('free') }}><img src={item.url} alt="" /><span>{item.file.name}</span></button>
            <Button variant="ghost" size="icon" aria-label={`移除 ${item.file.name}`} disabled={busy} onClick={() => { release(item.url); setItems((previous) => previous.filter((value) => value.id !== item.id)); setCropping(false) }}><X size={14} /></Button>
          </div>)}</div>
          <div className="image-preview-stage">
            <div className={`image-crop-surface ${cropping ? 'cropping' : ''}`}
              onPointerDown={(event) => {
                if (!cropping || busy) return
                event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId)
                const position = point(event)
                const corner = (event.target as HTMLElement).closest<HTMLElement>('[data-crop-handle]')?.dataset.cropHandle
                const rect = active.crop
                const inside = rect && position.x >= rect.x && position.x <= rect.x + rect.width && position.y >= rect.y && position.y <= rect.y + rect.height
                drag.current = { ...position, previous: rect, mode: corner ? 'resize' : inside ? 'move' : 'draw', corner }
              }}
              onPointerMove={cropMove} onPointerUp={() => { drag.current = null }} onPointerCancel={() => { if (drag.current) patchActive({ crop: drag.current.previous }); drag.current = null }}>
              <img src={cropping ? active.url : activePreview?.url ?? active.url} alt={cropping ? '裁剪原图' : '输出预览'} draggable={false} />
              {cropping && active.crop && <div className="image-crop-selection" style={{ left: `${active.crop.x / active.width * 100}%`, top: `${active.crop.y / active.height * 100}%`, width: `${active.crop.width / active.width * 100}%`, height: `${active.crop.height / active.height * 100}%` }}><span /><span />{['nw', 'ne', 'sw', 'se'].map((corner) => <span key={corner} className={`image-crop-handle ${corner}`} data-crop-handle={corner} />)}</div>}
            </div>
          </div>
          <div className="image-preview-meta"><strong>{cropping ? '裁剪' : '输出预览'}</strong><span>{activePreview ? `${activePreview.width} × ${activePreview.height} · ${sizeLabel(activePreview.blob.size)}` : '正在生成预览…'}</span></div>
          <div className="image-edit-toolbar"><Button variant={cropping ? 'default' : 'outline'} disabled={busy} onClick={() => setCropping(!cropping)}><Crop size={16} />{cropping ? '完成裁剪' : '裁剪'}</Button><Button variant="outline" disabled={busy} onClick={() => rotate(-90)}><RotateCcw size={16} />左转 90°</Button><Button variant="outline" disabled={busy} onClick={() => rotate(90)}><RotateCw size={16} />右转 90°</Button><Button variant="ghost" disabled={busy} onClick={() => patchActive({ crop: null, rotation: 0 })}>重置</Button></div>
          {cropping && <div className="image-crop-controls"><label>裁剪比例<Select value={ratio} onValueChange={changeRatio}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{[['free', '自由'], ['original', '原图'], ['1', '1:1'], ['1.3333333333333333', '4:3'], ['0.75', '3:4'], ['1.7777777777777777', '16:9'], ['0.5625', '9:16'], ['1.5', '3:2']].map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select></label>
            {(['x', 'y', 'width', 'height'] as const).map((field) => <CropNumberInput key={`${active.id}-${field}`} label={({ x: 'X', y: 'Y', width: '宽', height: '高' })[field]} min={field === 'x' || field === 'y' ? 0 : 1} value={(active.crop ?? { x: 0, y: 0, width: active.width, height: active.height })[field]} onCommit={(value) => {
              const rect = { ...(active.crop ?? { x: 0, y: 0, width: active.width, height: active.height }), [field]: value }
              rect.x = Math.max(0, Math.min(active.width - 1, rect.x)); rect.y = Math.max(0, Math.min(active.height - 1, rect.y))
              rect.width = Math.max(1, Math.min(active.width - rect.x, rect.width)); rect.height = Math.max(1, Math.min(active.height - rect.y, rect.height))
              if (cropRatio && (field === 'width' || field === 'height')) {
                rect.width = Math.min(field === 'height' ? rect.height * cropRatio : rect.width, active.width - rect.x, (active.height - rect.y) * cropRatio)
                rect.height = rect.width / cropRatio
              }
              patchActive({ crop: rect })
            }} />)}<Button variant="ghost" onClick={() => patchActive({ crop: null })}>取消裁剪</Button></div>}
        </>}
      </div>
      <aside className="audio-editor-options image-options">
        <div className="audio-editor-option-heading"><span><FileImage size={17} /></span><div><strong>图片调整</strong><p>{folder ? '应用于文件夹内的全部图片' : '调整预览后生成输出结果'}</p></div></div>
        <label>输出格式<Select value={level === 'original' ? 'original' : format} onValueChange={(value) => { setFormat(value); setFolderOutput(null) }} disabled={busy || loading || level === 'original'}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{level === 'original' && <SelectItem value="original">保持原始图片</SelectItem>}<SelectItem value="image/webp">WebP</SelectItem><SelectItem value="image/jpeg">JPG · 白色背景</SelectItem><SelectItem value="image/png">PNG</SelectItem></SelectContent></Select></label>
        <label>编码等级<Select value={level} disabled={busy || loading} onValueChange={(value) => { setLevel(value as EncodingLevel); setFolderOutput(null) }}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="strong">强压缩</SelectItem><SelectItem value="standard">标准压缩</SelectItem><SelectItem value="original">原图</SelectItem></SelectContent></Select><span className="image-level-help">{level === 'strong' ? '优先减小体积，细节可能有所损失。PNG 保持无损，可选择 WebP 进一步减小体积。' : level === 'standard' ? '在不明显影响观感的前提下压缩体积。' : `保留原始文件；若裁剪或旋转，则按 ${format === 'image/jpeg' ? 'JPG' : format === 'image/png' ? 'PNG' : 'WebP'} 以最高质量重新编码。`}</span></label>
        {!folder && items.length > 1 && <div className="image-batch-actions"><strong>批量旋转</strong><div><Button variant="outline" disabled={busy} onClick={() => rotate(-90, true)}>全部左转 90°</Button><Button variant="outline" disabled={busy} onClick={() => rotate(90, true)}>全部右转 90°</Button></div></div>}
        <div className="image-output-summary" aria-live="polite"><span>{folder?.count ?? items.length} 张图片</span><strong>{folder ? folderOutput ? `输出 ${sizeLabel(folderOutput.bytes)}` : '准备批量处理' : (currentPreview ? `预计输出 ${sizeLabel(currentPreview.images.reduce((sum, item) => sum + item.blob.size, 0))}` : items.length ? '正在计算大小…' : '尚未选择图片')}</strong>{!folder && currentPreview && <span>原图 {sizeLabel(items.reduce((sum, item) => sum + item.file.size, 0))}</span>}</div>
        {!folder && currentPreview?.errors.map((message) => <p key={message} className="image-processing-error" role="alert">{message}</p>)}
        <Button disabled={busy || loading || (folder ? !folder.count : !currentPreview?.images.length)} onClick={() => {
          if (!folder) { void exportImages(); return }
          setBusy(true); setError(''); setFolderOutput(null)
          void window.sylunae!.imageProcessing.processFolder(format, level).then((output) => { if (alive.current) { setFolderOutput(output); setFolderOrder(Array.from({ length: output.files?.length ?? 0 }, (_, index) => index)) } }).catch((reason) => setError(errorLabel(reason))).finally(() => { if (alive.current) setBusy(false) })
        }}><FileImage size={16} />{busy ? `正在处理 ${progress}` : '生成输出结果'}</Button>
      </aside>
    </div>}
    {(folder ? !!folderOutput : results.length > 0) && <section ref={resultSection} className="image-results">
      <div className="panel-heading"><h3 aria-live="polite">输出结果 · {folder ? folderOutput!.count : results.length}</h3><div>
        <Button disabled={busy || !!namingError || (folder ? !folderOutput!.count : !results.length)} onClick={() => void downloadAll()}><Download size={16} />一键下载全部结果</Button>
        <Button variant="ghost" disabled={busy} onClick={() => { setViewResult(null); results.forEach((item) => release(item.url)); setResults([]); setFolderOutput(null); setFolderOrder([]) }}><Trash2 size={16} />清空结果</Button>
      </div></div>
      <div className="image-results-toolbar"><p id="image-sort-help">拖拽图片调整下载顺序，编号自动更新。</p>
        <div className="image-naming">
          <label className="image-recursive"><Checkbox checked={customNaming} disabled={busy || loading} onCheckedChange={(checked) => setCustomNaming(checked === true)} />自定义下载命名</label>
          {customNaming && <>
            <label>命名模板<Input value={template} disabled={busy || loading} onChange={(event) => setTemplate(event.target.value)} placeholder="例如 {n}-{name}" /></label>
            <p className="image-level-help">{'{n} 为编号，{name} 为原文件名（不含扩展名）。可添加任意前后缀，扩展名自动保留。'}</p>
            <div className="image-naming-numbers">{[{ label: '起始编号', value: start, setter: setStart, min: 0, max: 999999999 }, { label: '编号位数', value: digits, setter: setDigits, min: 1, max: 12 }, { label: '编号步长', value: step, setter: setStep, min: 1, max: 999999 }].map(({ label, value, setter, min, max }) => <label key={label}>{label}<Input type="number" min={min} max={max} value={value} disabled={busy || loading} onChange={(event) => setter(event.target.value)} /></label>)}</div>
            <div className="image-naming-presets">{[['从 00 开始', '{n}', '0'], ['从 01 开始', '{n}', '1'], ['01-原名', '{n}-{name}', '1']].map(([label, pattern, first]) => <Button key={label} variant="outline" disabled={busy || loading} onClick={() => { setTemplate(pattern); setStart(first); setDigits('2'); setStep('1') }}>{label}</Button>)}</div>
            {namingError ? <p className="image-processing-error" role="alert">{namingError}</p> : <p className="image-naming-preview">命名预览：{(folder ? folderNames : namedResults.map((image) => image.name)).slice(0, 3).join('、')}</p>}
          </>}
        </div>
      </div>
      {folder ? <>
        <p>共 {folderOutput!.count} 张 · {sizeLabel(folderOutput!.bytes)}</p>
        <div className="image-result-grid">{folderOrder.map((index, position) => <article key={index} {...sortFolderResults(String(index))} aria-label={folderNames[position]} aria-describedby="image-sort-help"><FileImage size={32} /><strong>{folderNames[position]}</strong></article>)}</div>
        {folderOutput!.errors.map((message) => <p className="image-processing-error" key={message}>{message}</p>)}
      </> : <div className="image-result-grid">{namedResults.map((result) => <article key={result.id} {...sortResults(result.id)} aria-label={result.name} aria-describedby="image-sort-help">
        <button onClick={() => setViewResult(result)}><img src={result.url} alt={result.name} draggable={false} /><strong>{result.name}</strong></button>
        <span>{result.width} × {result.height} · {sizeLabel(result.blob.size)}</span>
        <Button data-no-sort variant="outline" disabled={busy || !!namingError} onClick={() => void downloadAll([result])}><Download size={15} />下载</Button>
      </article>)}</div>}
    </section>}
    {notice && <p role="status">{notice}</p>}
    <div className="privacy-note"><Check size={16} />图片处理均在设备本地完成，不会上传文件。</div>
    <Dialog open={!!viewResult} onOpenChange={(open) => { if (!open) setViewResult(null) }}><DialogContent className="image-result-dialog" aria-describedby={undefined}><DialogHeader><DialogTitle>{displayedResult?.name}</DialogTitle></DialogHeader>{displayedResult && <><img src={displayedResult.url} alt={displayedResult.name} /><span>{displayedResult.width} × {displayedResult.height} · {sizeLabel(displayedResult.blob.size)}</span><Button disabled={busy || !!namingError} onClick={() => void downloadAll([displayedResult])}><Download size={16} />下载图片</Button></>}</DialogContent></Dialog>
  </div>
}
