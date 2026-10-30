import { z } from 'zod'
import type { AppSettings, AppSnapshot, BackupEnvelope, PartialBackupEnvelope, PartialBackupSection } from '../shared/types'
import { normalizeThemePalettes } from '../shared/theme'
import { normalizeImageLibrary } from '../images/library'
import { normalizeBirthdays, validBirthdayDate } from '../birthdays/reminders'
import { normalizeCountdowns } from '../countdowns/normalize'

const timestamp = z.string().min(1)
const jsonContentSchema: z.ZodType<Record<string, unknown>> = z.lazy(() => z.object({ type: z.string().optional(), text: z.string().optional(), attrs: z.record(z.string(), z.unknown()).optional(), marks: z.array(z.unknown()).optional(), content: z.array(jsonContentSchema).optional() }).passthrough())
const weatherLocationSchema = z.object({ name: z.string(), country: z.string(), admin1: z.string(), latitude: z.number(), longitude: z.number(), timezone: z.string() })
const defaultWeatherLocation = { name: '吉隆坡', country: '马来西亚', admin1: '', latitude: 3.139, longitude: 101.6869, timezone: 'Asia/Kuala_Lumpur' }
const weatherSnapshotSchema = z.object({ location: weatherLocationSchema, temperature: z.number(), apparent: z.number(), code: z.number(), daily: z.array(z.object({ minimum: z.number(), maximum: z.number(), code: z.number() })), fetchedAt: timestamp })
const homeWallpaperSchema = z.object({ id: z.string(), image: z.string(), title: z.string(), description: z.string() })
const settingsSchema = z.object({
  theme: z.enum(['system', 'light', 'dark']),
  themePalettes: z.object({
    light: z.record(z.string(), z.string()),
    dark: z.record(z.string(), z.string()),
  }).optional(),
  privateMode: z.boolean().optional().default(false),
  lastTool: z.enum(['library', 'goals', 'home', 'tasks', 'notes', 'music', 'collection', 'tools', 'settings']),
  sidebarCollapsed: z.boolean(),
  sidebarWidth: z.number().min(220).default(300),
  pomodoroAlarmPath: z.string().optional().default(''),
  displayName: z.string().optional().default('Pandora'),
  bangumiUsername: z.string(),
  homeWallpaper: z.string().optional().default(''),
  homeWallpapers: z.array(homeWallpaperSchema).max(5).optional().default([]),
  homeQuickActions: z.array(z.enum(['new-note', 'new-todo', 'pomodoro', 'music', 'collection'])).min(1).max(5).optional().default(['new-note', 'new-todo', 'pomodoro', 'music', 'collection']),
  weatherLocation: weatherLocationSchema.optional().default(defaultWeatherLocation),
  weatherCache: weatherSnapshotSchema.nullable().optional().default(null),
  recentTools: z.array(z.enum(['tasks', 'notes', 'music', 'collection', 'tools'])).optional().default([]),
  toolUsage: z.partialRecord(z.enum(['tasks', 'notes', 'music', 'collection', 'tools']), z.string()).optional().default({}),
  updatedAt: timestamp,
})
const bangumiItemSchema = z.object({
  subjectId: z.number().int(), subjectType: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(6)]), collectionType: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]),
  name: z.string(), nameCn: z.string(), summary: z.string(), cover: z.string(), score: z.number(), rank: z.number().nullable(), rate: z.number(), comment: z.string(), tags: z.array(z.string()),
  epStatus: z.number(), volStatus: z.number(), totalEpisodes: z.number(), airDate: z.string(), platform: z.string(), updatedAt: timestamp, url: z.string(),
})
const trackSchema = z.object({ id: z.string(), path: z.string(), title: z.string(), artist: z.string(), album: z.string(), albumArtist: z.string().optional().default(''), albumId: z.string().nullable().optional().default(null), duration: z.number().nonnegative(), cover: z.string(), missing: z.boolean(), createdAt: timestamp, updatedAt: timestamp })
const albumSchema = z.object({ id: z.string(), title: z.string(), artist: z.string(), cover: z.string(), createdAt: timestamp, updatedAt: timestamp, keepEmpty: z.boolean().optional().default(false) })
const folderSchema = z.object({ id: z.string(), name: z.string(), createdAt: timestamp, updatedAt: timestamp })
const noteSchema = z.object({ id: z.string(), title: z.string(), content: jsonContentSchema, folderId: z.string().nullable(), tags: z.array(z.string()), pinned: z.boolean(), deletedAt: timestamp.nullable(), createdAt: timestamp, updatedAt: timestamp })
const milestoneSchema = z.object({ id: z.string(), title: z.string(), dueDate: z.string(), completed: z.boolean(), progress: z.number().min(0).max(100).optional().default(0), weight: z.number().nonnegative().optional().default(1), createdAt: timestamp, updatedAt: timestamp })
const goalCheckInSchema = z.object({ id: z.string(), progress: z.number().min(0).max(100), confidence: z.number().min(1).max(5), note: z.string(), nextStep: z.string(), createdAt: timestamp })
const goalSchema = z.object({ id: z.string(), title: z.string(), description: z.string(), motivation: z.string().optional().default(''), status: z.enum(['active', 'paused', 'completed', 'archived']), parentId: z.string().nullable().optional().default(null), startDate: z.string(), dueDate: z.string(), progressMode: z.enum(['manual', 'metric', 'milestones', 'subgoals']).optional().default('milestones'), manualProgress: z.number().min(0).max(100).optional().default(0), metricStart: z.number().optional().default(0), metricCurrent: z.number().optional().default(0), metricTarget: z.number().optional().default(100), metricUnit: z.string().optional().default(''), reviewCadence: z.enum(['weekly', 'monthly', 'none']).optional().default('weekly'), nextReviewDate: z.string().optional().default(''), checkIns: z.array(goalCheckInSchema).optional().default([]), milestones: z.array(milestoneSchema), createdAt: timestamp, updatedAt: timestamp })
const todoSchema = z.object({ id: z.string(), title: z.string(), goalId: z.string().optional(), priority: z.enum(['low', 'medium', 'high']), dueDate: z.string(), completed: z.boolean(), completedAt: timestamp.nullable().optional().default(null), createdAt: timestamp, updatedAt: timestamp })
const recurringTodoSchema = z.object({
  id: z.string(), title: z.string(), priority: z.enum(['low', 'medium', 'high']), frequency: z.enum(['daily', 'weekly', 'monthly', 'interval']), startDate: z.string(),
  weekdays: z.array(z.number().int().min(0).max(6)).optional(), dayOfMonth: z.number().int().min(1).max(31).optional(), intervalDays: z.number().int().positive().optional(),
  paused: z.boolean().optional().default(false), createdAt: timestamp, updatedAt: timestamp,
})
const todoCompletionRecordSchema = z.object({ id: z.string(), recurringTodoId: z.string(), occurrenceDate: z.string(), completedAt: timestamp })
const pomodoroSchema = z.object({ mode: z.enum(['focus', 'shortBreak', 'longBreak']), focusMinutes: z.number(), shortBreakMinutes: z.number(), longBreakMinutes: z.number(), sessionsBeforeLongBreak: z.number(), completedSessions: z.number(), secondsRemaining: z.number(), running: z.boolean(), endsAt: z.string().nullable() })
const countdownSchema = z.object({
  id: z.string(), title: z.string(), targetDate: z.string(), category: z.enum(['birthday', 'anniversary', 'travel', 'event', 'other']), note: z.string(),
  yearly: z.boolean().optional(), targetTime: z.string().optional().default('09:00'), precise: z.boolean().optional().default(false),
  repeat: z.enum(['none', 'weekly', 'monthly', 'yearly']).optional(), mode: z.enum(['auto', 'countdown', 'countup']).optional().default('auto'),
  includeStartDay: z.boolean().optional().default(false), accent: z.enum(['neutral', 'rose', 'amber', 'sage', 'sky']).optional().default('neutral'),
  coverImagePath: z.string().optional().default(''), coverImageId: z.string().optional(), pinned: z.boolean(), createdAt: timestamp, updatedAt: timestamp,
}).transform((event) => ({ ...event, repeat: event.repeat ?? (event.yearly ? 'yearly' as const : 'none' as const) }))
const clipboardSchema = z.object({ id: z.string(), title: z.string(), content: z.string(), category: z.string(), copyCount: z.number().int().nonnegative().optional().default(0), createdAt: timestamp, updatedAt: timestamp })
const launcherSchema = z.object({ id: z.string(), title: z.string(), url: z.string(), description: z.string(), faviconUrl: z.string().optional(), archived: z.boolean().optional().default(false), createdAt: timestamp, updatedAt: timestamp })
const birthdaySchema = z.object({
  people: z.array(z.object({ id: z.string().min(1), name: z.string().min(1), date: z.string().refine(validBirthdayDate), enabled: z.boolean() })),
  settings: z.object({ enabled: z.boolean(), daysBefore: z.number().int().min(0).max(365), time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/), repeatCount: z.number().int().min(1).max(20), intervalHours: z.number().int().min(1).max(8760), external: z.boolean(), toast: z.boolean() }),
  deliveries: z.record(z.string(), z.object({ occurrence: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), count: z.number().int().nonnegative(), lastSentAt: z.string().refine((value) => Number.isFinite(Date.parse(value))) })),
}).optional().default(normalizeBirthdays())
const imageRootSchema = z.object({ id: z.string(), path: z.string(), name: z.string(), recursive: z.boolean(), identity: z.string(), missing: z.boolean(), createdAt: timestamp, updatedAt: timestamp, lastScannedAt: timestamp.nullable(), collectionId: z.string().nullable().optional() })
const imageCollectionSchema = z.object({ id: z.string(), name: z.string(), createdAt: timestamp, updatedAt: timestamp })
const imageAssetSchema = z.object({ id: z.string(), rootId: z.string().nullable().optional(), collectionIds: z.array(z.string()).optional(), path: z.string(), relativePath: z.string(), name: z.string(), extension: z.string(), size: z.number().nonnegative(), mtimeMs: z.number().nonnegative(), width: z.number().nonnegative(), height: z.number().nonnegative(), aspectType: z.enum(['landscape', 'portrait', 'square']), identity: z.string(), hash: z.string(), missing: z.boolean(), metadata: z.record(z.string(), z.unknown()).optional().default({}), createdAt: timestamp, updatedAt: timestamp })

