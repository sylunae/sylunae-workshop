import { isAndroid } from '../platform/environment'
import { useEffect, useRef, useState, type DragEvent } from 'react'
import { ArrowLeftRight, AudioLines, Check, Download, FileImage, FileText, Film, Plus, RefreshCw, Trash2, Upload } from 'lucide-react'
import { Button } from './ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select'
import { Slider } from './ui/slider'
import { MediaToolsDialog } from './MediaToolsDialog'
import { categoryLabels, conversionFormats, outputFileName, type ConversionCapabilities, type ConversionCategory, type ConversionResult, type ConversionSource } from '../shared/conversion'
import { convertBrowserFile, inspectBrowserFile } from '../lib/formatConversion'

interface QueueItem { key: string; file: File; source: ConversionSource; target: string; status: 'ready' | 'converting' | 'done' | 'error'; error: string; result?: ConversionResult; resultQuality?: number; url?: string }
const icons = { image: FileImage, video: Film, audio: AudioLines, document: FileText }
const sizeLabel = (bytes: number) => bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 / 1024).toFixed(2)} MB`
const errorLabel = (error: unknown) => error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': Error: /, '').slice(0, 900) : '处理失败，请重试'

export function FormatConverter() {
  const input = useRef<HTMLInputElement>(null)
  const alive = useRef(true)
  const cancelled = useRef(false)
  const locked = useRef(false)
  const tokens = useRef(new Set<string>())
  const urls = useRef(new Set<string>())
  const [items, setItems] = useState<QueueItem[]>([])
  const [activeKey, setActiveKey] = useState('')
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [saving, setSaving] = useState(false)
  const [quality, setQuality] = useState(82)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [progress, setProgress] = useState('')
  const [capabilities, setCapabilities] = useState<ConversionCapabilities | null>(null)
  const [toolsOpen, setToolsOpen] = useState(false)
  const desktop = window.sylunae?.formatConversion
  const active = items.find((item) => item.key === activeKey) ?? items[0]
  const results = items.filter((item) => item.result)
  const actionable = items.filter((item) => item.target && (item.status !== 'done' || item.resultQuality !== quality))
  const disabled = loading || busy || saving

  const refreshCapabilities = async () => {
    if (!desktop) return
    try { const next = await desktop.capabilities(); if (alive.current) setCapabilities(next) }
    catch (reason) { if (alive.current) setError(errorLabel(reason)) }
  }
  useEffect(() => {
    alive.current = true
    void refreshCapabilities()
    return () => {
      alive.current = false; cancelled.current = true
      urls.current.forEach((url) => URL.revokeObjectURL(url)); urls.current.clear()
      if (desktop) void (async () => { await desktop.cancel(); await desktop.release([...tokens.current]) })().catch(() => {})
    }
  }, [])
  const release = async (item: QueueItem, source = false) => {
    if (item.url) { URL.revokeObjectURL(item.url); urls.current.delete(item.url) }
    const ids = [...(source ? [item.source.id] : []), ...(item.result ? [item.result.id] : [])]
    ids.forEach((id) => tokens.current.delete(id))
    await desktop?.release(ids)
  }
  const patchItem = (key: string, patch: Partial<QueueItem>) => {
    if (alive.current) setItems((previous) => previous.map((item) => item.key === key ? { ...item, ...patch } : item))
  }
  const addFiles = async (files: File[]) => {
    if (locked.current || saving || !files.length) return
    locked.current = true; setLoading(true); setError(''); setNotice('')
    const next: QueueItem[] = []
    try {
      for (const file of files) {
        if (!alive.current) break
        try {
          const source = desktop ? await desktop.inspect(file) : await inspectBrowserFile(file)
          if (!alive.current) { await desktop?.release([source.id]); break }
          tokens.current.add(source.id)
          next.push({ key: crypto.randomUUID(), file, source, target: source.targets[0] ?? '', status: 'ready', error: '' })
        } catch (reason) {
          next.push({ key: crypto.randomUUID(), file, source: { id: '', name: file.name, size: file.size, category: null, detected: '无法识别', targets: [], note: errorLabel(reason) }, target: '', status: 'error', error: errorLabel(reason) })
        }
      }
      if (alive.current) { setItems((previous) => [...previous, ...next]); if (next[0]) setActiveKey(next[0].key) }
    } finally { locked.current = false; if (alive.current) setLoading(false) }
  }
  const reidentify = async () => {
    if (locked.current || saving) return
    locked.current = true; setLoading(true); setError('')
    try {
      await refreshCapabilities()
      for (const item of items) {
        if (!alive.current) break
        try {
          const source = desktop ? await desktop.inspect(item.file) : await inspectBrowserFile(item.file)
          if (!alive.current) { await desktop?.release([source.id]); break }
          await release(item, true); tokens.current.add(source.id)
          patchItem(item.key, { source, target: source.targets.includes(item.target) ? item.target : source.targets[0] ?? '', status: 'ready', error: '', result: undefined, url: undefined })
        } catch (reason) { patchItem(item.key, { error: errorLabel(reason), status: 'error' }) }
      }
    } finally { locked.current = false; if (alive.current) setLoading(false) }
  }
  const convert = async () => {
    if (locked.current || saving) return
    locked.current = true; cancelled.current = false; setBusy(true); setError(''); setNotice('')
    try {
      for (const [index, item] of actionable.entries()) {
        if (cancelled.current || !alive.current) break
        setProgress(`正在转换 ${index + 1} / ${actionable.length}：${item.source.name}`)
        patchItem(item.key, { status: 'converting', error: '' })
        try {
          let result: ConversionResult; let url: string | undefined
          if (desktop) { result = await desktop.convert(item.source.id, item.target, quality); tokens.current.add(result.id) }
          else {
            const blob = await convertBrowserFile(item.file, item.source, item.target, quality)
            url = URL.createObjectURL(blob); urls.current.add(url)
            result = { id: crypto.randomUUID(), name: outputFileName(item.source.name, item.target), size: blob.size }
          }
          if (!alive.current || cancelled.current) { if (url) { URL.revokeObjectURL(url); urls.current.delete(url) }; await desktop?.release([result.id]); patchItem(item.key, { status: 'ready' }); break }
          await release(item)
          patchItem(item.key, { status: 'done', result, resultQuality: quality, url })
        } catch (reason) { patchItem(item.key, { status: cancelled.current ? 'ready' : 'error', error: cancelled.current ? '' : errorLabel(reason) }) }
      }
    } finally { locked.current = false; if (alive.current) { setBusy(false); setProgress('') } }
  }
  const save = async (selected: QueueItem[]) => {
    setSaving(true); setError(''); setNotice('')
    try {
      if (desktop) {
        const count = await desktop.save(selected.map((item) => item.result!.id))
        if (count && alive.current) setNotice(`已保存 ${count} 个转换结果`)
      } else {
        for (const item of selected) {
          if (!item.url || !item.result) continue
          const link = document.createElement('a'); link.href = item.url; link.download = item.result.name; link.click()
        }
        setNotice('已请求下载；批量下载如被浏览器拦截，可逐个下载。')
      }
    } catch (reason) { if (alive.current) setError(errorLabel(reason)) }
    finally { if (alive.current) setSaving(false) }
  }
  const changeTarget = (target: string) => {
    if (!active) return
    void release(active).catch((reason) => setError(errorLabel(reason)))
    patchItem(active.key, { target, result: undefined, url: undefined, status: 'ready', error: '' })
  }
  const remove = async (item: QueueItem) => {
    await release(item, true)
    if (alive.current) setItems((previous) => previous.filter((value) => value.key !== item.key))
  }
  const drop = (event: DragEvent) => { event.preventDefault(); if (!disabled) void addFiles(Array.from(event.dataTransfer.files)) }
  const Icon = active?.source.category ? icons[active.source.category] : FileText

  return <div className="tool-workspace format-converter">
    <div className="panel-heading"><div><h2>格式转换</h2><p>拖入文件，自动识别可转换格式，所有文件只在本机处理</p></div></div>
    <input ref={input} type="file" multiple hidden aria-label="选择待转换文件" onChange={(event) => { void addFiles(Array.from(event.currentTarget.files ?? [])); event.currentTarget.value = '' }} />
    {!items.length ? <>
      <button className={`audio-editor-dropzone ${loading ? 'loading' : ''}`} disabled={disabled} onClick={() => input.current?.click()} onDragOver={(event) => event.preventDefault()} onDrop={drop}>
        <span className="audio-editor-drop-icon"><ArrowLeftRight size={30} /></span><strong>{loading ? '正在识别文件…' : '选择或拖入文件'}</strong><span>支持批量导入图片、视频、音频与文档</span><span className="audio-editor-file-action"><Upload size={14} />选择文件</span>
      </button>
      <div className="conversion-categories">{(Object.keys(categoryLabels) as ConversionCategory[]).map((category) => { const CategoryIcon = icons[category]; return <div key={category}><CategoryIcon size={19} /><strong>{categoryLabels[category]}</strong><span>{{ image: 'JPG、PNG、WebP、AVIF、GIF、TIFF…', video: 'MP4、WebM、MKV、MOV、AVI…', audio: 'MP3、WAV、FLAC、AAC、OGG…', document: '文本、表格、JSON、Office → PDF…' }[category]}</span></div> })}</div>
    </> : <div className="audio-editor-shell" onDragOver={(event) => event.preventDefault()} onDrop={drop}>
      <div className="audio-editor-main conversion-main">
        <div className="audio-editor-filebar"><span className="audio-editor-file-icon"><ArrowLeftRight size={19} /></span><div><strong>待转换文件</strong><span>{items.length} 个文件 · {sizeLabel(items.reduce((sum, item) => sum + item.file.size, 0))}</span></div><Button variant="outline" className="button secondary" disabled={disabled} onClick={() => input.current?.click()}><Plus size={15} />添加文件</Button></div>
        <div className="conversion-queue">{items.map((item) => {
          const ItemIcon = item.source.category ? icons[item.source.category] : FileText
          return <div key={item.key} className={`conversion-queue-item ${item.key === active?.key ? 'active' : ''}`}>
            <button className="conversion-queue-select" aria-pressed={item.key === active?.key} onClick={() => setActiveKey(item.key)}><ItemIcon size={22} /><span><strong className="user-content">{item.source.name}</strong><small>{item.source.detected} · {sizeLabel(item.source.size)}{item.target ? ` → ${item.target.toUpperCase()}` : ''}</small><span className={item.error ? 'conversion-item-error' : 'conversion-item-status'}>{item.status === 'converting' ? '转换中…' : item.status === 'done' ? '已完成' : item.error || (!item.source.targets.length ? item.source.note : '等待转换')}</span></span>{item.status === 'done' && <Check size={16} />}</button>
            <button className="icon-button danger" disabled={disabled} aria-label={`移除 ${item.source.name}`} onClick={() => void remove(item).catch((reason) => setError(errorLabel(reason)))}><Trash2 size={16} /></button>
          </div>
        })}</div>
      </div>
      <aside className="audio-editor-options conversion-options">
        <div className="audio-editor-option-heading"><Icon size={18} /><h3>转换设置</h3></div>
        <div className="conversion-source"><strong className="user-content">{active.source.name}</strong><span>{active.source.category ? categoryLabels[active.source.category] : '未知类型'} · {active.source.detected}</span></div>
        <label>目标格式<Select value={active.target || undefined} onValueChange={changeTarget} disabled={disabled || !active.source.targets.length}><SelectTrigger aria-label="目标格式"><SelectValue placeholder="暂无可用格式" /></SelectTrigger><SelectContent>{(Object.keys(categoryLabels) as ConversionCategory[]).map((category) => {
          const formats = conversionFormats.filter((format) => format.category === category && active.source.targets.includes(format.id))
          return formats.length ? <div key={category}><div className="conversion-select-label">{categoryLabels[category]}</div>{formats.map((format) => <SelectItem key={format.id} value={format.id}>{format.label}{active.source.category === 'video' && category === 'audio' ? ' · 提取音轨' : ''}</SelectItem>)}</div> : null
        })}</SelectContent></Select></label>
        {items.length > 1 && active.target && <Button variant="outline" className="button secondary" disabled={disabled} onClick={() => {
          for (const item of items) if (item.source.targets.includes(active.target) && item.target !== active.target) { void release(item).catch((reason) => setError(errorLabel(reason))); patchItem(item.key, { target: active.target, status: 'ready', result: undefined, url: undefined, error: '' }) }
        }}>应用到兼容文件</Button>}
        <label>输出质量 <span>{quality >= 90 ? '高质量' : quality >= 60 ? '均衡' : '较小体积'} · {quality}</span><Slider aria-label="输出质量" min={30} max={100} step={1} value={[quality]} disabled={disabled} onValueChange={([value]) => {
          setQuality(value)
          // Completed results keep their settings; changing quality applies to the next conversion.
        }} /></label>
        <p className="conversion-note">有损图片与音频使用此质量等级；视频使用质量优先编码，无损格式不受影响。修改质量后可重新生成结果。</p>
        <p className="conversion-note">{active.source.note}</p>
        <div className="audio-editor-export-summary"><span>{actionable.length} 个文件等待转换</span><strong>{results.length} 个结果已生成</strong></div>
        <Button className="button primary audio-editor-export" disabled={disabled || !actionable.length} onClick={() => void convert()}><ArrowLeftRight size={16} />{busy ? '正在转换…' : '生成转换结果'}</Button>
        {busy && <Button variant="outline" className="button secondary" onClick={() => { cancelled.current = true; void desktop?.cancel().catch((reason) => setError(errorLabel(reason))) }}>取消转换</Button>}
        <Button variant="ghost" disabled={disabled} onClick={() => void reidentify()}><RefreshCw size={15} />重新识别文件</Button>
      </aside>
    </div>}
    <div className="conversion-environment"><p>{isAndroid ? 'Android 支持可解码图片及 UTF-8 文本文档转换；依赖 FFmpeg、LibreOffice 的转换请在桌面端使用。' : desktop ? `桌面端 · 图片引擎已就绪 · 媒体工具${capabilities ? capabilities.ffmpeg ? '已就绪' : '未安装' : '检查中'} · LibreOffice${capabilities ? capabilities.office ? '已检测到' : '未检测到' : '检查中'}` : '网页端支持浏览器可解码的图片及 UTF-8 文本文档；更多图片格式、音视频和 Office 转换请使用桌面端。'}</p>{!isAndroid && desktop && capabilities && !capabilities.ffmpeg && <Button variant="outline" className="button secondary" disabled={disabled} onClick={() => setToolsOpen(true)}>下载媒体工具</Button>}</div>
    {progress && <p className="conversion-progress" role="status">{progress}</p>}
    {results.length > 0 && <section className="conversion-results"><div className="panel-heading"><div><h3>转换结果</h3><p>确认结果后下载，原始文件保持完整</p></div><Button className="button primary" disabled={disabled} onClick={() => void save(results)}><Download size={16} />下载全部结果</Button></div>{results.map((item) => <div className="conversion-result" key={item.key}><Check size={18} /><div><strong className="user-content">{item.result!.name}</strong><span>{sizeLabel(item.source.size)} → {sizeLabel(item.result!.size)}</span></div><Button variant="outline" className="button secondary" disabled={disabled} onClick={() => void save([item])}><Download size={15} />下载</Button></div>)}</section>}
    {notice && <p className="conversion-progress" role="status">{notice}</p>}
    {error && <p className="audio-editor-error" role="alert">{error}</p>}
    <MediaToolsDialog open={toolsOpen} onOpenChange={setToolsOpen} onReady={() => { void refreshCapabilities(); if (items.length) void reidentify() }} purpose="conversion" />
  </div>
}
