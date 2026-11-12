import { createHash, randomUUID } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, open, rename, stat, unlink } from 'node:fs/promises'
import { dirname } from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { z } from 'zod'
import { driveFileId, driveHash, type DriveAccount, type DriveObject, type DriveRestoredObject } from '../../src/shared/driveBackup'
import { readGoogleJson } from './googleDriveAuth'

const filesApi = 'https://www.googleapis.com/drive/v3/files'
const uploadApi = 'https://www.googleapis.com/upload/drive/v3/files'
const chunkSize = 8 * 1024 * 1024
const objectFields = 'id,size,sha256Checksum'
const fileSchema = z.object({
  id: z.string().regex(driveFileId),
  size: z.string().regex(/^\d+$/).optional(),
  sha256Checksum: z.string().regex(driveHash).optional(),
})

function manifestObject(file: z.infer<typeof fileSchema>): DriveObject {
  const size = Number(file.size)
  if (!file.sha256Checksum || !Number.isSafeInteger(size) || size < 0 || size > 16 * 1024 * 1024) throw new Error('云端备份清单无效。')
  return { id: file.id, size, sha256: file.sha256Checksum, mime: 'application/json' }
}

export type UploadSource = Buffer | string
export const bufferHash = (buffer: Buffer) => createHash('sha256').update(buffer).digest('hex')

export class GoogleDriveFiles {
  constructor(private readonly getToken: (force?: boolean) => Promise<string>) {}

