import { Capacitor } from '@capacitor/core'

export const isAndroid = Capacitor.getPlatform() === 'android'
export function isElectron() { return window.sylunae?.platform === 'electron' }
export function hasDesktopMediaTools() { return isElectron() }
