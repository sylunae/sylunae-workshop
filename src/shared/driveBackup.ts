import { z } from 'zod'
import { snapshotSectionKeys } from '../data/snapshotSections'
import type { AppSnapshot } from './types'
import { createDefaultSnapshot } from './defaults'

export const driveBackupFormat = 'sylunae-drive-backup'
export const driveSectionKeys = [...snapshotSectionKeys, 'customWhiteNoise'] as const
const requiredDriveSections = driveSectionKeys.filter((key) => key !== 'collectionExtras')
export const driveHash = /^[a-f0-9]{64}$/
export const driveFileId = /^[A-Za-z0-9_-]{1,256}$/
export const driveMediaRef = /^sylunae-drive:(path|inline|note):([a-f0-9]{64})(\.[a-z0-9]{1,10})?$/

export const driveObjectSchema = z.object({
  id: z.string().regex(driveFileId),
  sha256: z.string().regex(driveHash),
  size: z.number().int().nonnegative(),
  mime: z.string().regex(/^[\w.+-]+\/[\w.+-]+$/),
})
const ancestorWindow = 256

export type DriveObject = z.infer<typeof driveObjectSchema>

export const driveManifestSchema = z.object({
  format: z.literal(driveBackupFormat),
  version: z.literal(1),
  createdAt: z.iso.datetime(),
  device: z.string(),
  ancestors: z.array(z.string().regex(driveFileId)).max(ancestorWindow).optional(),
  writeId: z.uuid().optional(),
  sections: z.object({
    ...Object.fromEntries(requiredDriveSections.map((key) => [key, driveObjectSchema])) as Record<typeof requiredDriveSections[number], typeof driveObjectSchema>,
    collectionExtras: driveObjectSchema.optional(),
  }).strict(),
  media: z.array(driveObjectSchema),
  counts: z.object({
    notes: z.number().int().nonnegative(),
    tracks: z.number().int().nonnegative(),
    images: z.number().int().nonnegative(),
  }),
}).superRefine(({ media }, context) => {
  if (new Set(media.map(({ sha256 }) => sha256)).size !== media.length) {
    context.addIssue({ code: 'custom', path: ['media'], message: '备份清单包含重复资源' })
  }
})

export type DriveManifest = z.infer<typeof driveManifestSchema>
export type DriveBackupInfo = Pick<DriveManifest, 'createdAt' | 'device' | 'counts' | 'ancestors' | 'writeId'> & { id: string; bytes: number }
export type DriveAccount = { id: string; label: string; availableBytes?: number }
export type DriveProgress = { message: string; completed: number; total: number }
export type DriveUploadResult = { id: string; createdAt: string; uploaded: number; reused: number }
export type DriveRestorePlan = DriveBackupInfo & { downloadFiles: number; reuseFiles: number; downloadBytes: number }
export type DriveRestoredObject = { file: string; reused: boolean }
export const drivePublishGuard = z.object({ accountId: z.string().min(1), head: z.string().regex(driveFileId).nullable(), writeId: z.uuid().optional() })
export type DrivePublishGuard = z.infer<typeof drivePublishGuard>
export const driveHeadChanged = '云端版本在同步期间发生变化。'
export const driveAncestors = (head: DriveBackupInfo | null) => head ? [head.id, ...(head.ancestors ?? [])].slice(0, ancestorWindow) : []
export type DriveUploadPlan = DriveManifest['counts'] & {
  token: string
  account: DriveAccount
  uploadBytes: number
  uploadFiles: number
  reuseFiles: number
  missing: string[]
}

export type DriveMediaKind = 'path' | 'inline' | 'note'
export type DriveMediaTransform = (source: string, kind: DriveMediaKind, label: string) => Promise<string>

export const customWhiteNoiseSchema = z.array(z.object({
  id: z.string().min(1),
  title: z.string(),
  localPath: z.string().min(1),
  duration: z.number().nonnegative(),
  size: z.number().int().nonnegative(),
}))
export type DriveWhiteNoise = z.infer<typeof customWhiteNoiseSchema>

type DriveConnection = {
  importDevelopmentClient?: () => Promise<boolean>
  status: () => Promise<{ configured: boolean; connected: boolean; account?: DriveAccount }>
  connect: () => Promise<DriveAccount>
  cancelConnect?: () => Promise<void>
  disconnect: () => Promise<void>
}
export type DriveBackupAPI = DriveConnection & {
  notebook?: import('./driveNotebook').DriveNotebookAPI
  account: () => Promise<DriveAccount>
  prepare: (snapshot: AppSnapshot, whiteNoise?: DriveWhiteNoise) => Promise<DriveUploadPlan>
  upload: (token: string, onProgress: (progress: DriveProgress) => void, guard?: DrivePublishGuard) => Promise<DriveUploadResult>
  latest: () => Promise<DriveBackupInfo | null>
  revision: (id: string) => Promise<DriveBackupInfo>
  previewRestore: () => Promise<DriveRestorePlan | null>
  download: (id: string, onProgress: (progress: DriveProgress) => void) => Promise<{ snapshot: AppSnapshot; whiteNoise: DriveWhiteNoise; downloaded: number; reused: number }>
  hasRollback: () => Promise<boolean>
  rollback: () => Promise<void>
}

