import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

interface ProfileApp {
  isPackaged: boolean
  getPath(name: 'appData'): string
  setPath(name: 'userData' | 'sessionData', path: string): void
}

/** Must run before app readiness, database access, or Chromium session creation. */
export function configureDevelopmentProfile(app: ProfileApp): void {
  if (app.isPackaged) return
  const userData = join(app.getPath('appData'), 'sylunae-workshop-development')
  const sessionData = join(userData, 'browser-session')
  mkdirSync(sessionData, { recursive: true })
  app.setPath('userData', userData)
  app.setPath('sessionData', sessionData)
}
