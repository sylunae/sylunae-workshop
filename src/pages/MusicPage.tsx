import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { Album, ArrowRight, CheckSquare2, CloudRain, Disc3, FileMusic, FolderOpen, ListMusic, LocateFixed, Music2, Pause, PencilLine, Play, Plus, Repeat, Repeat1, Search, Shuffle, SkipBack, SkipForward, Trash2, Volume1, Volume2, X } from 'lucide-react'
import { useAppStore } from '../app/AppStore'
import type { MusicAlbum, MusicMetadataUpdate, MusicTrack } from '../shared/types'
import { formatDuration } from '../utils'
import { albumCover, reconcileMusicLibrary, trackCover } from '../music/albums'
import { EmptyState } from '../components/Icons'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { Slider } from '../components/ui/slider'
import { MusicMetadataSheet } from '../components/MusicMetadataSheet'
import { MusicAlbumSheet } from '../components/MusicAlbumSheet'
import { MusicImportDialog } from '../components/MusicImportDialog'
import { Tabs, TabsList, TabsTrigger } from '../components/ui/tabs'
import { AudioWaveform } from '../components/AudioWaveform'
import { adjacentTrack, playbackQueue } from '../music/playback'
import { usePersistentState } from '../lib/usePersistentState'
import { Checkbox } from '../components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select'

type RepeatMode = 'off' | 'all' | 'one'

