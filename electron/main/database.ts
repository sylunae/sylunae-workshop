import { createHash } from 'node:crypto'
import Database from 'better-sqlite3'
import { app } from 'electron'
import { existsSync, readFileSync, renameSync } from 'node:fs'
import type { DriveWhiteNoise } from '../../src/shared/driveBackup'
import { join } from 'node:path'
import { createDefaultSnapshot } from '../../src/shared/defaults'
import type { Note, AppSnapshot } from '../../src/shared/types'
import { normalizeThemePalettes } from '../../src/shared/theme'
import { normalizeImageLibrary } from '../../src/images/library'
import { normalizeBirthdays } from '../../src/birthdays/reminders'
import { normalizeCountdowns } from '../../src/countdowns/normalize'
import { joinSnapshotSections, snapshotPatchEntries, splitSnapshot } from '../../src/data/snapshotSections'
import type { AppSnapshotPatch } from '../../src/shared/types'

let database: Database.Database | null = null

function migrateDatabaseFile(): void {
  const userData = app.getPath('userData')
  const legacyPath = join(userData, 'siyue-workshop.sqlite')
  const currentPath = join(userData, 'sylunae-workshop.sqlite')

  // Never overwrite a database that already exists under the new name.
  if (existsSync(currentPath) || !existsSync(legacyPath)) return

  // SQLite may have active WAL/shared-memory sidecars. Move them together
  // before opening the database under its new name.
  for (const suffix of ['', '-wal', '-shm', '-journal']) {
    const source = `${legacyPath}${suffix}`
    const target = `${currentPath}${suffix}`
    if (existsSync(source) && !existsSync(target)) renameSync(source, target)
  }
}

