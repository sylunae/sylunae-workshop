import { Capacitor, registerPlugin } from '@capacitor/core'
import { LocalNotifications } from '@capacitor/local-notifications'
import type { AppSnapshot, ImageAsset, MusicImportProgress, MusicTrack, ResourceItem, ResourceSummary, SylunaeAPI } from '../shared/types'
import { createDefaultSnapshot } from '../shared/defaults'
import { whiteNoiseCatalog } from '../resources/whiteNoiseCatalog'
import { convertBrowserFile, inspectBrowserFile } from '../lib/formatConversion'
import { conversionFormats } from '../shared/conversion'
import { resolveAndroidFiles } from './transfer'
import { mediaSource } from './mediaSource'
import { decodeBytes, encodeBytes } from './binary'
import { nativeChunkSize, readAndroidSnapshot, writeAndroidSnapshot } from './androidStorage'
import { createAndroidDriveBackup } from './androidDriveBackup'
import { androidTranslation } from './translation'
export { decodeBytes, encodeBytes } from './binary'

interface FilesPlugin {
  run<T = Record<string, unknown>>(options: Record<string, unknown>): Promise<T>
  pick<T>(options: { kind: string; multiple?: boolean }): Promise<{ items: T[] }>
  exportFile(options: { name: string; contents?: string; path?: string; mime?: string; base64?: boolean }): Promise<{ saved: boolean }>
  openExternal(options: { url: string }): Promise<void>
  appearance(options: { dark: boolean; background: string }): Promise<void>
}
export const androidFiles = registerPlugin<FilesPlugin>('WorkshopFiles')
const run = <T>(op: string, options: Record<string, unknown> = {}) => androidFiles.run<T>({ op, ...options })
const unsupported = async (): Promise<never> => { throw new Error('此操作依赖桌面工具，请在桌面客户端使用。') }
const noopListener = () => () => {}
const audioMetadata = (path: string) => run<MusicTrack & { genre: string; year: number | null; track: number | null; comment: string }>('metadata', { path })
export async function privateMediaUrl(path: string) {
  const { uri } = await run<{ uri: string }>('uri', { path })
  return Capacitor.convertFileSrc(uri)
}
export async function exportAndroidBytes(name: string, bytes: Uint8Array, mime = 'application/octet-stream') {
  return (await androidFiles.exportFile({ name, contents: encodeBytes(bytes), base64: true, mime })).saved
}
async function notify(title: string, body: string) {
  let permissions = await LocalNotifications.checkPermissions()
  if (permissions.display === 'prompt') permissions = await LocalNotifications.requestPermissions()
  if (permissions.display !== 'granted') return false
  await LocalNotifications.schedule({ notifications: [{ id: Math.floor(Date.now() % 2147483647), title, body, isExactNotification: false }] })
  return true
}

