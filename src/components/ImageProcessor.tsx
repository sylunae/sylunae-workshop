import { useEffect, useMemo, useRef, useState, type PointerEvent } from 'react'
import { Crop, Download, FileImage, FolderOpen, Check, Upload, RotateCcw, RotateCw, Trash2, X } from 'lucide-react'
import { Button } from './ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select'
import { Checkbox } from './ui/checkbox'
import { Input } from './ui/input'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog'
import type { ImageFolderSummary, ImageFolderOutput } from '../shared/types'
import { centeredCrop, encodeImage, outputName, encodingQuality, type EncodingLevel, type CropRect, type ImageEdits } from '../lib/imageProcessing'

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
  const key = useMemo(() => JSON.stringify([items.map(({ id, crop, rotation }) => [id, crop, rotation]), format, level]), [items, format, level])
  const currentPreview = preview?.key === key ? preview : null
  const activePreview = currentPreview?.images.find((item) => item.id === active?.id)
  const makeUrl = (blob: Blob) => { const url = URL.createObjectURL(blob); urls.current.add(url); return url }
  const release = (url: string) => { URL.revokeObjectURL(url); urls.current.delete(url) }

  useEffect(() => {
    alive.current = true
    return () => { alive.current = false; urls.current.forEach((url) => URL.revokeObjectURL(url)); urls.current.clear() }
  }, [])

  useEffect(() => {
    if (results.length) resultSection.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [results])

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
        setFolder(summary); setFolderOutput(null); setNotice('')
      }
    } catch (reason) { setError(errorLabel(reason)) }
    finally { setLoading(false) }
  }
  const downloadAll = async (images: EncodedImage[] = results) => {
    if (busy) return
    setBusy(true)
    setError('')
    setNotice('')
    try {
      if (window.sylunae) {
        if (!await window.sylunae.imageProcessing.pickDirectory()) return
        if (folder) {
          const saved = await window.sylunae.imageProcessing.saveFolder()
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
    const anchor = document.createElement('a')
    anchor.href = item.url
    anchor.download = item.name
    anchor.click()
  }
  const exportImages = async () => {
    if (!currentPreview?.images.length || busy) return
    setBusy(true)
    setError('')
    setNotice('')
    const exported: ResultImage[] = []
    try {
      for (const [index, image] of currentPreview.images.entries()) {
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
      {window.sylunae && <Button variant="outline" disabled={loading} onClick={() => void chooseFolder()}><FolderOpen size={16} />选择文件夹批量处理</Button>}
    </div> : <div className="audio-editor-shell" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); if (!busy && !loading) void addFiles(Array.from(event.dataTransfer.files)) }}>
      <div className="image-edit-area audio-editor-main">
        <div className="audio-editor-filebar image-filebar"><span className="audio-editor-file-icon">{folder ? <FolderOpen size={19} /> : <FileImage size={19} />}</span><div><strong>{folder ? folder.path : active?.file.name}</strong><span>{folder ? `${folder.count} 张图片 · ${sizeLabel(folder.bytes)}` : `${items.length} 张图片 · ${sizeLabel(items.reduce((sum, item) => sum + item.file.size, 0))}`}</span></div><Button variant="outline" disabled={busy || loading} onClick={() => { if (folder) void chooseFolder(); else input.current?.click() }}><Upload size={15} />{folder ? '更换' : '选择图片'}</Button>{folder && <Button variant="outline" disabled={busy || loading} onClick={() => input.current?.click()}>选择图片</Button>}{window.sylunae && !folder && <Button variant="outline" disabled={busy || loading} onClick={() => void chooseFolder()}><FolderOpen size={15} />文件夹</Button>}</div>
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
          void window.sylunae!.imageProcessing.processFolder(format, level).then((output) => { if (alive.current) setFolderOutput(output) }).catch((reason) => setError(errorLabel(reason))).finally(() => { if (alive.current) setBusy(false) })
        }}><FileImage size={16} />{busy ? `正在处理 ${progress}` : '生成输出结果'}</Button>
      </aside>
    </div>}
    {folder && folderOutput && <section className="image-results"><div className="panel-heading"><h3>输出结果 · {folderOutput.count}</h3><Button disabled={busy || !folderOutput.count} onClick={() => void downloadAll()}><Download size={16} />一键下载全部结果</Button></div><p>共 {folderOutput.count} 张 · {sizeLabel(folderOutput.bytes)}</p>{folderOutput.errors.map((message) => <p className="image-processing-error" key={message}>{message}</p>)}</section>}
    {!folder && results.length > 0 && <section ref={resultSection} className="image-results"><div className="panel-heading"><h3 aria-live="polite">输出结果 · {results.length}</h3><div><Button disabled={busy} onClick={() => void downloadAll()}><Download size={16} />一键下载全部结果</Button><Button variant="ghost" disabled={busy} onClick={() => { setViewResult(null); results.forEach((item) => release(item.url)); setResults([]) }}><Trash2 size={16} />清空结果</Button></div></div><div className="image-result-grid">{results.map((result) => <article className="image-result-card" key={result.id}><button onClick={() => setViewResult(result)}><img src={result.url} alt={result.name} /><strong>{result.name}</strong></button><span>{result.width} × {result.height} · {sizeLabel(result.blob.size)}</span><span>已生成 · 可下载</span><Button variant="outline" disabled={busy} onClick={() => void downloadAll([result])}><Download size={15} />下载</Button></article>)}</div></section>}
    {notice && <p role="status">{notice}</p>}
    <div className="privacy-note"><Check size={16} />图片处理均在设备本地完成，不会上传文件。</div>
    <Dialog open={!!viewResult} onOpenChange={(open) => { if (!open) setViewResult(null) }}><DialogContent className="image-result-dialog" aria-describedby={undefined}><DialogHeader><DialogTitle>{viewResult?.name}</DialogTitle></DialogHeader>{viewResult && <><img src={viewResult.url} alt={viewResult.name} /><span>{viewResult.width} × {viewResult.height} · {sizeLabel(viewResult.blob.size)}</span><Button disabled={busy} onClick={() => void downloadAll([viewResult])}><Download size={16} />下载图片</Button></>}</DialogContent></Dialog>
  </div>
}