const envelopeSchema = z.object({
  format: z.literal('siyue-workshop-backup'),
  version: z.literal(1),
  exportedAt: z.string(),
  snapshot: z.object({
    version: z.literal(1),
    settings: settingsSchema,
    bangumi: z.object({ username: z.string(), items: z.array(bangumiItemSchema), syncedAt: timestamp }).nullable(),
    tracks: z.array(trackSchema),
    albums: z.array(albumSchema).optional().default([]),
    folders: z.array(folderSchema),
    notes: z.array(noteSchema),
    goals: z.array(goalSchema),
    todos: z.array(todoSchema).optional().default([]),
    recurringTodos: z.array(recurringTodoSchema).optional().default([]),
    todoCompletionRecords: z.array(todoCompletionRecordSchema).optional().default([]),
    pomodoro: pomodoroSchema.optional().default({ mode: 'focus', focusMinutes: 25, shortBreakMinutes: 5, longBreakMinutes: 15, sessionsBeforeLongBreak: 4, completedSessions: 0, secondsRemaining: 1500, running: false, endsAt: null }),
    countdowns: z.array(countdownSchema).optional().default([]),
    clipboardSnippets: z.array(clipboardSchema).optional().default([]),
    launcherLinks: z.array(launcherSchema).optional().default([]),
    birthdays: birthdaySchema,
    imageLibrary: z.object({ roots: z.array(imageRootSchema), collections: z.array(imageCollectionSchema).optional().default([]), assets: z.array(imageAssetSchema) }).optional().default({ roots: [], collections: [], assets: [] }),
  }),
})

