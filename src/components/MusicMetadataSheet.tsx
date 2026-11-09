import { isAndroid } from '../platform/environment'
import { useEffect, useRef, useState } from 'react'
import { Disc3, ImagePlus, Trash2 } from 'lucide-react'
import type { MusicAlbum, MusicCoverUpdate, MusicEditableMetadata, MusicMetadataUpdate, MusicTrack } from '../shared/types'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Combobox } from './ui/combobox'
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from './ui/sheet'
import { Textarea } from './ui/textarea'
import { Spinner } from './Icons'

export function MusicMetadataSheet({ track, albums, onClose, onSave }: {
  track: MusicTrack
  albums: MusicAlbum[]
  onClose: () => void
  onSave: (update: MusicMetadataUpdate) => Promise<void>
}) {
  const coverInput = useRef<HTMLInputElement>(null)
  const [metadata, setMetadata] = useState<MusicEditableMetadata>(() => ({
    title: track.title,
    artist: track.artist === '未知艺术家' ? '' : track.artist,
    album: track.album === '未知专辑' ? '' : track.album,
    genre: '',
    year: null,
    track: null,
    comment: '',
    cover: track.cover,
  }))
  const [coverUpdate, setCoverUpdate] = useState<MusicCoverUpdate>({ mode: 'keep' })
  const [coverPreview, setCoverPreview] = useState(track.cover)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    window.sylunae?.music.readMetadata(track.path)
      .then((value) => {
        if (!active) return
        setMetadata((current) => ({
          ...value,
          title: value.title.trim() || current.title || track.title,
          artist: value.artist.trim() || current.artist,
          album: value.album.trim() || current.album,
          cover: value.cover || current.cover,
        }))
        setCoverPreview(value.cover || track.cover)
      })
      .catch(() => { if (active) setError('无法读取这个文件的元信息。') })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [track.path])

  const updateField = <K extends keyof MusicEditableMetadata>(key: K, value: MusicEditableMetadata[K]) => {
    setMetadata((current) => ({ ...current, [key]: value }))
  }

  const selectCover = async (file: File) => {
    setError('')
    if (file.size > 12 * 1024 * 1024) { setError('封面文件需小于 12 MB。'); return }
    if (file.type !== 'image/jpeg' && file.type !== 'image/png') { setError('封面仅支持 JPEG 或 PNG。'); return }
    const reader = new FileReader()
    const preview = await new Promise<string>((resolve, reject) => {
      reader.onload = () => resolve(String(reader.result))
      reader.onerror = () => reject(reader.error)
      reader.readAsDataURL(file)
    })
    setCoverPreview(preview)
    setCoverUpdate({ mode: 'replace', data: new Uint8Array(await file.arrayBuffer()), mimeType: file.type })
  }

  const submit = async () => {
    const title = metadata.title.trim() || track.title.trim()
    if (!title) { setError('无法确定歌曲标题。'); return }
    setSaving(true)
    setError('')
    try {
      const { cover: _cover, ...editable } = metadata
      await onSave({ id: track.id, path: track.path, metadata: { ...editable, title }, cover: coverUpdate })
      onClose()
    } catch {
      setError('保存失败。请确认文件可写且格式支持标签修改。')
    } finally {
      setSaving(false)
    }
  }

  return <Sheet open onOpenChange={(open) => { if (!open && !saving) onClose() }}>
    <SheetContent className="detail-drawer metadata-drawer" showCloseButton={!saving}>
      <SheetHeader className="metadata-sheet-header">
        <SheetTitle>编辑音乐信息</SheetTitle>
        <SheetDescription>{isAndroid ? '修改保存在此设备的音乐资料库中，不会改写原音频标签。' : '修改会直接写入原音频文件。'}</SheetDescription>
      </SheetHeader>
      {loading ? <div className="metadata-loading"><Spinner /><span>正在读取文件元信息…</span></div> : <div className="metadata-sheet-body">
        <div className="metadata-cover-editor">
          <div className="metadata-cover-preview">{coverPreview ? <img src={coverPreview} alt="当前专辑封面" /> : <Disc3 size={42} strokeWidth={1.2} />}</div>
          <div className="metadata-cover-actions">
            <strong>专辑封面</strong><small>支持 JPEG、PNG，最大 12 MB</small>
            <div><Button variant="outline" className="button secondary" onClick={() => coverInput.current?.click()}><ImagePlus size={16} />选择图片</Button><Button variant="ghost" className="button metadata-remove-cover" disabled={!coverPreview} onClick={() => { setCoverPreview(''); setCoverUpdate({ mode: 'remove' }) }}><Trash2 size={16} />移除</Button></div>
            <input ref={coverInput} hidden type="file" accept="image/jpeg,image/png" onChange={(event) => { const file = event.target.files?.[0]; if (file) void selectCover(file); event.currentTarget.value = '' }} />
          </div>
        </div>
        <div className="metadata-form">
          <label>标题<Input autoFocus value={metadata.title} onChange={(event) => updateField('title', event.target.value)} /></label>
          <label>艺术家<Input value={metadata.artist} onChange={(event) => updateField('artist', event.target.value)} /></label>
          <label>专辑<Combobox value={metadata.album} onValueChange={(value) => updateField('album', value)} options={albums.map((album) => album.title)} placeholder="输入或选择已有专辑" emptyMessage="没有匹配的已有专辑，可直接新建" /></label>
          <label>流派<Input value={metadata.genre} onChange={(event) => updateField('genre', event.target.value)} /></label>
          <div className="form-row">
            <label>年份<Input type="number" min={0} max={9999} value={metadata.year ?? ''} onChange={(event) => updateField('year', event.target.value ? Number(event.target.value) : null)} /></label>
            <label>音轨号<Input type="number" min={0} max={9999} value={metadata.track ?? ''} onChange={(event) => updateField('track', event.target.value ? Number(event.target.value) : null)} /></label>
          </div>
          <label>备注<Textarea rows={4} value={metadata.comment} onChange={(event) => updateField('comment', event.target.value)} /></label>
        </div>
      </div>}
      {error && <div className="notice error metadata-error">{error}</div>}
      <SheetFooter className="metadata-sheet-footer">
        <Button variant="outline" className="button secondary" disabled={saving} onClick={onClose}>取消</Button>
        <Button className="button primary" disabled={loading || saving} onClick={() => void submit()}>{saving ? '正在写入…' : '保存到文件'}</Button>
      </SheetFooter>
    </SheetContent>
  </Sheet>
}
