export type EncodingLevel = 'strong' | 'standard' | 'original'
export const encodingQuality = (level: EncodingLevel) => level === 'strong' ? 45 : level === 'standard' ? 82 : 100

export interface CropRect { x: number; y: number; width: number; height: number }
export interface ImageEdits { rotation: number; crop: CropRect | null }

export function centeredCrop(width: number, height: number, ratio: number): CropRect {
  const cropWidth = Math.min(width, height * ratio)
  const cropHeight = cropWidth / ratio
  return { x: (width - cropWidth) / 2, y: (height - cropHeight) / 2, width: cropWidth, height: cropHeight }
}

export function outputDimensions(width: number, height: number, edits: ImageEdits) {
  const crop = edits.crop ?? { width, height }
  const swapped = Math.abs(edits.rotation % 180) === 90
  return { width: Math.max(1, Math.round(swapped ? crop.height : crop.width)), height: Math.max(1, Math.round(swapped ? crop.width : crop.height)) }
}

export async function encodeImage(file: File, edits: ImageEdits, format: string, quality: number, original = false) {
  const bitmap = await createImageBitmap(file)
  if (original && !edits.crop && edits.rotation === 0) {
    const size = { width: bitmap.width, height: bitmap.height }
    bitmap.close()
    return { blob: file as Blob, ...size }
  }
  const canvas = document.createElement('canvas')
  try {
    const size = outputDimensions(bitmap.width, bitmap.height, edits)
    canvas.width = size.width
    canvas.height = size.height
    const context = canvas.getContext('2d')
    if (!context) throw new Error('无法创建图片画布')
    if (format === 'image/jpeg') {
      context.fillStyle = '#fff'
      context.fillRect(0, 0, canvas.width, canvas.height)
    }
    context.translate(canvas.width / 2, canvas.height / 2)
    context.rotate(edits.rotation * Math.PI / 180)
    const crop = edits.crop ?? { x: 0, y: 0, width: bitmap.width, height: bitmap.height }
    context.drawImage(bitmap, crop.x, crop.y, crop.width, crop.height, -crop.width / 2, -crop.height / 2, crop.width, crop.height)
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, format, quality / 100))
    if (!blob || blob.type !== format) throw new Error('当前环境不支持此输出格式')
    return { blob, ...size }
  } finally {
    bitmap.close()
    canvas.width = canvas.height = 0
  }
}

export function outputName(name: string, format: string) {
  if (format === 'original') return name
  return `${name.replace(/\.[^.]+$/, '')}-处理.${format === 'image/jpeg' ? 'jpg' : format.split('/')[1]}`
}