function getDatabase(): Database.Database {
  if (database) return database
  migrateDatabaseFile()
  database = new Database(join(app.getPath('userData'), 'sylunae-workshop.sqlite'))
  database.pragma('journal_mode = WAL')
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_meta (
      version INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS app_state (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      payload TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS app_state_sections (
      section TEXT PRIMARY KEY,
      payload TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `)
  const meta = database.prepare('SELECT version FROM schema_meta LIMIT 1').get() as { version: number } | undefined
  if (!meta) database.prepare('INSERT INTO schema_meta(version) VALUES (?)').run(1)
  migrateSectionStorage(database)
  database.exec('CREATE TABLE IF NOT EXISTS notes (id TEXT PRIMARY KEY, payload TEXT NOT NULL)')
  database.exec('CREATE TABLE IF NOT EXISTS note_assets (id TEXT PRIMARY KEY, bytes BLOB NOT NULL, mime TEXT NOT NULL)')
  const version = database.prepare('SELECT version FROM schema_meta LIMIT 1').get() as { version: number }
  if (version.version < 3) {
    database.transaction(() => {
      const legacy = database!.prepare("SELECT payload FROM app_state_sections WHERE section = 'notes'").get() as { payload: string } | undefined
      const notes = legacy ? JSON.parse(legacy.payload) as Note[] : []
      const insert = database!.prepare('INSERT OR REPLACE INTO notes(id, payload) VALUES (?, ?)')
      for (const note of notes) insert.run(note.id, JSON.stringify(note))
      // Preserve the original notes section as the migration rollback backup.
      database!.prepare('UPDATE schema_meta SET version = 3').run()
    })()
  }
  return database
}

function migrateSectionStorage(db: Database.Database): void {
  const existing = db.prepare('SELECT COUNT(*) AS count FROM app_state_sections').get() as { count: number }
  if (existing.count > 0) return

  const legacy = db.prepare('SELECT payload FROM app_state WHERE id = 1').get() as { payload: string } | undefined
  let snapshot: AppSnapshot
  try { snapshot = normalizeSnapshot(legacy ? JSON.parse(legacy.payload) as Partial<AppSnapshot> : {}) }
  catch { snapshot = createDefaultSnapshot() }

  const insert = db.prepare('INSERT INTO app_state_sections(section, payload, updated_at) VALUES (?, ?, ?)')
  const migrate = db.transaction(() => {
    const now = new Date().toISOString()
    for (const { key, value } of splitSnapshot(snapshot)) insert.run(key, JSON.stringify(value), now)
    db.prepare('DELETE FROM app_state').run()
    db.prepare('UPDATE schema_meta SET version = 2').run()
  })
  migrate()
}

function normalizeSnapshot(parsed: Partial<AppSnapshot>): AppSnapshot {
  const defaults = createDefaultSnapshot()
  const imageLibrary = normalizeImageLibrary(parsed.imageLibrary)
  const legacyTool = parsed.settings?.lastTool as string | undefined
  const migratedTool = legacyTool === 'goals' ? 'tasks' : legacyTool === 'library' ? 'collection' : legacyTool
  const lastTool = ['home', 'tasks', 'notes', 'music', 'collection', 'tools', 'settings'].includes(migratedTool ?? '') ? migratedTool! : defaults.settings.lastTool
  return {
    ...defaults,
    ...parsed,
    settings: { ...defaults.settings, ...parsed.settings, lastTool: lastTool as AppSnapshot['settings']['lastTool'], themePalettes: normalizeThemePalettes(parsed.settings?.themePalettes) },
    todos: parsed.todos ?? [],
    recurringTodos: parsed.recurringTodos ?? [],
    todoCompletionRecords: parsed.todoCompletionRecords ?? [],
    pomodoro: { ...defaults.pomodoro, ...parsed.pomodoro },
    countdowns: normalizeCountdowns(parsed.countdowns ?? [], imageLibrary.assets),
    clipboardSnippets: parsed.clipboardSnippets ?? [],
    launcherLinks: parsed.launcherLinks ?? [],
    birthdays: normalizeBirthdays(parsed.birthdays),
    imageLibrary,
  }
}

export function loadSnapshot(): AppSnapshot {
  const db = getDatabase()
  try {
    const rows = db.prepare("SELECT section AS key, payload FROM app_state_sections WHERE section != 'notes'").all() as Array<{ key: string; payload: string }>
    const parsed = joinSnapshotSections(rows.flatMap((row) => {
      try { return [{ key: row.key, value: JSON.parse(row.payload) }] }
      catch { return [] }
    }))
    return normalizeSnapshot({ ...parsed, notes: (db.prepare('SELECT payload FROM notes').all() as { payload: string }[]).map((row) => JSON.parse(row.payload) as Note) })
  } catch (error) {
    // A read failure must never overwrite recoverable user data.
    throw new Error('无法读取本地数据', { cause: error })
  }
}

export function saveSnapshotPatch(patch: AppSnapshotPatch): void {
  const entries = snapshotPatchEntries(patch)
  if (entries.length === 0 && !patch.noteChanges) return
  const db = getDatabase()
  const upsert = db.prepare(`
    INSERT INTO app_state_sections(section, payload, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(section) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at
  `)
  const save = db.transaction(() => {
    const now = new Date().toISOString()
    for (const { key, value } of entries) {
      if (key === 'notes') continue
      upsert.run(key, JSON.stringify(value), now)
    }
    if (patch.notes) db.prepare('DELETE FROM notes').run()
    const changed = patch.noteChanges ?? (patch.notes ? { put: patch.notes, delete: [] } : null)
    if (changed) {
      const put = db.prepare('INSERT INTO notes(id, payload) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET payload = excluded.payload')
      const remove = db.prepare('DELETE FROM notes WHERE id = ?')
      for (const note of changed.put) put.run(note.id, JSON.stringify(note))
      for (const id of changed.delete) remove.run(id)
    }
  })
  save()
}

type CustomWhiteNoiseRecord = Omit<DriveWhiteNoise[number], 'localPath'> & { path: string; createdAt: string }

function driveState() {
  const db = getDatabase()
  db.exec('CREATE TABLE IF NOT EXISTS drive_state (id TEXT PRIMARY KEY, payload TEXT NOT NULL)')
  return db
}

export function readCustomWhiteNoise(): CustomWhiteNoiseRecord[] {
  const stored = driveState().prepare("SELECT payload FROM drive_state WHERE id='whiteNoise'").get() as { payload: string } | undefined
  if (stored) return JSON.parse(stored.payload)
  try {
    const legacy = JSON.parse(readFileSync(join(app.getPath('userData'), 'resources', 'state.json'), 'utf8'))
    return Array.isArray(legacy.customWhiteNoise) ? legacy.customWhiteNoise : []
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
}

export function writeCustomWhiteNoise(items: CustomWhiteNoiseRecord[]): void {
  driveState().prepare("INSERT OR REPLACE INTO drive_state VALUES ('whiteNoise', ?)").run(JSON.stringify(items))
}

export function hasDriveRollback(): boolean {
  return Boolean(driveState().prepare("SELECT 1 FROM drive_state WHERE id='rollback'").get())
}

export function isWhiteNoiseInDriveRollback(path: string): boolean {
  const stored = driveState().prepare("SELECT payload FROM drive_state WHERE id='rollback'").get() as { payload: string } | undefined
  if (!stored) return false
  const previous = JSON.parse(stored.payload) as { whiteNoise: CustomWhiteNoiseRecord[] }
  return previous.whiteNoise.some((item) => item.path === path)
}

export function rollbackDriveSnapshot(): void {
  const db = driveState()
  db.transaction(() => {
    const previous = db.prepare("SELECT payload FROM drive_state WHERE id='rollback'").get() as { payload: string } | undefined
    if (!previous) throw new Error('没有可回退的本地备份。')
    const { snapshot, whiteNoise } = JSON.parse(previous.payload)
    replaceSnapshot(snapshot)
    writeCustomWhiteNoise(whiteNoise)
    db.prepare("DELETE FROM drive_state WHERE id='rollback'").run()
  })()
}

export function replaceSnapshot(snapshot: AppSnapshot, whiteNoise?: DriveWhiteNoise): void {
  const db = getDatabase()
  const insert = db.prepare('INSERT INTO app_state_sections(section, payload, updated_at) VALUES (?, ?, ?)')
  const replace = db.transaction(() => {
    if (whiteNoise !== undefined) {
      const previous = { snapshot: loadSnapshot(), whiteNoise: readCustomWhiteNoise() }
      driveState().prepare("INSERT OR REPLACE INTO drive_state VALUES ('rollback', ?)").run(JSON.stringify(previous))
      const createdAt = new Date().toISOString()
      writeCustomWhiteNoise(whiteNoise.map(({ localPath, ...item }) => ({ ...item, path: localPath, createdAt })))
    }
    db.prepare('DELETE FROM notes').run()
    const putNote = db.prepare('INSERT INTO notes(id, payload) VALUES (?, ?)')
    for (const note of snapshot.notes) putNote.run(note.id, JSON.stringify(note))
    db.prepare('DELETE FROM app_state_sections').run()
    const now = new Date().toISOString()
    for (const { key, value } of splitSnapshot(snapshot)) insert.run(key, JSON.stringify(key === 'notes' ? [] : value), now)
  })
  replace()
}

export function closeDatabase(): void {
  database?.close()
  database = null
}


export function putNoteAsset(bytes: Uint8Array, mime: string): string {
  if (!(bytes instanceof Uint8Array) || !/^image\/[a-z0-9.+-]+$/i.test(mime)) throw new Error('无效的图片资源')
  const data = Buffer.from(bytes)
  const id = createHash('sha256').update(data).digest('hex')
  getDatabase().prepare('INSERT OR IGNORE INTO note_assets(id, bytes, mime) VALUES (?, ?, ?)').run(id, data, mime)
  return id
}

export function getNoteAsset(id: string): { bytes: Uint8Array; mime: string } | null {
  if (!/^[a-f0-9]{64}$/.test(id)) throw new Error('无效的图片资源 ID')
  return (getDatabase().prepare('SELECT bytes, mime FROM note_assets WHERE id = ?').get(id) as { bytes: Uint8Array; mime: string } | undefined) ?? null
}
