import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeftRight, Clipboard, Copy, ExternalLink, Settings2 } from 'lucide-react'
import { useAppStore } from '../app/AppStore'
import { usePersistentState } from '../lib/usePersistentState'
import { isAndroid, isElectron } from '../platform/environment'
import { translationClient } from '../platform/translation'
import { countCharacters, googleLanguageCode, googleTranslateWebUrl, normalizeTranslationCredentials, translationBatchSize, translationLimit, type TranslationSegment } from '../shared/translation'
import { newId, nowIso } from '../utils'
import { Button } from './ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog'
import { Input } from './ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select'
import { Textarea } from './ui/textarea'
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs'

const commonLanguages: Record<string, string> = {
  'zh-CN': '简体中文', 'zh-TW': '繁體中文', en: '英语', ja: '日语', ko: '韩语',
  fr: '法语', de: '德语', es: '西班牙语', ru: '俄语', it: '意大利语',
  pt: '葡萄牙语', th: '泰语', vi: '越南语', id: '印度尼西亚语', ar: '阿拉伯语',
}
const presets = [
  { from: 'ja', to: 'zh-CN', label: '日语 → 简中' },
  { from: 'en', to: 'zh-CN', label: '英语 → 简中' },
  { from: 'zh-CN', to: 'en', label: '简中 → 英语' },
]
const formatCount = (count: number) => count.toLocaleString('zh-CN')
const errorMessage = (error: unknown) => (error instanceof Error ? error.message : '操作失败，请重试。')
  .replace(/^Error invoking remote method '[^']+': Error: /, '')

export function TranslationTool() {
  const [mode, setMode] = usePersistentState<'web' | 'api'>('translation.mode', 'web')
  const [draft, setDraft] = useState('')
  return (
    <Tabs value={mode} onValueChange={(value) => setMode(value === 'api' ? 'api' : 'web')}>
      <TabsList aria-label="翻译模式">
        <TabsTrigger value="web">Google 翻译网页</TabsTrigger>
        <TabsTrigger value="api">API 翻译</TabsTrigger>
      </TabsList>
      <TabsContent value="web"><TranslationWeb draft={draft} onDraftChange={setDraft} /></TabsContent>
      <TabsContent value="api"><TranslationApi source={draft} setSource={setDraft} /></TabsContent>
    </Tabs>
  )
}

function TranslationWeb({ draft, onDraftChange }: { draft: string; onDraftChange: (value: string) => void }) {
  const [error, setError] = useState('')
  const [opening, setOpening] = useState(false)
  const native = isElectron() || isAndroid
  const [pair] = usePersistentState('translation.languages', { from: 'auto', to: 'zh-CN' })
  const request = { text: draft, from: googleLanguageCode(pair.from), to: googleLanguageCode(pair.to) }
  const tooLong = countCharacters(draft) > 5_000

  async function openPage() {
    setError('')
    const client = translationClient()
    try {
      if (native && client.openWeb) {
        setOpening(true)
        await client.openWeb(request)
      } else {
        window.open(googleTranslateWebUrl(request), '_blank', 'noopener,noreferrer')
      }
    } catch (failure) {
      setError(errorMessage(failure))
    } finally {
      setOpening(false)
    }
  }

  return (
    <div className="translation-tool">
      <label htmlFor="translation-web-source">原文</label>
      <Textarea id="translation-web-source" value={draft} onChange={(event) => onDraftChange(event.target.value)}
        placeholder="输入或粘贴原文，也可以直接打开 Google 翻译" className="min-h-40" />
      <div className="translation-toolbar">
        <Button onClick={() => void openPage()} disabled={tooLong || opening}>
          <ExternalLink /> {opening ? '正在打开…' : '打开 Google 翻译'}
        </Button>
        <span className="translation-hint">{formatCount(countCharacters(draft))} / 5,000</span>
      </div>
      {tooLong && <p role="alert">网页模式最多可带入 5,000 字符，请缩短原文。</p>}
      {error && <p role="alert" className="text-destructive">{error}</p>}
      <p className="translation-hint">
        {native ? '在应用内打开 Google 翻译网页。' : '在新标签页打开 Google 翻译。'}
        打开时会将输入的原文发送给 Google，无需 API Key。
      </p>
    </div>
  )
}

