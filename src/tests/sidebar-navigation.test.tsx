// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { Sidebar } from '../components/Sidebar'

function renderSidebar(isMobile: boolean) {
  vi.stubGlobal('matchMedia', () => ({
    matches: isMobile,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }))
  const actions = {
    onSelect: vi.fn(),
    onSelectTaskView: vi.fn(),
    onSelectCollectionView: vi.fn(),
    onSelectMusicSection: vi.fn(),
    onSelectMusicView: vi.fn(),
    onOpenSettings: vi.fn(),
    onOpenFunFeatures: vi.fn(),
    onResize: vi.fn(),
    onOpen: vi.fn(),
    onClose: vi.fn(),
  }
  render(<Sidebar
    active="home" taskView="todos" collectionView="bangumi" musicSection="library" musicView="tracks"
    collapsed={isMobile} width={240} mobileOpen={isMobile} settingsOpen={false} funFeaturesOpen={false}
    nowPlaying={null} nowPlayingAmbient={null} {...actions}
  />)
  return actions
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

it.each([
  ['任务箱', '快速待办', 'onSelectTaskView', 'todos'],
  ['收藏馆', '精选图片', 'onSelectCollectionView', 'images'],
  ['音乐库', '专辑', 'onSelectMusicView', 'albums'],
  ['音乐库', '白噪音', 'onSelectMusicSection', 'white-noise'],
] as const)('在移动端展开 %s 后，点击 %s 才导航并关闭侧栏', (group, child, action, view) => {
  const actions = renderSidebar(true)
  const parent = screen.getByRole('button', { name: group })
  expect(screen.queryByRole('button', { name: child })).toBeNull()

  fireEvent.click(parent)
  expect(parent.getAttribute('aria-expanded')).toBe('true')
  expect(actions.onSelect).not.toHaveBeenCalled()
  expect(actions[action]).not.toHaveBeenCalled()
  expect(actions.onClose).not.toHaveBeenCalled()

  const item = screen.getByRole('button', { name: child })
  expect(item.classList.contains('active')).toBe(false)
  fireEvent.click(item)
  expect(actions[action]).toHaveBeenCalledWith(view)
  expect(actions.onClose).toHaveBeenCalledOnce()
})

it('移动端可切换或收起分组，单级选项仍直接导航', () => {
  const actions = renderSidebar(true)
  const tasks = screen.getByRole('button', { name: '任务箱' })
  const collection = screen.getByRole('button', { name: '收藏馆' })
  fireEvent.click(tasks)
  fireEvent.click(collection)
  expect(tasks.getAttribute('aria-expanded')).toBe('false')
  expect(collection.getAttribute('aria-expanded')).toBe('true')
  fireEvent.click(collection)
  expect(collection.getAttribute('aria-expanded')).toBe('false')
  expect(actions.onSelect).not.toHaveBeenCalled()

  fireEvent.click(screen.getByRole('button', { name: '笔记本' }))
  expect(actions.onSelect).toHaveBeenCalledWith('notes')
  expect(actions.onClose).toHaveBeenCalledOnce()
})

it('桌面端点击分组仍直接导航', () => {
  const actions = renderSidebar(false)
  fireEvent.click(screen.getByRole('button', { name: '任务箱' }))
  expect(actions.onSelect).toHaveBeenCalledWith('tasks')
})
