import { z } from 'zod'
import { driveFileId, driveObjectSchema, type DriveObject } from './driveBackup'
import type { AppSnapshot } from './types'

export type Notebook = Pick<AppSnapshot, 'notes' | 'folders'>
export const notebookRole = 'notebook-v1'
export const notebookKinds = ['folders', 'notes'] as const
const entry = z.object({ id: z.string().min(1), object: driveObjectSchema, assets: z.array(driveObjectSchema) })
export const notebookManifest = z.object({
  format: z.literal(notebookRole),
  ancestors: z.array(z.string().regex(driveFileId)).max(256),
  folders: z.array(entry),
  notes: z.array(entry),
}).refine(({ folders, notes }) => [folders, notes].every((rows) => new Set(rows.map(({ id }) => id)).size === rows.length))
export type NotebookManifest = z.infer<typeof notebookManifest>
export type NotebookEntry = z.infer<typeof entry>
export type NotebookHead = NotebookManifest & { id: string }
export type LegacyNotebook = { id: string; notebook: Notebook; assets: DriveObject[] }
export const notebookId = z.string().regex(driveFileId)

export interface DriveNotebookAPI {
  latest: () => Promise<NotebookHead | null>
  revision: (id: string) => Promise<NotebookHead>
  legacy: (id?: string) => Promise<LegacyNotebook | null>
  read: (object: DriveObject) => Promise<Uint8Array>
  put: (bytes: Uint8Array, mime: string) => Promise<DriveObject>
  publish: (manifest: NotebookManifest, expected: string | null) => Promise<string>
}