const partialSections = ['home', 'tasks', 'notes', 'music', 'collection', 'tools', 'settings'] as const satisfies readonly PartialBackupSection[]
const imageLibrarySchema = z.object({ roots: z.array(imageRootSchema), collections: z.array(imageCollectionSchema).optional().default([]), assets: z.array(imageAssetSchema) })
const partialPayloadSchemas: Record<PartialBackupSection, z.ZodType> = {
  home: z.object({ displayName: z.string(), homeWallpaper: z.string(), homeWallpapers: z.array(homeWallpaperSchema), homeQuickActions: z.array(z.enum(['new-note', 'new-todo', 'pomodoro', 'music', 'collection'])), weatherLocation: weatherLocationSchema, weatherCache: weatherSnapshotSchema.nullable() }),
  tasks: z.object({ goals: z.array(goalSchema), todos: z.array(todoSchema), recurringTodos: z.array(recurringTodoSchema).optional().default([]), todoCompletionRecords: z.array(todoCompletionRecordSchema).optional().default([]), pomodoro: pomodoroSchema, countdowns: z.array(countdownSchema).optional().default([]) }),
  notes: z.object({ folders: z.array(folderSchema), notes: z.array(noteSchema) }),
  music: z.object({ tracks: z.array(trackSchema), albums: z.array(albumSchema) }),
  collection: z.object({ bangumi: z.object({ username: z.string(), items: z.array(bangumiItemSchema), syncedAt: timestamp }).nullable(), bangumiUsername: z.string() }),
  tools: z.object({ birthdays: birthdaySchema, clipboardSnippets: z.array(clipboardSchema), launcherLinks: z.array(launcherSchema), imageLibrary: imageLibrarySchema }),
  settings: settingsSchema,
}

