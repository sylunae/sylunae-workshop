import { externalizeNoteImages } from './noteAssets'
import { applicationDatabaseName } from '../lib/storageEnvironment'
import { resolveAndroidFiles } from '../platform/transfer'
import Dexie, { type EntityTable } from 'dexie'
import { createDefaultSnapshot, defaultHomeWallpaperCopy } from '../shared/defaults'
import type { AppSnapshot, AppSnapshotPatch, DeskCompanionCharacter, DeskCompanionSettings, Note } from '../shared/types'
import { normalizeHomeQuickActions } from '../shared/homeQuickActions'
import { migrateDefaultThemePalettes } from '../shared/theme'
import { reconcileMusicLibrary } from '../music/albums'
import { normalizeImageLibrary } from '../images/library'
import { normalizeGoal } from '../goals/tracking'
import { normalizeBirthdays } from '../birthdays/reminders'
import { normalizeCountdowns } from '../countdowns/normalize'
import { joinSnapshotSections, snapshotPatchEntries, splitSnapshot, type SnapshotSectionKey, snapshotSectionKeys } from './snapshotSections'

interface StateRow { id: number; snapshot: AppSnapshot }
interface BangumiCoverRow { url: string; blob: Blob; cachedAt: string }
interface SectionRow { key: SnapshotSectionKey; value: unknown }

class SylunaeDatabase extends Dexie {
  state!: EntityTable<StateRow, 'id'>
  bangumiCovers!: EntityTable<BangumiCoverRow, 'url'>
  sections!: EntityTable<SectionRow, 'key'>
  notes!: EntityTable<Note, 'id'>
  constructor() {
    super(applicationDatabaseName)
    this.version(1).stores({ state: 'id' })
    this.version(2).stores({ state: 'id', bangumiCovers: 'url, cachedAt' })
    this.version(3).stores({ state: 'id', bangumiCovers: 'url, cachedAt', sections: 'key' })
    this.version(4).stores({ state: 'id', bangumiCovers: 'url, cachedAt', sections: 'key', notes: 'id' }).upgrade(async (tx) => {
      const old = await tx.table('sections').get('notes')
      if (old) await tx.table('notes').bulkPut(old.value)
      // Keep the old section as a rollback backup; version 4 reads the rows.
    })
  }
}

const db = new SylunaeDatabase()

function normalizeBundledCompanionAsset(source: string): string {
  return source.startsWith('/resources/fun/desk-companion/') ? source.slice(1) : source
}

type LegacyCompanionSettings = Partial<DeskCompanionSettings> & {
  sound?: boolean
  dialogues?: string[]
  characterImage?: string
  characterImageName?: string
  pressSound?: string
  pressSoundName?: string
  releaseSound?: string
  releaseSoundName?: string
}

function normalizeCompanionCharacter(value: Partial<DeskCompanionCharacter>, fallback: DeskCompanionCharacter, index: number): DeskCompanionCharacter {
  const dialogues = Array.isArray(value.dialogues)
    ? value.dialogues.filter((line): line is string => typeof line === 'string' && Boolean(line.trim())).slice(0, 30)
    : fallback.dialogues
  return {
    id: typeof value.id === 'string' && value.id ? value.id : `companion-${index + 1}`,
    name: typeof value.name === 'string' && value.name.trim() ? value.name.trim() : `小伙伴 ${index + 1}`,
    image: typeof value.image === 'string' && value.image ? normalizeBundledCompanionAsset(value.image) : fallback.image,
    dialogues,
    pressSound: typeof value.pressSound === 'string' ? normalizeBundledCompanionAsset(value.pressSound) : fallback.pressSound,
    pressSoundName: typeof value.pressSoundName === 'string' ? value.pressSoundName : fallback.pressSoundName,
    releaseSound: typeof value.releaseSound === 'string' ? normalizeBundledCompanionAsset(value.releaseSound) : fallback.releaseSound,
    releaseSoundName: typeof value.releaseSoundName === 'string' ? value.releaseSoundName : fallback.releaseSoundName,
  }
}

async function ensureSectionStorage(): Promise<void> {
  if (await db.sections.count() > 0) return
  const legacy = await db.state.get(1)
  const snapshot = normalize(legacy?.snapshot)
  await db.transaction('rw', db.sections, db.state, db.notes, async () => {
    await db.notes.bulkPut(snapshot.notes)
    await db.sections.bulkPut(splitSnapshot(snapshot))
    await db.state.clear()
  })
}

