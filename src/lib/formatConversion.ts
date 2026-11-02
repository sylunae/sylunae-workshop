import { categoryOf, conversionFormats, convertText, extensionOf, textExtensions, textTargets, type ConversionSource } from '../shared/conversion'
import { encodeImage } from './imageProcessing'

export function browserImageTargets() {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1
  try { return conversionFormats.filter((format) => ['jpg', 'png', 'webp', 'avif'].includes(format.id) && canvas.toDataURL(format.mime).startsWith(`data:${format.mime};`)).map((format) => format.id) }
  catch { return ['png'] }
}
export async function inspectBrowserFile(file: File): Promise<ConversionSource> {
  const source: ConversionSource = { id: crypto.randomUUID(), name: file.name, size: file.size, category: categoryOf(file.name, file.type), detected: extensionOf(file.name).toUpperCase(), targets: [], note: '' }
  if (!file.size) throw new Error('无法读取空文件')
  const extension = extensionOf(file.name)
  if (source.category === 'image') {
    const bitmap = await createImageBitmap(file); bitmap.close()
    source.targets = browserImageTargets()
    source.note = '网页端使用浏览器图片编码器；保持尺寸，动画或多页图片仅转换第一帧，转 JPG 使用白底，SVG 将栅格化。'
  } else if (source.category === 'document' && textExtensions.includes(extension)) {
    if (file.size > 20 * 1024 * 1024) throw new Error('文本文档请控制在 20 MB 以内')
    const text = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer())
    source.targets = textTargets(extension)
    if (extension === 'json') {
      const data: unknown = JSON.parse(text.replace(/^\uFEFF/, ''))
      if (!Array.isArray(data) || !data.every((item) => Array.isArray(item)) && !data.every((item) => item !== null && typeof item === 'object' && !Array.isArray(item))) source.targets = source.targets.filter((id) => id !== 'csv' && id !== 'tsv')
    }
    source.note = '使用 UTF-8；CSV/TSV 转 JSON 输出二维数组；Markdown 转 HTML 保留原文，不渲染排版。'
  } else source.note = source.category ? '此类型请在桌面端转换；音视频需要媒体工具，Office 文档需要安装 LibreOffice，PDF 暂不支持反向转换。' : '无法识别此类型，请选择图片、音视频或文档。'
  source.targets = source.targets.filter((id) => id !== extension && !(extension === 'jpeg' && id === 'jpg'))
  return source
}
export async function convertBrowserFile(file: File, source: ConversionSource, target: string, quality: number) {
  if (!source.targets.includes(target)) throw new Error('当前环境不支持此转换')
  const format = conversionFormats.find((item) => item.id === target)!
  if (source.category === 'image') return (await encodeImage(file, { rotation: 0, crop: null }, format.mime, quality)).blob
  return new Blob([convertText(new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer()), extensionOf(file.name), target)], { type: `${format.mime};charset=utf-8` })
}
