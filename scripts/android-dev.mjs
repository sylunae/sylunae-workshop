import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn, spawnSync } from 'node:child_process'

const root = fileURLToPath(new URL('..', import.meta.url))
const sdk = process.env.ANDROID_HOME || join(root, '.android-tools/sdk')
const adb = join(sdk, 'platform-tools', process.platform === 'win32' ? 'adb.exe' : 'adb')
const vite = join(root, 'node_modules/vite/bin/vite.js')
const cap = join(root, 'node_modules/@capacitor/cli/bin/capacitor')
const env = { ...process.env, SYLUNAE_ANDROID_DEV_URL: 'http://localhost:5173' }
function run(command, args, environment = env, capture = false) {
  const result = spawnSync(command, args, { cwd: root, env: environment, encoding: 'utf8', stdio: capture ? 'pipe' : 'inherit' })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(result.stderr || `${command} failed`)
  return result.stdout || ''
}
if (!existsSync(adb)) throw new Error('Install Android SDK or run scripts/setup-android.ps1 first.')
const devices = run(adb, ['devices'], env, true).split(/\r?\n/).filter((line) => /\sdevice$/.test(line)).map((line) => line.split(/\s/)[0])
const serial = process.argv[2] || (devices.length === 1 ? devices[0] : '')
if (!serial || !devices.includes(serial)) throw new Error('Connect one authorized USB device or emulator, or run npm run dev:android -- DEVICE_SERIAL.')
if (!existsSync(join(root, 'dist/index.html'))) run(process.execPath, [vite, 'build'])
const server = spawn(process.execPath, [vite, '--host', '127.0.0.1', '--port', '5173', '--strictPort'], { cwd: root, env, stdio: 'inherit' })
const ended = new Promise((resolve) => { server.once('exit', resolve); server.once('error', resolve) })
process.once('SIGINT', () => server.kill())
process.once('SIGTERM', () => server.kill())
try {
  let ready = false
  for (let attempt = 0; attempt < 40; attempt++) {
    try { ready = (await fetch(env.SYLUNAE_ANDROID_DEV_URL)).ok } catch { /* Vite is starting. */ }
    if (ready) break
    if (server.exitCode !== null) throw new Error('Vite stopped during startup. Check its error above (including port 5173 conflicts).')
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  if (!ready) throw new Error('Vite startup timed out.')
  run(adb, ['-s', serial, 'reverse', 'tcp:5173', 'tcp:5173'])
  run(process.execPath, [cap, 'sync', 'android'])
  run(process.execPath, [join(root, 'scripts/android-build.mjs'), 'debug'])
  run(adb, ['-s', serial, 'install', '-r', join(root, 'android/app/build/outputs/apk/debug/app-debug.apk')])
  run(adb, ['-s', serial, 'shell', 'am', 'start', '-n', 'studio.sylunae.workshop.debug/studio.sylunae.workshop.MainActivity'])
  console.log('\nAndroid live reload ready. Edit src/*.tsx or src/styles.css and save. Inspect the WebView at chrome://inspect/#devices. Java/manifest/plugin changes require restarting this command. Ctrl+C to stop.\n')
  await ended
} finally {
  server.kill()
  const production = { ...process.env }; delete production.SYLUNAE_ANDROID_DEV_URL
  run(process.execPath, [cap, 'sync', 'android'], production)
}
