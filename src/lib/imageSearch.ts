import {
  imageFingerprint, imageSimilarity, isSearchableImage, rankImageMatches,
  type ImageSearchOptions, type ImageSearchOutput, type ImageSearchProgress,
} from '../shared/imageSearch'

export function selectSearchFiles(files: File[], recursive: boolean) {
  return files.filter((file) => isSearchableImage(file.name) && (recursive || file.webkitRelativePath.split('/').length <= 2))
}

export async function browserImageFingerprint(file: File) {
  if (file.size > 128 * 1024 * 1024) throw new Error('图片文件超过 128 MB')
  const bitmap = await createImageBitmap(file)
  try {
    if (!bitmap.width || !bitmap.height || bitmap.width * bitmap.height > 80_000_000) throw new Error('图片超过 8000 万像素或无法读取')
    const canvas = document.createElement('canvas')
    canvas.width = 32
    canvas.height = 32
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context) throw new Error('浏览器无法读取图片像素')
    context.fillStyle = '#fff'
    context.fillRect(0, 0, 32, 32)
    context.drawImage(bitmap, 0, 0, 32, 32)
    const rgba = context.getImageData(0, 0, 32, 32).data
    const rgb = new Uint8Array(32 * 32 * 3)
    for (let i = 0; i < 32 * 32; i++) for (let c = 0; c < 3; c++) rgb[i * 3 + c] = rgba[i * 4 + c]
    return imageFingerprint(rgb, bitmap.width / bitmap.height)
  } finally { bitmap.close() }
}

export async function searchBrowserImages(
  reference: File, files: File[], options: ImageSearchOptions, signal: AbortSignal,
  report: (progress: ImageSearchProgress) => void,
): Promise<ImageSearchOutput> {
  const target = await browserImageFingerprint(reference)
  const candidates = selectSearchFiles(files, options.recursive)
  const progress: ImageSearchProgress = { checked: 0, failed: 0, skippedFolders: 0, discovered: candidates.length, current: '', phase: 'searching' }
  let ranked: ImageSearchOutput['results'] = []
  let matches = 0
  let lastReport = 0
  for (const file of candidates) {
    if (signal.aborted) break
    progress.current = file.webkitRelativePath || file.name
    try {
      const score = imageSimilarity(target, await browserImageFingerprint(file))
      if (signal.aborted) break
      progress.checked++
      if (score >= options.minScore) {
        matches++
        ranked = rankImageMatches([...ranked, { path: progress.current, name: file.name, score, preview: '' }])
      }
    } catch { progress.failed++ }
    if (Date.now() - lastReport > 100) {
      report({ ...progress })
      lastReport = Date.now()
      // Give rendering, input, and cancellation a turn during long scans.
      await new Promise((resolve) => window.setTimeout(resolve, 0))
    }
  }
  return { ...progress, current: '', results: ranked, matches, cancelled: signal.aborted }
}