export function createBackup(snapshot: AppSnapshot): BackupEnvelope {
  return { format: 'siyue-workshop-backup', version: 1, exportedAt: new Date().toISOString(), snapshot }
}

export const partialBackupSectionMeta: Array<{ id: PartialBackupSection; label: string; description: string }> = [
  { id: 'home', label: '首页', description: '主页资料、壁纸、天气与快捷入口' },
  { id: 'tasks', label: '任务箱', description: '目标、待办、番茄钟与倒数日' },
  { id: 'notes', label: '笔记本', description: '笔记与文件夹' },
  { id: 'music', label: '音乐库', description: '音乐和专辑索引，不含原始文件' },
  { id: 'collection', label: '收藏馆', description: 'Bangumi 收藏缓存与用户名' },
  { id: 'tools', label: '工具箱', description: '剪贴板、链接启动器、生日通知与图片索引' },
  { id: 'settings', label: '设置', description: '主题、界面偏好和关联服务' },
]

export function createPartialBackup(snapshot: AppSnapshot, section: PartialBackupSection): PartialBackupEnvelope {
  const payload: Record<PartialBackupSection, unknown> = {
    home: (({ displayName, homeWallpaper, homeWallpapers, homeQuickActions, weatherLocation, weatherCache }) => ({ displayName, homeWallpaper, homeWallpapers, homeQuickActions, weatherLocation, weatherCache }))(snapshot.settings),
    tasks: (({ goals, todos, recurringTodos, todoCompletionRecords, pomodoro, countdowns }) => ({ goals, todos, recurringTodos, todoCompletionRecords, pomodoro, countdowns }))(snapshot),
    notes: (({ folders, notes }) => ({ folders, notes }))(snapshot),
    music: (({ tracks, albums }) => ({ tracks, albums }))(snapshot),
    collection: { bangumi: snapshot.bangumi, bangumiUsername: snapshot.settings.bangumiUsername },
    tools: (({ clipboardSnippets, launcherLinks, imageLibrary, birthdays }) => ({ clipboardSnippets, launcherLinks, imageLibrary, birthdays }))(snapshot),
    settings: snapshot.settings,
  }
  return { format: 'siyue-workshop-partial-backup', version: 1, section, exportedAt: new Date().toISOString(), payload: payload[section] }
}

