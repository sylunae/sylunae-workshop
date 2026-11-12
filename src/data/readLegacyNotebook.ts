import { folderSchema, noteSchema } from './backup'
import type { DriveManifest, DriveObject } from '../shared/driveBackup'
import type { Notebook } from '../shared/driveNotebook'
import type { Note } from '../shared/types'

function restoreAttachmentIds(node: Note['content']): Note['content'] {
  const source = node.type === 'image' && node.attrs?.src
  const match = typeof source === 'string' && /^sylunae-drive:note:([a-f0-9]{64})$/.exec(source)
  return {
    ...node,
    attrs: match ? { ...node.attrs, src: 'sylunae-note-asset:' + match[1] } : node.attrs,
    content: node.content?.map(restoreAttachmentIds),
  }
}

export async function readLegacyNotebook(manifest: DriveManifest, read: (object: DriveObject) => Promise<unknown>): Promise<Notebook> {
  const [notes, folders] = await Promise.all([read(manifest.sections.notes), read(manifest.sections.folders)])
  return {
    notes: noteSchema.array().parse(notes).map((note) => ({ ...note, content: restoreAttachmentIds(note.content) })),
    folders: folderSchema.array().parse(folders),
  }
}