export function createAndroidAPI(): SylunaeAPI {
  const importListeners = new Set<(progress: MusicImportProgress) => void>()
  let resourceQueue: Promise<unknown> = Promise.resolve()
  const resourceIndex = async () => (await run<{ value: ResourceItem[] | null }>('record:get', { key: 'resources' })).value ?? []
  const changeResources = <T>(change: (items: ResourceItem[]) => Promise<{ items: ResourceItem[]; result: T }>) => {
    const next = resourceQueue.then(async () => {
      const { items, result } = await change(await resourceIndex())
      await run('record:set', { key: 'resources', value: items }); return result
    })
    resourceQueue = next.catch(() => undefined); return next
  }
  const getSummary = async (): Promise<ResourceSummary> => {
    await resourceQueue
    const saved = await resourceIndex()
    const items: ResourceItem[] = [...whiteNoiseCatalog.map((item) => saved.find((entry) => entry.id === item.id) ?? { ...item, origin: item.builtin ? 'builtin' as const : 'official' as const, state: item.builtin ? 'builtin' as const : 'available' as const, installedSize: 0 }), ...saved.filter((item) => item.origin === 'custom')]
    return { items, installedBytes: items.reduce((sum, item) => sum + item.installedSize, 0), availableBytes: items.filter((item) => item.state === 'available').reduce((sum, item) => sum + item.size, 0), remoteConfigured: Boolean(import.meta.env.MAIN_VITE_RESOURCE_PUBLIC_BASE_URL) }
  }
  const pickImages = async () => (await androidFiles.pick<ImageAsset>({ kind: 'image' })).items
  const checkPaths = async (paths: string[]) => (await run<{ paths: Record<string, boolean> }>('exists', { paths })).paths
  const urls = async (paths: string[]) => Object.fromEntries(await Promise.all(paths.map(async (path) => {
    try { return [path, await privateMediaUrl(path)] } catch { return [path, ''] }
  })))
  const sourceFiles = new Map<string, File>()
  const converted = new Map<string, { name: string; blob: Blob }>()
  return {
    platform: 'android',
    translation: androidTranslation,
    driveBackup: createAndroidDriveBackup(run),
    storage: {
      load: async () => resolveAndroidFiles({ ...createDefaultSnapshot(), ...await readAndroidSnapshot(run) }, checkPaths),
      save: (patch) => writeAndroidSnapshot(run, patch, false),
      replace: (snapshot, whiteNoise) => writeAndroidSnapshot(run, snapshot, true, whiteNoise),
      putNoteAsset: async (bytes, mime) => (await run<{ id: string }>('putAsset', { data: encodeBytes(bytes), mime })).id,
      getNoteAsset: async (id) => { const asset = await run<{ data?: string; mime: string }>('getAsset', { id }); return asset.data ? { bytes: decodeBytes(asset.data), mime: asset.mime } : null },
    },
    music: {
      pick: async () => (await androidFiles.pick<MusicTrack>({ kind: 'music' })).items,
      getDownloadDirectory: async () => '应用私有目录 / music',
      pickDownloadDirectory: async () => null,
      importRemote: async (input) => {
        if (input.source !== 'audio-url') return unsupported()
        const url = new URL(input.url)
        if (url.protocol !== 'https:') throw new Error('Android 音频下载请使用 HTTPS 直链。')
        const name = (decodeURIComponent(url.pathname.split('/').at(-1) || 'download.audio').replace(/[\\/:*?"<>|\x00-\x1f]/g, '_') || 'download.audio').slice(0, 160)
        const report = (stage: MusicImportProgress['stage'], message: string) => importListeners.forEach((listener) => listener({ taskId: input.taskId, source: 'audio-url', stage, message, percent: null }))
        report('downloading', '正在下载音频到应用内…')
        const saved = await run<{ path: string }>('download', { url: url.toString(), path: `music/import-${crypto.randomUUID()}.part`, music: true, name })
        report('metadata', '正在读取音频信息…')
        const track = await audioMetadata(saved.path)
        report('complete', '音频已下载并加入资料库。')
        return track
      }, searchYoutube: unsupported,
      onImportProgress: (listener) => { importListeners.add(listener); return () => { importListeners.delete(listener) } }, onMediaToolsProgress: noopListener,
      getMediaToolsStatus: async () => ({ ready: false, installing: false, components: [], installedBytes: 0 }),
      installMediaTools: unsupported,
      relocate: async (id) => { const item = (await androidFiles.pick<MusicTrack>({ kind: 'music', multiple: false })).items[0]; return item ? { ...item, id } : null },
      checkPaths, getAudioUrl: privateMediaUrl,
      showInFolder: async (path) => {
        const item = await audioMetadata(path)
        // The system's save picker lets the user export a private file explicitly.
        await androidFiles.exportFile({ path, name: path.split('/').at(-1) || item.title, mime: 'audio/*' })
      },
      readMetadata: async (path) => { const metadata = await audioMetadata(path); return { ...metadata, cover: mediaSource(metadata.cover) } },
      updateMetadata: (input) => run('updateMetadata', { update: { ...input, cover: input.cover.mode === 'replace' ? { ...input.cover, data: encodeBytes(input.cover.data) } : input.cover } }),
    },
    images: {
      pick: pickImages,
      pickFile: async () => { const item = (await androidFiles.pick<ImageAsset>({ kind: 'image', multiple: false })).items[0]; return item ? { name: item.name, path: item.path } : null },
      pickRoot: unsupported, scan: unsupported, cancelScan: async () => {}, onScanProgress: noopListener, relocateRoot: unsupported,
      relocateAsset: async (id, library) => { const replacement = (await androidFiles.pick<ImageAsset>({ kind: 'image', multiple: false })).items[0]; return replacement ? { ...library, assets: library.assets.map((asset) => asset.id === id ? { ...replacement, id, collectionIds: asset.collectionIds, createdAt: asset.createdAt } : asset) } : null },
      checkPaths, getUrls: urls, getThumbnailUrls: async (requests) => {
        const { uris } = await run<{ uris: Record<string, string> }>('thumbnails', { requests })
        return Object.fromEntries(Object.entries(uris).map(([path, uri]) => [path, uri ? Capacitor.convertFileSrc(uri) : '']))
      },
    },
    backup: {
      exportFile: async (contents, name = `sylunae-backup-${new Date().toISOString().slice(0, 10)}.json`) => {
        const path = `exports/${crypto.randomUUID()}.json`, bytes = new TextEncoder().encode(contents)
        try {
          for (let start = 0; start < bytes.length; start += nativeChunkSize) await run('export:append', { path, first: start === 0, data: encodeBytes(bytes.subarray(start, start + nativeChunkSize)) })
          return (await androidFiles.exportFile({ path, name })).saved
        } finally { await run('remove', { path }).catch(() => undefined) }
      },
      importFile: async () => {
        const item = (await androidFiles.pick<{ uri: string; name: string }>({ kind: 'backup', multiple: false })).items[0]
        if (!item) return null
        try {
          const response = await fetch(Capacitor.convertFileSrc(item.uri))
          if (!response.ok) throw new Error('无法读取整理后的备份文件')
          return await response.text()
        } finally { await run('backup:release', { name: item.name }).catch(() => undefined) }
      },
    },
    resources: {
      list: getSummary,
      openDirectory: unsupported,
      download: (id) => changeResources(async (items) => {
        const item = whiteNoiseCatalog.find((entry) => entry.id === id)
        if (!item) throw new Error('资源不存在')
        const base = import.meta.env.MAIN_VITE_RESOURCE_PUBLIC_BASE_URL
        if (!base && !item.builtin) throw new Error('尚未配置资源下载地址')
        const path = `resources/${item.id}.audio`
        const saved = item.builtin ? await run<{ size: number }>('bundled', { asset: item.audioPath, path }) : await run<{ size: number }>('download', { url: new URL(item.audioPath, `${base?.replace(/\/+$/, '')}/`).toString(), path, sha256: item.sha256 })
        const resource: ResourceItem = { ...item, origin: item.builtin ? 'builtin' : 'official', state: 'installed', installedSize: saved.size, localPath: path }
        return { items: [...items.filter((entry) => entry.id !== id), resource], result: resource }
      }),
      remove: (id) => changeResources(async (items) => {
        const item = items.find((entry) => entry.id === id)
        // Cloud media can still be referenced by another item or by the rollback snapshot.
        if (item?.localPath && !item.localPath.startsWith('drive-media/')) await run('remove', { path: item.localPath })
        return { items: items.filter((entry) => entry.id !== id), result: undefined }
      }),
      importWhiteNoise: () => changeResources(async (items) => {
        const track = (await androidFiles.pick<MusicTrack>({ kind: 'resource', multiple: false })).items[0]
        if (!track) return { items, result: null }
        const item: ResourceItem = { id: `custom-${track.id}`, kind: 'white-noise', title: track.title, description: '自行导入的音频', tags: [], coverPath: '', audioPath: '', duration: track.duration, size: 0, sha256: '', builtin: false, attribution: { creator: '', sourceTitle: '', sourceUrl: '', license: '', licenseUrl: '' }, origin: 'custom', state: 'installed', installedSize: 0, localPath: track.path }
        return { items: [...items.filter((entry) => entry.id !== item.id), item], result: item }
      }),
      getAudioUrl: async (id) => { const item = (await getSummary()).items.find((entry) => entry.id === id); if (!item) throw new Error('资源不存在'); if (item.localPath) return privateMediaUrl(item.localPath); if (item.builtin) return item.audioPath; throw new Error('请先下载资源') },
      onDownloadProgress: noopListener,
    },
    system: {
      setTheme: (theme, background) => androidFiles.appearance({ dark: theme === 'dark', background }),
      themeReady: () => {}, getTheme: async () => matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light',
      openExternal: (url) => androidFiles.openExternal({ url }), findFavicon: async () => null, getLinkPreview: async () => null,
      notifyBirthday: (body) => notify('生日提醒', body),
      notifyPomodoroComplete: async (focus) => { await notify('番茄钟', focus ? '专注结束，休息一下吧。' : '休息结束，开始下一段专注。') },
      pickPomodoroAlarm: async () => (await androidFiles.pick<MusicTrack>({ kind: 'alarm', multiple: false })).items[0]?.path ?? null,
      getPomodoroAlarmUrl: (path) => privateMediaUrl(path),
    },
    imageProcessing: {
      rememberImport: async () => {}, pickFolder: unsupported, scanFolder: unsupported, processFolder: unsupported, saveFolder: unsupported,
      getDirectory: async () => '系统文件选择器', pickDirectory: async () => 'system', openDirectory: unsupported,
      save: async (name, bytes) => { const saved = await exportAndroidBytes(name, new Uint8Array(bytes), `image/${name.split('.').pop()}`); if (!saved) throw new Error('已取消保存'); return name },
    },
    formatConversion: {
      capabilities: async () => ({ ffmpeg: false, office: false, image: ['jpg', 'png', 'webp'] }),
      inspect: async (file) => { const source = await inspectBrowserFile(file); sourceFiles.set(source.id, file); return source },
      convert: async (id, target, quality) => {
        const file = sourceFiles.get(id); if (!file) throw new Error('请重新选择文件')
        const source = await inspectBrowserFile(file); const blob = await convertBrowserFile(file, source, target, quality)
        const resultId = crypto.randomUUID(); const name = `${file.name.replace(/\.[^.]+$/, '')}.${target}`
        converted.set(resultId, { name, blob }); return { id: resultId, name, size: blob.size }
      },
      save: async (ids) => { let count = 0; for (const id of ids) { const item = converted.get(id); if (item && await exportAndroidBytes(item.name, new Uint8Array(await item.blob.arrayBuffer()), item.blob.type || conversionFormats.find((format) => item.name.endsWith(`.${format.id}`))?.mime)) count++ } return count },
      release: async (ids) => { ids.forEach((id) => { sourceFiles.delete(id); converted.delete(id) }) }, cancel: async () => {},
    },
  }
}

export function installAndroidAPI() {
  if (Capacitor.getPlatform() === 'android') {
    window.sylunae = createAndroidAPI()
    document.documentElement.dataset.platform = 'android'
  }
}