export function parsePartialBackup(contents: string): PartialBackupEnvelope {
  const base = z.object({ format: z.literal('siyue-workshop-partial-backup'), version: z.literal(1), section: z.enum(partialSections), exportedAt: timestamp, payload: z.unknown() }).parse(JSON.parse(contents))
  const payload = partialPayloadSchemas[base.section].parse(base.payload)
  if (base.section === 'settings') return { ...base, payload: { ...(payload as AppSettings), themePalettes: normalizeThemePalettes((payload as AppSettings).themePalettes) } }
  if (base.section === 'tools') return { ...base, payload: { ...(payload as { imageLibrary: AppSnapshot['imageLibrary'] }), imageLibrary: normalizeImageLibrary((payload as { imageLibrary: AppSnapshot['imageLibrary'] }).imageLibrary) } }
  return { ...base, payload }
}

export function applyPartialBackup(current: AppSnapshot, backup: PartialBackupEnvelope): AppSnapshot {
  const updatedAt = new Date().toISOString()
  switch (backup.section) {
    case 'home': return { ...current, settings: { ...current.settings, ...(backup.payload as Pick<AppSettings, 'displayName' | 'homeWallpaper' | 'homeWallpapers' | 'homeQuickActions' | 'weatherLocation' | 'weatherCache'>), updatedAt } }
    case 'tasks': {
      const payload = backup.payload as Pick<AppSnapshot, 'goals' | 'todos' | 'recurringTodos' | 'todoCompletionRecords' | 'pomodoro' | 'countdowns'>
      return { ...current, ...payload, countdowns: normalizeCountdowns(payload.countdowns, current.imageLibrary.assets) }
    }
    case 'notes': return { ...current, ...(backup.payload as Pick<AppSnapshot, 'folders' | 'notes'>) }
    case 'music': return { ...current, ...(backup.payload as Pick<AppSnapshot, 'tracks' | 'albums'>) }
    case 'collection': {
      const payload = backup.payload as { bangumi: AppSnapshot['bangumi']; bangumiUsername: string }
      return { ...current, bangumi: payload.bangumi, settings: { ...current.settings, bangumiUsername: payload.bangumiUsername, updatedAt } }
    }
    case 'tools': return { ...current, ...(backup.payload as Pick<AppSnapshot, 'clipboardSnippets' | 'launcherLinks' | 'imageLibrary' | 'birthdays'>) }
    case 'settings': return { ...current, settings: { ...(backup.payload as AppSettings), updatedAt } }
  }
}

export function partialBackupSummary(backup: PartialBackupEnvelope): string {
  return partialBackupSectionMeta.find((item) => item.id === backup.section)?.label ?? '局部数据'
}

export function parseBackup(contents: string): BackupEnvelope {
  const backup = envelopeSchema.parse(JSON.parse(contents))
  const imageLibrary = normalizeImageLibrary(backup.snapshot.imageLibrary)
  return {
    ...backup,
    snapshot: {
      ...backup.snapshot,
      settings: { ...backup.snapshot.settings, themePalettes: normalizeThemePalettes(backup.snapshot.settings.themePalettes) },
      countdowns: normalizeCountdowns(backup.snapshot.countdowns, imageLibrary.assets),
      imageLibrary,
    },
  } as BackupEnvelope
}

export function backupSummary(backup: BackupEnvelope): string {
  const { snapshot } = backup
  return `笔记 ${snapshot.notes.length} 条、目标 ${snapshot.goals.length} 个、音乐索引 ${snapshot.tracks.length} 首、图片索引 ${snapshot.imageLibrary.assets.length} 张`
}
