// @vitest-environment node
import { createHash } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, vi } from 'vitest'
import { GoogleDriveAuth } from '../../electron/main/googleDriveAuth'

const electron = vi.hoisted(() => ({
  profile: '',
  packaged: true,
  openExternal: vi.fn(),
  showOpenDialog: vi.fn(),
}))
vi.mock('electron', () => ({
  app: { getPath: () => electron.profile, get isPackaged() { return electron.packaged } },
  dialog: { showOpenDialog: electron.showOpenDialog },
  shell: { openExternal: electron.openExternal },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => Buffer.from(value),
    decryptString: (value: Buffer) => value.toString(),
  },
}))

it('lets the desktop development profile import a client without bundled configuration', async () => {
  const profile = await mkdtemp(join(tmpdir(), 'sylunae-drive-dev-oauth-'))
  try {
    electron.profile = profile
    electron.packaged = false
    vi.stubEnv('MAIN_VITE_GOOGLE_DRIVE_CLIENT_ID', '')
    vi.stubEnv('MAIN_VITE_GOOGLE_DRIVE_CLIENT_SECRET', '')
    const path = join(profile, 'desktop-client.json')
    await writeFile(path, JSON.stringify({ installed: {
      client_id: 'development.apps.googleusercontent.com', client_secret: 'development-client',
    } }))
    electron.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: [path] })
    expect(await new GoogleDriveAuth().status()).toEqual({ configured: false, connected: false })
    expect(await new GoogleDriveAuth().importDevelopmentClient()).toBe(true)
    expect(await new GoogleDriveAuth().status()).toEqual({ configured: true, connected: false })
    electron.packaged = true
    expect(await new GoogleDriveAuth().status()).toEqual({ configured: false, connected: false })
    await expect(new GoogleDriveAuth().importDevelopmentClient()).rejects.toThrow('桌面开发版')
  } finally {
    electron.packaged = true
    vi.unstubAllEnvs()
    await rm(profile, { recursive: true, force: true })
  }
})

it('uses the real loopback listener, validates state, exchanges a PKCE code, and reconnects after restart', async () => {
  const profile = await mkdtemp(join(tmpdir(), 'sylunae-drive-oauth-'))
  const realFetch = globalThis.fetch
  try {
    electron.profile = profile
    vi.stubEnv('MAIN_VITE_GOOGLE_DRIVE_CLIENT_ID', 'bundled.apps.googleusercontent.com')
    vi.stubEnv('MAIN_VITE_GOOGLE_DRIVE_CLIENT_SECRET', 'bundled-public-client-configuration')
    expect(await new GoogleDriveAuth().status()).toEqual({ configured: true, connected: false })
    let authorization: URL | undefined
    electron.openExternal.mockImplementation(async (address: string) => {
      authorization = new URL(address)
      expect(authorization.origin).toBe('https://accounts.google.com')
      expect(authorization.searchParams.get('scope')).toBe('https://www.googleapis.com/auth/drive.appdata')
      expect(authorization.searchParams.get('code_challenge_method')).toBe('S256')
      const callback = new URL(authorization.searchParams.get('redirect_uri')!)
      expect(callback.hostname).toBe('127.0.0.1')
      callback.search = new URLSearchParams({ code: 'untrusted', state: 'wrong' }).toString()
      expect((await realFetch(callback)).status).toBe(404)
      callback.search = new URLSearchParams({ code: 'fake-code', state: authorization.searchParams.get('state')! }).toString()
      const response = await realFetch(callback)
      expect(response.status).toBe(200)
      expect(await response.text()).toContain('可以返回丝月工坊')
    })

    const exchange = vi.fn(async (address: string, init: RequestInit) => {
      expect(address).toBe('https://oauth2.googleapis.com/token')
      const body = init.body as URLSearchParams
      expect(body.get('client_id')).toBe('bundled.apps.googleusercontent.com')
      if (body.get('grant_type') === 'authorization_code') {
        expect(body.get('code')).toBe('fake-code')
        expect(body.get('redirect_uri')).toBe(authorization!.searchParams.get('redirect_uri'))
        expect(createHash('sha256').update(body.get('code_verifier')!).digest('base64url'))
          .toBe(authorization!.searchParams.get('code_challenge'))
        return Response.json({ access_token: 'initial', refresh_token: 'persistent', expires_in: 3600 })
      }
      expect(body.get('grant_type')).toBe('refresh_token')
      expect(body.get('refresh_token')).toBe('persistent')
      return Response.json({ access_token: 'renewed', expires_in: 3600 })
    })
    vi.stubGlobal('fetch', exchange)
    const auth = new GoogleDriveAuth()
    await auth.connect()
    expect(await auth.token()).toBe('initial')

    const restarted = new GoogleDriveAuth()
    expect(await restarted.status()).toEqual({ configured: true, connected: true })
    expect(await restarted.token()).toBe('renewed')
    await restarted.disconnect()
    expect(await restarted.status()).toEqual({ configured: true, connected: false })
    await expect(restarted.token()).rejects.toThrow('请先连接')
    expect(exchange).toHaveBeenCalledTimes(2)
  } finally {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
    await rm(profile, { recursive: true, force: true })
  }
})

it('releases the callback listener when the browser fails without returning to the app', async () => {
  const profile = await mkdtemp(join(tmpdir(), 'sylunae-drive-cancel-oauth-'))
  try {
    electron.profile = profile
    vi.stubEnv('MAIN_VITE_GOOGLE_DRIVE_CLIENT_ID', 'bundled.apps.googleusercontent.com')
    vi.stubEnv('MAIN_VITE_GOOGLE_DRIVE_CLIENT_SECRET', 'bundled-public-client-configuration')
    const controller = new AbortController()
    let callback: string | null = null
    electron.openExternal.mockImplementationOnce(async (url: string) => {
      callback = new URL(url).searchParams.get('redirect_uri')
      controller.abort(new Error('已取消 Google Drive 授权。'))
    })
    await expect(new GoogleDriveAuth().connect(controller.signal)).rejects.toThrow('已取消')
    expect(callback).toBeTruthy()
    await expect(fetch(callback!)).rejects.toThrow()
  } finally {
    vi.unstubAllEnvs()
    await rm(profile, { recursive: true, force: true })
  }
})

it('keeps legacy authorizations until disconnected and recovers unreadable credentials using the bundled client', async () => {
  const profile = await mkdtemp(join(tmpdir(), 'sylunae-drive-oauth-'))
  try {
    electron.profile = profile
    vi.stubEnv('MAIN_VITE_GOOGLE_DRIVE_CLIENT_ID', 'bundled.apps.googleusercontent.com')
    vi.stubEnv('MAIN_VITE_GOOGLE_DRIVE_CLIENT_SECRET', 'bundled-public-client-configuration')
    const path = join(profile, 'google-drive.oauth')
    await writeFile(path, JSON.stringify({
      client: { client_id: 'legacy.apps.googleusercontent.com', client_secret: 'legacy-secret' },
      refresh: 'legacy-refresh',
    }))
    const auth = new GoogleDriveAuth()
    expect(await auth.status()).toEqual({ configured: true, connected: true })
    await auth.disconnect()
    expect(await auth.status()).toEqual({ configured: true, connected: false })
    await writeFile(path, 'invalid credentials')
    expect(await auth.status()).toEqual({ configured: true, connected: false })
  } finally {
    vi.unstubAllEnvs()
    await rm(profile, { recursive: true, force: true })
  }
})