export function MusicPage({ view: controlledView, onViewChange, onNowPlayingChange, onOpenWhiteNoise }: { view?: 'tracks' | 'albums'; onViewChange?: (view: 'tracks' | 'albums') => void; onNowPlayingChange: (track: MusicTrack | null) => void; onOpenWhiteNoise: () => void }) {
  const { snapshot, update } = useAppStore()
  const tracks = snapshot?.tracks || []
  const albums = snapshot?.albums || []
  const [storedView, setStoredView] = usePersistentState<'tracks' | 'albums'>('navigation.musicView', 'tracks')
  const view = controlledView ?? storedView
  const setView = onViewChange ?? setStoredView
  const [query, setQuery] = useState('')
  const [currentId, setCurrentId] = useState<string | null>(null)
  const [playing, setPlaying] = useState(false)
  const [position, setPosition] = useState(0)
  const [duration, setDuration] = useState(0)
  const [volume, setVolume] = usePersistentState('music.volume', 0.8)
  const [shuffle, setShuffle] = useState(false)
  const [repeat, setRepeat] = useState<RepeatMode>('off')
  const [queueAlbumId, setQueueAlbumId] = useState<string | null>(null)
  const [playerError, setPlayerError] = useState('')
  const [audioUrl, setAudioUrl] = useState('')
  const [removeTarget, setRemoveTarget] = useState<MusicTrack | null>(null)
  const [selectedTrackIds, setSelectedTrackIds] = useState<Set<string>>(() => new Set())
  const [selectingTracks, setSelectingTracks] = useState(false)
  const [removeSelectedOpen, setRemoveSelectedOpen] = useState(false)
  const [createAlbumOpen, setCreateAlbumOpen] = useState(false)
  const [newAlbumTitle, setNewAlbumTitle] = useState('')
  const [newAlbumArtist, setNewAlbumArtist] = useState('')
  const [createAlbumError, setCreateAlbumError] = useState('')
  const [assignAlbumOpen, setAssignAlbumOpen] = useState(false)
  const [assignAlbumId, setAssignAlbumId] = useState('')
  const [editTarget, setEditTarget] = useState<MusicTrack | null>(null)
  const [albumTarget, setAlbumTarget] = useState<MusicAlbum | null>(null)
  const [importOpen, setImportOpen] = useState(false)
  const audio = useRef<HTMLAudioElement>(null)
  const releasingForEdit = useRef(false)
  const current = tracks.find((track) => track.id === currentId) || null
  const currentCover = current ? trackCover(current, albums, tracks) : ''
  const filtered = useMemo(() => tracks.filter((track) => `${track.title} ${track.artist} ${track.album}`.toLowerCase().includes(query.toLowerCase())), [tracks, query])
  const filteredAlbums = useMemo(() => albums.filter((album) => `${album.title} ${album.artist}`.toLowerCase().includes(query.toLowerCase())), [albums, query])
  const queue = useMemo(() => playbackQueue(tracks, queueAlbumId), [tracks, queueAlbumId])
  const filteredTrackIds = filtered.map((track) => track.id)
  const selectedFilteredCount = filteredTrackIds.filter((id) => selectedTrackIds.has(id)).length
  const allFilteredSelected = filteredTrackIds.length > 0 && selectedFilteredCount === filteredTrackIds.length

  useEffect(() => {
    if (!window.sylunae || tracks.length === 0) return
    void window.sylunae.music.checkPaths(tracks.map((track) => track.path)).then((result) => {
      if (tracks.some((track) => track.missing === result[track.path])) {
        update((state) => ({ ...state, tracks: state.tracks.map((track) => ({ ...track, missing: !result[track.path] })) }))
      }
    })
  }, [])

  useEffect(() => { if (audio.current) audio.current.volume = volume }, [volume])

  useEffect(() => {
    onNowPlayingChange(playing && current ? { ...current, cover: currentCover } : null)
  }, [current, currentCover, playing, onNowPlayingChange])

  const addImportedTracks = (picked: MusicTrack[]) => {
    update((state) => {
      const paths = new Set(state.tracks.map((track) => track.path))
      const additions = picked.filter((track) => {
        if (paths.has(track.path)) return false
        paths.add(track.path)
        return true
      })
      const library = reconcileMusicLibrary([...state.tracks, ...additions], state.albums)
      return { ...state, ...library }
    })
  }

  const playTrack = async (track: MusicTrack, albumId: string | null = null) => {
    if (!window.sylunae || track.missing) return
    setQueueAlbumId(albumId)
    setPlayerError('')
    try {
      const url = await window.sylunae.music.getAudioUrl(track.path)
      setAudioUrl(url)
      if (currentId !== track.id && audio.current) {
        audio.current.src = url
        setCurrentId(track.id)
      }
      await audio.current?.play()
      setPlaying(true)
    } catch { setPlayerError('无法播放这个文件，请确认文件仍然存在。') }
  }

  const adjacent = (direction: 1 | -1) => {
    const next = adjacentTrack(queue, currentId, direction, shuffle)
    if (next) void playTrack(next, queueAlbumId)
  }

  const togglePlay = () => {
    if (!current) { if (tracks[0]) void playTrack(tracks[0]); return }
    if (!audio.current) return
    if (playing) { audio.current.pause(); setPlaying(false) } else void audio.current.play().then(() => setPlaying(true))
  }

  const onEnded = () => {
    if (repeat === 'one' && audio.current) { audio.current.currentTime = 0; void audio.current.play(); return }
    if (repeat === 'off' && currentId === queue.at(-1)?.id && !shuffle) { setPlaying(false); return }
    adjacent(1)
  }

  const remove = (track: MusicTrack) => {
    if (currentId === track.id) { audio.current?.pause(); setCurrentId(null); setAudioUrl(''); setPlaying(false) }
    setSelectedTrackIds((currentSelection) => { const next = new Set(currentSelection); next.delete(track.id); return next })
    update((state) => ({ ...state, ...reconcileMusicLibrary(state.tracks.filter((item) => item.id !== track.id), state.albums) }))
  }

  const toggleTrackSelection = (trackId: string) => {
    setSelectedTrackIds((currentSelection) => {
      const next = new Set(currentSelection)
      if (next.has(trackId)) next.delete(trackId)
      else next.add(trackId)
      return next
    })
  }

  const toggleFilteredTrackSelection = () => {
    setSelectedTrackIds((currentSelection) => {
      const next = new Set(currentSelection)
      if (allFilteredSelected) filteredTrackIds.forEach((id) => next.delete(id))
      else filteredTrackIds.forEach((id) => next.add(id))
      return next
    })
  }

  const removeSelectedTracks = () => {
    if (selectedTrackIds.has(currentId || '')) {
      audio.current?.pause()
      setCurrentId(null)
      setAudioUrl('')
      setPlaying(false)
    }
    update((state) => ({ ...state, ...reconcileMusicLibrary(state.tracks.filter((track) => !selectedTrackIds.has(track.id)), state.albums) }))
    setSelectedTrackIds(new Set())
    setSelectingTracks(false)
    setRemoveSelectedOpen(false)
  }

  const createAlbum = () => {
    const title = newAlbumTitle.trim()
    if (!title) { setCreateAlbumError('请输入专辑名称'); return }
    const key = title.normalize('NFKC').toLocaleLowerCase()
    if (albums.some((album) => album.title.normalize('NFKC').trim().toLocaleLowerCase() === key)) {
      setCreateAlbumError('已存在同名专辑')
      return
    }
    const now = new Date().toISOString()
    const album: MusicAlbum = {
      id: crypto.randomUUID(), title, artist: newAlbumArtist.trim() || '未知艺术家', cover: '',
      createdAt: now, updatedAt: now, keepEmpty: true,
    }
    update((state) => ({ ...state, albums: [...state.albums, album] }))
    setNewAlbumTitle('')
    setNewAlbumArtist('')
    setCreateAlbumError('')
    setCreateAlbumOpen(false)
    setQuery('')
    setView('albums')
  }

  const addSelectedTracksToAlbum = () => {
    const selectedIds = new Set(selectedTrackIds)
    const now = new Date().toISOString()
    update((state) => {
      const album = state.albums.find((item) => item.id === assignAlbumId)
      if (!album) return state
      const nextTracks = state.tracks.map((track) => selectedIds.has(track.id)
        ? { ...track, album: album.title, albumArtist: album.artist, albumId: album.id, updatedAt: now }
        : track)
      const nextAlbums = state.albums.map((item) => item.id === album.id ? { ...item, updatedAt: now } : item)
      return { ...state, ...reconcileMusicLibrary(nextTracks, nextAlbums) }
    })
    setSelectedTrackIds(new Set())
    setSelectingTracks(false)
    setAssignAlbumOpen(false)
  }

  const relocate = async (track: MusicTrack) => {
    if (!window.sylunae) return
    const replacement = await window.sylunae.music.relocate(track.id)
    if (!replacement) return
    update((state) => ({ ...state, ...reconcileMusicLibrary(state.tracks.map((item) => item.id === track.id ? { ...replacement, createdAt: item.createdAt } : item), state.albums) }))
  }

  const saveMetadata = async (input: MusicMetadataUpdate) => {
    if (!window.sylunae) return
    const element = audio.current
    const isCurrent = currentId === input.id && Boolean(element?.src)
    const wasPlaying = isCurrent && playing
    const resumeAt = isCurrent ? element?.currentTime || 0 : 0
    if (isCurrent && element) {
      releasingForEdit.current = true
      element.pause()
      element.removeAttribute('src')
      element.load()
    }
    try {
      const replacement = await window.sylunae.music.updateMetadata(input)
      update((state) => ({ ...state, ...reconcileMusicLibrary(state.tracks.map((item) => item.id === input.id ? { ...replacement, createdAt: item.createdAt } : item), state.albums) }))
    } finally {
      if (isCurrent && element) {
        try {
          const url = await window.sylunae.music.getAudioUrl(input.path)
          element.src = url
          await new Promise<void>((resolve, reject) => {
            const loaded = () => { cleanup(); resolve() }
            const failed = () => { cleanup(); reject(new Error('reload failed')) }
            const cleanup = () => { element.removeEventListener('loadedmetadata', loaded); element.removeEventListener('error', failed) }
            element.addEventListener('loadedmetadata', loaded)
            element.addEventListener('error', failed)
            element.load()
          })
          element.currentTime = Math.min(resumeAt, element.duration || resumeAt)
          if (wasPlaying) await element.play()
        } catch {
          setPlayerError('元信息已保存，但播放器重新加载文件失败。')
        } finally {
          releasingForEdit.current = false
        }
      }
    }
  }

  const saveAlbumCover = (albumId: string, cover: string) => {
    update((state) => ({ ...state, albums: state.albums.map((album) => album.id === albumId ? { ...album, cover, updatedAt: new Date().toISOString() } : album) }))
  }

  if (!window.sylunae) return <section className="page"><header className="page-header"><div><span className="eyebrow">MUSIC</span><h1>音乐</h1><p>属于桌面端的安静播放器</p></div><Button className="button secondary" onClick={onOpenWhiteNoise}><CloudRain size={17} />白噪音<ArrowRight size={15} /></Button></header><EmptyState icon={<Music2 size={27} />} title="桌面版专属能力" description="浏览器无法长期、安全地保留本地音乐路径。安装并打开丝月工坊桌面版后，即可建立你的音乐资料库。" /></section>

  return <section className="page music-page">
    <header className="page-header"><div><span className="eyebrow">MUSIC</span><h1>音乐</h1><p>{tracks.length ? `${tracks.length} 首本地音乐` : '让喜欢的声音留在手边'}</p></div><div className="music-header-actions"><Button className="button secondary" onClick={onOpenWhiteNoise}><CloudRain size={17} />白噪音<ArrowRight size={15} /></Button><Button className="button primary" onClick={() => setImportOpen(true)}><Plus size={17} />添加音乐</Button></div></header>
    <div
      className={`music-hero ${playing && currentCover ? 'is-playing' : ''}`}
      style={{ '--music-hero-cover': currentCover ? `url(${currentCover})` : 'none' } as CSSProperties}
    >
      <div className="hero-art">{currentCover ? <img src={currentCover} alt="" /> : <Disc3 size={48} strokeWidth={1.2} />}</div>
      <div className="hero-copy"><span>正在播放</span><h2 className={current ? 'private-music-title' : undefined}>{current?.title || '还没有选择音乐'}</h2><p className={current ? 'user-content' : undefined}>{current ? `${current.artist} · ${current.album}` : '从资料库中选择一首，给此刻一点声音。'}</p></div>
      {current && audioUrl ? <AudioWaveform media={audio.current} src={audioUrl} /> : <div className="audio-waveform-placeholder" aria-hidden><span /></div>}
    </div>
    <div className="toolbar music-library-toolbar">
      <Tabs value={view} onValueChange={(value) => { const nextView = value as 'tracks' | 'albums'; setView(nextView); if (nextView === 'albums') { setSelectedTrackIds(new Set()); setSelectingTracks(false) } }}><TabsList variant="line" aria-label="音乐资料库视图"><TabsTrigger value="tracks"><Music2 />歌曲 <span>{tracks.length}</span></TabsTrigger><TabsTrigger value="albums"><Album />专辑 <span>{albums.length}</span></TabsTrigger></TabsList></Tabs>
      <label className="search-box"><Search size={17} /><Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={view === 'tracks' ? '搜索歌曲、艺术家或专辑' : '搜索专辑或艺术家'} /></label>
      {view === 'tracks' && <div className="music-selection-actions">
        {selectingTracks ? <>
          <span>{selectedTrackIds.size ? `已选 ${selectedTrackIds.size} 首` : '选择歌曲'}</span>
          <Button variant="outline" size="sm" disabled={!selectedTrackIds.size || albums.length === 0} onClick={() => { setAssignAlbumId(albums[0]?.id ?? ''); setAssignAlbumOpen(true) }}><Album size={15} />加入专辑</Button>
          <Button variant="destructive" size="sm" disabled={!selectedTrackIds.size} onClick={() => setRemoveSelectedOpen(true)}><Trash2 size={15} />移除所选</Button>
          <Button variant="ghost" size="sm" onClick={() => { setSelectedTrackIds(new Set()); setSelectingTracks(false) }}><X size={15} />取消</Button>
        </> : <Button variant="outline" size="lg" onClick={() => setSelectingTracks(true)}><CheckSquare2 size={15} />批量选择</Button>}
      </div>}
      {view === 'albums' && <Button variant="outline" size="lg" onClick={() => { setCreateAlbumError(''); setCreateAlbumOpen(true) }}><Plus size={15} />新建专辑</Button>}
    </div>
    {playerError && <div className="notice error">{playerError}</div>}
    {tracks.length === 0 ? <EmptyState icon={<FileMusic size={26} />} title="资料库还是空的" description="可以索引电脑中的音频，也可以从 YouTube 或音频链接下载到本地。" action={<Button className="button primary" onClick={() => setImportOpen(true)}><Plus size={16} />添加第一首音乐</Button>} /> :
      view === 'tracks' ? <div className="track-table"><div className="track-head"><span>{selectingTracks ? <Checkbox aria-label="选择当前筛选的全部歌曲" checked={allFilteredSelected ? true : selectedFilteredCount > 0 ? 'indeterminate' : false} onCheckedChange={toggleFilteredTrackSelection} /> : '#'}</span><span>歌曲</span><span>专辑</span><span>时长</span><span /></div>{filtered.map((track, index) => <div key={track.id} className={`track-row ${currentId === track.id ? 'active' : ''} ${track.missing ? 'missing' : ''} ${selectedTrackIds.has(track.id) ? 'selected' : ''}`} onDoubleClick={() => void playTrack(track)}>
        {selectingTracks ? <span className="track-select-cell"><Checkbox aria-label={`选择 ${track.title}`} checked={selectedTrackIds.has(track.id)} onCheckedChange={() => toggleTrackSelection(track.id)} /></span> : <button className="track-play" disabled={track.missing} onClick={() => currentId === track.id ? togglePlay() : void playTrack(track)}>{currentId === track.id && playing ? <Pause size={15} /> : <span>{index + 1}</span>}</button>}
        <div className="track-title"><div className="tiny-cover">{trackCover(track, albums, tracks) ? <img src={trackCover(track, albums, tracks)} alt="" /> : <Music2 size={15} />}</div><div><strong className="private-music-title">{track.title}</strong><span className={track.missing ? undefined : 'private-music-artist'}>{track.missing ? '文件已移动或删除' : track.artist}</span></div></div>
        {(() => { const album = track.albumId ? albums.find((item) => item.id === track.albumId) : undefined; return album ? <button type="button" className="track-album track-album-link private-music-album" onClick={() => setAlbumTarget(album)}>{track.album}</button> : <span className="track-album private-music-album">{track.album}</span> })()}<span>{formatDuration(track.duration)}</span>
        <div className="track-actions">{track.missing && <button onClick={() => void relocate(track)} title="重新定位"><LocateFixed size={16} /></button>}<button disabled={track.missing} onClick={() => void window.sylunae?.music.showInFolder(track.path)} title="在文件夹中显示"><FolderOpen size={16} /></button><button disabled={track.missing} onClick={() => setEditTarget(track)} title="编辑元信息"><PencilLine size={16} /></button><button onClick={() => setRemoveTarget(track)} title="移除索引"><Trash2 size={16} /></button></div>
      </div>)}</div> : filteredAlbums.length ? <div className="music-album-grid">{filteredAlbums.map((album) => {
        const albumTracks = tracks.filter((track) => track.albumId === album.id)
        const cover = albumCover(album, albumTracks)
        return <button className="music-album-card" key={album.id} onClick={() => setAlbumTarget(album)}><div className="music-album-cover">{cover ? <img src={cover} alt="" /> : <Disc3 size={42} strokeWidth={1.1} />}</div><div className="music-album-info"><strong className="private-music-title">{album.title}</strong><span className="private-music-artist">{album.artist}</span><small>{albumTracks.length} 首歌曲</small></div></button>
      })}</div> : <EmptyState icon={<Album size={26} />} title="没有匹配的专辑" description="已导入且包含专辑名称的歌曲会自动归类到这里。" />}

    <div className={`player-bar ${current ? 'visible' : ''}`}>
      <audio ref={audio} onPlay={() => setPlaying(true)} onPause={() => { if (!releasingForEdit.current) setPlaying(false) }} onTimeUpdate={(event) => setPosition(event.currentTarget.currentTime)} onLoadedMetadata={(event) => setDuration(event.currentTarget.duration)} onEnded={onEnded} onError={() => { if (!releasingForEdit.current) { setPlayerError('音频加载失败'); setPlaying(false) } }} />
      <div className="player-track"><div className="tiny-cover large">{currentCover ? <img src={currentCover} alt="" /> : <ListMusic size={17} />}</div><div><strong className={current ? 'private-music-title' : undefined}>{current?.title || '未选择'}</strong><span className={current?.artist ? 'private-music-artist' : undefined}>{current?.artist || '—'}</span></div></div>
      <div className="player-center"><div className="player-controls"><button className={shuffle ? 'active' : ''} onClick={() => setShuffle(!shuffle)}><Shuffle size={16} /></button><button onClick={() => adjacent(-1)}><SkipBack size={18} fill="currentColor" /></button><button className="play-main" onClick={togglePlay}>{playing ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" />}</button><button onClick={() => adjacent(1)}><SkipForward size={18} fill="currentColor" /></button><button className={repeat !== 'off' ? 'active' : ''} onClick={() => setRepeat(repeat === 'off' ? 'all' : repeat === 'all' ? 'one' : 'off')}>{repeat === 'one' ? <Repeat1 size={16} /> : <Repeat size={16} />}</button></div>
        <div className="progress-control"><span>{formatDuration(position)}</span><Slider min={0} max={Math.max(duration, 1)} step={1} value={[Math.min(position, duration || 0)]} onValueChange={([value]) => { if (audio.current) audio.current.currentTime = value }} aria-label="播放进度" /><span>{formatDuration(duration)}</span></div></div>
      <div className="volume-control">{volume < 0.05 ? <Volume1 size={17} /> : <Volume2 size={17} />}<Slider min={0} max={1} step={0.01} value={[volume]} onValueChange={([value]) => setVolume(value)} aria-label="音量" /></div>
    </div>
    {editTarget && <MusicMetadataSheet track={editTarget} albums={albums} onClose={() => setEditTarget(null)} onSave={saveMetadata} />}
    {albumTarget && <MusicAlbumSheet album={albumTarget} tracks={tracks.filter((track) => track.albumId === albumTarget.id)} onClose={() => setAlbumTarget(null)} onSave={(cover) => saveAlbumCover(albumTarget.id, cover)} onPlay={(track) => { void playTrack(track, albumTarget.id); setAlbumTarget(null) }} />}
    <MusicImportDialog open={importOpen} onOpenChange={setImportOpen} onImported={addImportedTracks} />
    <Dialog open={createAlbumOpen} onOpenChange={setCreateAlbumOpen}>
      <DialogContent className="music-album-action-dialog">
        <DialogHeader><DialogTitle>新建专辑</DialogTitle><DialogDescription>创建一个专辑，可以先留空，之后再把歌曲加入。</DialogDescription></DialogHeader>
        <div className="music-album-action-fields">
          <label htmlFor="new-music-album-title">专辑名称</label>
          <Input id="new-music-album-title" autoFocus value={newAlbumTitle} onChange={(event) => { setNewAlbumTitle(event.target.value); setCreateAlbumError('') }} onKeyDown={(event) => { if (event.key === 'Enter') createAlbum() }} placeholder="输入专辑名称" />
          <label htmlFor="new-music-album-artist">艺术家</label>
          <Input id="new-music-album-artist" value={newAlbumArtist} onChange={(event) => setNewAlbumArtist(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') createAlbum() }} placeholder="可选" />
          {createAlbumError && <p className="music-import-error">{createAlbumError}</p>}
        </div>
        <DialogFooter><Button variant="outline" onClick={() => setCreateAlbumOpen(false)}>取消</Button><Button onClick={createAlbum} disabled={!newAlbumTitle.trim()}>创建专辑</Button></DialogFooter>
      </DialogContent>
    </Dialog>
    <Dialog open={assignAlbumOpen} onOpenChange={setAssignAlbumOpen}>
      <DialogContent className="music-album-action-dialog">
        <DialogHeader><DialogTitle>加入专辑</DialogTitle><DialogDescription>将选中的 {selectedTrackIds.size} 首歌曲移入所选专辑。</DialogDescription></DialogHeader>
        <div className="music-album-action-fields">
          <label htmlFor="assign-music-album">目标专辑</label>
          <Select value={assignAlbumId} onValueChange={setAssignAlbumId}>
            <SelectTrigger id="assign-music-album"><SelectValue placeholder="选择专辑" /></SelectTrigger>
            <SelectContent>{albums.map((album) => <SelectItem key={album.id} value={album.id}>{album.title} · {album.artist}</SelectItem>)}</SelectContent>
          </Select>
          <p className="music-import-hint">歌曲会从原专辑移出；音频文件和其它信息不会更改。</p>
        </div>
        <DialogFooter><Button variant="outline" onClick={() => setAssignAlbumOpen(false)}>取消</Button><Button onClick={addSelectedTracksToAlbum} disabled={!assignAlbumId || !selectedTrackIds.size}>加入专辑</Button></DialogFooter>
      </DialogContent>
    </Dialog>
    <ConfirmDialog open={Boolean(removeTarget)} onOpenChange={(open) => { if (!open) setRemoveTarget(null) }} title="从资料库移除？" description={removeTarget ? <><span>将移除《</span><span className="private-music-title">{removeTarget.title}</span><span>》的索引，原始音乐文件不会被删除。</span></> : ''} confirmLabel="移除索引" destructive icon={<Trash2 />} onConfirm={() => { if (removeTarget) remove(removeTarget); setRemoveTarget(null) }} />
    <ConfirmDialog open={removeSelectedOpen} onOpenChange={setRemoveSelectedOpen} title={`移除选中的 ${selectedTrackIds.size} 首歌曲？`} description="只会从音乐资料库中移除这些歌曲的索引，原始音频文件不会被删除。" confirmLabel="移除索引" destructive icon={<Trash2 />} onConfirm={removeSelectedTracks} />
  </section>
}
