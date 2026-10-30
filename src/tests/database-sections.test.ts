import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createDefaultSnapshot } from '../shared/defaults'

const testEnvironment = vi.hoisted(() => ({ dataDirectory: '' }))

vi.mock('electron', () => ({
  app: { getPath: () => testEnvironment.dataDirectory },
}))

describe('desktop section storage', () => {
  beforeEach(() => {
    testEnvironment.dataDirectory = mkdtempSync(join(tmpdir(), 'sylunae-storage-'))
    vi.resetModules()
  })

  afterEach(async () => {
    const database = await import('../../electron/main/database')
    database.closeDatabase()
    rmSync(testEnvironment.dataDirectory, { recursive: true, force: true })
  })

  it('migrates a legacy snapshot and updates only the requested section', async () => {
    const snapshot = createDefaultSnapshot()
    snapshot.tracks = [{
      id: 'track-1', path: 'song.mp3', title: 'Song', artist: 'Artist', album: 'Album', albumArtist: 'Artist',
      albumId: null, duration: 1, cover: `data:image/png;base64,${'a'.repeat(50_000)}`, missing: false,
      createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    }]
    const path = join(testEnvironment.dataDirectory, 'sylunae-workshop.sqlite')
    const legacy = new Database(path)
    legacy.exec('CREATE TABLE schema_meta (version INTEGER NOT NULL); INSERT INTO schema_meta(version) VALUES (1); CREATE TABLE app_state (id INTEGER PRIMARY KEY, payload TEXT NOT NULL, updated_at TEXT NOT NULL);')
    legacy.prepare('INSERT INTO app_state(id, payload, updated_at) VALUES (1, ?, ?)').run(JSON.stringify(snapshot), '2026-01-01T00:00:00.000Z')
    legacy.close()

    const database = await import('../../electron/main/database')
    expect(database.loadSnapshot().tracks).toEqual(snapshot.tracks)

    const notes = [{
      id: 'note-1', title: 'Only this domain changes', content: { type: 'doc' }, folderId: null, tags: [], pinned: false,
      deletedAt: null, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    }]
    database.saveSnapshotPatch({ notes })

    const verification = new Database(path, { readonly: true })
    const rows = verification.prepare('SELECT section, payload FROM app_state_sections').all() as Array<{ section: string; payload: string }>
    expect(rows).toHaveLength(17)
    expect(database.loadSnapshot().notes).toEqual(notes)
    expect(JSON.parse(rows.find((row) => row.section === 'notes')!.payload)).toEqual(snapshot.notes)
    expect(JSON.parse(rows.find((row) => row.section === 'tracks')!.payload)).toEqual(snapshot.tracks)
    expect((verification.prepare('SELECT COUNT(*) AS count FROM app_state').get() as { count: number }).count).toBe(0)
    verification.close()
  })
})


describe('per-note desktop writes', () => {
  it('deduplicates image bytes, preserves them on restart and keeps text writes small', async () => {
    testEnvironment.dataDirectory = mkdtempSync(join(tmpdir(), 'sylunae-assets-'))
    vi.resetModules()
    const database = await import('../../electron/main/database')
    try {
      const bytes = new Uint8Array([255, 216, 1, 2, 3, 255, 217])
      const id = database.putNoteAsset(bytes, 'image/jpeg')
      expect(database.putNoteAsset(bytes, 'image/jpeg')).toBe(id)
      const snapshot = createDefaultSnapshot()
      snapshot.notes = [{ id: 'image-note', title: 'Image', content: { type: 'doc', content: [
        { type: 'image', attrs: { src: `sylunae-note-asset:${id}` } },
      ] }, folderId: null, tags: [], pinned: false, deletedAt: null, createdAt: 'now', updatedAt: 'now' }]
      database.replaceSnapshot(snapshot)
      database.saveSnapshotPatch({ noteChanges: { put: [{ ...snapshot.notes[0], title: 'Edited' }], delete: [] } })
      database.closeDatabase()
      expect(Array.from(database.getNoteAsset(id)!.bytes)).toEqual(Array.from(bytes))
      expect(database.loadSnapshot().notes[0].content).toEqual(snapshot.notes[0].content)
      const verification = new Database(join(testEnvironment.dataDirectory, 'sylunae-workshop.sqlite'), { readonly: true })
      try {
        expect(verification.prepare('SELECT COUNT(*) AS count FROM note_assets').get()).toEqual({ count: 1 })
        expect((verification.prepare('SELECT length(payload) AS size FROM notes').get() as { size: number }).size).toBeLessThan(1000)
      } finally { verification.close() }
    } finally {
      database.closeDatabase()
      rmSync(testEnvironment.dataDirectory, { recursive: true, force: true })
    }
  })

  it('updates and deletes only the requested rows', async () => {
    testEnvironment.dataDirectory = mkdtempSync(join(tmpdir(), 'sylunae-note-'))
    vi.resetModules()
    const database = await import('../../electron/main/database')
    const snapshot = createDefaultSnapshot()
    const note = { id: 'a', title: 'A', content: { type: 'doc' }, folderId: null, tags: [], pinned: false, deletedAt: null, createdAt: 'now', updatedAt: 'now' }
    snapshot.notes = [note, { ...note, id: 'b' }]
    try {
      database.replaceSnapshot(snapshot)
      database.saveSnapshotPatch({ noteChanges: { put: [{ ...note, title: 'changed' }], delete: [] } })
      expect(database.loadSnapshot().notes.map((n) => n.title)).toEqual(['changed', 'A'])
      database.saveSnapshotPatch({ noteChanges: { put: [], delete: ['a'] } })
      expect(database.loadSnapshot().notes.map((n) => n.id)).toEqual(['b'])
      database.closeDatabase()
      expect(database.loadSnapshot().notes.map((n) => n.id)).toEqual(['b'])
    } finally {
      database.closeDatabase()
      rmSync(testEnvironment.dataDirectory, { recursive: true, force: true })
    }
  })
})
