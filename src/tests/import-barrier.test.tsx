// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createDefaultSnapshot } from '../shared/defaults'
import { AppStoreProvider, useAppStore } from '../app/AppStore'

const database = vi.hoisted(() => ({ load: vi.fn(), save: vi.fn(), replace: vi.fn() }))
vi.mock('../data/repository', () => ({ repository: database }))
vi.mock('../platform/environment', () => ({ isAndroid: false }))
function Controls() {
  const store = useAppStore()
  return <><span data-testid="name">{store.snapshot?.settings.displayName}</span>
    <button onClick={() => store.update((value) => ({ ...value, settings: { ...value.settings, displayName: 'Local edits' } }))}>Edit</button>
    <button onClick={() => store.update((value) => ({ ...value, settings: { ...value.settings, displayName: 'Background update' } }))}>Background tick</button>
    <button onClick={() => { void store.replace(createDefaultSnapshot()).catch(() => {}) }}>Import</button>
  </>
}
beforeEach(() => { database.load.mockResolvedValue(createDefaultSnapshot()); database.save.mockResolvedValue(undefined) })
afterEach(() => { cleanup(); vi.clearAllMocks() })
it('flushes local edits before import and blocks stale background writes across a failed replacement', async () => {
  let fail!: (error: Error) => void
  database.replace.mockImplementation(() => new Promise((_, reject) => { fail = reject }))
  render(<AppStoreProvider><Controls /></AppStoreProvider>)
  await waitFor(() => expect(screen.getByTestId('name').textContent).not.toBe(''))
  fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
  fireEvent.click(screen.getByRole('button', { name: 'Import' }))
  await waitFor(() => expect(database.replace).toHaveBeenCalledTimes(1))
  expect(database.save.mock.calls[0][0].settings.displayName).toBe('Local edits')
  fireEvent.click(screen.getByRole('button', { name: 'Background tick' }))
  fail(new Error('Disk full'))
  await waitFor(() => expect(screen.getByTestId('name').textContent).toBe('Local edits'))
  expect(database.save).toHaveBeenCalledTimes(1)
})
