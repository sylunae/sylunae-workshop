import { z } from 'zod'
import { snapshotSectionKeys } from '../data/snapshotSections'
import type { AppSnapshot } from './types'
import { createDefaultSnapshot } from './defaults'

export const driveBackupFormat = 'sylunae-drive-backup'
export const driveSectionKeys = [...snapshotSectionKeys, 'customWhiteNoise'] as const
export const driveHash = /^[a-f0-9]{64}$/
export const driveFileId = /^[A-Za-z0-9_-]{1,256}$/
export const driveMediaRef = /^sylunae-drive:(path|inline|note):([a-f0-9]{64})(\.[a-z0-9]{1,10})?$/

const objectSchema = z.object({
  id: z.string().regex(driveFileId),
  sha256: z.string().regex(driveHash),
  size: z.number().int().nonnegative(),
  mime: z.string().regex(/^[\w.+-]+\/[\w.+-]+$/),
})

export type DriveObject = z.infer<typeof objectSchema>

export const driveManifestSchema = z.object({
  format: z.literal(driveBackupFormat),
  version: z.literal(1),
  createdAt: z.iso.datetime(),
  device: z.string(),
  sections: z.record(z.enum(driveSectionKeys), objectSchema),
  media: z.array(objectSchema),
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
export type DriveBackupInfo = Pick<DriveManifest, 'createdAt' | 'device' | 'counts'> & { id: string; bytes: number }
export type DriveAccount = { id: string; label: string; availableBytes?: number }
export type DriveProgress = { message: string; completed: number; total: number }
export type DriveUploadResult = { createdAt: string; uploaded: number; reused: number }
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
  status: () => Promise<{ configured: boolean; connected: boolean; account?: DriveAccount }>
  connect: () => Promise<DriveAccount>
  disconnect: () => Promise<void>
}
export type DriveBackupAPI = DriveConnection & ({
  mode: 'upload'
  configure: () => Promise<boolean>
  prepare: () => Promise<DriveUploadPlan>
  upload: (token: string) => Promise<DriveUploadResult>
  onProgress: (listener: (progress: DriveProgress) => void) => () => void
} | {
  mode: 'restore'
  latest: () => Promise<DriveBackupInfo | null>
  download: (id: string, onProgress: (progress: DriveProgress) => void) => Promise<{ snapshot: AppSnapshot; whiteNoise: DriveWhiteNoise }>
  hasRollback: () => Promise<boolean>
  rollback: () => Promise<void>
})

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
