import { afterEach, describe, expect, it, vi } from 'vitest'
import { googleLanguageCode, googleTranslateWebUrl, normalizeTranslationCredentials, translateWithGoogle, translationBatchSize, translationLimit } from '../shared/translation'

const credentials = { key: 'AIza' + 'x'.repeat(35) }
afterEach(() => vi.unstubAllGlobals())

it('opens the official Google Translate page with encoded text and no API key', () => {
  const text = '你好 & op=other\nこんにちは'
  const url = new URL(googleTranslateWebUrl({ text, from: 'auto', to: 'zh-Hans' }))
  expect(url.origin).toBe('https://translate.google.com')
  expect(Object.fromEntries(url.searchParams)).toEqual({ sl: 'auto', tl: 'zh-CN', text, op: 'translate' })
  expect(() => googleTranslateWebUrl({ text: '😀'.repeat(5001), from: 'auto', to: 'zh-CN' })).toThrow('5,000')
})

describe('Google Cloud text translation', () => {
  it('authenticates with the supplied key and omits source for detection', async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({
      data: { translations: [{ detectedSourceLanguage: 'ja', translatedText: '你好' }] },
    }))
    vi.stubGlobal('fetch', fetch)
    await expect(translateWithGoogle(credentials, { texts: [' こんにちは '], to: 'zh-Hans' }))
      .resolves.toEqual({ segments: [{ text: '你好', detectedLanguage: 'ja' }] })
    const [url, init] = fetch.mock.calls[0]
    expect(url).toBe('https://translation.googleapis.com/language/translate/v2')
    expect(init.headers['x-goog-api-key']).toBe(credentials.key)
    expect(JSON.parse(init.body)).toEqual({ q: [' こんにちは '], target: 'zh-CN', format: 'text', model: 'nmt' })
    expect(googleLanguageCode('zh-Hant')).toBe('zh-TW')
  })

  it('rejects a missing key and oversized requests before calling Google', async () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    expect(() => normalizeTranslationCredentials({ key: '' })).toThrow('Google Cloud API Key')
    await expect(translateWithGoogle(credentials, { texts: ['😀'.repeat(translationLimit + 1)], to: 'zh-CN' }))
      .rejects.toThrow('翻译请求超出限制')
    await expect(translateWithGoogle(credentials, { texts: Array(translationBatchSize + 1).fill('a'), to: 'zh-CN' }))
      .rejects.toThrow('翻译请求超出限制')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('distinguishes Google quota errors from invalid API keys', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(Response.json({ error: { errors: [{ reason: 'dailyLimitExceeded' }] } }, { status: 403 }))
      .mockResolvedValueOnce(Response.json({ error: { details: [{ reason: 'API_KEY_INVALID' }] } }, { status: 400 }))
    vi.stubGlobal('fetch', fetch)
    const request = { texts: ['Hello'], from: 'en', to: 'ja' }
    await expect(translateWithGoogle(credentials, request)).rejects.toThrow('用量限制')
    await expect(translateWithGoogle(credentials, request)).rejects.toThrow('请检查 API Key')
  })
})
