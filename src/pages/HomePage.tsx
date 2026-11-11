import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ArrowDown, ArrowUp, BookMarked, CalendarClock, CheckSquare2, ChevronRight, Clipboard, Cloud, CloudLightning, CloudRain, CloudSun, Clover, FileText, Image, ImagePlus, Images, ListChecks, MapPin, Music2, NotebookPen, RotateCcw, Rss, Search, SlidersHorizontal, Snowflake, Sun, Target, Timer, Trash2 } from 'lucide-react'
import { useAppStore } from '../app/AppStore'
import type { HomeIntent, HomeWallpaper, ToolId, WeatherLocation, WeatherSnapshot } from '../shared/types'
import { defaultHomeQuickActions, homeQuickActionIds, maxHomeQuickActions, type HomeQuickActionId } from '../shared/homeQuickActions'
import { defaultHomeWallpaper } from '../components/HomeWallpaperBackdrop'
import { Spinner } from '../components/Icons'
import { Button } from '../components/ui/button'
import { Checkbox } from '../components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../components/ui/dialog'
import { Input } from '../components/ui/input'
import { Textarea } from '../components/ui/textarea'
import { Tooltip, TooltipContent, TooltipTrigger } from '../components/ui/tooltip'
import { localDateKey, occursOnDate } from '../todos/recurring'
import { LegalLinks } from '../components/LegalLinks'

interface CitySearchResult extends WeatherLocation { id: number }
interface QuickAction { label: string; hint: string; icon: ReactNode; tool: ToolId; intent?: HomeIntent }

