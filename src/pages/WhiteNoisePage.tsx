import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { CloudRain, Coffee, Download, Droplets, Flame, Headphones, LoaderCircle, Moon, Pause, Play, Plus, SkipBack, SkipForward, Sparkles, Timer, TrainFront, Trees, Volume2, Waves, Wind } from 'lucide-react'
import { Button } from '../components/ui/button'
import { Slider } from '../components/ui/slider'
import { whiteNoiseCatalog, defaultWhiteNoiseId } from '../resources/whiteNoiseCatalog'
import { editDriveResources } from '../app/driveLocalState'
import type { ResourceDownloadProgress, ResourceItem } from '../shared/types'
import { formatDuration } from '../utils'
import { usePersistentState } from '../lib/usePersistentState'
import { isAndroid } from '../platform/environment'
import { nativePlayer, playerCommand, setNativeQueue } from '../platform/player'

const noiseIcons: Record<string, typeof CloudRain> = {
  'window-rain': CloudRain,
  'misty-forest': Trees,
  'midnight-ocean': Waves,
  'warm-fireplace': Flame,
  'morning-cafe': Coffee,
  'night-train': TrainFront,
  'mountain-wind': Wind,
  'quiet-night': Moon,
  'forest-stream': Droplets,
  'distant-thunder': CloudRain,
}

const browserItems: ResourceItem[] = whiteNoiseCatalog.map((item) => ({
  ...item,
  origin: item.builtin ? 'builtin' : 'official',
  state: item.builtin ? 'builtin' : 'available',
  installedSize: item.builtin ? item.size : 0,
}))

const resourceBaseUrl = (import.meta.env.MAIN_VITE_RESOURCE_PUBLIC_BASE_URL || '').trim().replace(/\/+$/, '')

function getStreamUrl(item: ResourceItem): string | null {
  if (!resourceBaseUrl || !item.audioPath) return null
  try {
    const base = new URL(`${resourceBaseUrl}/`)
    const isLoopback = base.hostname === 'localhost' || base.hostname === '127.0.0.1' || base.hostname === '::1'
    if (base.protocol !== 'https:' && !(base.protocol === 'http:' && isLoopback)) return null
    return new URL(item.audioPath.replace(/^\/+/, ''), base).toString()
  } catch {
    return null
  }
}

function isReady(item: ResourceItem): boolean {
  return item.state === 'builtin' || item.state === 'installed'
}

