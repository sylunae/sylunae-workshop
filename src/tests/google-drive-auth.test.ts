// @vitest-environment node
import { createHash } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, vi } from 'vitest'
import { GoogleDriveAuth } from '../../electron/main/googleDriveAuth'

const electron = vi.hoisted(() => ({
  profile: '',
  showOpenDialog: vi.fn(),
  openExternal: vi.fn(),
}))
vi.mock('electron', () => ({
  app: { getPath: () => electron.profile },
  dialog: { showOpenDialog: electron.showOpenDialog },
  shell: { openExternal: electron.openExternal },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => Buffer.from(value),
    decryptString: (value: Buffer) => value.toString(),
  },
}))

it('uses the real loopback listener, validates state, exchanges a PKCE code, and reconnects after restart', async () => {
  const profile = await mkdtemp(join(tmpdir(), 'sylunae-drive-oauth-'))
  const realFetch = globalThis.fetch
  try {
    electron.profile = profile
    const config = join(profile, 'client.json')
    await writeFile(config, JSON.stringify({
      installed: { client_id: 'fake.apps.googleusercontent.com', client_secret: 'fake-client-secret' },
    }))
    electron.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: [config] })
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
    expect(await auth.configure()).toBe(true)
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
    await rm(profile, { recursive: true, force: true })
  }
})
