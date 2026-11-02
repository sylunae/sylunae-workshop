export type ConversionCategory = 'image' | 'video' | 'audio' | 'document'
export interface ConversionFormat { id: string; label: string; category: ConversionCategory; mime: string }
export const conversionFormats: ConversionFormat[] = [
  ...Object.entries({ jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp', avif: 'image/avif', gif: 'image/gif', tiff: 'image/tiff', bmp: 'image/bmp', ico: 'image/x-icon' }).map(([id, mime]) => ({ id, label: id.toUpperCase(), category: 'image' as const, mime })),
  ...Object.entries({ mp4: 'video/mp4', webm: 'video/webm', mkv: 'video/x-matroska', mov: 'video/quicktime', avi: 'video/x-msvideo', mpeg: 'video/mpeg', ts: 'video/mp2t' }).map(([id, mime]) => ({ id, label: id.toUpperCase(), category: 'video' as const, mime })),
  ...Object.entries({ mp3: 'audio/mpeg', wav: 'audio/wav', flac: 'audio/flac', m4a: 'audio/mp4', aac: 'audio/aac', ogg: 'audio/ogg', opus: 'audio/ogg', aiff: 'audio/aiff', wma: 'audio/x-ms-wma' }).map(([id, mime]) => ({ id, label: id.toUpperCase(), category: 'audio' as const, mime })),
  ...Object.entries({ txt: 'text/plain', md: 'text/markdown', html: 'text/html', json: 'application/json', csv: 'text/csv', tsv: 'text/tab-separated-values', pdf: 'application/pdf', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', doc: 'application/msword', odt: 'application/vnd.oasis.opendocument.text', rtf: 'application/rtf', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', xls: 'application/vnd.ms-excel', ods: 'application/vnd.oasis.opendocument.spreadsheet', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', ppt: 'application/vnd.ms-powerpoint', odp: 'application/vnd.oasis.opendocument.presentation' }).map(([id, mime]) => ({ id, label: id.toUpperCase(), category: 'document' as const, mime })),
]
export const categoryLabels: Record<ConversionCategory, string> = { image: '图片', video: '视频', audio: '音频', document: '文档' }
export const extensionOf = (name: string) => name.split('.').pop()?.toLowerCase() ?? ''
export function categoryOf(name: string, mime = ''): ConversionCategory | null {
  const ext = extensionOf(name)
  if (mime.startsWith('image/') || /^(jpe?g|png|webp|avif|gif|tiff?|bmp|ico|svg|heic|heif|jxl)$/.test(ext)) return 'image'
  if (mime.startsWith('video/') || /^(mp4|m4v|webm|mkv|mov|avi|mpeg|mpg|ts|mts|m2ts|flv|wmv|3gp|vob|ogv)$/.test(ext)) return 'video'
  if (mime.startsWith('audio/') || /^(mp3|wav|flac|m4a|aac|ogg|opus|aiff?|wma|alac|ape|amr|ac3|mka)$/.test(ext)) return 'audio'
  if (/^(txt|md|markdown|html?|json|csv|tsv|pdf|docx?|odt|rtf|xlsx?|ods|pptx?|odp)$/.test(ext)) return 'document'
  return null
}
export const outputFileName = (name: string, target: string) => `${name.replace(/\.[^.]+$/, '').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/[. ]+$/, '') || '转换结果'}.${target}`
export interface ConversionSource { id: string; name: string; size: number; category: ConversionCategory | null; detected: string; targets: string[]; note: string }
export interface ConversionResult { id: string; name: string; size: number }
export interface ConversionCapabilities { ffmpeg: boolean; office: boolean; image: string[] }
export interface FormatConversionAPI {
  capabilities: () => Promise<ConversionCapabilities>
  inspect: (file: File) => Promise<ConversionSource>
  convert: (id: string, target: string, quality: number) => Promise<ConversionResult>
  save: (ids: string[]) => Promise<number>
  release: (ids: string[]) => Promise<void>
  cancel: () => Promise<void>
}
export const textExtensions = ['txt', 'md', 'markdown', 'json', 'csv', 'tsv']
export function textTargets(extension: string): string[] {
  if (extension === 'json' || extension === 'csv' || extension === 'tsv') return ['json', 'csv', 'tsv', 'txt', 'html'].filter((id) => id !== extension)
  if (extension === 'txt' || extension === 'md' || extension === 'markdown') return ['txt', 'md', 'html'].filter((id) => id !== (extension === 'markdown' ? 'md' : extension))
  return []
}

// RFC 4180 quoting, including embedded newlines and trailing empty fields.
export function parseDelimited(text: string, delimiter: string): string[][] {
  const rows: string[][] = []; let row: string[] = []; let field = ''; let quoted = false; let closed = false
  const input = text.replace(/^\uFEFF/, '')
  for (let i = 0; i < input.length; i++) {
    const char = input[i]
    if (quoted) {
      if (char === '"' && input[i + 1] === '"') { field += '"'; i++ }
      else if (char === '"') { quoted = false; closed = true }
      else field += char
    } else if (char === delimiter) { row.push(field); field = ''; closed = false }
    else if (char === '\n' || char === '\r') {
      if (char === '\r' && input[i + 1] === '\n') i++
      row.push(field); rows.push(row); row = []; field = ''; closed = false
    } else if (char === '"' && !field && !closed) quoted = true
    else { if (closed || char === '"') throw new Error('表格引号格式无效'); field += char }
  }
  if (quoted) throw new Error('表格存在未闭合的引号')
  if (field || row.length || closed) { row.push(field); rows.push(row) }
  return rows
}
const escapeHtml = (text: string) => text.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!)
export function convertText(text: string, source: string, target: string): string {
  if (!textTargets(source).includes(target)) throw new Error('不支持此文档转换')
  let rows: unknown[][] | null = null
  if (source === 'csv' || source === 'tsv') rows = parseDelimited(text, source === 'csv' ? ',' : '\t')
  if (source === 'json') {
    const data: unknown = JSON.parse(text.replace(/^\uFEFF/, ''))
    if (target === 'csv' || target === 'tsv') {
      if (!Array.isArray(data)) throw new Error('转换为表格需要 JSON 数组（对象数组或二维数组）')
      if (data.every((item) => Array.isArray(item))) rows = data
      else if (data.every((item) => item !== null && typeof item === 'object' && !Array.isArray(item))) {
        const keys = [...new Set(data.flatMap((item) => Object.keys(item)))]
        rows = [keys, ...data.map((item) => keys.map((key) => item[key] ?? ''))]
      } else throw new Error('转换为表格需要对象数组或二维数组')
    }
  }
  if (target === 'json') return JSON.stringify(rows, null, 2)
  if ((target === 'csv' || target === 'tsv') && rows) {
    const separator = target === 'csv' ? ',' : '\t'
    return rows.map((row) => row.map((value) => {
      const field = value === null ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value)
      return /["\r\n,\t]/.test(field) ? `"${field.replace(/"/g, '""')}"` : field
    }).join(separator)).join('\r\n')
  }
  if (target === 'html') return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>转换文档</title></head><body>${rows ? `<table>${rows.map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(String(cell))}</td>`).join('')}</tr>`).join('')}</table>` : `<pre>${escapeHtml(text)}</pre>`}</body></html>`
  return text
}
