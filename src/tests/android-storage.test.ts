// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { readAndroidSnapshot, writeAndroidSnapshot, nativeChunkSize, type NativeCall } from '../platform/androidStorage'
import { decodeBytes, encodeBytes } from '../platform/binary'
import { createDefaultSnapshot } from '../shared/defaults'

describe('Android large-data persistence', () => {
  it('splits large Unicode values into bounded messages and reconstructs split UTF-8 characters', async () => {
    const settings = { ...createDefaultSnapshot().settings, displayName: '月🌙'.repeat(120_000) }
    const chunks: string[] = []
    const call = vi.fn(async (op: string, options?: Record<string, unknown>) => {
      if (op === 'storage:stage') { const data = options!.data as string; expect(decodeBytes(data).length).toBeLessThanOrEqual(nativeChunkSize); chunks.push(data) }
      if (op === 'storage:manifest') return { records: ['settings'], notes: [] }
      if (op === 'storage:readChunk') return { data: chunks[options!.part as number] ?? null }
    }) as unknown as NativeCall
    await writeAndroidSnapshot(call, { settings }, false)
    expect(chunks.length).toBeGreaterThan(2)
    expect((await readAndroidSnapshot(call)).settings).toEqual(settings)
  })
  it('aborts staging without committing when any chunk fails', async () => {
    const calls: string[] = []
    const call: NativeCall = async (op) => { calls.push(op); if (op === 'storage:stage') throw new Error('Disk full'); return undefined as never }
    await expect(writeAndroidSnapshot(call, createDefaultSnapshot(), true)).rejects.toThrow('Disk full')
    expect(calls).toEqual(['storage:stage', 'storage:abort'])
  })
  it('retains note row granularity and sends deletions in the final transaction', async () => {
    const calls: Array<{ op: string; options?: Record<string, unknown> }> = []
    const call: NativeCall = async (op, options) => { calls.push({ op, options }); return undefined as never }
    const note = { id: 'note-id', title: 'Test' } as never
    await writeAndroidSnapshot(call, { noteChanges: { put: [note], delete: ['old-note'] } }, false)
    expect(calls[0].options).toMatchObject({ scope: 'notes', id: 'note-id', data: encodeBytes(new TextEncoder().encode(JSON.stringify(note))) })
    expect(calls.at(-1)).toMatchObject({ op: 'storage:commit', options: { replace: false, deletedNotes: ['old-note'] } })
  })
})
