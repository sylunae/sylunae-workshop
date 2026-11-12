import { useCallback, useLayoutEffect, useState } from 'react'
import { usePersistentState, useSessionState } from '../lib/usePersistentState'
import type { ToolId } from '../shared/types'
import { readWorkspaceRoute, workspaceHref, type Workspace, type WorkspaceView } from './workspaceRoutes'

export function useWorkspaceNavigation() {
  const [storedTool, setStoredTool] = useSessionState<ToolId>('navigation.activeTool', 'home')
  const [storedTask, setStoredTask] = usePersistentState<WorkspaceView<'tasks'>>('navigation.tasksView', 'goals')
  const [storedCollection, setStoredCollection] = usePersistentState<WorkspaceView<'collection'>>('navigation.collectionView', 'bangumi')
  const [storedMusic, setStoredMusic] = usePersistentState<Exclude<WorkspaceView<'music'>, 'white-noise'>>('navigation.musicView', 'tracks')
  const [storedSection, setStoredSection] = usePersistentState<'library' | 'white-noise'>('navigation.musicSection', 'library')
  const [storedUtility, setStoredUtility] = usePersistentState<WorkspaceView<'tools'>>('navigation.toolsView', 'home')
  const [route, setRoute] = useState(() => readWorkspaceRoute(window.location.hash))

  const activeTool = route?.tool ?? storedTool
  const taskView = route?.tool === 'tasks' ? route.view : storedTask
  const collectionView = route?.tool === 'collection' ? route.view : storedCollection
  const musicRoute = route?.tool === 'music' ? route.view : undefined
  const musicSection = musicRoute ? musicRoute === 'white-noise' ? 'white-noise' : 'library' : storedSection
  const musicView = musicRoute && musicRoute !== 'white-noise' ? musicRoute : storedMusic
  const utilityView = route?.tool === 'tools' ? route.view : storedUtility

  useLayoutEffect(() => {
    const onLocationChange = () => {
      setRoute(readWorkspaceRoute(window.location.hash) ?? readWorkspaceRoute('#/'))
    }
    window.addEventListener('popstate', onLocationChange)
    window.addEventListener('hashchange', onLocationChange)
    return () => {
      window.removeEventListener('popstate', onLocationChange)
      window.removeEventListener('hashchange', onLocationChange)
    }
  }, [])

  const currentHref = {
    home: workspaceHref('home', 'home'),
    settings: workspaceHref('home', 'home'),
    notes: workspaceHref('notes', 'home'),
    tasks: workspaceHref('tasks', taskView),
    collection: workspaceHref('collection', collectionView),
    music: workspaceHref('music', musicSection === 'white-noise' ? musicSection : musicView),
    tools: workspaceHref('tools', utilityView),
  }[activeTool] ?? workspaceHref('home', 'home')

  useLayoutEffect(() => {
    const current = readWorkspaceRoute(currentHref)
    if (!current) return
    if (readWorkspaceRoute(window.location.hash) !== current) {
      window.history.replaceState(window.history.state, '', currentHref)
    }
    if (route !== current) setRoute(current)
  }, [currentHref, route])

  useLayoutEffect(() => {
    if (!route) return
    if (route.tool !== storedTool) setStoredTool(route.tool)
    if (route.tool === 'tasks' && route.view !== storedTask) setStoredTask(route.view)
    if (route.tool === 'collection' && route.view !== storedCollection) setStoredCollection(route.view)
    if (route.tool === 'tools' && route.view !== storedUtility) setStoredUtility(route.view)
    if (route.tool === 'music') {
      const section = route.view === 'white-noise' ? 'white-noise' : 'library'
      if (section !== storedSection) setStoredSection(section)
      if (route.view !== 'white-noise' && route.view !== storedMusic) setStoredMusic(route.view)
    }
  }, [route, storedTool, storedTask, storedCollection, storedUtility, storedSection, storedMusic,
    setStoredTool, setStoredTask, setStoredCollection, setStoredUtility, setStoredSection, setStoredMusic])

  const navigate = useCallback(<T extends Workspace>(tool: T, view: WorkspaceView<T>) => {
    const href = workspaceHref(tool, view)
    const next = readWorkspaceRoute(href)
    if (next && readWorkspaceRoute(window.location.hash) !== next) {
      window.history.pushState(null, '', href)
      setRoute(next)
    }
  }, [])

  return { activeTool, taskView, collectionView, musicSection, musicView, utilityView, navigate }
}