function normalize(snapshot: Partial<AppSnapshot> | undefined): AppSnapshot {
  const defaults = createDefaultSnapshot()
  const imageLibrary = normalizeImageLibrary(snapshot?.imageLibrary)
  if (!snapshot) return defaults
  const music = reconcileMusicLibrary(snapshot.tracks ?? [], snapshot.albums ?? [])
  const legacyTool = snapshot.settings?.lastTool as string | undefined
  const migratedTool = legacyTool === 'goals' ? 'tasks' : legacyTool === 'library' ? 'collection' : legacyTool
  const lastTool = ['home', 'tasks', 'notes', 'music', 'collection', 'tools', 'settings'].includes(migratedTool ?? '') ? migratedTool! : defaults.settings.lastTool
  const homeWallpapers = snapshot.settings?.homeWallpapers?.length
    ? snapshot.settings.homeWallpapers.slice(0, 5).map((wallpaper) => (
      wallpaper.title === '换一张喜欢的壁纸' && wallpaper.description === '让每一次打开，都有好心情。'
        ? { ...wallpaper, ...defaultHomeWallpaperCopy }
        : wallpaper
    ))
    : snapshot.settings?.homeWallpaper
      ? [{ id: 'legacy-home-wallpaper', image: snapshot.settings.homeWallpaper, ...defaultHomeWallpaperCopy }]
      : []
  const homeQuickActions = normalizeHomeQuickActions(snapshot.settings?.homeQuickActions)
  const companion = snapshot.settings?.deskCompanion as LegacyCompanionSettings | undefined
  const defaultCharacter = defaults.settings.deskCompanion.characters[0]
  const legacyCharacter: Partial<DeskCompanionCharacter> = {
    id: 'default-companion',
    name: companion?.characterImageName,
    image: companion?.characterImage,
    dialogues: companion?.dialogues,
    pressSound: typeof companion?.pressSound === 'string' ? companion.pressSound : companion?.sound === false ? '' : undefined,
    pressSoundName: typeof companion?.pressSoundName === 'string' ? companion.pressSoundName : companion?.sound === false ? '' : undefined,
    releaseSound: typeof companion?.releaseSound === 'string' ? companion.releaseSound : companion?.sound === false ? '' : undefined,
    releaseSoundName: typeof companion?.releaseSoundName === 'string' ? companion.releaseSoundName : companion?.sound === false ? '' : undefined,
  }
  const characters = (Array.isArray(companion?.characters) && companion.characters.length
    ? companion.characters.slice(0, 12).map((character, index) => normalizeCompanionCharacter(character, defaultCharacter, index))
    : [normalizeCompanionCharacter(legacyCharacter, defaultCharacter, 0)])
    .map((character) => character.id === 'default-companion' && character.name === '默认小伙伴'
      ? { ...character, name: defaultCharacter.name }
      : character)
  const activeCharacterId = characters.some((character) => character.id === companion?.activeCharacterId)
    ? companion!.activeCharacterId!
    : characters[0].id
  const deskCompanion: DeskCompanionSettings = {
    enabled: companion?.enabled === true,
    scale: typeof companion?.scale === 'number' && Number.isFinite(companion.scale)
      ? Math.min(1.4, Math.max(0.7, companion.scale))
      : defaults.settings.deskCompanion.scale,
    dialogueMode: companion?.dialogueMode === 'random' ? 'random' : 'sequential',
    activeCharacterId,
    characters,
  }
  return {
    ...defaults,
    ...snapshot,
    version: 1,
    settings: { ...defaults.settings, ...snapshot.settings, homeWallpapers, homeQuickActions, lastTool: lastTool as AppSnapshot['settings']['lastTool'], themePalettes: migrateDefaultThemePalettes(snapshot.settings?.themePalettes), deskCompanion },
    tracks: music.tracks,
    albums: music.albums,
    folders: snapshot.folders ?? [],
    notes: snapshot.notes ?? [],
    goals: (snapshot.goals ?? []).map(normalizeGoal),
    todos: snapshot.todos ?? [],
    recurringTodos: snapshot.recurringTodos ?? [],
    todoCompletionRecords: snapshot.todoCompletionRecords ?? [],
    pomodoro: { ...defaults.pomodoro, ...snapshot.pomodoro },
    countdowns: normalizeCountdowns(snapshot.countdowns ?? [], imageLibrary.assets),
    clipboardSnippets: (snapshot.clipboardSnippets ?? []).map(({ id, title, content, copyCount, createdAt, updatedAt }) => ({
      id, title, content, copyCount: copyCount ?? 0, createdAt, updatedAt,
    })),
      launcherLinks: snapshot.launcherLinks ?? [],
    birthdays: normalizeBirthdays(snapshot.birthdays),
      imageLibrary,
      bangumi: null,
  }
}

