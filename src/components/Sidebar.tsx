import { useEffect, useRef, useState, type CSSProperties, type PointerEvent } from 'react'
import { Album, BookHeart, BookOpen, Boxes, CalendarClock, ChevronDown, ChevronRight, CloudRain, Download, Images, Library, ListChecks, ListTodo, Menu, MoreHorizontal, Music2, NotebookPen, Settings, Smile, Sparkles, Sticker, Target } from 'lucide-react'
import { useMediaQuery } from '../lib/useMediaQuery'
import { workspaceHref, type WorkspaceView } from '../app/workspaceRoutes'
import { WorkspaceLink } from './WorkspaceLink'
import type { MusicTrack, ResourceItem, ToolId } from '../shared/types'
import { BrandMark } from './Icons'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from './ui/dropdown-menu'

const tools: Array<{ id: ToolId; label: string; icon: typeof Library }> = [
  { id: 'tasks', label: '任务箱', icon: ListChecks },
  { id: 'notes', label: '笔记本', icon: NotebookPen },
  { id: 'music', label: '音乐库', icon: Music2 },
  { id: 'collection', label: '收藏馆', icon: BookHeart },
  { id: 'tools', label: '工具箱', icon: Boxes },
]

const releasesApi = 'https://api.github.com/repos/sylunae/sylunae-workshop/releases'
const releasesPage = 'https://github.com/sylunae/sylunae-workshop/releases'

type GitHubRelease = {
  prerelease: boolean
  assets: Array<{ name: string; browser_download_url: string }>
}

function openExternal(url: string, target = '_blank') {
  if (window.sylunae) {
    void window.sylunae.system.openExternal(url)
    return
  }
  window.open(url, target, 'noopener,noreferrer')
}

function downloadDesktopApp() {
  void fetch(`${releasesApi}/latest`, { headers: { Accept: 'application/vnd.github+json' } })
    .then(async (response) => {
      if (!response.ok) throw new Error('未找到已发布的安装包')
      const release = await response.json() as GitHubRelease
      const installer = release.assets?.find((asset) => /-Setup\.exe$/i.test(asset.name))
      if (!installer) throw new Error('未找到 Windows 安装包')
      return installer.browser_download_url
    })
    .then((url) => openExternal(url, '_self'))
    .catch(() => openExternal(`${releasesPage}/latest`))
}

async function findAndroidApk() {
  const pageSize = 30
  for (let page = 1; ; page += 1) {
    const response = await fetch(`${releasesApi}?per_page=${pageSize}&page=${page}`, {
      headers: { Accept: 'application/vnd.github+json' },
    })
    if (!response.ok) throw new Error('无法获取 GitHub 发布列表')

    const releases = await response.json() as GitHubRelease[]
    for (const release of releases) {
      if (release.prerelease) continue
      const apk = release.assets.find((asset) => /^Sylunae-Workshop-.+-Android\.apk$/i.test(asset.name))
      if (apk) return apk.browser_download_url
    }
    if (releases.length < pageSize) return releasesPage
  }
}

function downloadAndroidApp() {
  void findAndroidApk()
    .catch(() => releasesPage)
    .then((url) => openExternal(url, '_self'))
}

