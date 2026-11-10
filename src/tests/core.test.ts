import { afterEach, describe, expect, it, vi } from 'vitest'
import { createDefaultSnapshot } from '../shared/defaults'
import { applyPartialBackup, backupSummary, createBackup, createPartialBackup, parseBackup, parsePartialBackup } from '../data/backup'
import { fetchBangumiCollection } from '../data/bangumi'
import { goalProgress, isOverdue } from '../utils'
import { accessibleForeground, getThemeContrastIssues, normalizeThemePalettes, parseThemePalettes, serializeThemePalettes } from '../shared/theme'
import { changedSnapshotSections, joinSnapshotSections, snapshotPatchEntries, splitSnapshot } from '../data/snapshotSections'
import { normalizeCountdowns } from '../countdowns/normalize'
import type { CountdownEvent, ImageAsset } from '../shared/types'

describe('goal progress', () => {
  it('calculates milestone completion and completed override', () => {
    expect(goalProgress([])).toBe(0)
    expect(goalProgress([true, false, true])).toBe(67)
    expect(goalProgress([false], 'completed')).toBe(100)
  })

  it('does not mark completed work as overdue', () => {
    expect(isOverdue('2000-01-01', true)).toBe(false)
    expect(isOverdue('2000-01-01', false)).toBe(true)
  })
})

describe('backup format', () => {
  it('round-trips a snapshot and reports its contents', () => {
    const envelope = createBackup(createDefaultSnapshot())
    const restored = parseBackup(JSON.stringify(envelope))
    expect(restored.format).toBe('siyue-workshop-backup')
    expect(backupSummary(restored)).toContain('笔记 0 条')
  })

  it('rejects unrelated json', () => {
    expect(() => parseBackup('{"hello":"world"}')).toThrow()
  })

  it('imports categorized and uncategorized clipboard entries into the same list', () => {
    const timestamp = '2026-09-12T00:00:00.000Z'
    const legacy = {
      id: 'legacy-snippet', title: '旧条目', content: '保留正文',
      copyCount: 3, createdAt: timestamp, updatedAt: timestamp,
    }
    const current = { ...legacy, id: 'new-snippet', title: '新条目', copyCount: 0 }
    const categorized = { ...legacy, category: '旧分类' }
    const snapshot = createDefaultSnapshot()
    snapshot.clipboardSnippets = [categorized, current]

    const full = parseBackup(JSON.stringify(createBackup(snapshot)))
    expect(full.snapshot.clipboardSnippets).toEqual([legacy, current])
    const partial = parsePartialBackup(JSON.stringify(createPartialBackup(snapshot, 'tools')))
    expect(applyPartialBackup(createDefaultSnapshot(), partial).clipboardSnippets).toEqual([legacy, current])
  })

  it('preserves seven ordered homepage shortcuts in full and homepage backups', () => {
    const snapshot = createDefaultSnapshot()
    const shortcuts = ['images', 'countdown', 'new-note', 'white-noise', 'clipboard', 'goals', 'rss'] as const
    snapshot.settings.homeQuickActions = [...shortcuts]

    expect(parseBackup(JSON.stringify(createBackup(snapshot))).snapshot.settings.homeQuickActions).toEqual(shortcuts)
    const partial = parsePartialBackup(JSON.stringify(createPartialBackup(snapshot, 'home')))
    expect(applyPartialBackup(createDefaultSnapshot(), partial).settings.homeQuickActions).toEqual(shortcuts)

    snapshot.settings.homeQuickActions.push('notes')
    expect(() => parseBackup(JSON.stringify(createBackup(snapshot)))).toThrow()
    expect(() => parsePartialBackup(JSON.stringify(createPartialBackup(snapshot, 'home')))).toThrow()
  })

  it('migrates legacy countdown fields while importing a backup', () => {
    const envelope = createBackup(createDefaultSnapshot()) as unknown as { snapshot: { countdowns: unknown[] } }
    envelope.snapshot.countdowns = [{
      id: 'legacy-countdown', title: '纪念日', targetDate: '2020-09-12', category: 'anniversary',
      note: '', yearly: true, pinned: true, createdAt: '2020-09-12T00:00:00.000Z', updatedAt: '2020-09-12T00:00:00.000Z',
    }]
    const restored = parseBackup(JSON.stringify(envelope))
    expect(restored.snapshot.countdowns[0]).toMatchObject({ repeat: 'yearly', targetTime: '09:00', precise: false, mode: 'auto', includeStartDay: false, accent: 'neutral', coverImagePath: '' })
  })

  it('migrates a legacy gallery cover reference to an independent local path', () => {
    const event = {
      id: 'countdown', title: '旅行', targetDate: '2026-10-01', category: 'travel', note: '', targetTime: '09:00', precise: false,
      repeat: 'none', mode: 'auto', includeStartDay: false, accent: 'neutral', coverImageId: 'asset-1', pinned: false,
      createdAt: '2026-09-12T00:00:00.000Z', updatedAt: '2026-09-12T00:00:00.000Z',
    } as unknown as CountdownEvent
    const asset = { id: 'asset-1', path: 'C:\\Pictures\\trip.jpg' } as ImageAsset
    expect(normalizeCountdowns([event], [asset])[0]).toMatchObject({ coverImagePath: 'C:\\Pictures\\trip.jpg' })
    expect(normalizeCountdowns([event], [asset])[0]).not.toHaveProperty('coverImageId')
  })
})