export function HomePage({ wallpaper, wallpaperSettingsOpen, onWallpaperSettingsChange, onOpenTool }: {
  wallpaper: HomeWallpaper
  wallpaperSettingsOpen: boolean
  onWallpaperSettingsChange: (open: boolean) => void
  onOpenTool: (tool: ToolId, intent?: HomeIntent) => void
}) {
  const { snapshot, update } = useAppStore()
  const [now, setNow] = useState(() => new Date())
  const [nameDialogOpen, setNameDialogOpen] = useState(false)
  const [quickActionsDialogOpen, setQuickActionsDialogOpen] = useState(false)
  useEffect(() => { const timer = window.setInterval(() => setNow(new Date()), 30_000); return () => clearInterval(timer) }, [])
  if (!snapshot) return null

  const wallpaperTitle = wallpaper.id === defaultHomeWallpaper.id ? '' : wallpaper.title
  const wallpaperDescription = wallpaper.id === defaultHomeWallpaper.id ? '' : wallpaper.description
  const hour = now.getHours()
  const greeting = hour < 5 ? '夜深了' : hour < 11 ? '早上好' : hour < 14 ? '中午好' : hour < 18 ? '下午好' : '晚上好'
  const period = hour < 5 ? 'GOOD NIGHT' : hour < 11 ? 'GOOD MORNING' : hour < 14 ? 'GOOD NOON' : hour < 18 ? 'GOOD AFTERNOON' : 'GOOD EVENING'
  const dateText = new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric', weekday: 'short' }).format(now).replace('周', '星期')
  const today = localDateKey(now)
  const todayRoutines = snapshot.recurringTodos.filter((todo) => occursOnDate(todo, today))
  const completedRoutineIds = new Set(snapshot.todoCompletionRecords.filter((record) => record.occurrenceDate === today).map((record) => record.recurringTodoId))
  const openTodos = snapshot.todos.filter((todo) => !todo.completed)
  const completedToday = snapshot.todos.filter((todo) => todo.completed && new Date(todo.completedAt ?? todo.updatedAt).toDateString() === now.toDateString()).length + completedRoutineIds.size
  const todayOpenTodos = openTodos.length + todayRoutines.filter((todo) => !completedRoutineIds.has(todo.id)).length
  const totalTodos = todayOpenTodos + completedToday
  const completionPercent = totalTodos ? completedToday / totalTodos * 100 : 0
  const activeGoals = snapshot.goals.filter((goal) => goal.status === 'active')
  const notes = snapshot.notes.filter((note) => !note.deletedAt)
  const latestNote = [...notes].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]
  const usage = snapshot.settings.toolUsage

  const allQuickActions: Record<HomeQuickActionId, QuickAction> = {
    'new-note': { label: '新建笔记', hint: '记录此刻的想法', icon: <FileText />, tool: 'notes', intent: 'new-note' },
    'new-todo': { label: '添加待办', hint: '让事情井井有条', icon: <CheckSquare2 />, tool: 'tasks', intent: 'todos' },
    pomodoro: { label: '开始专注', hint: '保持高效与专注', icon: <Timer />, tool: 'tasks', intent: 'pomodoro' },
    music: { label: '继续播放', hint: snapshot.tracks.length ? `${snapshot.tracks.length} 首音乐已就绪` : '打开你的音乐', icon: <Music2 />, tool: 'music' },
    collection: { label: '打开收藏', hint: '回到喜欢的内容', icon: <BookMarked />, tool: 'collection' },
    goals: { label: '目标追踪', hint: '查看目标与进展', icon: <Target />, tool: 'tasks', intent: 'goals' },
    countdown: { label: '倒数日', hint: '看看离重要日子还有多久', icon: <CalendarClock />, tool: 'tasks', intent: 'countdown' },
    'white-noise': { label: '白噪音', hint: '打开环境音页面', icon: <CloudRain />, tool: 'music', intent: 'white-noise' },
    images: { label: '精选图片', hint: '打开图片收藏', icon: <Images />, tool: 'collection', intent: 'images' },
    rss: { label: 'RSS 订阅', hint: '查看订阅内容', icon: <Rss />, tool: 'collection', intent: 'rss' },
    clipboard: { label: '剪贴板', hint: '查看保存的常用片段', icon: <Clipboard />, tool: 'tools', intent: 'clipboard' },
    notes: { label: '打开笔记', hint: '继续阅读或编辑已有笔记', icon: <NotebookPen />, tool: 'notes' },
  }
  const recent = [
    { label: '快速待办', time: usage.tasks, icon: <ListChecks />, tool: 'tasks' as ToolId, intent: 'todos' as HomeIntent },
    { label: latestNote?.title || '今日笔记', private: Boolean(latestNote?.title), time: latestNote?.updatedAt || usage.notes, icon: <NotebookPen />, tool: 'notes' as ToolId },
    { label: '最近播放', time: usage.music, icon: <Music2 />, tool: 'music' as ToolId },
    { label: '收藏夹', time: usage.collection, icon: <BookMarked />, tool: 'collection' as ToolId },
    { label: '剪贴板', time: usage.tools, icon: <Clipboard />, tool: 'tools' as ToolId, intent: 'clipboard' as HomeIntent },
  ].sort((a, b) => (b.time || '').localeCompare(a.time || '')).slice(0, 3)

  return <section className="home-page">
    <div className="home-layout">
      <header className="home-heading">
        <div className="home-greeting">
          <span>{period}</span>
          <h1>{greeting}，<button type="button" className="display-name-trigger" onClick={() => setNameDialogOpen(true)} title="修改名字">{snapshot.settings.displayName}</button></h1>
          <p className={wallpaperTitle ? 'home-wallpaper-title user-content' : 'home-wallpaper-title'}>{wallpaperTitle || defaultHomeWallpaper.title}</p>
          <blockquote className={wallpaperDescription ? 'user-content' : undefined}>{wallpaperDescription || defaultHomeWallpaper.description}</blockquote>
        </div>
        <div className="home-date">
          <strong>{dateText}</strong>
          <p>在平凡的日子里，<br />做不平凡的自己。</p>
          <div className="home-controls">
            <Tooltip>
              <TooltipTrigger asChild>
                <button type="button" onClick={() => onWallpaperSettingsChange(true)} aria-label="打开壁纸设置"><Image size={17} /></button>
              </TooltipTrigger>
              <TooltipContent>壁纸设置</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <button type="button" onClick={() => setQuickActionsDialogOpen(true)} aria-label="自定义快捷操作"><SlidersHorizontal size={17} /></button>
              </TooltipTrigger>
              <TooltipContent>自定义快捷操作</TooltipContent>
            </Tooltip>
          </div>
        </div>
      </header>

      <section className="home-quick home-glass" aria-label="快捷操作">
        {snapshot.settings.homeQuickActions.map((id) => {
          const action = allQuickActions[id]
          return <button key={id} type="button" onClick={() => onOpenTool(action.tool, action.intent)}>{action.icon}<span>{action.label}</span></button>
        })}
      </section>

      <div className="home-lower home-glass">
        <section className="home-overview">
          <h2>今日概览</h2>
          <div className="overview-content">
            <div className="home-todo-ring" role="group" aria-label="今日待办">
              <svg viewBox="0 0 100 100" aria-hidden="true">
                <circle cx="50" cy="50" r="46" />
                <circle className="home-todo-progress" cx="50" cy="50" r="46" pathLength="100" strokeDasharray={`${completionPercent} 100`} visibility={completionPercent ? 'visible' : 'hidden'} />
              </svg>
              <strong>{todayOpenTodos}</strong>
              <span>已完成 {completedToday} 项</span>
            </div>
            <dl className="overview-stats">
              <OverviewStat icon={<Target />} label="进行中的目标" value={activeGoals.length} />
              <OverviewStat icon={<FileText />} label="最近笔记" value={notes.length} />
              <OverviewStat icon={<Timer />} label="累计专注时长" value={formatFocusTime(snapshot.pomodoro.completedSessions * snapshot.pomodoro.focusMinutes)} />
            </dl>
          </div>
        </section>
        <section className="home-recent">
          <h2>近期使用</h2>
          <div className="recent-list">
            {recent.map((item) => <button key={item.tool} type="button" onClick={() => onOpenTool(item.tool, item.intent)}>
              <span className="home-row-icon">{item.icon}</span>
              <span className="home-recent-copy">
                <strong className={item.private ? 'user-content' : undefined}>{item.label}</strong>
                <small>{formatRelativeTime(item.time)}</small>
              </span>
              <ChevronRight size={16} />
            </button>)}
          </div>
        </section>
      </div>

      <footer className="home-footer">
        <WeatherSummary />
        <p><Clover size={16} aria-hidden="true" />「 慢下来，和喜欢的一切在一起。 」</p>
      </footer>
      <div className="home-legal"><p>丝月工坊 · 收藏、音乐、笔记与任务</p><LegalLinks /></div>
    </div>
    <DisplayNameDialog open={nameDialogOpen} name={snapshot.settings.displayName} onOpenChange={setNameDialogOpen} onSave={(displayName) => update((state) => ({ ...state, settings: { ...state.settings, displayName, updatedAt: new Date().toISOString() } }))} />
    <WallpaperSettingsDialog open={wallpaperSettingsOpen} wallpapers={snapshot.settings.homeWallpapers} onOpenChange={onWallpaperSettingsChange} onSave={(homeWallpapers) => update((state) => ({ ...state, settings: { ...state.settings, homeWallpaper: '', homeWallpapers, updatedAt: new Date().toISOString() } }))} />
    <QuickActionsDialog open={quickActionsDialogOpen} actions={allQuickActions} selectedIds={snapshot.settings.homeQuickActions} onOpenChange={setQuickActionsDialogOpen} onSave={(homeQuickActions) => update((state) => ({ ...state, settings: { ...state.settings, homeQuickActions, updatedAt: new Date().toISOString() } }))} />
  </section>
}

