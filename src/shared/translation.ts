export const translationEndpoint = 'https://translation.googleapis.com/language/translate/v2'
export const translationLimit = 15_000
export const translationBatchSize = 128

export interface TranslationCredentials {
  key: string
}

export interface TranslationRequest {
  texts: string[]
  from?: string
  to: string
}

export interface TranslationSegment {
  text: string
  detectedLanguage?: string
}

export interface TranslationClient {
  openWeb?(request: { text: string; from: string; to: string }): Promise<void>
  status(): Promise<{ configured: boolean }>
  save(credentials: TranslationCredentials): Promise<unknown>
  clear(): Promise<unknown>
  languages(): Promise<{ languages: { language: string; name: string }[] }>
  translate(request: TranslationRequest): Promise<{ segments: TranslationSegment[] }>
  readClipboard?(): Promise<{ text: string }>
  writeClipboard?(value: { text: string }): Promise<unknown>
}

export const countCharacters = (text: string) => Array.from(text).length
const legacyLanguageCodes = new Map([['zh-hans', 'zh-CN'], ['zh-hant', 'zh-TW'], ['zh', 'zh-CN'], ['zh-cn', 'zh-CN'], ['zh-tw', 'zh-TW']])
export const googleLanguageCode = (code: string) => legacyLanguageCodes.get(code.toLowerCase()) ?? code
const languageCode = /^[a-z]{2,8}(?:-[a-z0-9]{2,8})*$/i

export function googleTranslateWebUrl({ text, from, to }: { text: string; from: string; to: string }) {
  if (typeof text !== 'string' || countCharacters(text) > 5_000 || !languageCode.test(from) || !languageCode.test(to)) {
    throw new Error('请检查语言，网页模式最多可带入 5,000 字符。')
  }
  const url = new URL('https://translate.google.com/')
  url.search = new URLSearchParams({ sl: googleLanguageCode(from), tl: googleLanguageCode(to), text, op: 'translate' }).toString()
  return url.href
}

export function normalizeTranslationCredentials(value: TranslationCredentials) {
  const key = typeof value?.key === 'string' ? value.key.trim() : ''
  if (!/^AIza[a-z0-9_-]{35}$/i.test(key)) throw new Error('请输入有效格式的 Google Cloud API Key。')
  return { key }
}

async function requestGoogle<T>(credentials: TranslationCredentials, path = '', body?: object): Promise<T> {
  const headers: Record<string, string> = { 'x-goog-api-key': credentials.key }
  if (body) headers['Content-Type'] = 'application/json'
  let response: Response
  try {
    response = await fetch(translationEndpoint + path, {
      method: body ? 'POST' : 'GET', headers, body: body && JSON.stringify(body),
      signal: AbortSignal.timeout(25_000), redirect: 'error', credentials: 'omit',
    })
  } catch {
    throw new Error('无法连接 Google Cloud Translation，请检查网络后重试。')
  }
  const payload = await response.json().catch(() => null) as {
    data?: T
    error?: { message?: string; errors?: { reason?: string }[]; details?: { reason?: string }[] }
  } | null
  if (!response.ok) {
    const reasons = [...payload?.error?.errors ?? [], ...payload?.error?.details ?? []].map(({ reason }) => reason)
    if (response.status === 429 || reasons.some((reason) => /limitexceeded|quota_exceeded|rate_limit/i.test(reason ?? '')) ||
        /(?:daily|rate) limit exceeded/i.test(payload?.error?.message ?? '')) {
      throw new Error('已达到 Google Cloud 调用频率或用量限制，请检查项目配额。')
    }
    if (response.status === 401 || response.status === 403 || reasons.some((reason) => reason?.startsWith('API_KEY_'))) {
      throw new Error('Google 拒绝了请求，请检查 API Key、API 限制、Cloud Translation API 和结算状态。')
    }
    throw new Error('Google 翻译请求失败（HTTP ' + response.status + '）。')
  }
  if (!payload?.data) throw new Error('Google 返回的结果不完整。')
  return payload.data
}

export async function googleTranslationLanguages(credentials: TranslationCredentials) {
  const data = await requestGoogle<Awaited<ReturnType<TranslationClient['languages']>>>(credentials, '/languages?target=zh-CN&model=nmt')
  if (!Array.isArray(data.languages)) throw new Error('Google 返回的语言列表不完整。')
  return data
}

export async function translateWithGoogle(credentials: TranslationCredentials, request: TranslationRequest) {
  const { texts, from, to } = request
  if (!Array.isArray(texts) || texts.length < 1 || texts.length > translationBatchSize ||
      texts.some((text) => typeof text !== 'string' || !text.trim()) ||
      texts.reduce((sum, text) => sum + countCharacters(text), 0) > translationLimit ||
      typeof to !== 'string' || !languageCode.test(to) ||
      (from !== undefined && (typeof from !== 'string' || !languageCode.test(from)))) {
    throw new Error('翻译请求超出限制，或包含无效的语言。')
  }
  const data = await requestGoogle<{ translations?: { translatedText?: string; detectedSourceLanguage?: string }[] }>(
    credentials, '', { q: texts, source: from && googleLanguageCode(from), target: googleLanguageCode(to), format: 'text', model: 'nmt' },
  )
  if (!Array.isArray(data.translations) || data.translations.length !== texts.length) throw new Error('Google 返回的翻译结果不完整。')
  const segments = data.translations.map((item): TranslationSegment => {
    if (typeof item?.translatedText !== 'string') throw new Error('Google 返回的翻译结果不完整。')
    return { text: item.translatedText, detectedLanguage: item.detectedSourceLanguage && googleLanguageCode(item.detectedSourceLanguage) }
  })
  return { segments }
}
