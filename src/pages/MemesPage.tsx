import { useState, type FormEvent } from 'react'
import { Plus, Smile, Trash2 } from 'lucide-react'
import { useAppStore } from '../app/AppStore'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { EmptyState } from '../components/Icons'
import { Button } from '../components/ui/button'
import { Card, CardContent } from '../components/ui/card'
import { Textarea } from '../components/ui/textarea'
import { formatDate, newId, nowIso } from '../utils'

export function MemesPage() {
  const { snapshot, update } = useAppStore()
  const [text, setText] = useState('')
  const [removeId, setRemoveId] = useState<string | null>(null)
  const memes = snapshot!.collectionExtras.memes

  const add = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!text.trim()) return
    const meme = { id: newId(), text, createdAt: nowIso() }
    update((current) => ({
      ...current, collectionExtras: { ...current.collectionExtras, memes: [meme, ...current.collectionExtras.memes] },
    }))
    setText('')
  }

  return <section className="collection-extras">
    <h2>梗收集</h2>
    <form className="collection-meme-form" onSubmit={add}>
      <Textarea aria-label="梗内容" placeholder="记下一个梗…" value={text} onChange={(event) => setText(event.target.value)} />
      <Button type="submit" disabled={!text.trim()}><Plus size={16} />添加梗</Button>
    </form>
    {memes.length === 0 ? <EmptyState icon={<Smile size={26} />} title="还没有收藏的梗" description="遇到想记下来的梗，就写在这里。" /> :
      <ul className="collection-meme-list">
        {memes.map((meme) => <li key={meme.id}><Card><CardContent className="collection-meme">
          <div><p className="user-content">{meme.text}</p><time dateTime={meme.createdAt}>{formatDate(meme.createdAt)}</time></div>
          <Button variant="ghost" size="icon" aria-label="删除这条梗" onClick={() => setRemoveId(meme.id)}><Trash2 size={16} /></Button>
        </CardContent></Card></li>)}
      </ul>}
    <ConfirmDialog open={removeId !== null} onOpenChange={(open) => { if (!open) setRemoveId(null) }}
      title="删除这条梗？" description="这条文字和它的记录日期会从收藏中移除。" confirmLabel="删除" destructive
      onConfirm={() => update((current) => ({
        ...current, collectionExtras: { ...current.collectionExtras, memes: current.collectionExtras.memes.filter(({ id }) => id !== removeId) },
      }))} />
  </section>
}
