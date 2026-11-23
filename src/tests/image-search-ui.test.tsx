// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ImageSearchTool } from '../components/ImageSearchTool'
import type { SylunaeAPI } from '../shared/types'
import type { ImageSearchOutput } from '../shared/imageSearch'

afterEach(() => { cleanup(); delete window.sylunae; document.documentElement.classList.remove('dark') })
function desktop() {
  const output: ImageSearchOutput = { checked: 3, failed: 1, skippedFolders: 0, discovered: 4, current: '', phase: 'previews', matches: 1, cancelled: false, results: [{ path: 'C:/photos/match.png', name: 'match.png', score: 95.2, preview: 'data:image/png;base64,AA==' }] }
  const api = {
    pickReference: vi.fn(async () => ({ name: 'reference.png', preview: 'data:image/png;base64,AA==' })),
    pickFolder: vi.fn(async () => 'C:/photos'),
    search: vi.fn(async () => output), cancel: vi.fn(async () => {}), openResult: vi.fn(async () => {}),
  }
  window.sylunae = { platform: 'electron', imageSearch: api } as unknown as SylunaeAPI
  return { api, output }
}
async function selectSources() {
  fireEvent.click(screen.getByRole('button', { name: '选择图片' }))
  await screen.findByText('reference.png')
  fireEvent.click(screen.getByRole('button', { name: '选择文件夹' }))
  await screen.findByText('C:/photos')
}

it.each(['light', 'dark'])('searches from the toolbox using shared controls in the %s theme', async (theme) => {
  if (theme === 'dark') document.documentElement.classList.add('dark')
  const { api } = desktop()
  render(<ImageSearchTool />)
  expect((screen.getByRole('button', { name: '开始查找' }) as HTMLButtonElement).disabled).toBe(true)
  await selectSources()
  fireEvent.click(screen.getByRole('checkbox', { name: '遍历所有嵌套子文件夹' }))
  fireEvent.click(screen.getByRole('button', { name: '开始查找' }))
  await screen.findByText('查找完成')
  expect(api.search).toHaveBeenCalledWith({ recursive: true, minScore: 80 }, expect.any(Function))
  expect(screen.getByText('相似度 95.2 分')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '在文件夹中显示' }))
  expect(api.openResult).toHaveBeenCalledWith('C:/photos/match.png', true)
  fireEvent.click(screen.getByRole('button', { name: '预览 match.png' }))
  fireEvent.click(await screen.findByRole('button', { name: '打开原图' }))
  expect(api.openResult).toHaveBeenCalledWith('C:/photos/match.png', false)
})
it('locks options while searching, forwards cancellation, and preserves partial results', async () => {
  const { api, output } = desktop()
  let complete!: (value: ImageSearchOutput) => void
  api.search.mockImplementation(() => new Promise((resolve) => { complete = resolve }))
  render(<ImageSearchTool />)
  await selectSources()
  fireEvent.click(screen.getByRole('button', { name: '开始查找' }))
  await screen.findByRole('button', { name: '停止查找' })
  expect((screen.getByRole('checkbox') as HTMLButtonElement).disabled).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: '停止查找' }))
  await waitFor(() => expect(api.cancel).toHaveBeenCalledTimes(1))
  complete({ ...output, cancelled: true })
  await screen.findByText('已停止 · 保留已找到的结果')
  expect(screen.getByRole('button', { name: '预览 match.png' })).toBeTruthy()
})
it('retains the selected folder and results if a picker is cancelled', async () => {
  const { api } = desktop()
  render(<ImageSearchTool />)
  await selectSources()
  fireEvent.click(screen.getByRole('button', { name: '开始查找' }))
  await screen.findByText('查找完成')
  api.pickFolder.mockResolvedValueOnce(null as unknown as string)
  fireEvent.click(screen.getByRole('button', { name: '选择文件夹' }))
  await waitFor(() => expect(api.pickFolder).toHaveBeenCalledTimes(2))
  expect(screen.getByText('C:/photos')).toBeTruthy()
  expect(screen.getByText('查找完成')).toBeTruthy()
})
it('cancels an active desktop scan when leaving the tool', async () => {
  const { api } = desktop()
  api.search.mockImplementation(() => new Promise(() => {}))
  const view = render(<ImageSearchTool />)
  await selectSources()
  fireEvent.click(screen.getByRole('button', { name: '开始查找' }))
  await screen.findByRole('button', { name: '停止查找' })
  view.unmount()
  expect(api.cancel).toHaveBeenCalledTimes(1)
})
