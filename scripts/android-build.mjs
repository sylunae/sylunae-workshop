import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomBytes } from 'node:crypto'
import { spawnSync } from 'node:child_process'

const root = fileURLToPath(new URL('..', import.meta.url))
const mode = process.argv[2] || 'debug'
if (!['debug', 'release', 'test'].includes(mode)) throw new Error('Expected debug, release or test')
const env = { ...process.env }
const localJdk = join(root, '.android-tools/jdk')
const localSdk = join(root, '.android-tools/sdk')
if (!env.JAVA_HOME && existsSync(localJdk)) env.JAVA_HOME = localJdk
if (!env.ANDROID_HOME && existsSync(localSdk)) env.ANDROID_HOME = localSdk
if (!env.JAVA_HOME) throw new Error('Install JDK 21 and Android SDK, or run scripts/setup-android.ps1 first.')
function run(command, args, extraEnv = {}) {
  const result = spawnSync(command, args, { cwd: root, env: { ...env, ...extraEnv }, stdio: 'inherit' })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}
if (mode === 'release') {
  const directory = join(root, '.android-signing')
  const keystore = join(directory, 'release.keystore'), properties = join(directory, 'signing.properties')
  mkdirSync(directory, { recursive: true })
  if (existsSync(keystore) !== existsSync(properties)) throw new Error('Signing files are incomplete. Restore the original .android-signing backup before building.')
  if (!existsSync(keystore)) {
    const password = randomBytes(32).toString('hex')
    run(join(env.JAVA_HOME, 'bin', process.platform === 'win32' ? 'keytool.exe' : 'keytool'), ['-genkeypair', '-keystore', keystore, '-alias', 'workshop', '-keyalg', 'RSA', '-keysize', '3072', '-validity', '10000', '-dname', 'CN=Sylunae Workshop', '-storepass:env', 'WORKSHOP_SIGN_PASSWORD', '-keypass:env', 'WORKSHOP_SIGN_PASSWORD'], { WORKSHOP_SIGN_PASSWORD: password })
    writeFileSync(properties, `storePassword=${password}\nkeyAlias=workshop\nkeyPassword=${password}\n`, { mode: 0o600 })
    console.log('Created local Android signing key. Back up .android-signing to preserve upgrade compatibility.')
  }
}
const java = join(env.JAVA_HOME, 'bin', process.platform === 'win32' ? 'java.exe' : 'java')
run(java, ['-classpath', join(root, 'android/gradle/wrapper/gradle-wrapper.jar'), 'org.gradle.wrapper.GradleWrapperMain', '-p', 'android', mode === 'test' ? ':app:connectedDebugAndroidTest' : mode === 'release' ? ':app:assembleRelease' : ':app:assembleDebug', '--console=plain'])
if (mode !== 'test') {
  const { version: projectVersion } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  const version = env.ORG_GRADLE_PROJECT_workshopVersionName || projectVersion
  const source = join(root, `android/app/build/outputs/apk/${mode}/app-${mode}.apk`)
  const output = join(root, `release/Sylunae-Workshop-${version}-Android${mode === 'debug' ? '-debug' : ''}.apk`)
  mkdirSync(join(root, 'release'), { recursive: true }); copyFileSync(source, output)
  console.log(`Android APK: ${output}`)
}
