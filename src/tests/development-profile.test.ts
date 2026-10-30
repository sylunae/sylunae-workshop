import { describe, expect, it, vi } from 'vitest'
import { join } from 'node:path'
import { configureDevelopmentProfile } from '../../electron/main/developmentProfile'
vi.mock('node:fs', () => ({ mkdirSync: vi.fn() }))

describe('development data isolation', () => {
  it('redirects both application data and browser sessions before startup', () => {
    const app = { isPackaged: false, getPath: vi.fn(() => '/profiles'), setPath: vi.fn() }
    configureDevelopmentProfile(app)
    expect(app.getPath).toHaveBeenCalledWith('appData')
    expect(app.setPath.mock.calls).toEqual([
      ['userData', join('/profiles', 'sylunae-workshop-development')],
      ['sessionData', join('/profiles', 'sylunae-workshop-development', 'browser-session')],
    ])
  })
  it('leaves the installed application profile untouched', () => {
    const app = { isPackaged: true, getPath: vi.fn(() => '/profiles'), setPath: vi.fn() }
    configureDevelopmentProfile(app)
    expect(app.getPath).not.toHaveBeenCalled()
    expect(app.setPath).not.toHaveBeenCalled()
  })
})
