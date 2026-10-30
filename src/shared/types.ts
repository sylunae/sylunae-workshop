import type { JSONContent } from '@tiptap/react'

export type ThemeMode = 'system' | 'light' | 'dark'
export type WorkspaceToolId = 'tasks' | 'notes' | 'music' | 'collection' | 'tools'
export type ToolId = 'home' | WorkspaceToolId | 'settings'
export type HomeQuickActionId = 'new-note' | 'new-todo' | 'pomodoro' | 'music' | 'collection'

export interface ThemePalette {
  bg: string
  surface: string
  surface2: string
  surface3: string
  sidebarBg: string
  text: string
  mutedText: string
  faint: string
  line: string
  brand: string
  accentSoft: string
  accentDeep: string
  danger: string
  dangerSoft: string
  success: string
  successSoft: string
}

export interface ThemePalettes {
  light: ThemePalette
  dark: ThemePalette
}

export interface HomeWallpaper {
  id: string
  image: string
  title: string
  description: string
}

export interface DeskCompanionCharacter {
  id: string
  name: string
  image: string
  dialogues: string[]
  pressSound: string
  pressSoundName: string
  releaseSound: string
  releaseSoundName: string
}

export interface DeskCompanionSettings {
  enabled: boolean
  scale: number
  dialogueMode: 'sequential' | 'random'
  activeCharacterId: string
  characters: DeskCompanionCharacter[]
}

export interface AppSettings {
  theme: ThemeMode
  themePalettes: ThemePalettes
  privateMode: boolean
  lastTool: ToolId
  sidebarCollapsed: boolean
  sidebarWidth: number
  pomodoroAlarmPath: string
  displayName: string
  bangumiUsername: string
  homeWallpaper: string
  homeWallpapers: HomeWallpaper[]
  homeQuickActions: HomeQuickActionId[]
  weatherLocation: WeatherLocation
  weatherCache: WeatherSnapshot | null
  deskCompanion: DeskCompanionSettings
  recentTools: WorkspaceToolId[]
  toolUsage: Partial<Record<WorkspaceToolId, string>>
  updatedAt: string
}

export interface WeatherLocation {
  name: string
  country: string
  admin1: string
  latitude: number
  longitude: number
  timezone: string
}

export interface WeatherSnapshot {
  location: WeatherLocation
  temperature: number
  apparent: number
  code: number
  daily: Array<{ minimum: number; maximum: number; code: number }>
  fetchedAt: string
}

export type BangumiSubjectType = 1 | 2 | 3 | 4 | 6
export type BangumiCollectionType = 1 | 2 | 3 | 4 | 5

export interface BangumiCollectionItem {
  subjectId: number
  subjectType: BangumiSubjectType
  collectionType: BangumiCollectionType
  name: string
  nameCn: string
  summary: string
  cover: string
  score: number
  rank: number | null
  rate: number
  comment: string
  tags: string[]
  epStatus: number
  volStatus: number
  totalEpisodes: number
  airDate: string
  platform: string
  updatedAt: string
  url: string
}

export interface BangumiProfileCache {
  username: string
  items: BangumiCollectionItem[]
  syncedAt: string
}

export type ImageAspectType = 'landscape' | 'portrait' | 'square'

export interface ImageLibraryRoot {
  id: string
  path: string
  name: string
  recursive: boolean
  identity: string
  missing: boolean
  createdAt: string
  updatedAt: string
  lastScannedAt: string | null
  collectionId: string | null
}

export interface ImageCollection {
  id: string
  name: string
  createdAt: string
  updatedAt: string
}

