import { lazy, Suspense, useEffect, useLayoutEffect, useState, type CSSProperties } from 'react'
import { Clock3 } from 'lucide-react'
import { BirthdayNotifications } from './components/BirthdayNotifications'
import { Sidebar } from './components/Sidebar'
import { FunFeaturesDialog } from './components/FunFeaturesDialog'
import { DeskCompanion } from './components/DeskCompanion'
import { DesktopUpdate } from './components/DesktopUpdate'
import { Spinner } from './components/Icons'
import { useAppStore } from './app/AppStore'
import type { MusicTrack, PomodoroMode, ResourceItem, ToolId, WorkspaceToolId } from './shared/types'
import { accessibleForeground, themeColorFields, themeCssVariables, themeDerivedCssVariables } from './shared/theme'
import { TooltipProvider } from './components/ui/tooltip'
import { playPomodoroAlarm, unlockPomodoroAlarm } from './utils/pomodoroAlarm'
import { usePersistentState, useSessionState } from './lib/usePersistentState'
import { isAndroid, isElectron } from './platform/environment'
import { App as CapacitorApp } from '@capacitor/app'
import { syncAndroidPomodoro } from './platform/reminders'

const MusicPage = lazy(() => import('./pages/MusicPage').then((module) => ({ default: module.MusicPage })))
const WhiteNoisePage = lazy(() => import('./pages/WhiteNoisePage').then((module) => ({ default: module.WhiteNoisePage })))
const NotesPage = lazy(() => import('./pages/NotesPage').then((module) => ({ default: module.NotesPage })))
const TasksPage = lazy(() => import('./pages/TasksPage').then((module) => ({ default: module.TasksPage })))
const CollectionPage = lazy(() => import('./pages/CollectionPage').then((module) => ({ default: module.CollectionPage })))
const ToolsPage = lazy(() => import('./pages/ToolsPage').then((module) => ({ default: module.ToolsPage })))
const HomePage = lazy(() => import('./pages/HomePage').then((module) => ({ default: module.HomePage })))
const SettingsDialog = lazy(() => import('./components/SettingsDialog').then((module) => ({ default: module.SettingsDialog })))

const collapsedSidebarWidth = 70
const minimumSidebarWidth = 220
const maximumSidebarWidth = 480
const sidebarCollapseThreshold = 180
const pomodoroModeLabels: Record<PomodoroMode, string> = { focus: '专注', shortBreak: '短休息', longBreak: '长休息' }

function pomodoroDuration(timer: { mode: PomodoroMode; focusMinutes: number; shortBreakMinutes: number; longBreakMinutes: number }) {
  return (timer.mode === 'focus' ? timer.focusMinutes : timer.mode === 'shortBreak' ? timer.shortBreakMinutes : timer.longBreakMinutes) * 60
}

