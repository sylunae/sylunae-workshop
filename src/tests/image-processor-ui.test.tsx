// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ImageProcessor } from '../components/ImageProcessor'
import type { SylunaeAPI } from '../shared/types'

vi.mock('../lib/imageProcessing', async (load) => ({
  ...await load<typeof import('../lib/imageProcessing')>(),
  encodeImage: vi.fn(async () => ({ blob: new Blob(['encoded'], { type: 'image/webp' }), width: 40, height: 30 })),
}))

beforeEach(() => {
  vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 40, height: 30, close: vi.fn() })))
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} unobserve() {} })
  URL.createObjectURL = vi.fn(() => `blob:${Math.random()}`)
  URL.revokeObjectURL = vi.fn()
  Element.prototype.scrollIntoView = vi.fn()
})
afterEach(() => { cleanup(); delete window.sylunae; vi.unstubAllGlobals() })

const imageApi = () => ({
  rememberImport: vi.fn(async () => {}),
  pickDirectory: vi.fn(async () => '/download'),
  save: vi.fn(async () => '/download/photo.webp'),
  pickFolder: vi.fn(async () => ({ path: '/photos', count: 2, bytes: 300, recursive: false, formats: { PNG: 2 } })),
  scanFolder: vi.fn(async () => ({ path: '/photos', count: 3, bytes: 500, recursive: true, formats: { PNG: 3 } })),
  processFolder: vi.fn(async () => ({ count: 2, bytes: 100, errors: [], files: ['a.webp', 'b.webp'] })),
  saveFolder: vi.fn(async () => ({ count: 2, errors: [] })),
})
function desktop() {
  const api = imageApi()
  window.sylunae = { platform: 'electron', imageProcessing: api } as unknown as SylunaeAPI
  return api
}
function importImage(container: HTMLElement) {
  fireEvent.change(container.querySelector('input[type=file]')!, { target: { files: [new File(['source'], 'photo.png', { type: 'image/png' })] } })
}

