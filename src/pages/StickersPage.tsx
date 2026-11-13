import { useEffect, useRef, useState, type FormEvent } from 'react'
import { ArrowLeft, ImageOff, Plus, Sticker as StickerIcon, Trash2 } from 'lucide-react'
import { useAppStore } from '../app/AppStore'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { EmptyState } from '../components/Icons'
import { PromptDialog } from '../components/PromptDialog'
import { Button } from '../components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../components/ui/dialog'
import { Input } from '../components/ui/input'
import { acquireNoteImageUrl, storeNoteImage } from '../data/noteAssets'
import type { Sticker } from '../shared/types'
import { newId } from '../utils'

const stickerTypes: Record<string, string> = {
  png: 'image/png', apng: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
  gif: 'image/gif', webp: 'image/webp', avif: 'image/avif', svg: 'image/svg+xml',
  bmp: 'image/bmp', ico: 'image/x-icon', jfif: 'image/jpeg', jxl: 'image/jxl',
  heic: 'image/heic', heif: 'image/heif', tif: 'image/tiff', tiff: 'image/tiff',
}
const stickerAccept = ['image/*', ...Object.keys(stickerTypes).map((extension) => '.' + extension)].join(',')

function stickerLabel(sticker: Sticker) {
  return sticker.name || sticker.fileName
}

function StickerImage({ sticker }: { sticker: Sticker }) {
  const [url, setUrl] = useState('')
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let active = true
    const asset = acquireNoteImageUrl(sticker.src)
    void asset.url.then((source) => { if (active) setUrl(source) }, () => { if (active) setFailed(true) })
    return () => { active = false; asset.release() }
  }, [sticker.src])

  if (failed) return <span className="collection-sticker-unavailable"><ImageOff size={20} />无法预览</span>
  return url ? <img className="private-media" src={url} alt={stickerLabel(sticker)} loading="lazy" onError={() => setFailed(true)} /> : null
}

export function StickersPage() {
  const { snapshotEpoch } = useAppStore()
  return <StickerLibrary key={snapshotEpoch} />
}