  private async request(url: string, init: RequestInit = {}) {
    const send = async (force: boolean) => fetch(url, {
      ...init,
      redirect: 'manual',
      headers: { ...init.headers, Authorization: 'Bearer ' + await this.getToken(force) },
      signal: init.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(120_000)]) : AbortSignal.timeout(120_000),
    })
    const response = await send(false)
    if (response.status !== 401) return response
    await response.body?.cancel()
    return send(true)
  }

  async account(signal?: AbortSignal): Promise<DriveAccount> {
    const query = new URLSearchParams({ fields: 'user(permissionId,emailAddress,displayName),storageQuota(limit,usage)' })
    const data = z.object({
      user: z.object({ permissionId: z.string(), emailAddress: z.string().optional(), displayName: z.string().optional() }),
      storageQuota: z.object({ limit: z.string().optional(), usage: z.string().optional() }).optional(),
    }).parse(await readGoogleJson(await this.request('https://www.googleapis.com/drive/v3/about?' + query, { signal })))
    const { user, storageQuota } = data
    const availableBytes = storageQuota?.limit && storageQuota.usage
      ? Math.max(0, Number(storageQuota.limit) - Number(storageQuota.usage))
      : undefined
    return { id: user.permissionId, label: user.emailAddress || user.displayName || 'Google Drive', availableBytes }
  }

  async objects() {
    const results = new Map<string, { id: string; size: number }>()
    const query = new URLSearchParams({
      spaces: 'appDataFolder', pageSize: '1000',
      q: "trashed = false and appProperties has { key='sylunae' and value='object-v1' }",
      fields: 'nextPageToken,files(' + objectFields + ')',
    })
    do {
      const page = z.object({ nextPageToken: z.string().optional(), files: z.array(fileSchema) })
        .parse(await readGoogleJson(await this.request(filesApi + '?' + query)))
      for (const file of page.files) if (file.sha256Checksum && file.size) {
        results.set(file.sha256Checksum, { id: file.id, size: Number(file.size) })
      }
      if (!page.nextPageToken) break
      query.set('pageToken', page.nextPageToken)
    } while (true)
    return results
  }

  async latest(role: 'manifest-v1' | 'notebook-v1' = 'manifest-v1'): Promise<DriveObject | null> {
    const query = new URLSearchParams({
      spaces: 'appDataFolder', pageSize: '1', orderBy: 'createdTime desc',
      q: "trashed = false and appProperties has { key='sylunae' and value='" + role + "' }",
      fields: 'nextPageToken,files(' + objectFields + ')',
    })
    do {
      const page = z.object({ nextPageToken: z.string().optional(), files: z.array(fileSchema) })
        .parse(await readGoogleJson(await this.request(filesApi + '?' + query)))
      const file = page.files[0]
      if (file) return manifestObject(file)
      if (!page.nextPageToken) return null
      query.set('pageToken', page.nextPageToken)
    } while (true)
  }

  async revision(id: string): Promise<DriveObject> {
    if (!driveFileId.test(id)) throw new Error('云端文件 ID 无效。')
    const response = await this.request(filesApi + '/' + id + '?fields=' + objectFields)
    return manifestObject(fileSchema.parse(await readGoogleJson(response)))
  }

  async download(object: DriveObject, destination: string): Promise<DriveRestoredObject> {
    const { id, sha256, size } = object
    const details = await stat(destination).catch(() => undefined)
    if (details?.isFile() && details.size === size) {
      const hash = createHash('sha256')
      for await (const chunk of createReadStream(destination)) hash.update(chunk)
      if (hash.digest('hex') === sha256) return { file: destination, reused: true }
    }
    await mkdir(dirname(destination), { recursive: true })
    const response = await this.request(filesApi + '/' + id + '?alt=media')
    if (!response.ok) await readGoogleJson(response)
    if (!response.body) throw new Error('Google Drive 返回了空文件。')
    const partial = destination + '.' + randomUUID() + '.part'
    const hash = createHash('sha256')
    let received = 0
    const verify = new Transform({
      transform(bytes: Buffer, _encoding, done) {
        received += bytes.length
        if (received > size) return done(new Error('云端文件大小不匹配。'))
        hash.update(bytes)
        done(null, bytes)
      },
    })
    try {
      await pipeline(Readable.from(response.body), verify, createWriteStream(partial))
      if (received !== size || hash.digest('hex') !== sha256) throw new Error('云端文件校验失败。')
      await rename(partial, destination)
      return { file: destination, reused: false }
    } finally { await unlink(partial).catch(() => undefined) }
  }

  async upload(name: string, role: 'object-v1' | 'manifest-v1' | 'notebook-v1', source: UploadSource, size: number, sha256: string) {
    const metadata = { name, parents: ['appDataFolder'], appProperties: { sylunae: role } }
    const fields = '&fields=' + objectFields
    let file: unknown
    if (Buffer.isBuffer(source) && source.length <= 4 * 1024 * 1024) {
      const boundary = randomUUID()
      const body = Buffer.concat([
        Buffer.from('--' + boundary + '\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n' + JSON.stringify(metadata)
          + '\r\n--' + boundary + '\r\nContent-Type: application/octet-stream\r\n\r\n'),
        source,
        Buffer.from('\r\n--' + boundary + '--\r\n'),
      ])
      file = await readGoogleJson(await this.request(uploadApi + '?uploadType=multipart' + fields, {
        method: 'POST', headers: { 'Content-Type': 'multipart/related; boundary=' + boundary }, body: new Uint8Array(body),
      }))
    } else {
      file = await this.uploadResumable(metadata, source, size, fields)
    }
    const uploaded = fileSchema.parse(file)
    if (uploaded.sha256Checksum !== sha256 || Number(uploaded.size) !== size) {
      throw new Error('Drive 文件校验失败。请检查源文件是否在上传期间被修改。')
    }
    return uploaded.id
  }

  private async uploadResumable(metadata: object, source: UploadSource, size: number, fields: string) {
    const initial = await this.request(uploadApi + '?uploadType=resumable' + fields, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=UTF-8',
        'X-Upload-Content-Type': 'application/octet-stream',
        'X-Upload-Content-Length': String(size),
      },
      body: JSON.stringify(metadata),
    })
    if (!initial.ok) return readGoogleJson(initial)
    const location = initial.headers.get('location')
    if (!location) throw new Error('Google Drive 没有返回续传地址。')
    const session = new URL(location)
    if (session.origin !== 'https://www.googleapis.com') throw new Error('Google Drive 返回了未知的续传地址。')
    const handle = typeof source === 'string' ? await open(source, 'r') : undefined
    const put = (range: string, bytes: Uint8Array<ArrayBuffer>) => this.request(session.href, {
      method: 'PUT', headers: { 'Content-Range': range, 'Content-Type': 'application/octet-stream' }, body: bytes,
    })
    try {
      let offset = 0
      let retries = 0
      while (offset < size) {
        const length = Math.min(chunkSize, size - offset)
        const bytes = Buffer.alloc(length)
        if (typeof source === 'string') {
          const { bytesRead } = await handle!.read(bytes, 0, length, offset)
          if (bytesRead !== length) throw new Error('源文件在上传时发生变化，请重新备份。')
        } else source.copy(bytes, 0, offset, offset + length)
        let response: Response | undefined
        try { response = await put('bytes ' + offset + '-' + (offset + length - 1) + '/' + size, new Uint8Array(bytes)) }
        catch (error) { if (retries >= 3) throw error }
        if (!response || response.status >= 500 || response.status === 429) {
          await response?.body?.cancel()
          if (++retries > 3) throw new Error('Google Drive 暂时无法续传，请重新开始备份。')
          await new Promise((resolve) => setTimeout(resolve, 1000 * retries))
          response = await put('bytes */' + size, new Uint8Array())
        }
        if (response.status !== 308) return await readGoogleJson(response)
        const end = /^bytes=0-(\d+)$/.exec(response.headers.get('range') || '')?.[1]
        await response.body?.cancel()
        const next = end === undefined ? 0 : Number(end) + 1
        if (next <= offset && ++retries > 3) throw new Error('Google Drive 续传无进展，请重新开始备份。')
        if (next > offset) retries = 0
        offset = next
      }
      return await readGoogleJson(await put('bytes */' + size, new Uint8Array()))
    } finally { await handle?.close() }
  }
}
