// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { FormatConverter } from '../components/FormatConverter'
import type { SylunaeAPI } from '../shared/types'
import type { FormatConversionAPI } from '../shared/conversion'

vi.mock('../components/MediaToolsDialog', () => ({ MediaToolsDialog: () => null }))
const mockAPI = (): FormatConversionAPI => ({
  capabilities: vi.fn(async () => ({ ffmpeg: true, office: false, image: ['png', 'jpg', 'webp'] })),
  inspect: vi.fn<FormatConversionAPI['inspect']>(async (file) => ({ id: file.name, name: file.name, size: file.size, category: file.name.endsWith('.mp4') ? 'video' : 'image', detected: file.name.endsWith('.mp4') ? 'MP4' : 'PNG', targets: ['mp3', 'webp'], note: '格式说明' })),
  convert: vi.fn(async (id, target) => ({ id: `${id}-result`, name: `output.${target}`, size: 100 })),
  save: vi.fn(async (ids) => ids.length),
  cancel: vi.fn(async () => {}),
  release: vi.fn(async () => {}),
})
let api: FormatConversionAPI
beforeEach(() => {
  api = mockAPI(); window.sylunae = { formatConversion: api } as unknown as SylunaeAPI
  URL.createObjectURL = vi.fn(() => 'blob:result'); URL.revokeObjectURL = vi.fn()
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} unobserve() {} })
})
afterEach(() => { cleanup(); delete window.sylunae; vi.restoreAllMocks(); vi.unstubAllGlobals() })
const add = (container: HTMLElement, names: string[]) => fireEvent.change(container.querySelector('input[type=file]')!, { target: { files: names.map((name) => new File(['source'], name)) } })
describe('format converter workflows', () => {
  it('uses the shared dropzone and editor layout, and saves only after download', async () => {
    const { container } = render(<FormatConverter />)
    expect(container.querySelector('.audio-editor-dropzone')).toBeTruthy()
    expect(container.querySelector('.audio-editor-shell')).toBeNull()
    add(container, ['clip.mp4'])
    await screen.findByText('转换设置')
    expect(container.querySelector('.audio-editor-shell')).toBeTruthy()
    expect(container.querySelector('.audio-editor-options')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '生成转换结果' }))
    await screen.findByRole('button', { name: '下载全部结果' })
    expect(api.convert).toHaveBeenCalledWith('clip.mp4', 'mp3', 82)
    expect(api.save).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '下载全部结果' }))
    await waitFor(() => expect(api.save).toHaveBeenCalledWith(['clip.mp4-result']))
    await screen.findByText('已保存 1 个转换结果')
  })
  it('keeps the rest of a batch running when one file fails and retries that file', async () => {
    vi.mocked(api.convert).mockRejectedValueOnce(new Error('无法解码')).mockResolvedValue({ id: 'success', name: 'output.mp3', size: 100 })
    const { container } = render(<FormatConverter />)
    add(container, ['a.mp4', 'b.mp4'])
    await screen.findByText('2 个文件等待转换')
    fireEvent.click(screen.getByRole('button', { name: '生成转换结果' }))
    await screen.findByText('无法解码')
    await screen.findByText('1 个结果已生成')
    expect(api.convert).toHaveBeenCalledTimes(2)
    fireEvent.click(screen.getByRole('button', { name: '生成转换结果' }))
    await screen.findByText('2 个结果已生成')
    expect(api.convert).toHaveBeenCalledTimes(3)
  })
  it('shows missing engine guidance without offering unsupported conversion', async () => {
    vi.mocked(api.inspect).mockResolvedValue({ id: 'no-engine', name: 'clip.mp4', size: 20, category: 'video', detected: 'MP4', targets: [], note: '需要下载媒体工具后重新识别此文件。' })
    const { container } = render(<FormatConverter />)
    add(container, ['clip.mp4'])
    await screen.findByText('暂无可用格式')
    expect((screen.getByRole('button', { name: '生成转换结果' }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getAllByText('需要下载媒体工具后重新识别此文件。').length).toBeGreaterThan(0)
    fireEvent.click(screen.getByRole('button', { name: '重新识别文件' }))
    await waitFor(() => expect(api.inspect).toHaveBeenCalledTimes(2))
  })
  it('cancels between files and releases owned sources and results on unmount', async () => {
    let finish!: (value: { id: string; name: string; size: number }) => void
    vi.mocked(api.convert).mockReturnValueOnce(new Promise((resolve) => { finish = resolve }))
    const { container, unmount } = render(<FormatConverter />)
    add(container, ['a.mp4', 'b.mp4'])
    await screen.findByText('2 个文件等待转换')
    fireEvent.click(screen.getByRole('button', { name: '生成转换结果' }))
    fireEvent.click(await screen.findByRole('button', { name: '取消转换' }))
    finish({ id: 'discarded', name: 'a.mp3', size: 20 })
    await waitFor(() => expect(api.release).toHaveBeenCalledWith(['discarded']))
    expect(api.convert).toHaveBeenCalledTimes(1)
    unmount()
    await waitFor(() => expect(api.cancel).toHaveBeenCalled())
    await waitFor(() => expect(api.release).toHaveBeenCalledWith(expect.arrayContaining(['a.mp4', 'b.mp4'])))
  })
})
