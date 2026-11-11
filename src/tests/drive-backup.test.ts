// @vitest-environment node
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { registerGoogleDriveBackup } from '../../electron/main/googleDriveBackup'
import { createDefaultSnapshot } from '../shared/defaults'
import { driveManifestSchema } from '../shared/driveBackup'
import type { AppSnapshot } from '../shared/types'

const mock = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, token?: string) => Promise<unknown>>(),
  load: vi.fn(),
  directory: '',
}))
vi.mock('electron', () => ({ app: { getPath: () => mock.directory }, ipcMain: { handle: (key: string, fn: never) => mock.handlers.set(key, fn) } }))
vi.mock('../../electron/main/database', () => ({ loadSnapshot: mock.load, getNoteAsset: () => null, putNoteAsset: (bytes: Buffer) => hash(bytes) }))
vi.mock('../../electron/main/resourceManager', () => ({ listResources: async () => ({ items: [] }) }))
vi.mock('../../electron/main/googleDriveAuth', () => ({
  GoogleDriveAuth: class { async token() { return 'test-token' } },
  readGoogleJson: async (response: Response) => {
    if (!response.ok) throw new Error('HTTP ' + response.status)
    return response.json()
  },
}))

afterEach(() => vi.unstubAllGlobals())

const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')
const call = (key: string, token?: string) => mock.handlers.get('drive:' + key)!({ sender: { isDestroyed: () => true } }, token)

function setupDrive() {
  const saved = new Map<string, { bytes: Buffer; role: string }>()
  const sessions = new Map<string, { role: string; bytes: Buffer }>()
  const record = (role: string, bytes: Buffer) => {
    const id = 'file-' + saved.size
    saved.set(id, { role, bytes })
    return Response.json({ id, size: String(bytes.length), sha256Checksum: hash(bytes) })
  }
  let rejectMedia = false
  vi.stubGlobal('fetch', vi.fn(async (url: string, options: RequestInit) => {
    expect(new Headers(options.headers).get('Authorization')).toBe('Bearer test-token')
    const address = new URL(url)
    if (address.pathname.endsWith('/about')) return Response.json({ user: { permissionId: 'account-id', emailAddress: 'test@example.com' } })
    if (address.searchParams.get('alt') === 'media') {
      const file = saved.get(address.pathname.split('/').at(-1)!)
      return file ? new Response(new Uint8Array(file.bytes)) : new Response(null, { status: 404 })
    }
    const mode = address.searchParams.get('uploadType')
    if (mode === 'multipart') {
      const body = Buffer.from(options.body as Uint8Array)
      const boundary = new Headers(options.headers).get('Content-Type')!.split('boundary=')[1]
      const headerEnd = body.indexOf('\r\n\r\n') + 4
      const endMetadata = body.indexOf('\r\n--' + boundary, headerEnd)
      const metadata = JSON.parse(body.subarray(headerEnd, endMetadata).toString())
      const dataStart = body.indexOf('\r\n\r\n', endMetadata) + 4
      const dataEnd = body.lastIndexOf('\r\n--' + boundary)
      return record(metadata.appProperties.sylunae, body.subarray(dataStart, dataEnd))
    }
    if (mode === 'resumable') {
      const session = 'https://www.googleapis.com/upload/drive/v3/files?upload_id=' + sessions.size
      const metadata = JSON.parse(options.body as string)
      sessions.set(session, { role: metadata.appProperties.sylunae, bytes: Buffer.alloc(0) })
      return new Response(null, { headers: { Location: session } })
    }
    const session = sessions.get(url)
    if (session) {
      if (rejectMedia) return new Response(null, { status: 403 })
      const contentRange = new Headers(options.headers).get('Content-Range')!
      const range = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(contentRange)!
      expect(Number(range[1])).toBe(session.bytes.length)
      session.bytes = Buffer.concat([session.bytes, Buffer.from(options.body as Uint8Array)])
      return session.bytes.length === Number(range[3])
        ? record(session.role, session.bytes)
        : new Response(null, { status: 308, headers: { Range: 'bytes=0-' + range[2] } })
    }
    const manifest = address.searchParams.get('orderBy') === 'createdTime desc'
    const records = [...saved].filter(([, value]) => value.role === (manifest ? 'manifest-v1' : 'object-v1'))
    return Response.json({
      files: (manifest ? records.slice(-1) : records).map(([id, { bytes }]) => ({
        id, size: String(bytes.length), sha256Checksum: hash(bytes),
      })),
    })
  }))
  return {
    saved,
    rejectMedia: () => { rejectMedia = true },
    manifests: () => [...saved.values()].filter(({ role }) => role === 'manifest-v1').map(({ bytes }) => driveManifestSchema.parse(JSON.parse(bytes.toString()))),
  }
}

