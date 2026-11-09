import type { CapacitorConfig } from '@capacitor/cli'

const devUrl = process.env.SYLUNAE_ANDROID_DEV_URL
if (devUrl && !/^http:\/\/(localhost|127\.0\.0\.1):\d+\/?$/.test(devUrl)) throw new Error('Android live reload only accepts a localhost URL over adb reverse.')

const config: CapacitorConfig = {
  appId: 'studio.sylunae.workshop',
  appName: '丝月工坊',
  webDir: 'dist',
  android: { allowMixedContent: false },
  ...(devUrl ? { server: { url: devUrl, cleartext: true } } : {}),
}
export default config