export interface ImageAsset {
  id: string
  rootId: string | null
  collectionIds: string[]
  path: string
  relativePath: string
  name: string
  extension: string
  size: number
  mtimeMs: number
  width: number
  height: number
  aspectType: ImageAspectType
  identity: string
  hash: string
  missing: boolean
  metadata: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

export interface ImageLibraryState {
  roots: ImageLibraryRoot[]
  collections: ImageCollection[]
  assets: ImageAsset[]
}

export type ImageScanStage = 'discovering' | 'indexing' | 'complete' | 'cancelled'

export interface ImageScanProgress {
  taskId: string
  stage: ImageScanStage
  message: string
  completed: number
  total: number | null
}

export interface MusicTrack {
  id: string
  path: string
  title: string
  artist: string
  album: string
  albumArtist: string
  albumId: string | null
  duration: number
  cover: string
  missing: boolean
  createdAt: string
  updatedAt: string
}

export interface MusicAlbum {
  id: string
  title: string
  artist: string
  cover: string
  createdAt: string
  updatedAt: string
  keepEmpty?: boolean
}

export interface MusicEditableMetadata {
  title: string
  artist: string
  album: string
  genre: string
  year: number | null
  track: number | null
  comment: string
  cover: string
}

export type MusicCoverUpdate =
  | { mode: 'keep' }
  | { mode: 'remove' }
  | { mode: 'replace'; data: Uint8Array; mimeType: 'image/jpeg' | 'image/png' }

export interface MusicMetadataUpdate {
  id: string
  path: string
  metadata: Omit<MusicEditableMetadata, 'cover'>
  cover: MusicCoverUpdate
}

export type MusicRemoteSource = 'youtube' | 'audio-url'

export type MusicImportStage = 'reading' | 'downloading' | 'converting' | 'metadata' | 'complete'

export interface MusicImportProgress {
  taskId: string
  source: MusicRemoteSource
  stage: MusicImportStage
  message: string
  percent: number | null
  receivedBytes?: number
  totalBytes?: number | null
}

export interface MusicRemoteImport {
  taskId: string
  source: MusicRemoteSource
  url: string
  directory: string
}

export interface YoutubeVideoSearchResult {
  id: string
  title: string
  channel: string
  duration: number | null
  url: string
}

export interface MediaToolComponentStatus {
  id: 'ffmpeg' | 'yt-dlp'
  label: string
  version: string
  installed: boolean
  installedBytes: number
}

export interface MediaToolsStatus {
  ready: boolean
  installing: boolean
  components: MediaToolComponentStatus[]
  installedBytes: number
}

export interface MediaToolsProgress {
  stage: 'downloading' | 'verifying' | 'complete'
  tool: 'ffmpeg' | 'yt-dlp' | null
  message: string
  receivedBytes: number
  totalBytes: number | null
  percent: number | null
}

export type ResourceKind = 'white-noise'
export type ResourceOrigin = 'builtin' | 'official' | 'custom'
export type ResourceInstallState = 'builtin' | 'available' | 'downloading' | 'installed' | 'error'
export type ManagedResourceDirectory = 'app-data' | 'music' | 'resources'

export interface ResourceAttribution {
  creator: string
  sourceTitle: string
  sourceUrl: string
  license: string
  licenseUrl: string
}

export interface ResourceCatalogItem {
  id: string
  kind: ResourceKind
  title: string
  description: string
  tags: string[]
  coverPath: string
  audioPath: string
  duration: number
  size: number
  sha256: string
  builtin: boolean
  attribution: ResourceAttribution
}

export interface ResourceItem extends ResourceCatalogItem {
  origin: ResourceOrigin
  state: ResourceInstallState
  installedSize: number
  localPath?: string
  createdAt?: string
}

export interface ResourceSummary {
  items: ResourceItem[]
  installedBytes: number
  availableBytes: number
  remoteConfigured: boolean
}

export interface ResourceDownloadProgress {
  id: string
  receivedBytes: number
  totalBytes: number | null
  percent: number | null
  stage: 'downloading' | 'verifying' | 'complete' | 'error'
  message: string
}

export interface NoteFolder {
  id: string
  name: string
  createdAt: string
  updatedAt: string
}

export interface Note {
  id: string
  title: string
  content: JSONContent
  folderId: string | null
  tags: string[]
  pinned: boolean
  deletedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface Milestone {
  id: string
  title: string
  dueDate: string
  completed: boolean
  progress?: number
  weight?: number
  createdAt: string
  updatedAt: string
}

export type GoalStatus = 'active' | 'paused' | 'completed' | 'archived'
export type GoalProgressMode = 'manual' | 'metric' | 'milestones' | 'subgoals'
export type GoalReviewCadence = 'weekly' | 'monthly' | 'none'

export interface GoalCheckIn {
  id: string
  progress: number
  confidence: number
  note: string
  nextStep: string
  createdAt: string
}

export interface Goal {
  id: string
  title: string
  description: string
  motivation?: string
  status: GoalStatus
  parentId?: string | null
  startDate: string
  dueDate: string
  progressMode?: GoalProgressMode
  manualProgress?: number
  metricStart?: number
  metricCurrent?: number
  metricTarget?: number
  metricUnit?: string
  reviewCadence?: GoalReviewCadence
  nextReviewDate?: string
  checkIns?: GoalCheckIn[]
  milestones: Milestone[]
  createdAt: string
  updatedAt: string
}

export type TodoPriority = 'low' | 'medium' | 'high'

export interface QuickTodo {
  id: string
  title: string
  goalId?: string
  priority: TodoPriority
  dueDate: string
  completed: boolean
  completedAt?: string | null
  createdAt: string
  updatedAt: string
}

export type PomodoroMode = 'focus' | 'shortBreak' | 'longBreak'

export interface PomodoroState {
  mode: PomodoroMode
  focusMinutes: number
  shortBreakMinutes: number
  longBreakMinutes: number
  sessionsBeforeLongBreak: number
  completedSessions: number
  secondsRemaining: number
  running: boolean
  endsAt: string | null
}

export interface LocalImageReference {
  path: string
  name: string
}

export type CountdownCategory = 'birthday' | 'anniversary' | 'travel' | 'event' | 'other'
export type CountdownRepeat = 'none' | 'weekly' | 'monthly' | 'yearly'
export type CountdownMode = 'auto' | 'countdown' | 'countup'
export type CountdownAccent = 'neutral' | 'rose' | 'amber' | 'sage' | 'sky'

export interface CountdownEvent {
  id: string
  title: string
  targetDate: string
  category: CountdownCategory
  note: string
  /** Legacy field retained while old snapshots are normalized. */
  yearly?: boolean
  targetTime: string
  precise: boolean
  repeat: CountdownRepeat
  mode: CountdownMode
  includeStartDay: boolean
  accent: CountdownAccent
  coverImagePath: string
  /** Legacy field retained while old snapshots are normalized. */
  coverImageId?: string
  pinned: boolean
  createdAt: string
  updatedAt: string
}

export type RecurringTodoFrequency = 'daily' | 'weekly' | 'monthly' | 'interval'

export interface RecurringTodo {
  id: string
  title: string
  priority: TodoPriority
  frequency: RecurringTodoFrequency
  /** Local calendar date (YYYY-MM-DD) from which this routine starts. */
  startDate: string
  /** 0–6 for Sunday–Saturday; used by weekly routines. */
  weekdays?: number[]
  /** 1–31; shorter months use their final calendar day. */
  dayOfMonth?: number
  /** Positive number of calendar days; used by interval routines. */
  intervalDays?: number
  paused: boolean
  createdAt: string
  updatedAt: string
}

export interface TodoCompletionRecord {
  id: string
  recurringTodoId: string
  occurrenceDate: string
  completedAt: string
}

export interface ClipboardSnippet {
  id: string
  title: string
  content: string
  category: string
  copyCount: number
  createdAt: string
  updatedAt: string
}

export interface LauncherLink {
  id: string
  title: string
  url: string
  description: string
  faviconUrl?: string
  archived?: boolean
  createdAt: string
  updatedAt: string
}

export interface BirthdayPerson {
  id: string
  name: string
  date: string
  enabled: boolean
}

export interface BirthdaySettings {
  enabled: boolean
  daysBefore: number
  time: string
  repeatCount: number
  intervalHours: number
  external: boolean
  toast: boolean
}

export interface BirthdayState {
  people: BirthdayPerson[]
  settings: BirthdaySettings
  deliveries: Record<string, { occurrence: string; count: number; lastSentAt: string }>
}

export interface AppSnapshot {
  version: 1
  settings: AppSettings
  bangumi: BangumiProfileCache | null
  imageLibrary: ImageLibraryState
  tracks: MusicTrack[]
  albums: MusicAlbum[]
  folders: NoteFolder[]
  notes: Note[]
  goals: Goal[]
  todos: QuickTodo[]
  recurringTodos: RecurringTodo[]
  todoCompletionRecords: TodoCompletionRecord[]
  pomodoro: PomodoroState
  countdowns: CountdownEvent[]
  clipboardSnippets: ClipboardSnippet[]
  launcherLinks: LauncherLink[]
  birthdays: BirthdayState
}

/** Top-level persistence unit. Updates must contain only the domains that changed. */
export type AppSnapshotPatch = { [Key in keyof AppSnapshot]?: AppSnapshot[Key] }

export interface BackupSummary {
  notes: number
  goals: number
  tracks: number
  bangumiItems: number
  exportedAt: string
}

export interface BackupEnvelope {
  format: 'siyue-workshop-backup'
  version: 1
  exportedAt: string
  snapshot: AppSnapshot
}

export type PartialBackupSection = 'home' | 'tasks' | 'notes' | 'music' | 'collection' | 'tools' | 'settings'

export interface PartialBackupEnvelope {
  format: 'siyue-workshop-partial-backup'
  version: 1
  section: PartialBackupSection
  exportedAt: string
  payload: unknown
}

export interface SylunaeAPI {
  platform: 'electron'
  imageProcessing: {
    getDirectory: () => Promise<string>
    pickDirectory: () => Promise<string | null>
    openDirectory: () => Promise<void>
    save: (name: string, bytes: ArrayBuffer) => Promise<string>
  }
  storage: {
    load: () => Promise<AppSnapshot>
    save: (patch: AppSnapshotPatch) => Promise<void>
    replace: (snapshot: AppSnapshot) => Promise<void>
  }
  music: {
    pick: () => Promise<MusicTrack[]>
    getDownloadDirectory: () => Promise<string>
    pickDownloadDirectory: (currentDirectory: string) => Promise<string | null>
    importRemote: (input: MusicRemoteImport) => Promise<MusicTrack>
    searchYoutube: (query: string) => Promise<YoutubeVideoSearchResult[]>
    onImportProgress: (listener: (progress: MusicImportProgress) => void) => () => void
    getMediaToolsStatus: () => Promise<MediaToolsStatus>
    installMediaTools: () => Promise<MediaToolsStatus>
    onMediaToolsProgress: (listener: (progress: MediaToolsProgress) => void) => () => void
    relocate: (trackId: string) => Promise<MusicTrack | null>
    checkPaths: (paths: string[]) => Promise<Record<string, boolean>>
    getAudioUrl: (path: string) => Promise<string>
    showInFolder: (path: string) => Promise<void>
    readMetadata: (path: string) => Promise<MusicEditableMetadata>
    updateMetadata: (update: MusicMetadataUpdate) => Promise<MusicTrack>
  }
  resources: {
    list: () => Promise<ResourceSummary>
    openDirectory: (directory: ManagedResourceDirectory) => Promise<void>
    download: (id: string) => Promise<ResourceItem>
    remove: (id: string) => Promise<void>
    importWhiteNoise: () => Promise<ResourceItem | null>
    getAudioUrl: (id: string) => Promise<string>
    onDownloadProgress: (listener: (progress: ResourceDownloadProgress) => void) => () => void
  }
  images: {
    pick: () => Promise<ImageAsset[]>
    pickFile: () => Promise<LocalImageReference | null>
    pickRoot: (recursive: boolean) => Promise<ImageLibraryRoot | null>
    scan: (taskId: string, library: ImageLibraryState, rootId?: string) => Promise<ImageLibraryState>
    cancelScan: (taskId: string) => Promise<void>
    onScanProgress: (listener: (progress: ImageScanProgress) => void) => () => void
    relocateRoot: (taskId: string, rootId: string, library: ImageLibraryState) => Promise<ImageLibraryState | null>
    relocateAsset: (assetId: string, library: ImageLibraryState) => Promise<ImageLibraryState | null>
    checkPaths: (paths: string[]) => Promise<Record<string, boolean>>
    getUrls: (paths: string[]) => Promise<Record<string, string>>
    getThumbnailUrls: (requests: Array<{ path: string; maxEdge: number }>) => Promise<Record<string, string>>
  }
  backup: {
    exportFile: (contents: string, defaultName?: string) => Promise<boolean>
    importFile: () => Promise<string | null>
  }
  system: {
    getTheme: () => Promise<'light' | 'dark'>
    openExternal: (url: string) => Promise<void>
    findFavicon: (url: string) => Promise<string | null>
    getLinkPreview: (url: string) => Promise<LinkPreview | null>
    notifyPomodoroComplete: (focusCompleted: boolean) => Promise<void>
    notifyBirthday: (body: string) => Promise<boolean>
    pickPomodoroAlarm: () => Promise<string | null>
    getPomodoroAlarmUrl: (path: string) => Promise<string | null>
  }
}

export interface LinkPreview {
  url: string
  host: string
  title: string
  description: string
  iconUrl: string | null
}
