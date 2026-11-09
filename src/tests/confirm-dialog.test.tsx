// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ConfirmDialog } from '../components/ConfirmDialog'

afterEach(cleanup)
describe('asynchronous confirmations', () => {
  it('keeps the dialog open, prevents duplicate submissions, and displays failures for retry', async () => {
    let reject!: (error: Error) => void
    const action = vi.fn(() => new Promise<void>((_, fail) => { reject = fail }))
    const close = vi.fn()
    render(<ConfirmDialog open title="导入备份" onConfirm={action} onOpenChange={close} description="覆盖前先校验" />)
    fireEvent.click(screen.getByRole('button', { name: '确认' }))
    expect((screen.getByRole('button', { name: '取消' }) as HTMLButtonElement).disabled).toBe(true)
    reject(new Error('空间不足，原数据已保留'))
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', '空间不足，原数据已保留')
    expect(close).not.toHaveBeenCalled()
    action.mockResolvedValueOnce()
    fireEvent.click(screen.getByRole('button', { name: '确认' }))
    await waitFor(() => expect(close).toHaveBeenCalledWith(false))
    expect(action).toHaveBeenCalledTimes(2)
  })
})
