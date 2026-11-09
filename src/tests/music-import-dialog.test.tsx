// @vitest-environment jsdom
import { useState } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { MusicImportDialog } from '../components/MusicImportDialog'
import type { MusicImportProgress, MusicRemoteImport, MusicTrack, SylunaeAPI } from '../shared/types'

afterEach(() => { cleanup(); delete window.sylunae })

it('continues a YouTube import with the dialog closed and shows current progress when reopened', async () => {
  let emitProgress!: (progress: MusicImportProgress) => void
  let completeImport!: (track: MusicTrack) => void
  const importRemote = vi.fn((_input: MusicRemoteImport) => new Promise<MusicTrack>((resolve) => {
    completeImport = resolve
  }))
  window.sylunae = { platform: 'electron', music: {
    getDownloadDirectory: async () => 'Music',
    getMediaToolsStatus: async () => ({ ready: true }),
    onMediaToolsProgress: () => () => {},
    onImportProgress: (listener: typeof emitProgress) => { emitProgress = listener; return () => {} },
    importRemote,
  } } as unknown as SylunaeAPI
  const onImported = vi.fn()
  const otherAction = vi.fn()
  function Harness() {
    const [open, setOpen] = useState(false)
    return <>
      <button onClick={() => setOpen(true)}>添加音乐</button>
      <button onClick={otherAction}>其他操作</button>
      <MusicImportDialog open={open} onOpenChange={setOpen} onImported={onImported} />
    </>
  }
  render(<Harness />)

  const openImport = () => fireEvent.click(screen.getByRole('button', { name: '添加音乐' }))
  openImport()
  fireEvent.click(screen.getByRole('button', { name: /从 YouTube 链接导入/ }))
  const url = 'https://www.youtube.com/watch?v=example'
  fireEvent.change(await screen.findByLabelText('链接'), { target: { value: url } })
  fireEvent.click(screen.getByRole('button', { name: '下载并导入' }))
  expect(importRemote).toHaveBeenCalledTimes(1)
  fireEvent.click(screen.getByRole('button', { name: '后台继续' }))
  expect(screen.queryByRole('dialog')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '其他操作' }))
  expect(otherAction).toHaveBeenCalledTimes(1)

  const { taskId } = importRemote.mock.calls[0][0]
  act(() => emitProgress({ taskId, source: 'youtube', stage: 'converting', message: '正在转换 MP3', percent: null }))
  openImport()
  expect(screen.getByText('正在转换 MP3')).toBeTruthy()
  expect(screen.getByLabelText('链接')).toHaveProperty('value', url)
  expect(screen.getByRole('button', { name: '正在处理…' })).toHaveProperty('disabled', true)
  fireEvent.click(screen.getByRole('button', { name: '关闭' }))
  expect(screen.queryByRole('dialog')).toBeNull()

  const track = { id: 'song', title: 'YouTube 音频' } as MusicTrack
  await act(async () => completeImport(track))
  expect(onImported).toHaveBeenCalledExactlyOnceWith([track])
  expect(screen.queryByRole('dialog')).toBeNull()
  openImport()
  await waitFor(() => expect(screen.getByRole('heading', { name: '添加音乐' })).toBeTruthy())
})
