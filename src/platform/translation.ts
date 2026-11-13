import { registerPlugin } from '@capacitor/core'
import { isAndroid } from './environment'
import { googleTranslationLanguages, normalizeTranslationCredentials, translateWithGoogle, type TranslationClient, type TranslationCredentials } from '../shared/translation'

export const androidTranslation = registerPlugin<TranslationClient>('WorkshopTranslation')

let browserCredentials: TranslationCredentials | undefined
const browser: TranslationClient = {
  async status() { return { configured: Boolean(browserCredentials) } },
  async save(value) { browserCredentials = normalizeTranslationCredentials(value) },
  async clear() { browserCredentials = undefined },
  async translate(request) {
    if (!browserCredentials) throw new Error('请先填写自己的 Google Cloud API Key。')
    return translateWithGoogle(browserCredentials, request)
  },
  async languages() {
    if (!browserCredentials) throw new Error('请先填写自己的 Google Cloud API Key。')
    return googleTranslationLanguages(browserCredentials)
  },
}

export function translationClient(): TranslationClient {
  return window.sylunae?.translation ?? (isAndroid ? androidTranslation : browser)
}