function StickerLibrary() {
  const { snapshot, update } = useAppStore()
  const packs = snapshot!.collectionExtras.stickerPacks
  const [packId, setPackId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [adding, setAdding] = useState(false)
  const [preview, setPreview] = useState<string | null>(null)
  const [removing, setRemoving] = useState(false)
  const pack = packs.find(({ id }) => id === packId)
  const selectedSticker = pack?.stickers.find(({ id }) => id === preview)

  const createPack = (name: string) => {
    const id = newId()
    update((current) => ({
      ...current, collectionExtras: {
        ...current.collectionExtras, stickerPacks: [...current.collectionExtras.stickerPacks, { id, name, stickers: [] }],
      },
    }))
    setPackId(id)
  }

  const addSticker = (sticker: Sticker) => {
    update((current) => ({
      ...current, collectionExtras: {
        ...current.collectionExtras,
        stickerPacks: current.collectionExtras.stickerPacks.map((item) =>
          item.id === packId ? { ...item, stickers: [...item.stickers, sticker] } : item),
      },
    }))
    setAdding(false)
  }

  const remove = () => {
    update((current) => {
      const currentPacks = current.collectionExtras.stickerPacks
      const stickerPacks = selectedSticker
        ? currentPacks.map((item) => item.id === packId
          ? { ...item, stickers: item.stickers.filter(({ id }) => id !== selectedSticker.id) }
          : item)
        : currentPacks.filter(({ id }) => id !== packId)
      return { ...current, collectionExtras: { ...current.collectionExtras, stickerPacks } }
    })
    if (!selectedSticker) setPackId(null)
    setPreview(null)
  }

  return <section className="collection-extras">
    {pack && <Button variant="ghost" className="collection-pack-back" onClick={() => setPackId(null)}><ArrowLeft size={16} />全部贴图包</Button>}
    <div className="collection-extras-heading">
      <h2 className={pack ? 'user-content' : undefined}>{pack?.name ?? '表情包'}</h2>
      <div className="collection-extras-actions">
        {pack ? <>
          <Button variant="ghost" size="icon" aria-label="删除贴图包" onClick={() => setRemoving(true)}><Trash2 size={17} /></Button>
          <Button onClick={() => setAdding(true)}><Plus size={16} />添加表情包</Button>
        </> : <Button onClick={() => setCreating(true)}><Plus size={16} />新建贴图包</Button>}
      </div>
    </div>
    {pack ? pack.stickers.length === 0
      ? <EmptyState icon={<StickerIcon size={26} />} title="这个贴图包还是空的" description="添加图片或动图，把喜欢的表情收进来。" />
      : <ul className="collection-sticker-grid">
        {pack.stickers.map((sticker) => <li key={sticker.id}>
          <button type="button" className="collection-sticker-card" onClick={() => setPreview(sticker.id)}>
            <span className="collection-sticker-thumb"><StickerImage sticker={sticker} /></span>
            <span className="user-content">{stickerLabel(sticker)}</span>
          </button>
        </li>)}
      </ul>
      : packs.length === 0
        ? <EmptyState icon={<StickerIcon size={26} />} title="还没有贴图包" description="先创建一个贴图包，再添加表情。" />
        : <ul className="collection-pack-grid">
          {packs.map((item) => <li key={item.id}>
            <button type="button" className="collection-pack-card" onClick={() => setPackId(item.id)}>
              <span className="collection-pack-cover">
                {item.stickers[0] ? <StickerImage key={item.stickers[0].id} sticker={item.stickers[0]} /> : <StickerIcon size={24} />}
              </span>
              <span><strong className="user-content">{item.name}</strong><small>{item.stickers.length} 个表情</small></span>
            </button>
          </li>)}
        </ul>}
    <PromptDialog open={creating} onOpenChange={setCreating} title="新建贴图包" placeholder="贴图包名称（必填）" confirmLabel="创建" onSubmit={createPack} />
    {pack && adding && <AddStickerDialog onClose={() => setAdding(false)} onAdd={addSticker} />}
    <Dialog open={Boolean(selectedSticker) && !removing} onOpenChange={(open) => { if (!open && !removing) setPreview(null) }}>
      {selectedSticker && <DialogContent size="md">
        <DialogHeader><DialogTitle className="user-content">{stickerLabel(selectedSticker)}</DialogTitle><DialogDescription className="sr-only">表情预览</DialogDescription></DialogHeader>
        <div className="collection-sticker-preview"><StickerImage key={selectedSticker.id} sticker={selectedSticker} /></div>
        <DialogFooter><Button variant="outline" onClick={() => setRemoving(true)}><Trash2 size={16} />删除表情</Button></DialogFooter>
      </DialogContent>}
    </Dialog>
    <ConfirmDialog open={removing} onOpenChange={setRemoving} destructive confirmLabel="删除"
      title={selectedSticker ? '删除这个表情？' : '删除这个贴图包？'}
      description={selectedSticker ? '这个表情会从贴图包中移除。' : '贴图包和里面的全部表情都会从收藏中移除。'}
      onConfirm={remove} />
  </section>
}

function AddStickerDialog({ onClose, onAdd }: { onClose: () => void; onAdd: (sticker: Sticker) => void }) {
  const [file, setFile] = useState<File | null>(null)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const active = useRef(false)
  const saving = useRef(false)
  useEffect(() => {
    active.current = true
    return () => { active.current = false }
  }, [])

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!file || saving.current) return
    const mime = stickerTypes[file.name.split('.').at(-1)?.toLowerCase() ?? ''] ?? file.type.toLowerCase()
    if (!/^image\/[a-z0-9.+-]+$/.test(mime)) {
      setError('请选择图片或动图文件。')
      return
    }
    saving.current = true
    setBusy(true)
    setError('')
    try {
      const bytes = new Uint8Array(await file.arrayBuffer())
      if (!bytes.length) throw new Error('所选文件是空的。')
      const src = await storeNoteImage(bytes, mime)
      if (active.current) onAdd({ id: newId(), name: name.trim(), fileName: file.name, src })
    } catch (cause) {
      if (active.current) setError(cause instanceof Error ? cause.message : '表情保存失败，请重试。')
    } finally {
      saving.current = false
      if (active.current) setBusy(false)
    }
  }

  return <Dialog open onOpenChange={(open) => { if (!open && !saving.current) onClose() }}>
    <DialogContent showCloseButton={!busy}>
      <DialogHeader><DialogTitle>添加表情包</DialogTitle><DialogDescription>选择一张图片或动图添加到当前贴图包。</DialogDescription></DialogHeader>
      <form className="collection-sticker-form" onSubmit={(event) => void submit(event)}>
        <label>表情文件<Input type="file" accept={stickerAccept} disabled={busy} onChange={(event) => { setFile(event.target.files?.[0] ?? null); setError('') }} /></label>
        <label>表情名称（选填）<Input value={name} disabled={busy} onChange={(event) => setName(event.target.value)} /></label>
        {error && <p className="notice error" role="alert">{error}</p>}
        <DialogFooter>
          <Button variant="outline" type="button" disabled={busy} onClick={onClose}>取消</Button>
          <Button type="submit" disabled={!file || busy}>{busy ? '正在保存…' : '添加'}</Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
}