export async function followsDriveRevision(head: DriveBackupInfo | null, base: string, revision: DriveBackupAPI['revision']) {
  const seen = new Set<string>()
  let candidate = head
  while (candidate && !seen.has(candidate.id)) {
    const { id, ancestors } = candidate
    if (id === base || ancestors?.includes(base)) return true
    if (ancestors?.length !== ancestorWindow) return false
    seen.add(id)
    candidate = await revision(ancestors[ancestorWindow - 1])
  }
  return false
}

export const driveExtensions: Record<string, string> = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp',
  '.gif': 'image/gif', '.bmp': 'image/bmp', '.avif': 'image/avif', '.svg': 'image/svg+xml',
  '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.wav': 'audio/wav',
  '.ogg': 'audio/ogg', '.oga': 'audio/ogg', '.opus': 'audio/ogg', '.flac': 'audio/flac',
}
export const driveExtensionForMime = (mime: string) => Object.keys(driveExtensions).find((extension) => driveExtensions[extension] === mime) ?? '.bin'

export function driveObjects(manifest: DriveManifest) {
  return new Map([...Object.values(manifest.sections), ...manifest.media].map((object) => [object.sha256, object]))
}

export function describeDriveBackup(id: string, manifest: DriveManifest): DriveBackupInfo {
  const { createdAt, device, counts, ancestors, writeId } = manifest
  return { id, createdAt, device, counts, ancestors, writeId, bytes: [...driveObjects(manifest).values()].reduce((total, item) => total + item.size, 0) }
}

/** Media fields are explicit so note text and arbitrary user metadata stay untouched. */
export async function mapDriveSnapshotMedia(snapshot: AppSnapshot, map: DriveMediaTransform): Promise<AppSnapshot> {
  const inline = (source: string, label: string) => source ? map(source, 'inline', label) : Promise.resolve(source)
  const path = (source: string, label: string) => source ? map(source, 'path', label) : Promise.resolve(source)
  const mapItems = async <T, R>(items: T[], transform: (item: T) => Promise<R>) => {
    const result: R[] = []
    for (const item of items) result.push(await transform(item))
    return result
  }
  const noteNode = async (node: AppSnapshot['notes'][number]['content'], label: string): Promise<typeof node> => {
    const image = node.type === 'image' ? node.attrs?.src : undefined
    const attrs = typeof image === 'string' && image
      ? { ...node.attrs, src: await map(image, 'note', label) }
      : node.attrs
    return { ...node, attrs, content: node.content && await mapItems(node.content, (child) => noteNode(child, label)) }
  }
  const settings = snapshot.settings
  const companion = Array.isArray(settings.deskCompanion?.characters) ? settings.deskCompanion : createDefaultSnapshot().settings.deskCompanion
  return {
    ...snapshot,
    settings: {
      ...settings,
      pomodoroAlarmPath: await path(settings.pomodoroAlarmPath, '番茄钟铃声'),
      homeWallpaper: await inline(settings.homeWallpaper, '首页壁纸'),
      homeWallpapers: await mapItems(settings.homeWallpapers, async (item) => ({
        ...item, image: await inline(item.image, item.title || '首页壁纸'),
      })),
      deskCompanion: {
        ...companion,
        characters: await mapItems(companion.characters, async (character) => ({
          ...character,
          image: await inline(character.image, character.name),
          pressSound: await inline(character.pressSound, `${character.name}按下音效`),
          releaseSound: await inline(character.releaseSound, `${character.name}松开音效`),
        })),
      },
    },
    tracks: await mapItems(snapshot.tracks, async (track) => ({
      ...track, path: await path(track.path, track.title), cover: await inline(track.cover, `${track.title}封面`),
    })),
    albums: await mapItems(snapshot.albums, async (album) => ({ ...album, cover: await inline(album.cover, `${album.title}封面`) })),
    notes: await mapItems(snapshot.notes, async (note) => ({ ...note, content: await noteNode(note.content, note.title || '笔记附件') })),
    collectionExtras: {
      ...snapshot.collectionExtras,
      stickerPacks: await mapItems(snapshot.collectionExtras.stickerPacks, async (pack) => ({
        ...pack,
        stickers: await mapItems(pack.stickers, async (sticker) => ({
          ...sticker, src: await map(sticker.src, 'note', sticker.name || sticker.fileName),
        })),
      })),
    },
    imageLibrary: {
      ...snapshot.imageLibrary,
      assets: await mapItems(snapshot.imageLibrary.assets, async (asset) => ({ ...asset, path: await path(asset.path, asset.name) })),
    },
    countdowns: await mapItems(snapshot.countdowns, async (item) => ({ ...item, coverImagePath: await path(item.coverImagePath, `${item.title}背景`) })),
    launcherLinks: await mapItems(snapshot.launcherLinks, async (item) => ({
      ...item, faviconUrl: item.faviconUrl && await inline(item.faviconUrl, `${item.title}图标`),
    })),
  }
}