function TranslationApi({ source, setSource }: { source: string; setSource: (value: string) => void }) {
  const client = translationClient()
  const { snapshot, update } = useAppStore()
  const [savedPair, setPair] = usePersistentState('translation.languages', { from: 'auto', to: 'zh-CN' })
  const pair = { from: googleLanguageCode(savedPair.from), to: googleLanguageCode(savedPair.to) }
  const [usage, setUsage] = usePersistentState('translation.googleUsage', { month: '', count: 0 })
  const [languages, setLanguages] = useState(commonLanguages)
  const [result, setResult] = useState<{ source: string; from: string; to: string; text: string; detected?: string }>()
  const [configured, setConfigured] = useState<boolean>()
  const [key, setKey] = useState('')
  const [settings, setSettings] = useState(false)
  const [busy, setBusy] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [settingsError, setSettingsError] = useState('')
  const [feedback, setFeedback] = useState('')
  const requestInFlight = useRef(false)
  const settingsInFlight = useRef(false)
  const month = new Date().toLocaleDateString('sv-SE', { year: 'numeric', month: '2-digit' })
  const length = useMemo(() => countCharacters(source), [source])
  const languageEntries = useMemo(() => Object.entries(languages), [languages])
  const current = result?.source === source && result.from === pair.from && result.to === pair.to ? result : undefined
  const swapSource = pair.from === 'auto' ? current?.detected : pair.from

  useEffect(() => {
    let active = true
    void client.status().then((status) => {
      if (!active) return
      setConfigured(status.configured)
    }).catch((failure) => {
      if (!active) return
      setConfigured(false)
      setError(errorMessage(failure))
    })
    return () => { active = false }
  }, [client])

  useEffect(() => {
    setLanguages(commonLanguages)
    if (!configured || settings) return
    let active = true
    void client.languages().then(({ languages }) => {
      if (!active) return
      setLanguages({ ...commonLanguages, ...Object.fromEntries(languages
        .filter(({ language, name }) => language && name)
        .map(({ language, name }) => {
          const code = googleLanguageCode(language)
          return [code, commonLanguages[code] ?? name]
        })) })
    }).catch(() => undefined)
    return () => { active = false }
  }, [client, configured, settings])

  function openSettings() {
    setKey('')
    setSettingsError('')
    setSettings(true)
  }

  async function saveSettings(clear = false) {
    if (settingsInFlight.current) return
    settingsInFlight.current = true
    setSaving(true)
    setSettingsError('')
    try {
      if (clear) {
        await client.clear()
      } else {
        const credentials = normalizeTranslationCredentials({ key })
        await client.save(credentials)
      }
      setConfigured(!clear)
      setKey('')
      setSettings(false)
      setError('')
      setFeedback(clear ? '已清除 Google Cloud 配置。' : '已保存 Google Cloud 配置。')
    } catch (failure) {
      setSettingsError(errorMessage(failure))
    } finally {
      settingsInFlight.current = false
      setSaving(false)
    }
  }

  async function translate() {
    if (requestInFlight.current || !source.trim() || length > translationLimit || pair.from === pair.to) return
    if (configured === false) { openSettings(); return }
    if (!configured) return
    requestInFlight.current = true
    setBusy(true)
    setError('')
    setFeedback('')
    try {
      // Translate each line as a segment so blank lines and line endings survive.
      const pieces = source.split(/(\r\n|\n|\r)/)
      const texts = pieces.filter((piece) => piece.trim())
      const segments: TranslationSegment[] = []
      for (let offset = 0; offset < texts.length; offset += translationBatchSize) {
        const batch = texts.slice(offset, offset + translationBatchSize)
        const response = await client.translate({ texts: batch, from: pair.from === 'auto' ? undefined : pair.from, to: pair.to })
        segments.push(...response.segments)
        const used = batch.reduce((sum, text) => sum + countCharacters(text), 0)
        setUsage((previous) => ({ month, count: (previous.month === month ? previous.count : 0) + used }))
      }
      let index = 0
      const text = pieces.map((piece) => piece.trim() ? segments[index++].text : piece).join('')
      const detectedCode = segments.find((segment) => segment.detectedLanguage)?.detectedLanguage
      const detected = detectedCode && googleLanguageCode(detectedCode)
      setResult({ source, ...pair, text, detected })
    } catch (failure) {
      setError(errorMessage(failure))
    } finally {
      requestInFlight.current = false
      setBusy(false)
    }
  }

  function changeSource(text: string) {
    setSource(text)
    setResult(undefined)
    setFeedback('')
    setError('')
  }

  async function paste() {
    try {
      const text = client.readClipboard ? (await client.readClipboard()).text : await navigator.clipboard.readText()
      if (requestInFlight.current) return
      if (text) changeSource(text)
      else setError('系统剪贴板中没有文本。')
    } catch {
      setError('无法读取系统剪贴板，请直接在原文框内粘贴。')
    }
  }

  async function copy() {
    if (!current?.text) return
    try {
      if (client.writeClipboard) await client.writeClipboard({ text: current.text })
      else await navigator.clipboard.writeText(current.text)
      setFeedback('已复制译文。')
      setError('')
    } catch {
      setError('无法写入系统剪贴板，请选中译文手动复制。')
    }
  }

  function saveToSnippets() {
    if (!current?.text || !snapshot) return
    const now = nowIso()
    const title = `译文 · ${languages[pair.to] ?? pair.to}`
    const content = current.text
    const item = { id: newId(), title, content, copyCount: 0, createdAt: now, updatedAt: now }
    update((state) => state.clipboardSnippets.some((snippet) => snippet.content === content) ? state : {
      ...state, clipboardSnippets: [item, ...state.clipboardSnippets],
    })
    setFeedback('译文已存入工具箱剪贴板。')
    setError('')
  }

  function choose(from: string, to: string) {
    setPair({ from, to })
    setError('')
    setFeedback('')
  }

  const blocked = busy || configured === undefined || !source.trim() || length > translationLimit || pair.from === pair.to
  return (
    <div className="translation-tool">
      <div className="translation-toolbar">
        <div className="translation-actions" aria-label="常用语言对">
          {presets.map(({ from, to, label }) => (
            <Button key={label} variant="outline" aria-pressed={pair.from === from && pair.to === to}
              onClick={() => choose(from, to)} disabled={busy}>{label}</Button>
          ))}
        </div>
        <Button variant="outline" onClick={openSettings} disabled={busy || configured === undefined}><Settings2 /> API 设置</Button>
      </div>
      {configured === false && <p className="translation-hint">请先配置 你自己的 Google Cloud API Key。</p>}
      <div className="translation-language-row">
        <Select value={pair.from} onValueChange={(from) => choose(from, pair.to)} disabled={busy}>
          <SelectTrigger aria-label="原文语言"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="auto">自动检测</SelectItem>
            {pair.from !== 'auto' && !languages[pair.from] && <SelectItem value={pair.from}>{pair.from}</SelectItem>}
            {languageEntries.map(([code, name]) => <SelectItem key={code} value={code}>{name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Button variant="outline" size="icon" aria-label="互换语言" disabled={!swapSource || swapSource === pair.to || busy}
          onClick={() => {
            if (!swapSource) return
            choose(pair.to, swapSource)
            if (current) {
              setSource(current.text)
              setResult(undefined)
            }
          }}><ArrowLeftRight /></Button>
        <Select value={pair.to} onValueChange={(to) => choose(pair.from, to)} disabled={busy}>
          <SelectTrigger aria-label="译文语言"><SelectValue /></SelectTrigger>
          <SelectContent>
            {!languages[pair.to] && <SelectItem value={pair.to}>{pair.to}</SelectItem>}
            {languageEntries.map(([code, name]) => <SelectItem key={code} value={code}>{name}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <div className="translation-panes">
        <div className="translation-pane">
          <label htmlFor="translation-source">原文</label>
          <Textarea id="translation-source" placeholder="输入或粘贴要翻译的文本" value={source} readOnly={busy}
            onChange={(event) => changeSource(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && !event.nativeEvent.isComposing) {
                event.preventDefault()
                void translate()
              }
            }} />
          <div className="translation-toolbar">
            <div className="translation-actions">
              <Button variant="outline" onClick={() => void paste()} disabled={busy}><Clipboard /> 粘贴</Button>
              <Button variant="ghost" onClick={() => changeSource('')} disabled={!source || busy}>清空</Button>
            </div>
            <span className="translation-hint">{formatCount(length)} / {formatCount(translationLimit)}</span>
          </div>
        </div>
        <div className="translation-pane">
          <label htmlFor="translation-result">译文{current?.detected && ` · 检测到${languages[current.detected] ?? current.detected}`}</label>
          <Textarea id="translation-result" value={current?.text ?? ''} readOnly aria-busy={busy} />
          <div className="translation-actions">
            <Button variant="outline" disabled={!current?.text || busy} onClick={() => void copy()}><Copy /> 复制译文</Button>
            <Button variant="outline" disabled={!current?.text || busy || !snapshot} onClick={saveToSnippets}>存入剪贴板</Button>
          </div>
        </div>
      </div>
      <div className="translation-toolbar">
        <Button disabled={blocked} onClick={() => void translate()}>{busy ? '翻译中…' : '翻译'}</Button>
        <span className="translation-hint">本设备本月用量估算 {formatCount(usage.month === month ? usage.count : 0)} 字符</span>
      </div>
      {length > translationLimit && <p role="alert">原文超过 {formatCount(translationLimit)} 字符，请分次翻译。</p>}
      {pair.from === pair.to && <p role="status">请选择不同的原文和译文语言。</p>}
      {error && <p role="alert" className="text-destructive">{error}</p>}
      {feedback && <p role="status">{feedback}</p>}
      <p className="translation-hint">提交后，原文将发送至 Google Cloud Translation。桌面端可按 Ctrl+Enter 提交。</p>

      <Dialog open={settings} onOpenChange={(open) => {
        if (settingsInFlight.current) return
        if (!open) setKey('')
        setSettings(open)
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Google Cloud Translation 设置</DialogTitle>
            <DialogDescription>
              在自己的 Google Cloud 项目中启用结算和 Cloud Translation API，然后创建 API Key。翻译用量计入该密钥所属项目。
              {isAndroid || isElectron() ? '密钥加密保存在当前设备。' : '网页端密钥仅保存在当前页面内存，刷新后需重新输入。'}
            </DialogDescription>
          </DialogHeader>
          <form className="translation-settings" onSubmit={(event) => { event.preventDefault(); void saveSettings() }}>
            <label>Google Cloud API Key
              <Input type="password" value={key} onChange={(event) => setKey(event.target.value)}
                placeholder={configured ? '输入新密钥以替换' : '输入你自己的 API Key'} autoComplete="off" required disabled={saving} />
            </label>
            {settingsError && <p role="alert" className="text-destructive">{settingsError}</p>}
            <DialogFooter>
              <Button type="button" variant="outline" disabled={saving} onClick={() => void saveSettings(true)}>清除密钥</Button>
              <Button type="submit" disabled={saving || !key.trim()}>保存</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
