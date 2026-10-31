export interface ImageNamingRule { template: string; start: number; digits: number; step: number }

export function validateImageNaming(rule: ImageNamingRule) {
  if (!rule || typeof rule.template !== 'string' || !rule.template.trim() || rule.template.length > 120) return '命名模板需为 1–120 个字符'
  if (!Number.isSafeInteger(rule.start) || rule.start < 0 || rule.start > 999999999) return '起始编号需为 0–999999999 的整数'
  if (!Number.isInteger(rule.digits) || rule.digits < 1 || rule.digits > 12) return '编号位数需为 1–12 的整数'
  if (!Number.isSafeInteger(rule.step) || rule.step < 1 || rule.step > 999999) return '编号步长需为 1–999999 的整数'
  return ''
}

// Shared by browser downloads and Electron. Extensions always come from the encoded file.
export function imageDownloadNames(names: string[], rule?: ImageNamingRule): string[] {
  if (rule) { const error = validateImageNaming(rule); if (error) throw new Error(error) }
  const used = new Set<string>()
  return names.map((name, index) => {
    const dot = name.lastIndexOf('.')
    const extension = dot > 0 ? name.slice(dot) : ''
    const original = dot > 0 ? name.slice(0, dot) : name
    let stem = rule ? rule.template.replace(/\{(n|name)\}/g, (_, token: string) => token === 'n' ? String(rule.start + index * rule.step).padStart(rule.digits, '0') : original) : original
    stem = stem.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/[. ]+$/, '').slice(0, 140) || 'image'
    if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(stem)) stem = `_${stem}`
    let candidate = `${stem}${extension}`
    let suffix = 1
    while (used.has(candidate.toLowerCase())) candidate = `${stem} (${suffix++})${extension}`
    used.add(candidate.toLowerCase())
    return candidate
  })
}

export function moveImage<T>(items: T[], from: number, to: number): T[] {
  if (!Number.isInteger(to) || from < 0 || from >= items.length || to < 0 || to >= items.length || from === to) return items
  const next = [...items]
  next.splice(to, 0, next.splice(from, 1)[0])
  return next
}
