import { useEffect, useRef, useState } from 'react'
import { FileImage, FolderOpen, ImageOff, Search, Square, Upload } from 'lucide-react'
import { Button } from './ui/button'
import { Checkbox } from './ui/checkbox'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from './ui/dialog'
import { isAndroid } from '../platform/environment'
import { browserImageFingerprint, searchBrowserImages } from '../lib/imageSearch'
import {
  imageSearchAccept, imageSearchResultLimit, isSearchableImage,
  type ImageSearchMatch, type ImageSearchOutput, type ImageSearchProgress, type ImageSearchReference,
} from '../shared/imageSearch'

const errorText = (error: unknown) => error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': Error: /, '') : '查找失败，请重试'

export function ImageSearchTool() {
  const api = window.sylunae?.platform === 'electron' ? window.sylunae.imageSearch : undefined
  const referenceInput = useRef<HTMLInputElement>(null)
  const folderInput = useRef<HTMLInputElement>(null)
  const alive = useRef(true)
  const controller = useRef<AbortController | null>(null)
  const referenceUrl = useRef('')
  const resultUrls = useRef<string[]>([])
  const [reference, setReference] = useState<ImageSearchReference | null>(null)
  const [referenceFile, setReferenceFile] = useState<File | null>(null)
  const [files, setFiles] = useState<File[]>([])
  const [folder, setFolder] = useState('')
  const [recursive, setRecursive] = useState(false)
  const [minScore, setMinScore] = useState('80')
  const [busy, setBusy] = useState<'reference' | 'folder' | 'search' | null>(null)
  const [stopping, setStopping] = useState(false)
  const [progress, setProgress] = useState<ImageSearchProgress | null>(null)
  const [output, setOutput] = useState<ImageSearchOutput | null>(null)
  const [selected, setSelected] = useState<ImageSearchMatch | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
      if (controller.current) { controller.current.abort(); void api?.cancel().catch(() => {}) }
      if (referenceUrl.current) URL.revokeObjectURL(referenceUrl.current)
      resultUrls.current.forEach((url) => URL.revokeObjectURL(url))
    }
  }, [api])

  const clearResults = () => {
    resultUrls.current.forEach((url) => URL.revokeObjectURL(url))
    resultUrls.current = []
    setOutput(null)
    setProgress(null)
    setSelected(null)
    setError('')
  }
  const pickReference = async () => {
    if (!api) { referenceInput.current?.click(); return }
    setBusy('reference'); setError('')
    try {
      const value = await api.pickReference()
      if (alive.current && value) { clearResults(); setReference(value) }
    } catch (reason) { if (alive.current) setError(errorText(reason)) }
    finally { if (alive.current) setBusy(null) }
  }
  const readReference = async (file?: File) => {
    if (!file) return
    setBusy('reference'); setError('')
    try {
      if (!isSearchableImage(file.name)) throw new Error('请选择下方支持格式中的图片')
      await browserImageFingerprint(file)
      if (!alive.current) return
      clearResults()
      if (referenceUrl.current) URL.revokeObjectURL(referenceUrl.current)
      referenceUrl.current = URL.createObjectURL(file)
      setReference({ name: file.name, preview: referenceUrl.current })
      setReferenceFile(file)
    } catch (reason) { if (alive.current) setError(`参考图片无法读取：${errorText(reason)}`) }
    finally { if (alive.current) setBusy(null) }
  }
  const pickFolder = async () => {
    if (!api) { folderInput.current?.click(); return }
    setBusy('folder'); setError('')
    try {
      const path = await api.pickFolder()
      if (alive.current && path) { clearResults(); setFolder(path) }
    } catch (reason) { if (alive.current) setError(errorText(reason)) }
    finally { if (alive.current) setBusy(null) }
  }
  const search = async () => {
    if (!reference || !folder || busy) return
    clearResults(); setBusy('search'); setStopping(false)
    const job = new AbortController()
    controller.current = job
    const report = (value: ImageSearchProgress) => { if (alive.current) setProgress(value) }
    try {
      const options = { recursive, minScore: Number(minScore) }
      const result = api ? await api.search(options, report)
        : await searchBrowserImages(referenceFile!, files, options, job.signal, report)
      if (!alive.current) return
      if (!api) {
        const byPath = new Map(files.map((file) => [file.webkitRelativePath || file.name, file]))
        result.results = result.results.map((match) => {
          const file = byPath.get(match.path)
          const preview = file ? URL.createObjectURL(file) : ''
          if (preview) resultUrls.current.push(preview)
          return { ...match, preview }
        })
      }
      setOutput(result)
    } catch (reason) { if (alive.current) setError(errorText(reason)) }
    finally {
      controller.current = null
      if (alive.current) { setBusy(null); setStopping(false) }
    }
  }
  const cancel = async () => {
    setStopping(true)
    controller.current?.abort()
    try { await api?.cancel() }
    catch (reason) { if (alive.current) { setError(errorText(reason)); setStopping(false) } }
  }
  const openResult = async (match: ImageSearchMatch, reveal: boolean) => {
    try { await api?.openResult(match.path, reveal) }
    catch (reason) { if (alive.current) setError(errorText(reason)) }
  }

  return <div className="tool-workspace image-search-tool">
    <div className="panel-heading"><h2>以图找图</h2></div>
    <p className="image-search-intro">提供一张参考图片，在指定文件夹中寻找像素与画面结构相似的图片。全部在本地处理，不上传图片。</p>
    {isAndroid ? <div className="tool-empty"><FolderOpen /><strong>文件夹查找暂不支持 Android</strong><span>请使用桌面端，或电脑浏览器中的网页版。</span></div> : <>
      <input ref={referenceInput} hidden type="file" accept={imageSearchAccept} aria-label="参考图片文件" onChange={(event) => { void readReference(event.target.files?.[0]); event.target.value = '' }} />
      <input ref={folderInput} hidden type="file" multiple {...{ webkitdirectory: '', directory: '' }} aria-label="图片查找文件夹" onChange={(event) => {
        const chosen = Array.from(event.target.files ?? [])
        if (chosen.length) {
          clearResults()
          setFiles(chosen.filter((file) => isSearchableImage(file.name)))
          setFolder(chosen[0].webkitRelativePath.split('/')[0] || '所选文件夹')
        }
        event.target.value = ''
      }} />
      <div className="image-search-setup">
        <section className="image-search-reference">
          <div className="image-search-reference-preview">{reference ? <img src={reference.preview} alt="参考图片" /> : <FileImage size={40} strokeWidth={1.4} />}</div>
          <strong className="user-content">{reference?.name || '选择一张参考图片'}</strong>
          <Button variant="outline" disabled={!!busy} onClick={() => void pickReference()}><Upload />{busy === 'reference' ? '正在读取…' : reference ? '更换图片' : '选择图片'}</Button>
        </section>
        <section className="image-search-options">
          <h3>查找范围</h3>
          <div className="image-search-folder"><span className="user-content">{folder || '尚未选择文件夹'}</span><Button variant="outline" disabled={!!busy} onClick={() => void pickFolder()}><FolderOpen />选择文件夹</Button></div>
          <label className="image-search-recursive"><Checkbox checked={recursive} disabled={!!busy} onCheckedChange={(value) => { setRecursive(value === true); clearResults() }} />遍历所有嵌套子文件夹</label>
          <label className="image-search-threshold">匹配门槛<Select value={minScore} disabled={!!busy} onValueChange={(value) => { setMinScore(value); clearResults() }}>
            <SelectTrigger aria-label="匹配门槛"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="70">宽松 · 70 分以上</SelectItem><SelectItem value="80">推荐 · 80 分以上</SelectItem><SelectItem value="90">严格 · 90 分以上</SelectItem></SelectContent>
          </Select></label>
          <p>支持 JPG、PNG、WebP、AVIF、GIF、TIFF；GIF 仅比较首帧。损坏、超大或当前环境无法解码的图片会跳过。</p>
          <p>适合查找缩放、压缩或轻微调色后的同图；大幅裁剪、旋转或仅题材相近的图片可能无法匹配。相似度分数仅供筛选参考。</p>
          {!api && <p>网页版读取所选文件夹中的文件；格式支持以浏览器解码能力为准。</p>}
          <div className="image-search-actions"><Button disabled={!reference || !folder || !!busy} onClick={() => void search()}><Search />开始查找</Button>
            {busy === 'search' && <Button variant="outline" disabled={stopping} onClick={() => void cancel()}><Square />{stopping ? '正在停止…' : '停止查找'}</Button>}
          </div>
        </section>
      </div>
      {error && <p className="image-search-error" role="alert">{error}</p>}
      {busy === 'search' && <div className="image-search-status" role="status" aria-live="polite">
        <strong>{progress?.phase === 'previews' ? '正在整理候选图片…' : '正在查找相似图片…'}</strong>
        <span>已检查 {progress?.checked ?? 0} 张 · 跳过 {progress?.failed ?? 0} 张 · 无法读取 {progress?.skippedFolders ?? 0} 个子文件夹</span>
        <span className="user-content">{progress?.current}</span>
      </div>}
      {output && <section className="image-search-results" aria-label="相似图片结果">
        <div className="panel-heading"><h3>{output.cancelled ? '已停止 · 保留已找到的结果' : '查找完成'}</h3></div>
        <p>已检查 {output.checked} 张 · 跳过 {output.failed} 张 · 无法读取 {output.skippedFolders} 个子文件夹 · 找到 {output.matches} 张候选图片</p>
        {output.matches > imageSearchResultLimit && <p>按相似度展示前 {imageSearchResultLimit} 张，可提高匹配门槛缩小范围。</p>}
        {!output.results.length ? <div className="tool-empty"><Search /><strong>{output.cancelled ? '本次尚未找到符合门槛的图片' : output.checked === 0 ? '当前范围内没有可比较的图片' : '没有找到符合门槛的图片'}</strong><span>可尝试降低匹配门槛、包含子文件夹，或更换文件夹。</span></div> : <div className="image-search-grid">
          {output.results.map((match) => <article className="image-search-card" key={match.path}>
            <button className="image-search-thumbnail" onClick={() => setSelected(match)} aria-label={`预览 ${match.name}`}>{match.preview ? <img src={match.preview} alt={match.name} loading="lazy" /> : <ImageOff />}</button>
            <div className="image-search-card-info"><strong className="user-content">{match.name}</strong><span className="image-search-score">相似度 {match.score.toFixed(1)} 分</span><p className="user-content">{match.path}</p>
              {api && <Button variant="outline" size="sm" onClick={() => void openResult(match, true)}><FolderOpen />在文件夹中显示</Button>}
            </div>
          </article>)}
        </div>}
      </section>}
      <Dialog open={!!selected} onOpenChange={(open) => { if (!open) setSelected(null) }}>
        {selected && <DialogContent size="xl" className="image-search-dialog"><DialogHeader><DialogTitle className="user-content">{selected.name}</DialogTitle><DialogDescription>相似度 {selected.score.toFixed(1)} 分{api ? ' · 缩略预览，可打开原图查看细节' : ''}</DialogDescription></DialogHeader>
          {selected.preview ? <img src={selected.preview} alt={selected.name} /> : <p>预览不可用，请打开原图查看。</p>}
          {api && <Button onClick={() => void openResult(selected, false)}>打开原图</Button>}
        </DialogContent>}
      </Dialog>
    </>}
  </div>
}
