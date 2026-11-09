import { registerPlugin, type PluginListenerHandle } from '@capacitor/core'
import type { MusicTrack } from '../shared/types'

export interface NativePlaybackState {
  id: string | null
  playing: boolean
  position: number
  duration: number
  volume: number
  repeat: 'off' | 'one' | 'all'
  shuffle: boolean
}
interface NativePlayerPlugin {
  command(options: Record<string, unknown>): Promise<NativePlaybackState>
  addListener(event: 'state', listener: (state: NativePlaybackState) => void): Promise<PluginListenerHandle>
  addListener(event: 'playbackError', listener: (error: { message: string }) => void): Promise<PluginListenerHandle>
}
export const nativePlayer = registerPlugin<NativePlayerPlugin>('WorkshopPlayer')
let commands: Promise<unknown> = Promise.resolve()
export function playerCommand(op: string, options: Record<string, unknown> = {}) {
  const result = commands.then(() => nativePlayer.command({ op, ...options }))
  commands = result.catch(() => undefined)
  return result
}
export function setNativeQueue(tracks: MusicTrack[], id: string, play: boolean) {
  return playerCommand('queue', { tracks: tracks.map(({ id, path, title, artist, album, cover }) => ({ id, path, title, artist, album, cover })), id, play })
}