it('uploads separate verified objects, reuses media on a note edit, and keeps the last manifest on a failed upload', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sylunae-drive-test-'))
  mock.directory = directory
  try {
    const image = join(directory, 'test.png')
    const audio = join(directory, 'test.mp3')
    await writeFile(image, 'original image')
    const music = Buffer.alloc(9 * 1024 * 1024, 97)
    await writeFile(audio, music)
    const snapshot = createDefaultSnapshot()
    const dates = { createdAt: snapshot.settings.updatedAt, updatedAt: snapshot.settings.updatedAt }
    snapshot.tracks = [{ id: 'track', path: audio, title: '歌曲', cover: '', artist: '', album: '', albumArtist: '', albumId: null, duration: 1, missing: false, ...dates }]
    snapshot.imageLibrary.assets = [{ id: 'image', path: image, name: '图片', rootId: null, collectionIds: [], relativePath: 'test.png', extension: 'png',
      size: 14, mtimeMs: 0, width: 1, height: 1, aspectType: 'square', identity: 'image', hash: hash(Buffer.from('original image')), missing: false, metadata: {}, ...dates }]
    snapshot.notes = [{ id: 'note', title: '笔记', folderId: null, tags: [], pinned: false, deletedAt: null,
      createdAt: snapshot.settings.updatedAt, updatedAt: snapshot.settings.updatedAt, content: { type: 'doc', content: [
      { type: 'image', attrs: { src: 'data:image/png;base64,' + Buffer.from('original image').toString('base64') } },
    ] } }]
    mock.load.mockImplementation(() => snapshot)
    const drive = setupDrive()
    registerGoogleDriveBackup()

    const first = await call('prepare') as { token: string; missing: string[] }
    expect(first.missing).toEqual([])
    await call('upload', first.token)
    const [manifest] = drive.manifests()
    expect(manifest.media).toHaveLength(2)
    expect(drive.saved.get(manifest.media.find((item) => item.sha256 === hash(music))!.id)!.bytes.equals(music)).toBe(true)
    const notes = JSON.parse(drive.saved.get(manifest.sections.notes.id)!.bytes.toString())
    expect(notes[0].content.content[0].attrs.src).toBe('sylunae-drive:note:' + hash(Buffer.from('original image')))
    const firstPreview = await call('latest') as { id: string }

    snapshot.notes[0].title = '改过的笔记'
    const next = await call('prepare') as { token: string; uploadFiles: number }
    expect(next.uploadFiles).toBe(1)
    expect(await call('upload', next.token)).toMatchObject({ uploaded: 1 })
    expect(drive.manifests()[1].media).toEqual(manifest.media)
    expect(drive.manifests()[1].sections.notes.id).not.toBe(manifest.sections.notes.id)
    await expect(call('download', firstPreview.id)).rejects.toThrow('云端备份已更新')
    const latest = await call('latest') as { id: string }
    const restored = await call('download', latest.id) as { snapshot: AppSnapshot }
    expect(restored.snapshot.notes[0].title).toBe('改过的笔记')
    expect((await readFile(restored.snapshot.tracks[0].path)).equals(music)).toBe(true)
    expect(await readFile(restored.snapshot.imageLibrary.assets[0].path, 'utf8')).toBe('original image')

    await writeFile(audio, 'new music')
    const failed = await call('prepare') as { token: string }
    drive.rejectMedia()
    await expect(call('upload', failed.token)).rejects.toThrow('HTTP 403')
    expect(drive.manifests()).toHaveLength(2)

    await rm(audio)
    const missing = await call('prepare') as { token: string; missing: string[] }
    expect(missing.missing[0]).toContain('歌曲')
    await expect(call('upload', missing.token)).rejects.toThrow('缺失文件')
  } finally { await rm(directory, { recursive: true, force: true }) }
})