function QuickActionsDialog({ open, actions, selectedIds, onOpenChange, onSave }: { open: boolean; actions: Record<HomeQuickActionId, QuickAction>; selectedIds: HomeQuickActionId[]; onOpenChange: (open: boolean) => void; onSave: (ids: HomeQuickActionId[]) => void }) {
  const [draftOrder, setDraftOrder] = useState<HomeQuickActionId[]>([])
  const [visibleIds, setVisibleIds] = useState<Set<HomeQuickActionId>>(new Set(selectedIds))
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) return
    setDraftOrder([...selectedIds, ...homeQuickActionIds.filter((id) => !selectedIds.includes(id))])
    setVisibleIds(new Set(selectedIds))
    setError('')
  }, [open, selectedIds])

  const move = (index: number, direction: -1 | 1) => setDraftOrder((current) => {
    const target = index + direction
    if (target < 0 || target >= current.length) return current
    const next = [...current]
    ;[next[index], next[target]] = [next[target], next[index]]
    return next
  })
  const toggle = (id: HomeQuickActionId, checked: boolean) => {
    setVisibleIds((current) => {
      const next = new Set(current)
      if (checked && next.size < maxHomeQuickActions) next.add(id)
      else next.delete(id)
      return next
    })
    setError('')
  }
  const save = () => {
    const selected = draftOrder.filter((id) => visibleIds.has(id))
    if (!selected.length) { setError('请至少保留一张快捷卡片'); return }
    onSave(selected)
    onOpenChange(false)
  }

  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent size="md" className="quick-actions-dialog">
      <DialogHeader>
        <DialogTitle>自定义快捷卡片</DialogTitle>
        <DialogDescription>选择主页要显示的入口并调整顺序。已选 {visibleIds.size} / {maxHomeQuickActions} 张。</DialogDescription>
      </DialogHeader>
      <div className="quick-actions-editor">
        {draftOrder.map((id, index) => {
          const action = actions[id]
          const checked = visibleIds.has(id)
          return <div key={id} className={checked ? '' : 'disabled'}>
            <Checkbox id={`quick-action-${id}`} checked={checked} disabled={!checked && visibleIds.size >= maxHomeQuickActions} onCheckedChange={(value) => toggle(id, value === true)} />
            <label htmlFor={`quick-action-${id}`}><span>{action.icon}</span><span><strong>{action.label}</strong><small>{action.hint}</small></span></label>
            <div className="quick-action-order">
              <Button type="button" variant="ghost" size="icon-sm" disabled={index === 0} onClick={() => move(index, -1)} aria-label={`上移${action.label}`}><ArrowUp /></Button>
              <Button type="button" variant="ghost" size="icon-sm" disabled={index === draftOrder.length - 1} onClick={() => move(index, 1)} aria-label={`下移${action.label}`}><ArrowDown /></Button>
            </div>
          </div>
        })}
      </div>
      {error && <p className="quick-actions-error">{error}</p>}
      <DialogFooter className="quick-actions-footer">
        <Button type="button" variant="ghost" className="quick-actions-reset" onClick={() => { setDraftOrder([...homeQuickActionIds]); setVisibleIds(new Set(defaultHomeQuickActions)); setError('') }}><RotateCcw />恢复默认</Button>
        <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
        <Button type="button" onClick={save}>保存</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
}