export default function App() {
  const { snapshot, loading, saving, error, update } = useAppStore()
  const [mobileOpen, setMobileOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settingsMounted, setSettingsMounted] = useState(false)
  const [funFeaturesOpen, setFunFeaturesOpen] = useState(false)
  const [musicMounted, setMusicMounted] = useState(isAndroid)
  const [nowPlaying, setNowPlaying] = useState<MusicTrack | null>(null)
  const [nowPlayingAmbient, setNowPlayingAmbient] = useState<ResourceItem | null>(null)
  const [pageScrolled, setPageScrolled] = useState(false)
  // Reloads stay on the current page, while closing the desktop window clears
  // sessionStorage so the next app launch begins on the home page.
  const [activeTool, setActiveTool] = useSessionState<ToolId>('navigation.activeTool', 'home')
  const [musicSection, setMusicSection] = usePersistentState<'library' | 'white-noise'>('navigation.musicSection', 'library')
  const [taskView, setTaskView] = usePersistentState<'goals' | 'todos' | 'pomodoro' | 'countdown'>('navigation.tasksView', 'goals')
  const [collectionView, setCollectionView] = usePersistentState<'bangumi' | 'images' | 'rss'>('navigation.collectionView', 'bangumi')
  const [musicView, setMusicView] = usePersistentState<'tracks' | 'albums'>('navigation.musicView', 'tracks')
  const [homeIntent, setHomeIntent] = useState<'new-note' | 'todos' | 'pomodoro' | 'clipboard' | null>(null)

  useEffect(() => {
    if (!isAndroid) return
    const listener = CapacitorApp.addListener('backButton', () => {
      if (document.querySelector('[role="dialog"][data-state="open"]')) {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }))
      } else if (settingsOpen) setSettingsOpen(false)
      else if (mobileOpen) setMobileOpen(false)
      else if (activeTool !== 'home') setActiveTool('home')
      else void CapacitorApp.minimizeApp()
    })
    return () => { void listener.then((handle) => handle.remove()) }
  }, [activeTool, mobileOpen, settingsOpen, setActiveTool])

  useLayoutEffect(() => {
    if (!snapshot) return
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = () => {
      const effective = snapshot.settings.theme === 'system' ? (media.matches ? 'dark' : 'light') : snapshot.settings.theme
      document.documentElement.dataset.theme = effective
      document.documentElement.classList.toggle('dark', effective === 'dark')
      const palette = snapshot.settings.themePalettes[effective]
      themeColorFields.forEach(({ key }) => document.documentElement.style.setProperty(themeCssVariables[key], palette[key]))
      const primaryForeground = accessibleForeground(palette.brand, palette.accentDeep)
      const destructiveForeground = accessibleForeground(palette.danger)
      document.documentElement.style.setProperty(themeDerivedCssVariables.primaryForeground, primaryForeground)
      document.documentElement.style.setProperty(themeDerivedCssVariables.destructiveForeground, destructiveForeground)
      document.documentElement.style.setProperty(themeDerivedCssVariables.sidebarPrimaryForeground, primaryForeground)
      document.documentElement.style.colorScheme = effective
      document.querySelector('meta[name="theme-color"]')?.setAttribute('content', palette.bg)
      void window.sylunae?.system.setTheme?.(effective, palette.bg).catch(() => {})
      try {
        const palettes = Object.fromEntries((['light', 'dark'] as const).map((mode) => [mode,
          Object.fromEntries(themeColorFields.map(({ key }) => [themeCssVariables[key], snapshot.settings.themePalettes[mode][key]])),
        ]))
        localStorage.setItem('sylunae:startup-theme', JSON.stringify({ mode: snapshot.settings.theme, palettes }))
      } catch { /* Theme changes still work when browser storage is unavailable. */ }

    }
    apply()
    media.addEventListener('change', apply)
    return () => media.removeEventListener('change', apply)
  }, [snapshot?.settings.theme, snapshot?.settings.themePalettes])

  useEffect(() => {
    if (!loading) window.sylunae?.system.themeReady()
  }, [loading])

  useEffect(() => {
    if (!snapshot) return
    document.documentElement.dataset.privateMode = snapshot.settings.privateMode ? 'on' : 'off'
    return () => { delete document.documentElement.dataset.privateMode }
  }, [snapshot?.settings.privateMode])

  useEffect(() => {
    if (snapshot?.settings.lastTool !== 'settings') return
    setSettingsMounted(true)
    setSettingsOpen(true)
    update((state) => ({ ...state, settings: { ...state.settings, lastTool: 'home', updatedAt: new Date().toISOString() } }))
  }, [snapshot?.settings.lastTool, update])

  useEffect(() => {
    if (activeTool === 'music') setMusicMounted(true)
  }, [activeTool])

  useEffect(() => {
    if (isAndroid && snapshot) void syncAndroidPomodoro(snapshot.pomodoro).catch(() => {})
  }, [snapshot?.pomodoro.running, snapshot?.pomodoro.endsAt, snapshot?.pomodoro.mode])

  useEffect(() => setPageScrolled(false), [activeTool, musicSection])

  useEffect(() => {
    if (!snapshot?.pomodoro.running || !snapshot.pomodoro.endsAt) return
    const tick = () => {
      const remaining = Math.max(0, Math.ceil((new Date(snapshot.pomodoro.endsAt!).getTime() - Date.now()) / 1000))
      if (remaining > 0) {
        update((state) => state.pomodoro.secondsRemaining === remaining ? state : { ...state, pomodoro: { ...state.pomodoro, secondsRemaining: remaining } })
        return
      }
      update((state) => {
        const finishedFocus = state.pomodoro.mode === 'focus'
        const completedSessions = state.pomodoro.completedSessions + (finishedFocus ? 1 : 0)
        const nextMode: PomodoroMode = finishedFocus ? (completedSessions % state.pomodoro.sessionsBeforeLongBreak === 0 ? 'longBreak' : 'shortBreak') : 'focus'
        const minutes = nextMode === 'focus' ? state.pomodoro.focusMinutes : nextMode === 'shortBreak' ? state.pomodoro.shortBreakMinutes : state.pomodoro.longBreakMinutes
        return { ...state, pomodoro: { ...state.pomodoro, mode: nextMode, completedSessions, secondsRemaining: minutes * 60, running: false, endsAt: null } }
      })
      const focusCompleted = snapshot.pomodoro.mode === 'focus'
      playPomodoroAlarm(snapshot.settings.pomodoroAlarmPath)
      if (window.sylunae && !isAndroid) void window.sylunae.system.notifyPomodoroComplete(focusCompleted)
      else if (!isAndroid && 'Notification' in window && Notification.permission === 'granted') new Notification('丝月工坊', { body: focusCompleted ? '本轮专注完成，休息一下吧。' : '休息结束，准备开始下一轮专注。' })
    }
    tick()
    const id = window.setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [snapshot?.pomodoro.running, snapshot?.pomodoro.endsAt, snapshot?.pomodoro.mode, update])

  if (loading || !snapshot) return <div className="app-loading"><Spinner /><span>正在打开丝月工坊…</span></div>

  const selectTool = (tool: ToolId) => {
    setHomeIntent(null)
    if (tool === 'music') setMusicSection('library')
    setActiveTool(tool)
    update((state) => {
      const recentTools = tool !== 'home' && tool !== 'settings' ? [tool as WorkspaceToolId, ...state.settings.recentTools.filter((item) => item !== tool)].slice(0, 5) : state.settings.recentTools
      const toolUsage = tool !== 'home' && tool !== 'settings' ? { ...state.settings.toolUsage, [tool]: new Date().toISOString() } : state.settings.toolUsage
      return { ...state, settings: { ...state.settings, lastTool: tool, recentTools, toolUsage, updatedAt: new Date().toISOString() } }
    })
  }
  const openFromHome = (tool: ToolId, intent?: 'new-note' | 'todos' | 'pomodoro' | 'clipboard') => {
    if (intent === 'pomodoro') unlockPomodoroAlarm()
    setHomeIntent(intent ?? null)
    setActiveTool(tool)
    update((state) => {
      if (tool === 'home' || tool === 'settings') return state
      const recentTools = [tool as WorkspaceToolId, ...state.settings.recentTools.filter((item) => item !== tool)].slice(0, 5)
      return { ...state, settings: { ...state.settings, lastTool: tool, recentTools, toolUsage: { ...state.settings.toolUsage, [tool]: new Date().toISOString() }, updatedAt: new Date().toISOString() } }
    })
  }
  const openPomodoro = () => openFromHome('tasks', 'pomodoro')
  const selectMusicSection = (section: 'library' | 'white-noise') => {
    selectTool('music')
    setMusicSection(section)
  }
  const selectTaskView = (view: 'goals' | 'todos' | 'pomodoro' | 'countdown') => {
    setHomeIntent(null)
    setTaskView(view)
    selectTool('tasks')
  }
  const selectCollectionView = (view: 'bangumi' | 'images' | 'rss') => {
    setCollectionView(view)
    selectTool('collection')
  }
  const selectMusicView = (view: 'tracks' | 'albums') => {
    setMusicView(view)
    selectMusicSection('library')
  }
  const setSidebarCollapsed = (collapsed: boolean) => update((state) => {
    if (state.settings.sidebarCollapsed === collapsed) return state
    return { ...state, settings: { ...state.settings, sidebarCollapsed: collapsed, updatedAt: new Date().toISOString() } }
  })
  const resizeSidebar = (nextWidth: number) => {
    const collapsed = nextWidth <= sidebarCollapseThreshold
    const width = collapsed ? undefined : Math.min(maximumSidebarWidth, Math.max(minimumSidebarWidth, nextWidth))
    update((state) => {
      if (state.settings.sidebarCollapsed === collapsed && (width === undefined || state.settings.sidebarWidth === width)) return state
      return {
        ...state,
        settings: {
          ...state.settings,
          sidebarCollapsed: collapsed,
          ...(width === undefined ? {} : { sidebarWidth: width }),
          updatedAt: new Date().toISOString(),
        },
      }
    })
  }
  const openSettings = () => { setSettingsMounted(true); setSettingsOpen(true) }
  const openFunFeatures = () => setFunFeaturesOpen(true)
  const page = {
    home: <HomePage onOpenTool={openFromHome} />,
    tasks: <TasksPage view={taskView} onViewChange={setTaskView} initialView={homeIntent === 'todos' ? 'todos' : homeIntent === 'pomodoro' ? 'pomodoro' : 'goals'} startPomodoro={homeIntent === 'pomodoro'} />,
    collection: <CollectionPage view={collectionView} onViewChange={setCollectionView} />,
    tools: <ToolsPage initialView={homeIntent === 'clipboard' ? 'clipboard' : 'home'} />,
    music: null,
    notes: <NotesPage createOnOpen={homeIntent === 'new-note'} />,
  }[activeTool === 'settings' ? 'home' : activeTool]

  const renderedSidebarWidth = snapshot.settings.sidebarCollapsed ? collapsedSidebarWidth : snapshot.settings.sidebarWidth
  const pomodoroTotal = Math.max(1, pomodoroDuration(snapshot.pomodoro))
  const pomodoroProgress = Math.min(100, Math.max(0, ((pomodoroTotal - snapshot.pomodoro.secondsRemaining) / pomodoroTotal) * 100))
  const pomodoroTime = `${String(Math.floor(snapshot.pomodoro.secondsRemaining / 60)).padStart(2, '0')}:${String(snapshot.pomodoro.secondsRemaining % 60).padStart(2, '0')}`

  return <BirthdayNotifications><TooltipProvider><div className="app-shell" style={{ '--sidebar-width': `${renderedSidebarWidth}px` } as CSSProperties}>
    <Sidebar active={activeTool} taskView={taskView} collectionView={collectionView} musicSection={musicSection} musicView={musicView} collapsed={snapshot.settings.sidebarCollapsed} width={renderedSidebarWidth} mobileOpen={mobileOpen} settingsOpen={settingsOpen} funFeaturesOpen={funFeaturesOpen} nowPlaying={nowPlaying} nowPlayingAmbient={nowPlayingAmbient} onSelect={selectTool} onSelectTaskView={selectTaskView} onSelectCollectionView={selectCollectionView} onSelectMusicSection={selectMusicSection} onSelectMusicView={selectMusicView} onOpenSettings={openSettings} onOpenFunFeatures={openFunFeatures} onResize={resizeSidebar} onOpen={() => setMobileOpen(true)} onClose={() => setMobileOpen(false)} />
    {isElectron() && <div className={`app-titlebar ${pageScrolled ? 'scrolled' : ''} ${snapshot.pomodoro.running ? 'pomodoro-running' : ''}`}>
      <div className="app-titlebar-drag" />
      <DesktopUpdate titlebar />
      {snapshot.pomodoro.running && <button type="button" className="pomodoro-titlebar" onClick={openPomodoro} aria-label={`打开番茄钟：${pomodoroModeLabels[snapshot.pomodoro.mode]}中，剩余 ${pomodoroTime}`}>
        <Clock3 size={14} strokeWidth={1.8} /><span>{pomodoroModeLabels[snapshot.pomodoro.mode]}中</span><strong>{pomodoroTime}</strong>
      </button>}
      {snapshot.pomodoro.running && <i className="pomodoro-titlebar-progress" style={{ '--pomodoro-progress': `${pomodoroProgress}%` } as CSSProperties} aria-hidden="true" />}
    </div>}
    <main className="content-shell" onScrollCapture={(event) => {
      const target = event.target
      if (target instanceof HTMLElement) setPageScrolled((current) => {
        const next = target.scrollTop > 0
        return current === next ? current : next
      })
    }}>
      <Suspense fallback={<div className="app-loading"><Spinner /></div>}>
        {page}
        {(musicMounted || activeTool === 'music') && <div className="persistent-page" hidden={activeTool !== 'music'}>
          <div className="persistent-page" hidden={musicSection !== 'library'}><MusicPage view={musicView} onViewChange={setMusicView} onNowPlayingChange={setNowPlaying} onOpenWhiteNoise={() => setMusicSection('white-noise')} /></div>
          <div className="persistent-page" hidden={musicSection !== 'white-noise'}><WhiteNoisePage onNowPlayingChange={setNowPlayingAmbient} /></div>
        </div>}
      </Suspense>
      <div className={`save-indicator ${error ? 'error' : ''}`}>{error || (saving ? '正在保存…' : '')}</div>
    </main>
    <Suspense fallback={null}>{settingsMounted && <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />}</Suspense>
    <DeskCompanion settings={snapshot.settings.deskCompanion} />
    <FunFeaturesDialog open={funFeaturesOpen} onOpenChange={setFunFeaturesOpen} />
  </div></TooltipProvider></BirthdayNotifications>
}
