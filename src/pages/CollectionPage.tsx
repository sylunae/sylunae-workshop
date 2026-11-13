import { useEffect, useRef } from 'react'
import { BookOpen, Images } from 'lucide-react'
import { LibraryPage } from './LibraryPage'
import { ImageGalleryPage } from './ImageGalleryPage'
import { Tabs, TabsList, TabsTrigger } from '../components/ui/tabs'
import type { WorkspaceView } from '../app/workspaceRoutes'

type CollectionView = WorkspaceView<'collection'>

export function CollectionPage({ view, onViewChange }: { view: CollectionView; onViewChange: (view: CollectionView) => void }) {
  const pageRef = useRef<HTMLElement>(null)
  useEffect(() => { pageRef.current?.scrollTo({ top: 0 }) }, [view])
  return <section ref={pageRef} className="page collection-hub-page">
    <header className="page-header"><div><span className="eyebrow">COLLECTION</span><h1>收藏馆</h1><p>收录喜欢的作品与精选图片</p></div></header>
    <Tabs value={view} onValueChange={(value) => onViewChange(value as CollectionView)} className="workspace-tabs">
      <TabsList className="workspace-tab-list"><TabsTrigger value="bangumi"><BookOpen size={16} />Bangumi</TabsTrigger><TabsTrigger value="images"><Images size={16} />精选图片</TabsTrigger></TabsList>
    </Tabs>
    {view === 'bangumi' ? <LibraryPage embedded /> : <ImageGalleryPage />}
  </section>
}
