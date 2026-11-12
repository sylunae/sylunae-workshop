// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { useWorkspaceNavigation } from '../app/useWorkspaceNavigation'
import { storageKey } from '../lib/storageEnvironment'

afterEach(() => {
  cleanup()
  window.history.replaceState(null, '', '/')
  window.sessionStorage.clear()
  window.localStorage.clear()
})

it('opens a direct link ahead of saved navigation and retains it after reload', () => {
  sessionStorage.setItem(storageKey('navigation.activeTool'), JSON.stringify('music'))
  localStorage.setItem(storageKey('navigation.tasksView'), JSON.stringify('goals'))
  window.history.replaceState(null, '', '/#/tasks/todos')

  const first = renderHook(useWorkspaceNavigation)
  expect(first.result.current).toMatchObject({ activeTool: 'tasks', taskView: 'todos' })
  first.unmount()
  sessionStorage.clear()
  localStorage.clear()
  const reopened = renderHook(useWorkspaceNavigation)
  expect(reopened.result.current).toMatchObject({ activeTool: 'tasks', taskView: 'todos' })
})

it('restores legacy navigation without a fragment and supports browser back and forward', async () => {
  sessionStorage.setItem(storageKey('navigation.activeTool'), JSON.stringify('music'))
  localStorage.setItem(storageKey('navigation.musicView'), JSON.stringify('albums'))
  const { result } = renderHook(useWorkspaceNavigation)
  expect(window.location.hash).toBe('#/music/albums')

  act(() => result.current.navigate('tools', 'clipboard'))
  expect(window.location.hash).toBe('#/tools/clipboard')
  expect(result.current).toMatchObject({ activeTool: 'tools', utilityView: 'clipboard' })

  window.history.back()
  await waitFor(() => expect(result.current).toMatchObject({ activeTool: 'music', musicView: 'albums' }))
  window.history.forward()
  await waitFor(() => expect(result.current).toMatchObject({ activeTool: 'tools', utilityView: 'clipboard' }))
})