describe('image processor workflows', () => {
  it('starts with a full width dropzone and reveals matching editor panels after import', async () => {
    const { container } = render(<ImageProcessor />)
    expect(container.querySelector('.audio-editor-dropzone')).toBeTruthy()
    expect(container.querySelector('.audio-editor-shell')).toBeNull()
    expect(screen.queryByText('添加图片')).toBeNull()
    importImage(container)
    await waitFor(() => expect(container.querySelector('.audio-editor-shell')).toBeTruthy())
    expect(screen.getByText('编码等级')).toBeTruthy()
    expect(screen.queryByRole('slider')).toBeNull()
    expect(screen.queryByText('输出文件夹')).toBeNull()
  })
  it('generates results without writing files and asks for the destination only on download', async () => {
    const api = desktop()
    const { container } = render(<ImageProcessor />)
    importImage(container)
    await waitFor(() => expect((screen.getByRole('button', { name: '生成输出结果' }) as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(screen.getByRole('button', { name: '生成输出结果' }))
    await screen.findByRole('button', { name: '一键下载全部结果' })
    expect(api.save).not.toHaveBeenCalled()
    expect(api.pickDirectory).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '一键下载全部结果' }))
    await waitFor(() => expect(api.save).toHaveBeenCalledTimes(1))
    expect(api.pickDirectory).toHaveBeenCalledTimes(1)
  })
  it('shows folder statistics without thumbnails or editing and downloads only on request', async () => {
    const api = desktop()
    const { container } = render(<ImageProcessor />)
    fireEvent.click(screen.getByRole('button', { name: '选择文件夹批量处理' }))
    await screen.findByText('文件夹批量处理')
    expect(container.querySelector('img')).toBeNull()
    expect(screen.queryByRole('button', { name: '裁剪' })).toBeNull()
    fireEvent.click(screen.getByRole('checkbox', { name: '包含子文件夹' }))
    await waitFor(() => expect(api.scanFolder).toHaveBeenCalledWith(true))
    await waitFor(() => expect((screen.getByRole('button', { name: '生成输出结果' }) as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(screen.getByRole('button', { name: '生成输出结果' }))
    await screen.findByRole('button', { name: '一键下载全部结果' })
    expect(api.saveFolder).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '一键下载全部结果' }))
    await waitFor(() => expect(api.saveFolder).toHaveBeenCalledTimes(1))
  })
  it('renames and reorders generated images without encoding again and preserves numbering on single downloads', async () => {
    const { encodeImage } = await import('../lib/imageProcessing')
    vi.mocked(encodeImage).mockClear()
    const { container } = render(<ImageProcessor />)
    fireEvent.change(container.querySelector('input[type=file]')!, { target: { files: [new File(['a'], 'a.png'), new File(['b'], 'b.png')] } })
    await waitFor(() => expect((screen.getByRole('button', { name: '生成输出结果' }) as HTMLButtonElement).disabled).toBe(false))
    expect(screen.queryByRole('checkbox', { name: '自定义下载命名' })).toBeNull()
    expect(container.querySelector('.image-order-controls')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '生成输出结果' }))
    await screen.findByRole('button', { name: '一键下载全部结果' })
    fireEvent.click(screen.getByRole('checkbox', { name: '自定义下载命名' }))
    fireEvent.click(screen.getByRole('button', { name: '01-原名' }))
    expect(container.querySelector('.image-options .image-naming')).toBeNull()
    expect([...container.querySelectorAll('.image-result-card strong')].map((node) => node.textContent)).toEqual(['01-a.webp', '02-b.webp'])
    const cards = container.querySelectorAll('.image-result-card')
    const dataTransfer = { setData: vi.fn(), effectAllowed: '', dropEffect: '' }
    fireEvent.dragStart(cards[1], { dataTransfer })
    fireEvent.dragEnd(cards[1], { dataTransfer })
    expect([...container.querySelectorAll('.image-result-card strong')].map((node) => node.textContent)).toEqual(['01-a.webp', '02-b.webp'])
    fireEvent.dragStart(cards[1], { dataTransfer })
    fireEvent.pointerCancel(cards[1], { pointerType: 'mouse' })
    fireEvent.dragOver(cards[0], { dataTransfer })
    expect(cards[0].classList.contains('is-drop-target')).toBe(true)
    fireEvent.drop(cards[0], { dataTransfer })
    expect([...container.querySelectorAll('.image-result-card strong')].map((node) => node.textContent)).toEqual(['01-b.webp', '02-a.webp'])
    expect(Element.prototype.scrollIntoView).toHaveBeenCalledTimes(1)
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { expect(this.download).toBe('02-a.webp') })
    fireEvent.click(screen.getAllByRole('button', { name: '下载' })[1])
    await waitFor(() => expect(click).toHaveBeenCalledOnce())
    click.mockRestore()
    expect(encodeImage).toHaveBeenCalledTimes(2)
    fireEvent.change(screen.getByLabelText('起始编号'), { target: { value: '' } })
    expect((screen.getByRole('button', { name: '一键下载全部结果' }) as HTMLButtonElement).disabled).toBe(true)
  })
  it('allows sorting only after folder processing and saves in the new order without converting again', async () => {
    const api = desktop()
    api.pickFolder.mockResolvedValue({ path: '/photos', count: 2, bytes: 300, recursive: false, formats: { PNG: 2 }, files: ['a.png', 'b.png'] } as Awaited<ReturnType<typeof api.pickFolder>>)
    const { container } = render(<ImageProcessor />)
    fireEvent.click(screen.getByRole('button', { name: '选择文件夹批量处理' }))
    await screen.findByText('文件夹批量处理')
    expect(screen.queryByRole('checkbox', { name: '自定义下载命名' })).toBeNull()
    expect(container.querySelector('[draggable=true]')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '生成输出结果' }))
    await screen.findByRole('button', { name: '一键下载全部结果' })
    expect(api.processFolder).toHaveBeenCalledWith('image/webp', 'standard')
    const cards = container.querySelectorAll('.image-result-card')
    const dataTransfer = { setData: vi.fn(), effectAllowed: '', dropEffect: '' }
    fireEvent.dragStart(cards[1], { dataTransfer })
    fireEvent.dragOver(cards[0], { dataTransfer })
    fireEvent.drop(cards[0], { dataTransfer })
    fireEvent.click(screen.getByRole('checkbox', { name: '自定义下载命名' }))
    fireEvent.click(screen.getByRole('button', { name: '从 01 开始' }))
    fireEvent.click(screen.getByRole('button', { name: '一键下载全部结果' }))
    await waitFor(() => expect(api.saveFolder).toHaveBeenCalledWith({ template: '{n}', start: 1, digits: 2, step: 1 }, [1, 0]))
    expect(api.processFolder).toHaveBeenCalledTimes(1)
  })

})
