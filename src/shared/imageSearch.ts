export const imageSearchExtensions = ['jpg', 'jpeg', 'png', 'webp', 'avif', 'gif', 'tif', 'tiff']
export const imageSearchAccept = imageSearchExtensions.map((extension) => `.${extension}`).join(',')
export const imageSearchResultLimit = 100
export const isSearchableImage = (name: string) => imageSearchExtensions.includes(name.split('.').pop()?.toLowerCase() ?? '')

export interface ImageSearchReference { name: string; preview: string }
export interface ImageSearchMatch extends ImageSearchReference { path: string; score: number }
export interface ImageSearchOptions { recursive: boolean; minScore: number }
export interface ImageSearchProgress {
  checked: number
  failed: number
  skippedFolders: number
  discovered: number
  current: string
  phase: 'searching' | 'previews'
}
export interface ImageSearchOutput extends ImageSearchProgress {
  results: ImageSearchMatch[]
  matches: number
  cancelled: boolean
}
export interface ImageSearchAPI {
  pickReference: () => Promise<ImageSearchReference | null>
  pickFolder: () => Promise<string | null>
  search: (options: ImageSearchOptions, onProgress: (progress: ImageSearchProgress) => void) => Promise<ImageSearchOutput>
  cancel: () => Promise<void>
  openResult: (path: string, reveal: boolean) => Promise<void>
}

const size = 32
const cosines = Array.from({ length: 8 }, (_, frequency) =>
  Array.from({ length: size }, (_, position) => Math.cos((2 * position + 1) * frequency * Math.PI / (2 * size))),
)

export interface ImageFingerprint {
  pixels: Float32Array
  gray: Float32Array
  mean: number
  energy: number
  color: number[]
  hash: boolean[]
  aspect: number
}

// Both decoders supply a white-composited, orientation-corrected 32 × 32 RGB image.
export function imageFingerprint(rgb: ArrayLike<number>, aspect: number): ImageFingerprint {
  if (rgb.length !== size * size * 3 || !Number.isFinite(aspect) || aspect <= 0) throw new Error('无效的图片像素')
  const pixels = Float32Array.from(rgb)
  const gray = new Float32Array(size * size)
  const color = [0, 0, 0]
  for (let i = 0; i < gray.length; i++) {
    gray[i] = .299 * pixels[i * 3] + .587 * pixels[i * 3 + 1] + .114 * pixels[i * 3 + 2]
    for (let c = 0; c < 3; c++) color[c] += pixels[i * 3 + c] / gray.length
  }
  const mean = gray.reduce((sum, value) => sum + value, 0) / gray.length
  const energy = Math.sqrt(gray.reduce((sum, value) => sum + (value - mean) ** 2, 0))
  const rows = new Float64Array(size * 8)
  for (let y = 0; y < size; y++) for (let u = 0; u < 8; u++) {
    for (let x = 0; x < size; x++) rows[y * 8 + u] += gray[y * size + x] * cosines[u][x]
  }
  const coefficients: number[] = []
  for (let v = 0; v < 8; v++) for (let u = 0; u < 8; u++) {
    if (u === 0 && v === 0) continue
    let value = 0
    for (let y = 0; y < size; y++) value += rows[y * 8 + u] * cosines[v][y]
    coefficients.push(Math.abs(value) < .000001 ? 0 : value)
  }
  const median = [...coefficients].sort((a, b) => a - b)[31]
  return { pixels, gray, mean, energy, color, hash: coefficients.map((value) => value > median), aspect }
}

// Similarity is a ranking score, not a statistical probability of identity.
export function imageSimilarity(left: ImageFingerprint, right: ImageFingerprint): number {
  let distance = 0
  let covariance = 0
  for (let i = 0; i < left.pixels.length; i++) distance += Math.abs(left.pixels[i] - right.pixels[i])
  for (let i = 0; i < left.gray.length; i++) covariance += (left.gray[i] - left.mean) * (right.gray[i] - right.mean)
  const pixel = 1 - distance / (left.pixels.length * 255)
  const structure = left.energy < .01 && right.energy < .01 ? 1
    : Math.max(0, Math.min(1, covariance / Math.max(.0001, left.energy * right.energy)))
  const hash = left.hash.reduce((sum, value, i) => sum + Number(value === right.hash[i]), 0) / left.hash.length
  const color = Math.max(0, 1 - left.color.reduce((sum, value, i) => sum + Math.abs(value - right.color[i]), 0) / (3 * 128))
  const aspect = Math.min(left.aspect, right.aspect) / Math.max(left.aspect, right.aspect)
  return Math.round(Math.max(0, Math.min(100, 100 * (.45 * hash + .30 * structure + .25 * pixel) * (.7 + .3 * color) * (.9 + .1 * aspect))) * 10) / 10
}

export function rankImageMatches<T extends { path: string; score: number }>(matches: T[]): T[] {
  return matches.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path)).slice(0, imageSearchResultLimit)
}
