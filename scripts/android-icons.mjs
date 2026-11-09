import sharp from 'sharp'
import { fileURLToPath } from 'node:url'
const source = fileURLToPath(new URL('../public/icon.svg', import.meta.url))
for (const [density, size] of [['mdpi', 48], ['hdpi', 72], ['xhdpi', 96], ['xxhdpi', 144], ['xxxhdpi', 192]]) {
  for (const name of ['ic_launcher', 'ic_launcher_round']) {
    await sharp(source).resize(size, size).png().toFile(fileURLToPath(new URL(`../android/app/src/main/res/mipmap-${density}/${name}.png`, import.meta.url)))
  }
}