function DisplayNameDialog({ open, name, onOpenChange, onSave }: { open: boolean; name: string; onOpenChange: (open: boolean) => void; onSave: (name: string) => void }) {
  const [draft, setDraft] = useState(name)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) return
    setDraft(name)
    setError('')
  }, [open, name])

  const save = () => {
    const displayName = draft.trim()
    if (!displayName) { setError('名字不能为空'); return }
    onSave(displayName)
    onOpenChange(false)
  }

  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent size="sm"><DialogHeader><DialogTitle>修改名字</DialogTitle><DialogDescription>这个名字会显示在主页的问候语中。</DialogDescription></DialogHeader><form onSubmit={(event) => { event.preventDefault(); save() }}><label className="display-name-field">名字<Input autoFocus value={draft} maxLength={32} onChange={(event) => setDraft(event.target.value)} placeholder="输入你的名字" /></label>{error && <p className="display-name-error">{error}</p>}<DialogFooter><Button type="button" variant="outline" onClick={() => onOpenChange(false)}>取消</Button><Button type="submit">保存</Button></DialogFooter></form></DialogContent></Dialog>
}

function WallpaperSettingsDialog({ open, wallpapers, onOpenChange, onSave }: { open: boolean; wallpapers: HomeWallpaper[]; onOpenChange: (open: boolean) => void; onSave: (wallpapers: HomeWallpaper[]) => void }) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [draft, setDraft] = useState<HomeWallpaper[]>(wallpapers)
  const [selectedId, setSelectedId] = useState<string | null>(wallpapers[0]?.id ?? null)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) return
    setDraft(wallpapers.map((wallpaper) => ({ ...wallpaper })))
    setSelectedId(wallpapers[0]?.id ?? null)
    setError('')
  }, [open, wallpapers])

  const selected = draft.find((wallpaper) => wallpaper.id === selectedId) ?? null
  const addWallpapers = async (files: FileList | null) => {
    setError('')
    if (!files?.length) return
    const remaining = 5 - draft.length
    if (remaining <= 0) { setError('最多只能设置 5 张壁纸'); return }
    const candidates = Array.from(files).slice(0, remaining)
    const invalid = candidates.find((file) => !file.type.startsWith('image/') || file.size > 12 * 1024 * 1024)
    if (invalid) { setError(!invalid.type.startsWith('image/') ? '请选择图片文件' : '每张壁纸请勿超过 12 MB'); return }
    try {
      const additions = await Promise.all(candidates.map(async (file) => ({
        id: crypto.randomUUID(),
        image: await readImage(file),
        title: defaultHomeWallpaper.title,
        description: defaultHomeWallpaper.description,
      })))
      setDraft((current) => [...current, ...additions].slice(0, 5))
      setSelectedId(additions[0]?.id ?? null)
      if (files.length > remaining) setError(`已添加前 ${remaining} 张，壁纸最多 5 张`)
    } catch { setError('无法读取选中的图片') }
  }
  const updateSelected = (changes: Partial<Pick<HomeWallpaper, 'title' | 'description'>>) => setDraft((current) => current.map((wallpaper) => wallpaper.id === selectedId ? { ...wallpaper, ...changes } : wallpaper))
  const removeWallpaper = (id: string) => setDraft((current) => {
    const next = current.filter((wallpaper) => wallpaper.id !== id)
    if (selectedId === id) setSelectedId(next[0]?.id ?? null)
    return next
  })

  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent size="lg" className="wallpaper-settings-dialog"><DialogHeader><DialogTitle>壁纸设置</DialogTitle><DialogDescription>添加最多 5 张壁纸并为每张图片设置独立文案。保存后会自动轮播；清空列表时使用默认壁纸。</DialogDescription></DialogHeader>
    <div className="wallpaper-settings-body">
      <div className="wallpaper-settings-list">
        <div className="wallpaper-settings-list-head"><strong>我的壁纸</strong><span>{draft.length} / 5</span></div>
        <input ref={inputRef} type="file" accept="image/*" multiple hidden onChange={(event) => { void addWallpapers(event.target.files); event.currentTarget.value = '' }} />
        <Button type="button" variant="outline" className="wallpaper-add" disabled={draft.length >= 5} onClick={() => inputRef.current?.click()}><ImagePlus size={16} />添加壁纸</Button>
        <div className="wallpaper-settings-items">{draft.map((wallpaper, index) => <div key={wallpaper.id} className={`wallpaper-settings-item ${wallpaper.id === selectedId ? 'active' : ''}`}>
          <button type="button" onClick={() => setSelectedId(wallpaper.id)}><span className="private-media" style={{ backgroundImage: `url(${JSON.stringify(wallpaper.image)})` }} /><strong>壁纸 {index + 1}</strong></button>
          <Button type="button" variant="ghost" size="icon-sm" aria-label={`删除壁纸 ${index + 1}`} onClick={() => removeWallpaper(wallpaper.id)}><Trash2 size={15} /></Button>
        </div>)}</div>
        {!draft.length && <div className="wallpaper-settings-empty"><ImagePlus size={24} /><span>还没有自定义壁纸</span><small>主页将继续显示默认壁纸</small></div>}
      </div>
      <div className="wallpaper-copy-editor">{selected ? <><div className="wallpaper-editor-preview"><span className="wallpaper-editor-preview-bg private-media" style={{ backgroundImage: `url(${JSON.stringify(selected.image)})` }} /><div><strong>{selected.title}</strong><span>{selected.description}</span></div></div><label>主文案<Input value={selected.title} maxLength={40} onChange={(event) => updateSelected({ title: event.target.value })} placeholder="输入主文案" /></label><label>副文案<Textarea value={selected.description} maxLength={80} rows={3} onChange={(event) => updateSelected({ description: event.target.value })} placeholder="输入副文案" /></label></> : <div className="wallpaper-editor-empty"><strong>添加一张壁纸开始设置</strong><span>选中壁纸后，可在这里编辑它的专属文案。</span></div>}</div>
    </div>
    {error && <p className="wallpaper-settings-error">{error}</p>}
    <DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>取消</Button><Button onClick={() => { onSave(draft.map((wallpaper) => ({ ...wallpaper, title: wallpaper.title.trim(), description: wallpaper.description.trim() }))); onOpenChange(false) }}>保存设置</Button></DialogFooter>
  </DialogContent></Dialog>
}

function readImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

function WeatherSummary() {
  const { snapshot, update } = useAppStore()
  const location = snapshot?.settings.weatherLocation
  const cached = snapshot?.settings.weatherCache
  const weather = location && cached && sameLocation(cached.location, location) ? cached : null
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [locationOpen, setLocationOpen] = useState(false)
  const [retryToken, setRetryToken] = useState(0)

  useEffect(() => {
    if (!location) return
    const controller = new AbortController()
    const timeout = window.setTimeout(() => controller.abort(), 12000)
    let disposed = false
    const loadCurrentWeather = async () => {
      setStatus('loading')
      try {
        const params = new URLSearchParams({ latitude: String(location.latitude), longitude: String(location.longitude), current: 'temperature_2m,apparent_temperature,weather_code', timezone: location.timezone || 'auto' })
        const response = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`, { signal: controller.signal })
        if (!response.ok) throw new Error('weather unavailable')
        const { current } = await response.json() as { current: { temperature_2m: number; apparent_temperature: number; weather_code: number } }
        if (disposed) return
        const next: WeatherSnapshot = { location, temperature: Math.round(current.temperature_2m), apparent: Math.round(current.apparent_temperature), code: current.weather_code, daily: [], fetchedAt: new Date().toISOString() }
        update((state) => sameLocation(state.settings.weatherLocation, location)
          ? { ...state, settings: { ...state.settings, weatherCache: next, updatedAt: next.fetchedAt } }
          : state)
        setStatus('ready')
      } catch {
        if (!disposed) setStatus('error')
      } finally {
        clearTimeout(timeout)
      }
    }
    void loadCurrentWeather()
    return () => { disposed = true; clearTimeout(timeout); controller.abort() }
  }, [location, retryToken, update])

  if (!snapshot || !location) return null
  const WeatherIcon = weather ? weatherIcon(weather.code) : CloudSun
  return <>
    <div className="home-weather">
      <button type="button" className="weather-summary" onClick={() => setLocationOpen(true)} title={`${location.name} · 选择天气地区`}>
        <WeatherIcon size={25} aria-hidden="true" />
        {weather ? <>
          <strong>{weather.temperature}°</strong>
          <span>{weatherText(weather.code)}</span>
          <span className="weather-apparent">体感 {weather.apparent}°</span>
        </> : <span>{status === 'loading' ? '正在读取天气…' : '天气暂不可用'}</span>}
      </button>
      {status === 'error' && <button type="button" className="weather-retry" onClick={() => setRetryToken((value) => value + 1)} aria-label={weather ? '当前显示上次天气，点击重试' : '重试获取天气'} title={weather ? '当前显示上次天气，点击重试' : '重试获取天气'}><RotateCcw size={15} /></button>}
    </div>
    <LocationDialog open={locationOpen} current={location} onOpenChange={setLocationOpen} onSelect={(next) => { update((state) => ({ ...state, settings: { ...state.settings, weatherLocation: next, updatedAt: new Date().toISOString() } })); setLocationOpen(false) }} />
  </>
}

function LocationDialog({ open, current, onOpenChange, onSelect }: { open: boolean; current: WeatherLocation; onOpenChange: (open: boolean) => void; onSelect: (location: WeatherLocation) => void }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<CitySearchResult[]>([])
  const [searching, setSearching] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => { if (!open) { setQuery(''); setResults([]); setError('') } }, [open])
  const searchCities = async () => {
    const clean = query.trim()
    if (clean.length < 2) { setError('请输入至少 2 个字符'); return }
    setSearching(true); setError('')
    const controller = new AbortController(); const timeout = window.setTimeout(() => controller.abort(), 10000)
    try {
      const params = new URLSearchParams({ name: clean, count: '8', language: 'zh', format: 'json' })
      const response = await fetch(`https://geocoding-api.open-meteo.com/v1/search?${params}`, { signal: controller.signal })
      if (!response.ok) throw new Error('search unavailable')
      const data = await response.json() as { results?: Array<{ id: number; name: string; latitude: number; longitude: number; country?: string; admin1?: string; timezone?: string }> }
      const next = (data.results ?? []).map((item) => ({ id: item.id, name: item.name, country: item.country ?? '', admin1: item.admin1 ?? '', latitude: item.latitude, longitude: item.longitude, timezone: item.timezone ?? 'auto' }))
      setResults(next)
      if (!next.length) setError('没有找到这个地区，请换个关键词试试')
    } catch { setError('地区搜索暂时不可用，请稍后重试') }
    finally { clearTimeout(timeout); setSearching(false) }
  }
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="weather-location-dialog" size="md"><DialogHeader><DialogTitle>选择天气地区</DialogTitle><DialogDescription>默认使用吉隆坡。搜索并选择城市后会保存在本机，不需要系统定位权限。</DialogDescription></DialogHeader><form className="weather-search" onSubmit={(event) => { event.preventDefault(); void searchCities() }}><label><Search size={16} /><Input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索城市，例如：北京、Tokyo" /></label><Button type="submit" disabled={searching}>{searching ? <Spinner /> : '搜索'}</Button></form>{error && <p className="weather-search-error">{error}</p>}<div className="weather-search-results">{results.length ? results.map((item) => <button key={`${item.id}-${item.latitude}`} onClick={() => onSelect(item)} className={sameLocation(item, current) ? 'active' : ''}><MapPin size={16} /><span><strong>{item.name}</strong><small>{[item.admin1, item.country].filter(Boolean).join(' · ') || '地区信息未知'}</small></span>{sameLocation(item, current) && <em>当前</em>}<ChevronRight size={15} /></button>) : !error && <div className="weather-search-empty"><CloudSun size={28} /><span>输入城市名称，选择你想关注的天气</span></div>}</div><p className="weather-provider">天气与地区数据由 Open-Meteo 提供</p></DialogContent></Dialog>
}

function sameLocation(a: WeatherLocation, b: WeatherLocation) { return a.latitude === b.latitude && a.longitude === b.longitude }

function OverviewStat({ icon, label, value }: { icon: ReactNode; label: string; value: number | string }) {
  return <div><dt><span className="home-row-icon">{icon}</span>{label}</dt><dd>{value}</dd></div>
}
function formatRelativeTime(value?: string) { if (!value) return '还没有使用记录'; const minutes = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 60_000)); if (minutes < 1) return '刚刚使用'; if (minutes < 60) return `上次使用 ${minutes} 分钟前`; if (minutes < 1440) return `上次使用 ${Math.floor(minutes / 60)} 小时前`; return `上次使用 ${Math.floor(minutes / 1440)} 天前` }
function formatFocusTime(minutes: number) { return minutes >= 60 ? `${(minutes / 60).toFixed(minutes % 60 ? 1 : 0)} 小时` : `${minutes} 分钟` }
function weatherText(code = -1) { if (code === 0) return '晴朗'; if (code <= 3) return '多云'; if (code === 45 || code === 48) return '有雾'; if (code >= 71 && code <= 86) return '有雪'; if (code >= 51 && code <= 82) return '有雨'; if (code >= 95) return '雷雨'; return '天气未知' }
function weatherIcon(code = -1) { if (code === 0) return Sun; if (code <= 3) return CloudSun; if (code >= 71 && code <= 86) return Snowflake; if (code >= 95) return CloudLightning; if (code >= 51 && code <= 82) return CloudRain; return Cloud }
