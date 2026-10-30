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
  processFolder: vi.fn(async () => ({ count: 2, bytes: 100, errors: [] })),
  saveFolder: vi.fn(async () => ({ count: 2, errors: [] })),
})
function desktop() {
  const api = imageApi()
  window.sylunae = { imageProcessing: api } as unknown as SylunaeAPI
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
    fireEvent.click(screen.getByRole('checkbox'))
    await waitFor(() => expect(api.scanFolder).toHaveBeenCalledWith(true))
    await waitFor(() => expect((screen.getByRole('button', { name: '生成输出结果' }) as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(screen.getByRole('button', { name: '生成输出结果' }))
    await screen.findByRole('button', { name: '一键下载全部结果' })
    expect(api.saveFolder).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '一键下载全部结果' }))
    await waitFor(() => expect(api.saveFolder).toHaveBeenCalledTimes(1))
  })
})