export function Sidebar({ active, taskView, collectionView, musicSection, musicView, collapsed, width, mobileOpen, settingsOpen, funFeaturesOpen, nowPlaying, nowPlayingAmbient, onSelect, onSelectTaskView, onSelectCollectionView, onSelectMusicSection, onSelectMusicView, onOpenSettings, onOpenFunFeatures, onResize, onOpen, onClose }: {
  active: ToolId
  taskView: 'goals' | 'todos' | 'pomodoro' | 'countdown'
  collectionView: WorkspaceView<'collection'>
  musicSection: 'library' | 'white-noise'
  musicView: 'tracks' | 'albums'
  collapsed: boolean
  width: number
  mobileOpen: boolean
  settingsOpen: boolean
  funFeaturesOpen: boolean
  nowPlaying: MusicTrack | null
  nowPlayingAmbient: ResourceItem | null
  onSelect: (tool: ToolId) => void
  onSelectTaskView: (view: 'goals' | 'todos' | 'pomodoro' | 'countdown') => void
  onSelectCollectionView: (view: WorkspaceView<'collection'>) => void
  onSelectMusicSection: (section: 'library' | 'white-noise') => void
  onSelectMusicView: (view: 'tracks' | 'albums') => void
  onOpenSettings: () => void
  onOpenFunFeatures: () => void
  onResize: (width: number) => void
  onOpen: () => void
  onClose: () => void
}) {
  const isMobile = useMediaQuery('(max-width: 760px)')
  const [mobileExpandedGroup, setMobileExpandedGroup] = useState<ToolId | null>(active)
  const showSubmenus = isMobile || !collapsed
  const expandedGroup = isMobile ? mobileExpandedGroup : active
  const resizeStart = useRef<{ x: number; width: number } | null>(null)
  const primaryNowPlaying = nowPlaying ?? nowPlayingAmbient
  const playingMusic = Boolean(nowPlaying)
  const privateAmbient = nowPlayingAmbient?.origin === 'custom'
  const ambientCover = nowPlayingAmbient?.coverPath ?? ''

  const select = (tool: ToolId) => { onSelect(tool); onClose() }
  const openMobileMenu = () => {
    setMobileExpandedGroup(active)
    onOpen()
  }
  const selectGroup = (tool: ToolId) => {
    if (isMobile) setMobileExpandedGroup((group) => group === tool ? null : tool)
    else select(tool)
  }
  const openSettings = () => { onOpenSettings(); onClose() }
  const openFunFeatures = () => { onOpenFunFeatures(); onClose() }
  const startResize = (event: PointerEvent<HTMLDivElement>) => {
    if (isMobile) return
    resizeStart.current = { x: event.clientX, width }
    event.currentTarget.setPointerCapture(event.pointerId)
    document.body.classList.add('sidebar-resizing')
  }
  const resize = (event: PointerEvent<HTMLDivElement>) => {
    if (!resizeStart.current) return
    onResize(resizeStart.current.width + event.clientX - resizeStart.current.x)
  }
  const stopResize = () => {
    resizeStart.current = null
    document.body.classList.remove('sidebar-resizing')
  }

  useEffect(() => () => document.body.classList.remove('sidebar-resizing'), [])
  return <>
    <button className="mobile-menu" onClick={openMobileMenu} aria-label="打开导航" aria-expanded={mobileOpen} aria-controls="app-sidebar"><Menu size={20} /></button>
    <button className={`sidebar-backdrop${mobileOpen ? ' mobile-open' : ''}`} onClick={onClose} aria-label="关闭导航" inert={!mobileOpen} />
    <aside id="app-sidebar" className={`sidebar ${collapsed ? 'collapsed' : ''} ${mobileOpen ? 'mobile-open' : ''}`}>
      <button className={`brand ${active === 'home' ? 'active' : ''}`} onClick={() => select('home')} title="返回主页" aria-label="返回主页">
        <BrandMark />
        {!collapsed && <div className="brand-copy"><strong>丝月工坊</strong><span>MY QUIET SPACE</span></div>}
      </button>
      <div className={`now-playing-slot ${primaryNowPlaying ? 'visible' : ''}`} aria-hidden={!primaryNowPlaying}>
        <button
          className={`sidebar-now-playing ${playingMusic || privateAmbient ? 'private-media-background' : ''}`}
          onClick={() => {
            if (playingMusic) select('music')
            else { onSelectMusicSection('white-noise'); onClose() }
          }}
          tabIndex={primaryNowPlaying ? 0 : -1}
          title={primaryNowPlaying ? `正在播放：${primaryNowPlaying.title}` : undefined}
          style={{ '--now-playing-cover': nowPlaying?.cover ? `url(${JSON.stringify(nowPlaying.cover)})` : ambientCover ? `url(${JSON.stringify(ambientCover)})` : 'none' } as CSSProperties}
        >
          {playingMusic ? <span className="music-wave" aria-hidden><i /><i /><i /><i /></span> : <CloudRain className="ambient-now-playing-icon" size={22} strokeWidth={1.65} aria-hidden />}
          <span className="now-playing-copy"><strong className={playingMusic ? 'private-music-title' : privateAmbient ? 'user-content' : undefined}>{primaryNowPlaying?.title || '正在播放'}</strong><small className={playingMusic && nowPlaying?.artist ? 'private-music-artist' : undefined}>{playingMusic ? nowPlaying?.artist || '未知艺术家' : '环境白噪音'}</small></span>
          {playingMusic && nowPlayingAmbient && <span className="ambient-now-playing-cover" title={`同时播放：${nowPlayingAmbient.title}`} aria-label={`同时播放：${nowPlayingAmbient.title}`}>{ambientCover ? <img className={privateAmbient ? 'private-media' : undefined} src={ambientCover} alt="" /> : <CloudRain size={16} strokeWidth={1.65} />}</span>}
        </button>
      </div>
      <nav>
        {!collapsed && <div className="nav-caption">工具</div>}
        {tools.map(({ id, label, icon: Icon }) => {
          const current = active === id
          if (id !== 'tasks' && id !== 'collection' && id !== 'music') {
            return <button key={id} className={current ? 'active' : ''} onClick={() => select(id)} title={label}>
              <Icon size={19} strokeWidth={1.7} /><span>{label}</span>
            </button>
          }

          const expanded = showSubmenus && expandedGroup === id
          const submenuId = `sidebar-submenu-${id}`
          return <div className={`nav-group${expanded ? ' expanded' : ''}`} key={id}>
            <button className={current && (id !== 'music' || musicSection === 'library') ? 'active' : ''} onClick={() => selectGroup(id)} title={label} aria-expanded={expanded} aria-controls={submenuId}>
              <Icon size={19} strokeWidth={1.7} /><span>{label}</span>{showSubmenus && <ChevronDown className="nav-group-chevron" size={15} strokeWidth={1.8} />}
            </button>
            <div id={submenuId} className="nav-children" aria-hidden={!expanded} inert={!expanded}>
              {id === 'tasks' ? <>
                <WorkspaceLink className={current && taskView === 'goals' ? 'active' : ''} aria-current={current && taskView === 'goals' ? 'page' : undefined} href={workspaceHref('tasks', 'goals')} onNavigate={() => { onSelectTaskView('goals'); onClose() }} title="目标追踪"><Target size={17} strokeWidth={1.7} /><span>目标追踪</span></WorkspaceLink>
                <WorkspaceLink className={current && taskView === 'todos' ? 'active' : ''} aria-current={current && taskView === 'todos' ? 'page' : undefined} href={workspaceHref('tasks', 'todos')} onNavigate={() => { onSelectTaskView('todos'); onClose() }} title="快速待办"><ListTodo size={17} strokeWidth={1.7} /><span>快速待办</span></WorkspaceLink>
                <WorkspaceLink className={current && taskView === 'pomodoro' ? 'active' : ''} aria-current={current && taskView === 'pomodoro' ? 'page' : undefined} href={workspaceHref('tasks', 'pomodoro')} onNavigate={() => { onSelectTaskView('pomodoro'); onClose() }} title="番茄钟"><CalendarClock size={17} strokeWidth={1.7} /><span>番茄钟</span></WorkspaceLink>
                <WorkspaceLink className={current && taskView === 'countdown' ? 'active' : ''} aria-current={current && taskView === 'countdown' ? 'page' : undefined} href={workspaceHref('tasks', 'countdown')} onNavigate={() => { onSelectTaskView('countdown'); onClose() }} title="倒数日"><CalendarClock size={17} strokeWidth={1.7} /><span>倒数日</span></WorkspaceLink>
              </> : id === 'collection' ? <>
                <WorkspaceLink className={current && collectionView === 'bangumi' ? 'active' : ''} aria-current={current && collectionView === 'bangumi' ? 'page' : undefined} href={workspaceHref('collection', 'bangumi')} onNavigate={() => { onSelectCollectionView('bangumi'); onClose() }} title="Bangumi"><BookOpen size={17} strokeWidth={1.7} /><span>Bangumi</span></WorkspaceLink>
                <WorkspaceLink className={current && collectionView === 'images' ? 'active' : ''} aria-current={current && collectionView === 'images' ? 'page' : undefined} href={workspaceHref('collection', 'images')} onNavigate={() => { onSelectCollectionView('images'); onClose() }} title="精选图片"><Images size={17} strokeWidth={1.7} /><span>精选图片</span></WorkspaceLink>
                <WorkspaceLink className={current && collectionView === 'memes' ? 'active' : ''} aria-current={current && collectionView === 'memes' ? 'page' : undefined} href={workspaceHref('collection', 'memes')} onNavigate={() => { onSelectCollectionView('memes'); onClose() }} title="梗收集"><Smile size={17} strokeWidth={1.7} /><span>梗收集</span></WorkspaceLink>
                <WorkspaceLink className={current && collectionView === 'stickers' ? 'active' : ''} aria-current={current && collectionView === 'stickers' ? 'page' : undefined} href={workspaceHref('collection', 'stickers')} onNavigate={() => { onSelectCollectionView('stickers'); onClose() }} title="表情包"><Sticker size={17} strokeWidth={1.7} /><span>表情包</span></WorkspaceLink>
              </> : <>
                <WorkspaceLink className={current && musicSection === 'library' && musicView === 'tracks' ? 'active' : ''} aria-current={current && musicSection === 'library' && musicView === 'tracks' ? 'page' : undefined} href={workspaceHref('music', 'tracks')} onNavigate={() => { onSelectMusicView('tracks'); onClose() }} title="歌曲"><Music2 size={17} strokeWidth={1.7} /><span>歌曲</span></WorkspaceLink>
                <WorkspaceLink className={current && musicSection === 'library' && musicView === 'albums' ? 'active' : ''} aria-current={current && musicSection === 'library' && musicView === 'albums' ? 'page' : undefined} href={workspaceHref('music', 'albums')} onNavigate={() => { onSelectMusicView('albums'); onClose() }} title="专辑"><Album size={17} strokeWidth={1.7} /><span>专辑</span></WorkspaceLink>
                <WorkspaceLink className={current && musicSection === 'white-noise' ? 'active' : ''} aria-current={current && musicSection === 'white-noise' ? 'page' : undefined} href={workspaceHref('music', 'white-noise')} onNavigate={() => { onSelectMusicSection('white-noise'); onClose() }} title="白噪音"><CloudRain size={17} strokeWidth={1.7} /><span>白噪音</span></WorkspaceLink>
              </>}
            </div>
          </div>
        })}
        {!window.sylunae && (isMobile ? <button className="download-card mobile-download-card" onClick={downloadAndroidApp} aria-label="下载 Android APK">
          <span className="download-card-icon"><Download size={18} strokeWidth={1.8} /></span>
          <span className="download-card-copy"><strong>下载 Android APK</strong></span>
          <ChevronRight className="download-card-arrow" size={16} strokeWidth={1.8} />
        </button> : <button className="download-card desktop-download-card" onClick={downloadDesktopApp} title="下载桌面端安装包">
          <span className="download-card-icon"><Download size={18} strokeWidth={1.8} /></span>
          <span className="download-card-copy"><strong>桌面端安装包</strong><small>下载最新 Windows 版本</small></span>
          <ChevronRight className="download-card-arrow" size={16} strokeWidth={1.8} />
        </button>)}
      </nav>
      <div className="sidebar-footer">
        {collapsed ? <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className={funFeaturesOpen || settingsOpen ? 'active' : ''} title="更多操作" aria-label="更多操作">
              <MoreHorizontal size={20} strokeWidth={1.7} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="right" align="end" className="sidebar-footer-menu">
            <DropdownMenuItem onSelect={openFunFeatures}><Sparkles />趣味功能</DropdownMenuItem>
            <DropdownMenuItem onSelect={openSettings}><Settings />设置</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu> : <>
          <button className={funFeaturesOpen ? 'active' : ''} onClick={openFunFeatures} title="趣味功能" aria-label="趣味功能" aria-haspopup="dialog" aria-expanded={funFeaturesOpen}>
            <Sparkles size={19} strokeWidth={1.7} />
          </button>
          <button className={settingsOpen ? 'active' : ''} onClick={openSettings} title="设置" aria-label="设置" aria-haspopup="dialog" aria-expanded={settingsOpen}>
            <Settings size={19} strokeWidth={1.7} />
          </button>
        </>}
      </div>
      <div
        className="sidebar-resize-handle"
        role="separator"
        aria-orientation="vertical"
        aria-label="调整导航栏宽度"
        aria-valuemin={70}
        aria-valuenow={width}
        onPointerDown={startResize}
        onPointerMove={resize}
        onPointerUp={stopResize}
        onPointerCancel={stopResize}
      />
    </aside>
  </>
}