describe('snapshot section persistence', () => {
  it('persists only top-level domains whose references changed', () => {
    const current = createDefaultSnapshot()
    const next = { ...current, notes: [{
      id: 'note-1', title: 'Draft', content: { type: 'doc' }, folderId: null, tags: [], pinned: false,
      deletedAt: null, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    }] }

    expect(snapshotPatchEntries(changedSnapshotSections(current, next))).toEqual([{ key: 'notes', value: next.notes }])
  })

  it('reassembles every persisted domain into the original snapshot', () => {
    const snapshot = createDefaultSnapshot()
    expect(joinSnapshotSections(splitSnapshot(snapshot))).toEqual(snapshot)
  })

  it('persists a countdown edit without rewriting other domains', () => {
    const current = createDefaultSnapshot()
    const next = { ...current, countdowns: [{
      id: 'countdown-1', title: '旅行', targetDate: '2026-10-01', category: 'travel' as const,
      note: '', targetTime: '09:00', precise: false, repeat: 'none' as const, mode: 'auto' as const,
      includeStartDay: false, accent: 'neutral' as const, coverImagePath: '', pinned: false,
      createdAt: '2026-09-12T00:00:00.000Z', updatedAt: '2026-09-12T00:00:00.000Z',
    }] }

    expect(snapshotPatchEntries(changedSnapshotSections(current, next))).toEqual([{ key: 'countdowns', value: next.countdowns }])
  })
})

describe('theme palettes', () => {
  it('round-trips editable CSS palettes', () => {
    const palettes = normalizeThemePalettes()
    const css = serializeThemePalettes(palettes).replace('--brand: #2f2f2f', '--brand: #123456')
    expect(parseThemePalettes(css, palettes).light.brand).toBe('#123456')
  })

  it('rejects CSS without supported color variables', () => {
    expect(() => parseThemePalettes(':root { color: red; }', normalizeThemePalettes())).toThrow()
  })

  it('derives readable button foregrounds and detects unsafe text pairs', () => {
    expect(accessibleForeground('#f8e7a5')).toBe('#202020')
    expect(accessibleForeground('#2f2f2f', '#ededed')).toBe('#202020')
    expect(getThemeContrastIssues(normalizeThemePalettes())).toEqual([])
    const palettes = normalizeThemePalettes({ light: { text: '#f6f4f0' } })
    expect(getThemeContrastIssues(palettes)).toEqual(expect.arrayContaining([expect.objectContaining({ mode: 'light', foreground: 'text' })]))
    const hoverMismatch = normalizeThemePalettes({ light: { brand: '#2f2f2f', accentSoft: '#ffffff', accentDeep: '#ededed' } })
    expect(getThemeContrastIssues(hoverMismatch)).toEqual(expect.arrayContaining([expect.objectContaining({ mode: 'light', foreground: 'primaryForeground' })]))
  })
})

describe('Bangumi client', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('maps and paginates public collections', async () => {
    const entry = (id: number, userTags: string[]) => ({
      subject_id: id, subject_type: 2, rate: 9, type: 3, comment: null, tags: userTags, ep_status: 4, vol_status: 0,
      updated_at: '2026-01-01T00:00:00Z',
      subject: { id, name: `Title ${id}`, name_cn: `标题 ${id}`, short_summary: '简介', date: '2026-01-01', platform: 'TV', eps: 12, score: 8.2, rank: 100, images: { large: 'https://example.com/cover.jpg' }, tags: [{ name: '科幻', count: 100 }, { name: '原创', count: 80 }] },
    })
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ total: 2, limit: 1, offset: 0, data: [entry(1, [])] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ total: 2, limit: 1, offset: 1, data: [entry(2, ['自定义'])] }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const result = await fetchBangumiCollection('sai')
    expect(result.items).toHaveLength(2)
    expect(result.items[0]).toMatchObject({ subjectId: 1, nameCn: '标题 1', summary: '简介', comment: '', collectionType: 3, tags: ['科幻', '原创'] })
    expect(result.items[1].tags).toEqual(['自定义'])
    expect(fetchMock.mock.calls[1][0]).toContain('offset=1')
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ cache: 'no-store' })
  })
})
