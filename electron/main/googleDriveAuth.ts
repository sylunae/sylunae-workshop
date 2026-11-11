import { app, dialog, safeStorage, shell } from 'electron'
import { createHash, randomBytes } from 'node:crypto'
import { readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { join } from 'node:path'
import { z } from 'zod'

const scope = 'https://www.googleapis.com/auth/drive.appdata'
const clientSchema = z.object({
  client_id: z.string().regex(/^[\w.-]+\.apps\.googleusercontent\.com$/),
  client_secret: z.string().min(1),
})
const storedSchema = z.object({ client: clientSchema, refresh: z.string().optional() })
type Credentials = z.infer<typeof storedSchema>

function defaultCredentials(): Credentials | undefined {
  const client = clientSchema.safeParse({
    client_id: import.meta.env.MAIN_VITE_GOOGLE_DRIVE_CLIENT_ID,
    client_secret: import.meta.env.MAIN_VITE_GOOGLE_DRIVE_CLIENT_SECRET,
  })
  return client.success ? { client: client.data } : undefined
}

export async function readGoogleJson(response: Response): Promise<unknown> {
  if (!response.ok) {
    let reason = ''
    try {
      const body = await response.json()
      reason = body?.error?.errors?.[0]?.reason ?? body?.error?.status ?? body?.error ?? ''
    } catch { /* Some Google endpoints return an empty error response. */ }
    if (reason === 'storageQuotaExceeded') throw new Error('Google Drive 可用空间不足。')
    if (response.status === 401 || reason === 'invalid_grant') throw new Error('Google 授权已失效，请重新连接账号。')
    throw new Error('Google Drive 请求失败（HTTP ' + response.status + '）。请检查网络、Drive API 设置或账号权限。')
  }
  return response.json()
}

function credentialPath() { return join(app.getPath('userData'), 'google-drive.oauth') }

export class GoogleDriveAuth {
  private access: { token: string; expiresAt: number } | undefined

  private async load(): Promise<Credentials | undefined> {
    try {
      return storedSchema.parse(JSON.parse(safeStorage.decryptString(await readFile(credentialPath()))))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return defaultCredentials()
      throw new Error('无法读取本机 Google Drive 授权，请重新导入桌面 OAuth 配置。')
    }
  }

  private async save(credentials: Credentials) {
    if (!safeStorage.isEncryptionAvailable()) throw new Error('系统凭据加密不可用，无法保存 Google Drive 授权。')
    const temporary = credentialPath() + '.tmp'
    try {
      await writeFile(temporary, safeStorage.encryptString(JSON.stringify(credentials)), { mode: 0o600 })
      await rename(temporary, credentialPath())
    } finally { await unlink(temporary).catch(() => undefined) }
  }

  async configure(): Promise<boolean> {
    const selected = await dialog.showOpenDialog({
      title: '选择 Google Cloud 下载的 Desktop OAuth 客户端 JSON',
      properties: ['openFile'],
      filters: [{ name: 'Google OAuth 客户端', extensions: ['json'] }],
    })
    if (selected.canceled) return false
    let client
    try { client = clientSchema.parse(JSON.parse(await readFile(selected.filePaths[0], 'utf8')).installed) }
    catch { throw new Error('请选择 Google Cloud 下载的「桌面应用」OAuth 客户端 JSON。') }
    await this.save({ client })
    this.access = undefined
    return true
  }

  async status() {
    try {
      const credentials = await this.load()
      return { configured: Boolean(credentials), connected: Boolean(credentials?.refresh) }
    } catch { return { configured: false, connected: false } }
  }

  async disconnect() {
    const credentials = await this.load()
    if (credentials) await this.save({ client: credentials.client })
    this.access = undefined
  }

  private async exchange(client: Credentials['client'], parameters: Record<string, string>) {
    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      body: new URLSearchParams({ ...client, ...parameters }),
      signal: AbortSignal.timeout(30_000),
    })
    return z.object({
      access_token: z.string().min(1), expires_in: z.number().positive(), refresh_token: z.string().optional(),
    }).parse(await readGoogleJson(response))
  }

  async token(force = false): Promise<string> {
    if (!force && this.access && this.access.expiresAt > Date.now() + 60_000) return this.access.token
    const credentials = await this.load()
    if (!credentials?.refresh) throw new Error('请先连接 Google Drive。')
    const result = await this.exchange(credentials.client, { grant_type: 'refresh_token', refresh_token: credentials.refresh })
    if (result.refresh_token) await this.save({ ...credentials, refresh: result.refresh_token })
    this.access = { token: result.access_token, expiresAt: Date.now() + result.expires_in * 1000 }
    return this.access.token
  }

  async connect() {
    const credentials = await this.load()
    if (!credentials) throw new Error('请先导入桌面 OAuth 配置。')
    const verifier = randomBytes(48).toString('base64url')
    const state = randomBytes(32).toString('base64url')
    const { code, redirectUri } = await waitForGoogleCode(credentials.client.client_id, state, verifier)
    const result = await this.exchange(credentials.client, {
      grant_type: 'authorization_code', code, redirect_uri: redirectUri, code_verifier: verifier,
    })
    if (!result.refresh_token) throw new Error('Google 未返回续期凭据，请重新连接账号。')
    await this.save({ ...credentials, refresh: result.refresh_token })
    this.access = { token: result.access_token, expiresAt: Date.now() + result.expires_in * 1000 }
  }
}

async function waitForGoogleCode(clientId: string, state: string, verifier: string) {
  let redirectUri = ''
  let finish: (code: string) => void
  let fail: (error: Error) => void
  const result = new Promise<string>((resolve, reject) => { finish = resolve; fail = reject })
  const server = createServer((request, response) => {
    let callback: URL
    try { callback = new URL(request.url || '/', 'http://127.0.0.1') }
    catch { response.writeHead(400).end(); return }
    if (request.method !== 'GET' || callback.pathname !== '/google-drive' || callback.searchParams.get('state') !== state) {
      response.writeHead(404).end()
      return
    }
    const code = callback.searchParams.get('code')
    response.writeHead(code ? 200 : 400, { 'Content-Type': 'text/plain; charset=utf-8', Connection: 'close' })
      .end(code ? '授权响应已收到，可以返回丝月工坊。' : '授权未完成，请返回丝月工坊重试。', () => {
        if (code) finish(code)
        else fail(new Error('Google 授权未完成。'))
      })
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => { server.removeListener('error', reject); resolve() })
  })
  server.on('error', fail!)
  const timeout = setTimeout(() => fail(new Error('Google 授权超时，请重试。')), 180_000)
  try {
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('无法启动 Google 授权回调。')
    redirectUri = 'http://127.0.0.1:' + address.port + '/google-drive'
    const authorize = new URL('https://accounts.google.com/o/oauth2/v2/auth')
    authorize.search = new URLSearchParams({
      client_id: clientId, redirect_uri: redirectUri, scope, state, response_type: 'code',
      access_type: 'offline', prompt: 'select_account consent',
      code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256',
    }).toString()
    const [, code] = await Promise.all([shell.openExternal(authorize.toString()), result])
    return { code, redirectUri }
  } finally {
    clearTimeout(timeout)
    server.close()
    server.closeAllConnections()
  }
}
