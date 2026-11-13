import { snapshotSectionKeys } from '../data/snapshotSections'
import type { AppSnapshot } from '../shared/types'
import type { DriveWhiteNoise } from '../shared/driveBackup'

const sectionHashes = new WeakMap<object, Promise<string>>()
const deviceSettings = ['lastTool', 'recentTools', 'toolUsage', 'sidebarCollapsed', 'sidebarWidth', 'weatherCache', 'updatedAt'] as const
const deviceTimer = ['mode', 'completedSessions', 'secondsRemaining', 'running', 'endsAt'] as const

function omitFields<T extends object, K extends keyof T>(source: T, keys: readonly K[]) {
  const result = { ...source }
  for (const key of keys) delete result[key]
  return result as Omit<T, K>
}

function sameFields<T extends object>(a: T, b: T) {
  return (Object.keys(a) as Array<keyof T>).every((key) => Object.is(a[key], b[key]))
}

export function sameDriveData(a: AppSnapshot, b: AppSnapshot, excludeNotebook = false) {
  return snapshotSectionKeys.every((key) => {
    if (excludeNotebook && (key === 'notes' || key === 'folders')) return true
    if (a[key] === b[key]) return true
    if (key === 'settings') return sameFields(omitFields(a.settings, deviceSettings), omitFields(b.settings, deviceSettings))
    if (key === 'pomodoro') return sameFields(omitFields(a.pomodoro, deviceTimer), omitFields(b.pomodoro, deviceTimer))
    if (key === 'birthdays') return a.birthdays.people === b.birthdays.people && a.birthdays.settings === b.birthdays.settings
    return false
  })
}

export function preserveDeviceState(current: AppSnapshot, restored: AppSnapshot): AppSnapshot {
  const settings = { ...restored.settings }
  const pomodoro = { ...restored.pomodoro }
  for (const key of deviceSettings) Object.assign(settings, { [key]: current.settings[key] })
  for (const key of deviceTimer) Object.assign(pomodoro, { [key]: current.pomodoro[key] })
  return { ...restored, settings, pomodoro, birthdays: { ...restored.birthdays, deliveries: current.birthdays.deliveries } }
}

export function canonicalDriveJson(value: unknown) {
  return JSON.stringify(value, (_key, item: unknown) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return item
    return Object.fromEntries(Object.entries(item).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0))
  })
}

export function driveDigest(bytes: Uint8Array<ArrayBuffer>) {
  return crypto.subtle.digest('SHA-256', bytes)
    .then((bytes) => Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join(''))
}

const hash = (value: unknown) => driveDigest(new TextEncoder().encode(canonicalDriveJson(value)))

function sectionHash(snapshot: AppSnapshot, key: typeof snapshotSectionKeys[number]) {
  const value = snapshot[key]
  if (typeof value !== 'object' || value === null) return hash(value)
  let digest = sectionHashes.get(value)
  if (!digest) {
    // Notes are stored as individual rows whose storage order can change after restart.
    if (key === 'notes') digest = hash([...snapshot.notes].sort((a, b) => a.id.localeCompare(b.id)))
    else if (key === 'settings') digest = hash(omitFields(snapshot.settings, deviceSettings))
    else if (key === 'pomodoro') digest = hash(omitFields(snapshot.pomodoro, deviceTimer))
    else if (key === 'birthdays') digest = hash(omitFields(snapshot.birthdays, ['deliveries']))
    else digest = hash(value)
    sectionHashes.set(value, digest)
  }
  return digest
}

export async function readDriveResources(): Promise<DriveWhiteNoise> {
  const { items } = await window.sylunae!.resources.list()
  return items.filter(({ origin, localPath }) => origin === 'custom' && localPath)
    .map(({ id, title, localPath, duration, size }) => ({ id, title, localPath: localPath!, duration, size }))
    .sort((a, b) => a.id.localeCompare(b.id))
}

export async function driveLocalHash(snapshot: AppSnapshot, resources?: DriveWhiteNoise, excludeNotebook = false) {
  const sections = await Promise.all(snapshotSectionKeys
    .filter((key) => !excludeNotebook || (key !== 'notes' && key !== 'folders'))
    // Keep existing sync baselines valid until the user adds collection data.
    .filter((key) => key !== 'collectionExtras' || snapshot.collectionExtras.memes.length > 0 || snapshot.collectionExtras.stickerPacks.length > 0)
    .map((key) => sectionHash(snapshot, key)))
  return hash([...sections, resources ?? await readDriveResources()])
}

let resourceEdits = 0
let restoringResources = false

export async function editDriveResources<T>(edit: () => Promise<T>) {
  if (restoringResources) throw new Error('正在应用云端更新，请稍后重试。')
  resourceEdits++
  try { return await edit() }
  finally { resourceEdits-- }
}

export async function withUnchangedDriveResources(expected: DriveWhiteNoise, restore: () => Promise<void>) {
  if (resourceEdits || restoringResources) return
  restoringResources = true
  try {
    if (JSON.stringify(await readDriveResources()) === JSON.stringify(expected)) await restore()
  } finally { restoringResources = false }
}