let savedNotes = new Map<string, Note>()

export const repository = {
  isDesktop: Boolean(window.sylunae),
  async load(): Promise<AppSnapshot> {
    let snapshot: AppSnapshot
    if (window.sylunae) snapshot = normalize(await window.sylunae.storage.load())
    else {
      await ensureSectionStorage()
      snapshot = normalize({ ...joinSnapshotSections((await db.sections.bulkGet(snapshotSectionKeys.filter((key) => key !== 'notes'))).filter((row): row is SectionRow => Boolean(row))), notes: await db.notes.toArray() })
    }
    const migrated = await externalizeNoteImages(snapshot.notes)
    const changed = migrated.filter((note, index) => note !== snapshot.notes[index])
    // Assets are committed first; only then replace references. Failure leaves old notes intact.
    if (changed.length) {
      if (window.sylunae) await window.sylunae.storage.save({ noteChanges: { put: changed, delete: [] } })
      else await db.notes.bulkPut(changed)
    }
    snapshot = { ...snapshot, notes: migrated }
    savedNotes = new Map(snapshot.notes.map((note) => [note.id, note]))
    return snapshot
  },
  async save(patch: AppSnapshotPatch): Promise<void> {
    const { notes, ...sections } = patch
    const nextNotes = notes ? new Map(notes.map((note) => [note.id, note])) : savedNotes
    const noteChanges = notes ? {
      put: notes.filter((note) => savedNotes.get(note.id) !== note),
      delete: [...savedNotes.keys()].filter((id) => !nextNotes.has(id)),
    } : undefined
    const entries = snapshotPatchEntries(sections)
    if (window.sylunae) await window.sylunae.storage.save({ ...sections, noteChanges })
    else {
      await ensureSectionStorage()
      await db.transaction('rw', db.sections, db.notes, async () => {
        await db.sections.bulkPut(entries)
        if (noteChanges) {
          await db.notes.bulkPut(noteChanges.put)
          await db.notes.bulkDelete(noteChanges.delete)
        }
      })
    }
    savedNotes = nextNotes
  },
  async replace(snapshot: AppSnapshot, whiteNoise?: import('../shared/driveBackup').DriveWhiteNoise): Promise<AppSnapshot> {
    let safe = normalize(snapshot)
    if (window.sylunae?.platform === 'android') safe = await resolveAndroidFiles(safe, window.sylunae.music.checkPaths)
    safe.notes = await externalizeNoteImages(safe.notes)
    if (window.sylunae) {
      if (whiteNoise === undefined) await window.sylunae.storage.replace(safe)
      else await window.sylunae.storage.replace(safe, whiteNoise)
    }
    else {
      await ensureSectionStorage()
      await db.transaction('rw', db.sections, db.notes, async () => {
        await db.notes.clear()
        await db.notes.bulkPut(safe.notes)
        await db.sections.clear()
        await db.sections.bulkPut(splitSnapshot({ ...safe, notes: [] }))
      })
    }
    savedNotes = new Map(safe.notes.map((note) => [note.id, note]))
    return safe
  },
}

/** Persistent cover cache kept separate from the user's exported application data. */
export const bangumiCoverCache = {
  async get(url: string): Promise<Blob | null> {
    return (await db.bangumiCovers.get(url))?.blob ?? null
  },
  async put(url: string, blob: Blob): Promise<void> {
    await db.bangumiCovers.put({ url, blob, cachedAt: new Date().toISOString() })
  },
  async clear(): Promise<void> {
    await db.bangumiCovers.clear()
  },
}
