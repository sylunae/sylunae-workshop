// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { storageKey } from '../lib/storageEnvironment'
import { useSessionState } from '../lib/usePersistentState'

function SessionStateHarness() {
  const [page, setPage] = useSessionState('navigation.testPage', 'home')
  return <button onClick={() => setPage('notes')}>{page}</button>
}

describe('session navigation state', () => {
  beforeEach(() => window.sessionStorage.clear())
  afterEach(cleanup)

  it('starts at home in a new window session', () => {
    render(<SessionStateHarness />)
    expect(screen.getByRole('button').textContent).toBe('home')
  })

  it('does not read or overwrite production navigation in development', () => {
    window.sessionStorage.setItem('navigation.testPage', JSON.stringify('music'))
    render(<SessionStateHarness />)
    expect(screen.getByRole('button').textContent).toBe('home')
    fireEvent.click(screen.getByRole('button'))
    expect(window.sessionStorage.getItem('navigation.testPage')).toBe(JSON.stringify('music'))
    expect(window.sessionStorage.getItem(storageKey('navigation.testPage'))).toBe(JSON.stringify('notes'))
  })

  it('restores the current page after a renderer reload', () => {
    window.sessionStorage.setItem(storageKey('navigation.testPage'), JSON.stringify('music'))
    render(<SessionStateHarness />)
    expect(screen.getByRole('button').textContent).toBe('music')
    fireEvent.click(screen.getByRole('button'))
    expect(window.sessionStorage.getItem(storageKey('navigation.testPage'))).toBe(JSON.stringify('notes'))
  })
})
