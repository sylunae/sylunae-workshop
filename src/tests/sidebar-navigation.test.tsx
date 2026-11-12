// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
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
  expect(screen.queryByRole('link', { name: child })).toBeNull()

  fireEvent.click(parent)
  expect(parent.getAttribute('aria-expanded')).toBe('true')
  expect(actions.onSelect).not.toHaveBeenCalled()
  expect(actions[action]).not.toHaveBeenCalled()
  expect(actions.onClose).not.toHaveBeenCalled()

  const item = screen.getByRole('link', { name: child })
  const routeGroup = group === '任务箱' ? 'tasks' : group === '收藏馆' ? 'collection' : 'music'
  expect(item.getAttribute('href')).toBe(`#/${routeGroup}/${view}`)
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
  expect(screen.queryByRole('button', { name: '下载 Android APK' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '任务箱' }))
  expect(actions.onSelect).toHaveBeenCalledWith('tasks')
})

it('Android App 内不显示 APK 下载入口', () => {
  vi.stubGlobal('sylunae', {})
  renderSidebar(true)

  expect(screen.queryByRole('button', { name: '下载 Android APK' })).toBeNull()
})

it('移动端跳过 Windows 和预发行版本并下载正式 APK', async () => {
  const apkUrl = 'https://github.com/sylunae/sylunae-workshop/releases/download/android-v0.1.6/Sylunae-Workshop-0.1.6-Android.apk'
  const open = vi.fn()
  vi.stubGlobal('open', open)
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json([
    { prerelease: false, assets: [{ name: 'Sylunae-Workshop-0.1.7-Setup.exe' }] },
    { prerelease: true, assets: [{ name: 'Sylunae-Workshop-0.1.7-beta-Android.apk' }] },
    { prerelease: false, assets: [{ name: 'Sylunae-Workshop-0.1.6-Android.apk', browser_download_url: apkUrl }] },
  ])))
  renderSidebar(true)

  fireEvent.click(screen.getByRole('button', { name: '下载 Android APK' }))

  await waitFor(() => expect(open).toHaveBeenCalledWith(apkUrl, '_self', 'noopener,noreferrer'))
})

it('移动端无法获取 APK 时打开 GitHub 发布列表', async () => {
  const open = vi.fn()
  vi.stubGlobal('open', open)
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 403 })))
  renderSidebar(true)

  fireEvent.click(screen.getByRole('button', { name: '下载 Android APK' }))

  await waitFor(() => expect(open).toHaveBeenCalledWith('https://github.com/sylunae/sylunae-workshop/releases', '_self', 'noopener,noreferrer'))
})