export function WhiteNoisePage({ onNowPlayingChange }: { onNowPlayingChange: (item: ResourceItem | null) => void }) {
  const [items, setItems] = useState<ResourceItem[]>(browserItems)
  const [selectedId, setSelectedId] = useState(defaultWhiteNoiseId)
  const [playing, setPlaying] = useState(false)
  const [position, setPosition] = useState(0)
  const [duration, setDuration] = useState(whiteNoiseCatalog[0].duration)
  const [volume, setVolume] = usePersistentState('whiteNoise.volume', 0.68)
  const [busyId, setBusyId] = useState('')
  const [progress, setProgress] = useState<Record<string, ResourceDownloadProgress>>({})
  const [error, setError] = useState('')
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const selected = items.find((item) => item.id === selectedId) ?? items[0]
  const SelectedIcon = noiseIcons[selected?.id] ?? Headphones
  const canPlay = (item: ResourceItem) => isReady(item) || (!window.sylunae && Boolean(getStreamUrl(item)))
  const readyItems = useMemo(() => items.filter(canPlay), [items])

  useEffect(() => {
    if (!isAndroid) return
    let disposed = false
    const listener = nativePlayer.addListener('state', (state) => {
      if (disposed) return
      if (state.id?.startsWith('ambient:')) { setSelectedId(state.id.slice(8)); setPlaying(state.playing); setPosition(state.position); setDuration(state.duration) }
      else setPlaying(false)
    })
    return () => { disposed = true; void listener.then((handle) => handle.remove()) }
  }, [])

  const refresh = async () => {
    if (!window.sylunae) return
    const summary = await window.sylunae.resources.list()
    setItems(summary.items)
  }

  useEffect(() => {
    void refresh().catch(() => setError('无法读取本地资源状态。'))
    const onChanged = () => void refresh()
    window.addEventListener('sylunae-resources-changed', onChanged)
    const disposeProgress = window.sylunae?.resources.onDownloadProgress((value) => {
      setProgress((current) => ({ ...current, [value.id]: value }))
    })
    return () => {
      window.removeEventListener('sylunae-resources-changed', onChanged)
      disposeProgress?.()
    }
  }, [])

  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = volume
    if (isAndroid && playing) void playerCommand('volume', { volume }).catch(() => setError('无法设置音量'))
  }, [volume])

  useEffect(() => {
    onNowPlayingChange(playing ? selected : null)
  }, [onNowPlayingChange, playing, selected])

  const getAudioUrl = async (item: ResourceItem): Promise<string> => {
    if (window.sylunae) return window.sylunae.resources.getAudioUrl(item.id)
    if (item.builtin) return item.audioPath
    const streamUrl = getStreamUrl(item)
    if (streamUrl) return streamUrl
    throw new Error('尚未配置白噪音流媒体地址')
  }

  const download = async (item: ResourceItem): Promise<ResourceItem> => {
    if (!window.sylunae) throw new Error('按需下载为客户端专属功能')
    setBusyId(item.id)
    const installed = await editDriveResources(() => window.sylunae!.resources.download(item.id))
    await refresh()
    window.dispatchEvent(new Event('sylunae-resources-changed'))
    return installed
  }

  const playItem = async (item: ResourceItem) => {
    audioRef.current?.pause()
    setError('')
    setSelectedId(item.id)
    try {
      if (isAndroid) {
        const playable = item.localPath ? item : await editDriveResources(() => window.sylunae!.resources.download(item.id))
        if (!playable.localPath) throw new Error('音频未保存到本地')
        await playerCommand('modes', { shuffle: false, repeat: 'one' })
        await playerCommand('volume', { volume })
        await setNativeQueue([{ id: `ambient:${item.id}`, path: playable.localPath, title: item.title, artist: item.attribution.creator || '白噪音', album: '白噪音', albumArtist: '', albumId: null, duration: item.duration, cover: '', missing: false, createdAt: '', updatedAt: '' }], `ambient:${item.id}`, true)
        return
      }
      const playable = isReady(item) || !window.sylunae ? item : await download(item)
      const url = await getAudioUrl(playable)
      const audio = audioRef.current
      if (!audio) return
      if (audio.src !== new URL(url, window.location.href).href) {
        audio.src = url
        audio.load()
        setPosition(0)
        setDuration(playable.duration)
      }
      audio.volume = volume
      await audio.play()
    } catch (cause) {
      audioRef.current?.pause()
      setPlaying(false)
      setError(cause instanceof Error ? cause.message : '暂时无法播放这个白噪音。')
    } finally {
      setBusyId('')
    }
  }

  const toggleSelected = () => {
    if (isAndroid) { if (playing) void playerCommand('pause').catch(() => setError('无法暂停')); else if (selected) void playItem(selected); return }
    const audio = audioRef.current
    if (!audio || !selected) return
    if (playing) audio.pause()
    else void playItem(selected)
  }

  const move = (direction: 1 | -1) => {
    if (!selected || readyItems.length === 0) return
    const currentIndex = readyItems.findIndex((item) => item.id === selected.id)
    const index = currentIndex < 0 ? 0 : (currentIndex + direction + readyItems.length) % readyItems.length
    void playItem(readyItems[index])
  }

  const importAudio = async () => {
    if (!window.sylunae) {
      setError('添加自己的白噪音为客户端专属功能。')
      return
    }
    setBusyId('import')
    setError('')
    try {
      const imported = await editDriveResources(() => window.sylunae!.resources.importWhiteNoise())
      if (imported) {
        await refresh()
        window.dispatchEvent(new Event('sylunae-resources-changed'))
        await playItem(imported)
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '无法添加这个音频。')
    } finally {
      setBusyId('')
    }
  }

  if (!selected) return null

  const selectedProgress = progress[selected.id]
  const selectedBusy = busyId === selected.id

  return <section className="page white-noise-page">
    <audio ref={audioRef} loop preload="metadata" onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onTimeUpdate={(event) => setPosition(event.currentTarget.currentTime)} onLoadedMetadata={(event) => setDuration(event.currentTarget.duration || selected.duration)} onError={() => { setPlaying(false); setError(window.sylunae ? '音频文件无法读取，请检查资源是否完整。' : '流式音频无法播放，请检查资源地址和跨域设置。') }} />

    <header className="page-header"><div><span className="eyebrow">AMBIENCE</span><h1>白噪音</h1><p>留一点自然的声音，让此刻慢下来</p></div><div className="white-noise-header-actions"><Button variant="outline" className="button secondary" onClick={() => void importAudio()} disabled={Boolean(busyId)}><Plus />{busyId === 'import' ? '正在添加…' : '添加白噪音'}</Button><button className="white-noise-timer" type="button" title="定时功能即将开放"><Timer size={16} /><span>定时关闭</span><small>即将开放</small></button></div></header>

    <div className={`white-noise-hero ${selected.origin === 'custom' ? 'private-media-background' : ''} ${playing ? 'is-playing' : ''}`}>
      {selected.coverPath && <img className={`white-noise-hero-background ${selected.origin === 'custom' ? 'private-media' : ''}`} src={selected.coverPath} alt="" aria-hidden />}
      <div className="white-noise-glow" aria-hidden />
      <div className="white-noise-orb">{selected.coverPath ? <img className={selected.origin === 'custom' ? 'private-media' : undefined} src={selected.coverPath} alt="" /> : <SelectedIcon size={44} strokeWidth={1.25} />}</div>
      <div className="white-noise-hero-copy"><span>{selectedBusy ? '正在获取资源' : playing ? '正在播放' : !window.sylunae && canPlay(selected) ? '流式播放' : isReady(selected) ? '已在本地' : '可按需下载'}</span><h2 className={selected.origin === 'custom' ? 'user-content' : undefined}>{selected.title}</h2><p className={selected.origin === 'custom' ? 'user-content' : undefined}>{selected.description}</p><div>{selected.tags.map((tag) => <span className={selected.origin === 'custom' ? 'user-content' : undefined} key={tag}>{tag}</span>)}</div>{selectedBusy && <div className="white-noise-hero-download"><i style={{ width: `${selectedProgress?.percent ?? 0}%` }} /><small>{selectedProgress?.message ?? '正在准备下载'}</small></div>}</div>
      <button className="white-noise-hero-play" type="button" onClick={toggleSelected} disabled={Boolean(busyId)} aria-label={selectedBusy ? `正在下载${selected.title}` : playing ? `暂停${selected.title}` : canPlay(selected) ? `播放${selected.title}` : `下载并播放${selected.title}`}>
        {selectedBusy ? <LoaderCircle className="spin" size={21} /> : playing ? <Pause size={21} fill="currentColor" /> : canPlay(selected) ? <Play size={21} fill="currentColor" /> : <Download size={20} />}
      </button>
      <div className="ambient-lines" aria-hidden>{Array.from({ length: 18 }, (_, index) => <i key={index} style={{ '--line-index': index } as CSSProperties} />)}</div>
    </div>

    {error && <div className="notice error white-noise-error">{error}</div>}
    <div className="white-noise-section-heading"><div><Sparkles size={16} /><h2>选择你喜欢的氛围</h2></div></div>
    <div className="white-noise-grid">{items.map((item) => {
      const Icon = noiseIcons[item.id] ?? Headphones
      const active = selected.id === item.id
      const downloading = busyId === item.id
      return <button type="button" key={item.id} className={`white-noise-card ${item.origin === 'custom' ? 'private-media-background' : ''} ${active ? 'active' : ''}`} onClick={() => active && playing ? (isAndroid ? void playerCommand('pause').catch(() => setError('无法暂停')) : audioRef.current?.pause()) : void playItem(item)} disabled={Boolean(busyId) && !downloading} aria-pressed={active}>
        <div className="white-noise-card-art">{item.coverPath ? <img className={item.origin === 'custom' ? 'private-media' : undefined} src={item.coverPath} alt="" /> : <Icon size={31} strokeWidth={1.35} />}<span className="white-noise-card-action">{downloading ? <LoaderCircle className="spin" size={15} /> : active && playing ? <Pause size={15} fill="currentColor" /> : canPlay(item) ? <Play size={15} fill="currentColor" /> : <Download size={14} />}</span></div>
        <div className="white-noise-card-copy"><strong className={item.origin === 'custom' ? 'user-content' : undefined}>{item.title}</strong><small className={item.origin === 'custom' ? 'user-content' : undefined}>{item.description}</small><div>{item.tags.map((tag) => <span className={item.origin === 'custom' ? 'user-content' : undefined} key={tag}>{tag}</span>)}<span className="white-noise-card-state">{item.origin === 'custom' ? '本地添加' : !window.sylunae && canPlay(item) ? '流式' : item.state === 'builtin' ? '内置' : item.state === 'installed' ? '已下载' : downloading ? `${progress[item.id]?.percent ?? 0}%` : '需下载'}</span></div></div>
        {downloading && <i className="white-noise-card-download" style={{ width: `${progress[item.id]?.percent ?? 0}%` }} />}
      </button>
    })}</div>

    <div className="player-bar white-noise-player visible">
      <div className="player-track white-noise-player-track"><div className="tiny-cover large">{selected.coverPath ? <img className={selected.origin === 'custom' ? 'private-media' : undefined} src={selected.coverPath} alt="" /> : <SelectedIcon size={18} />}</div><div><strong className={selected.origin === 'custom' ? 'user-content' : undefined}>{selected.title}</strong><span>{canPlay(selected) ? `环境白噪音 · ${!window.sylunae ? '流式' : '循环'}播放` : '尚未下载'}</span></div></div>
      <div className="player-center"><div className="player-controls"><button onClick={() => move(-1)} aria-label="上一个可播放白噪音"><SkipBack size={18} fill="currentColor" /></button><button className="play-main" onClick={toggleSelected} disabled={Boolean(busyId)} aria-label={playing ? '暂停' : canPlay(selected) ? '播放' : '下载并播放'}>{selectedBusy ? <LoaderCircle className="spin" size={18} /> : playing ? <Pause size={18} fill="currentColor" /> : canPlay(selected) ? <Play size={18} fill="currentColor" /> : <Download size={17} />}</button><button onClick={() => move(1)} aria-label="下一个可播放白噪音"><SkipForward size={18} fill="currentColor" /></button></div>
        <div className="progress-control"><span>{formatDuration(position)}</span><Slider min={0} max={Math.max(duration, 1)} step={1} value={[Math.min(position, duration || 0)]} onValueChange={([value]) => { if (isAndroid) void playerCommand('seek', { position: value }).catch(() => setError('无法调整播放进度')); else if (audioRef.current) audioRef.current.currentTime = value }} disabled={!canPlay(selected)} aria-label="播放进度" /><span>{formatDuration(duration)}</span></div></div>
      <div className="volume-control"><Volume2 size={17} /><Slider min={0} max={1} step={0.01} value={[volume]} onValueChange={([value]) => setVolume(value)} aria-label="白噪音音量" /></div>
    </div>
  </section>
}
