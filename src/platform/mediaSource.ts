import { Capacitor } from '@capacitor/core'

export function mediaSource(source: string): string {
  return Capacitor.getPlatform() === 'android' && source.startsWith('file://') ? Capacitor.convertFileSrc(source) : source
}
