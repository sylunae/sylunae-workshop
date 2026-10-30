import { portableNoteSnapshot } from '../data/noteAssets'
import { useEffect, useRef, useState } from 'react'
import { BellRing, Check, CheckCircle2, ClipboardPaste, Code2, Copy, Database, Download, ExternalLink, EyeOff, FileWarning, FolderOpen, Globe2, HardDrive, Info, Laptop, Link2, Moon, PackageOpen, Palette, Play, RotateCcw, Settings, ShieldCheck, Sparkles, Sun, Undo2, Upload, UserRound, X } from 'lucide-react'
import { useAppStore } from '../app/AppStore'
import { applyPartialBackup, backupSummary, createBackup, createPartialBackup, parseBackup, parsePartialBackup, partialBackupSectionMeta, partialBackupSummary } from '../data/backup'
import type { BackupEnvelope, PartialBackupEnvelope, PartialBackupSection, ThemeMode, ThemePalette, ThemePalettes } from '../shared/types'
import { getThemeContrastIssues, normalizeThemePalettes, parseThemePalettes, serializeThemePalettes, themeColorFields, themeContrastMessage, themeCssVariables } from '../shared/theme'
import { nowIso } from '../utils'
import { playPomodoroAlarm, unlockPomodoroAlarm } from '../utils/pomodoroAlarm'
import { ConfirmDialog } from './ConfirmDialog'
import { Button } from './ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from './ui/dialog'
import { Drawer, DrawerClose, DrawerContent, DrawerDescription, DrawerTitle } from './ui/drawer'
import { Input } from './ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs'
import { Textarea } from './ui/textarea'
import { Switch } from './ui/switch'
import { usePersistentState } from '../lib/usePersistentState'
import type { MediaToolsStatus } from '../shared/types'
import { MediaToolsDialog } from './MediaToolsDialog'
import { ResourceSettings } from './ResourceSettings'

type SettingsSection = 'appearance' | 'focus' | 'resources' | 'connections' | 'data' | 'about'

const sections: Array<{ id: SettingsSection; label: string; description: string; icon: typeof Settings }> = [
  { id: 'appearance', label: '外观', description: '主题与显示', icon: Palette },
  { id: 'focus', label: '专注', description: '番茄钟与提醒', icon: BellRing },
  { id: 'resources', label: '资源管理', description: '下载与本地内容', icon: Sparkles },
  { id: 'connections', label: '关联服务', description: 'Bangumi 收藏', icon: Link2 },
  { id: 'data', label: '数据与备份', description: '导入、导出', icon: Database },
  { id: 'about', label: '关于', description: '环境与版本', icon: Info },
]

export function SettingsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const isMobile = useMediaQuery('(max-width: 760px)')

  if (isMobile) {
    return <Drawer open={open} onOpenChange={onOpenChange} direction="bottom">
      <DrawerContent className="settings-drawer">
        <DrawerTitle className="sr-only">设置</DrawerTitle>
        <DrawerDescription className="sr-only">调整丝月工坊的外观、关联服务、数据与运行环境</DrawerDescription>
        <DrawerClose asChild><Button variant="ghost" size="icon-sm" className="settings-overlay-close"><X /><span className="sr-only">关闭设置</span></Button></DrawerClose>
        <SettingsPanel />
      </DrawerContent>
    </Drawer>
  }

  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent size="xl" className="settings-modal" showCloseButton>
      <DialogTitle className="sr-only">设置</DialogTitle>
      <DialogDescription className="sr-only">调整丝月工坊的外观、关联服务、数据与运行环境</DialogDescription>
      <SettingsPanel />
    </DialogContent>
  </Dialog>
}

function SettingsPanel() {
  const { snapshot, update, replace, flush } = useAppStore()
  const [activeSection, setActiveSection] = usePersistentState<SettingsSection>('navigation.settingsSection', 'appearance')
  const [username, setUsername] = useState(snapshot?.settings.bangumiUsername || '')
  const [message, setMessage] = useState('')
  const [pendingImport, setPendingImport] = useState<BackupEnvelope | null>(null)
  const [pendingPartialImport, setPendingPartialImport] = useState<PartialBackupEnvelope | null>(null)
  const importInput = useRef<HTMLInputElement>(null)
  const partialImportInput = useRef<HTMLInputElement>(null)

  useEffect(() => setUsername(snapshot?.settings.bangumiUsername || ''), [snapshot?.settings.bangumiUsername])
  if (!snapshot) return null

  const currentSection = sections.find((section) => section.id === activeSection) || sections[0]
  const setTheme = (theme: ThemeMode) => update((state) => ({ ...state, settings: { ...state.settings, theme, updatedAt: nowIso() } }))
  const setPrivateMode = (privateMode: boolean) => update((state) => ({ ...state, settings: { ...state.settings, privateMode, updatedAt: nowIso() } }))
  const setThemePalettes = (themePalettes: ThemePalettes) => update((state) => ({ ...state, settings: { ...state.settings, themePalettes, updatedAt: nowIso() } }))
  const setPomodoroAlarmPath = (pomodoroAlarmPath: string) => update((state) => ({ ...state, settings: { ...state.settings, pomodoroAlarmPath, updatedAt: nowIso() } }))
  const saveUsername = () => {
    const clean = username.trim()
    if (clean === snapshot.settings.bangumiUsername) return
    update((state) => ({ ...state, bangumi: null, settings: { ...state.settings, bangumiUsername: clean, updatedAt: nowIso() } }))
    setMessage(clean ? '用户名已更新，返回收藏库后会实时读取。' : '已移除 Bangumi 用户名。')
  }
  const exportBackup = async () => {
    try {
      const current = await flush()
      if (!current) return
      const contents = JSON.stringify(createBackup(await portableNoteSnapshot(current)), null, 2)
      if (window.sylunae) {
        const saved = await window.sylunae.backup.exportFile(contents)
        if (saved) setMessage('备份已成功导出。')
      } else {
        const url = URL.createObjectURL(new Blob([contents], { type: 'application/json' }))
        const anchor = document.createElement('a')
        anchor.href = url
        anchor.download = `sylunae-backup-${new Date().toISOString().slice(0, 10)}.json`
        anchor.click()
        URL.revokeObjectURL(url)
        setMessage('备份已下载。')
      }
    } catch { setMessage('导出失败：请确认笔记图片可读取，并重试。') }
  }
  const downloadContents = async (contents: string, filename: string, successMessage: string) => {
    if (window.sylunae) {
      const saved = await window.sylunae.backup.exportFile(contents, filename)
      if (saved) setMessage(successMessage)
      return
    }
    const url = URL.createObjectURL(new Blob([contents], { type: 'application/json' }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = filename
    anchor.click()
    URL.revokeObjectURL(url)
    setMessage(successMessage)
  }
  const exportPartialBackup = async (section: PartialBackupSection) => {
    try {
      const current = await flush()
      if (!current) return
      const item = partialBackupSectionMeta.find((entry) => entry.id === section)!
      const contents = JSON.stringify(createPartialBackup(section === 'notes' ? await portableNoteSnapshot(current) : current, section), null, 2)
      await downloadContents(contents, `siyue-${section}-backup-${new Date().toISOString().slice(0, 10)}.json`, `“${item.label}”局部备份已导出。`)
    } catch { setMessage('导出失败：请确认笔记图片可读取，并重试。') }
  }
  const applyImport = async (contents: string) => {
    try {
      setPendingImport(parseBackup(contents))
    } catch {
      setMessage('无法导入：文件不是有效的丝月工坊备份。')
    }
  }
  const importBackup = async () => {
    if (window.sylunae) {
      const contents = await window.sylunae.backup.importFile()
      if (contents) await applyImport(contents)
    } else {
      importInput.current?.click()
    }
  }
  const applyPartialImport = async (contents: string) => {
    try {
      setPendingPartialImport(parsePartialBackup(contents))
    } catch {
      setMessage('无法导入：文件不是有效的局部备份。')
    }
  }
  const importPartialBackup = async () => {
    if (window.sylunae) {
      const contents = await window.sylunae.backup.importFile()
      if (contents) await applyPartialImport(contents)
    } else {
      partialImportInput.current?.click()
    }
  }

  return <div className="settings-layout">
    <aside className="settings-nav">
      <div className="settings-brand"><span><Settings size={18} /></span><div><strong>设置</strong><small>让工坊更贴合你的习惯</small></div></div>
      <nav aria-label="设置分类">
        {sections.map(({ id, label, description, icon: Icon }) => <button key={id} className={activeSection === id ? 'active' : ''} onClick={() => { setActiveSection(id); setMessage('') }} aria-current={activeSection === id ? 'page' : undefined}>
          <Icon size={17} /><span><strong>{label}</strong><small>{description}</small></span>
        </button>)}
      </nav>
      <div className="settings-nav-footer"><span>丝月工坊</span><small>MY QUIET SPACE</small></div>
    </aside>

    <main className="settings-content">
      <header className="settings-content-header"><span className="eyebrow">SETTINGS</span><h2>{currentSection.label}</h2><p>{currentSection.description}</p></header>
      {message && <div className="notice success settings-notice"><Check size={16} /><span>{message}</span><button onClick={() => setMessage('')}>知道了</button></div>}
      <div className="settings-section-body">
        {activeSection === 'appearance' && <AppearanceSettings theme={snapshot.settings.theme} palettes={snapshot.settings.themePalettes} privateMode={snapshot.settings.privateMode} onThemeChange={setTheme} onPalettesChange={setThemePalettes} onPrivateModeChange={setPrivateMode} />}
        {activeSection === 'focus' && <FocusSettings alarmPath={snapshot.settings.pomodoroAlarmPath} onAlarmPathChange={setPomodoroAlarmPath} />}
        {activeSection === 'resources' && <ResourceSettings />}
        {activeSection === 'connections' && <ConnectionSettings username={username} onUsernameChange={setUsername} onSave={saveUsername} />}
        {activeSection === 'data' && <DataSettings counts={{ notes: snapshot.notes.length, goals: snapshot.goals.length, tracks: snapshot.tracks.length }} onExport={() => void exportBackup()} onImport={() => void importBackup()} inputRef={importInput} onFile={(file) => void file.text().then(applyImport)} onExportPartial={(section) => void exportPartialBackup(section)} onImportPartial={() => void importPartialBackup()} partialInputRef={partialImportInput} onPartialFile={(file) => void file.text().then(applyPartialImport)} />}
        {activeSection === 'about' && <AboutSettings />}
      </div>
    </main>

    <ConfirmDialog open={Boolean(pendingImport)} onOpenChange={(nextOpen) => { if (!nextOpen) setPendingImport(null) }} title="覆盖当前本地数据？" description={<>{pendingImport && <span className="backup-preview">{backupSummary(pendingImport)}</span>}<span>当前数据将被备份内容替换，建议先导出现有备份。</span></>} confirmLabel="覆盖并导入" destructive icon={<FileWarning />} onConfirm={async () => { if (!pendingImport) return; await replace(pendingImport.snapshot); setPendingImport(null); setMessage('备份已导入。') }} />
    <ConfirmDialog open={Boolean(pendingPartialImport)} onOpenChange={(nextOpen) => { if (!nextOpen) setPendingPartialImport(null) }} title={`导入“${pendingPartialImport ? partialBackupSummary(pendingPartialImport) : ''}”局部备份？`} description={<><span className="backup-preview">{pendingPartialImport && partialBackupSummary(pendingPartialImport)}</span><span>仅替换这个页面的数据，其他页面内容会保留。</span></>} confirmLabel="覆盖并导入" destructive icon={<FileWarning />} onConfirm={async () => { if (!pendingPartialImport) return; await replace(applyPartialBackup(snapshot, pendingPartialImport)); setPendingPartialImport(null); setMessage(`“${partialBackupSummary(pendingPartialImport)}”局部备份已导入。`) }} />
  </div>
}

function AppearanceSettings({ theme, palettes, privateMode, onThemeChange, onPalettesChange, onPrivateModeChange }: { theme: ThemeMode; palettes: ThemePalettes; privateMode: boolean; onThemeChange: (theme: ThemeMode) => void; onPalettesChange: (palettes: ThemePalettes) => void; onPrivateModeChange: (enabled: boolean) => void }) {
  const [editingMode, setEditingMode] = usePersistentState<keyof ThemePalettes>('navigation.themePaletteMode', theme === 'dark' ? 'dark' : 'light')
  const [cssCode, setCssCode] = useState(() => serializeThemePalettes(palettes))
  const [paletteMessage, setPaletteMessage] = useState('')
  const [previousPalettes, setPreviousPalettes] = useState<ThemePalettes | null>(null)
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false)
  const cssInput = useRef<HTMLTextAreaElement>(null)

  useEffect(() => setCssCode(serializeThemePalettes(palettes)), [palettes])

  const commitPalettes = (next: ThemePalettes, message = '') => {
    setPreviousPalettes(palettes)
    onPalettesChange(next)
    setCssCode(serializeThemePalettes(next))
    setPaletteMessage(message)
  }

  const updateColor = (key: keyof ThemePalette, value: string) => {
    const next = { ...palettes, [editingMode]: { ...palettes[editingMode], [key]: value.toLowerCase() } }
    const issues = getThemeContrastIssues(next)
    if (issues.length) {
      setPaletteMessage(`未应用：${themeContrastMessage(issues)}`)
      return
    }
    commitPalettes(next)
  }
  const copyCss = async () => {
    const code = serializeThemePalettes(palettes)
    setCssCode(code)
    try {
      await navigator.clipboard.writeText(code)
    } catch {
      cssInput.current?.select()
      document.execCommand('copy')
    }
    setPaletteMessage('CSS 已复制，可以直接交给 AI 调色。')
  }
  const applyCss = () => {
    try {
      const parsed = parseThemePalettes(cssCode, palettes)
      const issues = getThemeContrastIssues(parsed)
      if (issues.length) {
        setPaletteMessage(`未应用：${themeContrastMessage(issues)}`)
        return
      }
      commitPalettes(parsed, 'CSS 色板已应用。')
    } catch (error) {
      setPaletteMessage(error instanceof Error ? error.message : 'CSS 色板无法识别。')
    }
  }

  return <div className="appearance-settings">
    <section className="settings-pane theme-mode-pane">
      <SettingHeading icon={<Palette />} title="界面主题" description="选择最适合此刻光线的显示方式。" />
      <div className="theme-options"><ThemeOption value="system" active={theme === 'system'} icon={<Laptop />} title="跟随系统" onClick={onThemeChange} /><ThemeOption value="light" active={theme === 'light'} icon={<Sun />} title="浅色" onClick={onThemeChange} /><ThemeOption value="dark" active={theme === 'dark'} icon={<Moon />} title="深色" onClick={onThemeChange} /></div>
    </section>

    <section className="settings-pane privacy-mode-pane">
      <SettingHeading icon={<EyeOff />} title="私密模式" description="隐藏你在工坊中写下的内容，页面原有文案与操作界面保持清晰。" />
      <label className="privacy-mode-control">
        <span><strong>全局遮罩</strong><small>笔记、目标、待办及其他自行输入的文字都会被遮住；关闭后立即恢复显示。</small></span>
        <Switch checked={privateMode} onCheckedChange={onPrivateModeChange} aria-label="切换私密模式" />
      </label>
    </section>

    <section className="settings-pane palette-pane">
      <SettingHeading icon={<Code2 />} title="全局配色" description="逐项调色，或让 AI 定制你的风格配色。" />
      <Tabs value={editingMode} onValueChange={(value) => setEditingMode(value as keyof ThemePalettes)}>
        <TabsList className="palette-tabs"><TabsTrigger value="light"><Sun />浅色配色</TabsTrigger><TabsTrigger value="dark"><Moon />深色配色</TabsTrigger></TabsList>
        {(['light', 'dark'] as const).map((mode) => <TabsContent value={mode} key={mode} className="palette-grid">
          {themeColorFields.map(({ key, label }) => <label className="color-field" key={key}>
            <input type="color" value={palettes[mode][key]} onChange={(event) => updateColor(key, event.target.value)} aria-label={`${label}颜色`} />
            <span><strong>{label}</strong><code>{themeCssVariables[key]}</code></span>
            <output>{palettes[mode][key]}</output>
          </label>)}
        </TabsContent>)}
      </Tabs>

      <div className="palette-safety"><ShieldCheck size={15} /><span>安全检查已开启：按钮文字自动适配；低对比度配色不会保存。</span></div>
      <div className="palette-code-heading"><div><strong>AI 调色代码</strong><small>仅支持上方列出的变量与六位十六进制色码。</small></div><div className="palette-code-controls"><Button variant="outline" className="button secondary" disabled={!previousPalettes} onClick={() => { if (!previousPalettes) return; onPalettesChange(previousPalettes); setCssCode(serializeThemePalettes(previousPalettes)); setPreviousPalettes(null); setPaletteMessage('已撤销本次配色修改。') }}><Undo2 size={15} /></Button><Button variant="outline" className="button secondary" onClick={() => setResetConfirmOpen(true)}><RotateCcw size={15} />恢复默认</Button><Button variant="outline" className="button secondary" onClick={() => void copyCss()}><Copy size={15} />复制 CSS</Button></div></div>
      <Textarea ref={cssInput} className="palette-code" value={cssCode} onChange={(event) => { setCssCode(event.target.value); setPaletteMessage('') }} spellCheck={false} aria-label="全局配色 CSS" />
      <div className="palette-code-actions"><span role="status">{paletteMessage}</span><Button className="button primary" onClick={applyCss}><ClipboardPaste size={15} />应用粘贴的 CSS</Button></div>
      <ConfirmDialog open={resetConfirmOpen} onOpenChange={setResetConfirmOpen} title="恢复默认配色？" description="这会同时还原浅色和深色配色方案，当前自定义颜色将被替换。" confirmLabel="恢复默认" icon={<RotateCcw />} onConfirm={() => { commitPalettes(normalizeThemePalettes(), '已恢复默认配色。'); setResetConfirmOpen(false) }} />
    </section>
  </div>
}

function ConnectionSettings({ username, onUsernameChange, onSave }: { username: string; onUsernameChange: (value: string) => void; onSave: () => void }) {
  return <section className="settings-pane"><SettingHeading icon={<UserRound />} title="Bangumi 收藏" description="匿名读取一个用户的公开收藏。" /><label className="setting-field">用户名<div className="inline-field"><Input value={username} onChange={(event) => onUsernameChange(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') onSave() }} onBlur={onSave} placeholder="例如：sai" /><Button variant="outline" className="button secondary" onClick={onSave}>保存</Button></div><small>无需登录。封面会缓存到本地；在收藏库中点击“刷新”即可重新读取数据并更新封面。</small></label><Button variant="link" className="text-link" onClick={() => window.sylunae?.system.openExternal('https://bgm.tv') ?? window.open('https://bgm.tv', '_blank', 'noopener,noreferrer')}>打开 Bangumi <ExternalLink size={14} /></Button></section>
}

function FocusSettings({ alarmPath, onAlarmPathChange }: { alarmPath: string; onAlarmPathChange: (path: string) => void }) {
  const [choosing, setChoosing] = useState(false)
  const desktop = Boolean(window.sylunae)
  const fileName = alarmPath.split(/[\\/]/).pop() || ''
  const chooseAlarm = async () => {
    if (!window.sylunae) return
    setChoosing(true)
    try {
      const path = await window.sylunae.system.pickPomodoroAlarm()
      if (path) onAlarmPathChange(path)
    } finally { setChoosing(false) }
  }
  const previewAlarm = () => {
    unlockPomodoroAlarm()
    playPomodoroAlarm(alarmPath)
  }
  return <section className="settings-pane focus-settings"><SettingHeading icon={<BellRing />} title="番茄钟提示音" description="专注或休息结束时播放；未设置时使用默认的柔和钟铃。" /><div className="alarm-source"><div className="alarm-source-icon"><BellRing size={18} /></div><div><strong className={fileName ? 'user-content' : undefined}>{fileName || '默认钟铃'}</strong><small>{fileName ? '已选择自定义本地音频' : desktop ? '三声渐进的柔和提示音' : '自定义音频仅在桌面端可用'}</small></div></div><div className="alarm-actions"><Button variant="outline" className="button secondary" onClick={() => void chooseAlarm()} disabled={!desktop || choosing}><FolderOpen size={16} />{choosing ? '正在选择…' : '选择音频'}</Button><Button variant="outline" className="button secondary" onClick={previewAlarm} disabled={!desktop}><Play size={16} fill="currentColor" />试听</Button>{fileName && <Button variant="ghost" className="button alarm-reset" onClick={() => onAlarmPathChange('')}><RotateCcw size={16} />恢复默认</Button>}</div><small className="settings-note">支持 MP3、M4A、WAV、OGG、FLAC 等本地音频。若文件被移动或无法读取，将自动使用默认钟铃。</small></section>
}

function DataSettings({ counts, onExport, onImport, inputRef, onFile, onExportPartial, onImportPartial, partialInputRef, onPartialFile }: { counts: { notes: number; goals: number; tracks: number }; onExport: () => void; onImport: () => void; inputRef: React.RefObject<HTMLInputElement | null>; onFile: (file: File) => void; onExportPartial: (section: PartialBackupSection) => void; onImportPartial: () => void; partialInputRef: React.RefObject<HTMLInputElement | null>; onPartialFile: (file: File) => void }) {
  return <section className="settings-pane"><SettingHeading icon={<Database />} title="本地数据" description="为重要内容留一份可以带走的副本。" /><div className="data-summary"><div><NotebookCount value={counts.notes} label="笔记" /></div><div><NotebookCount value={counts.goals} label="目标" /></div><div><NotebookCount value={counts.tracks} label="音乐索引" /></div></div><div className="settings-actions"><Button variant="outline" className="button secondary" onClick={onExport}><Download size={16} />导出完整备份</Button><Button variant="outline" className="button secondary" onClick={onImport}><Upload size={16} />导入完整备份</Button><input ref={inputRef} hidden type="file" accept="application/json,.json" onChange={(event) => { const file = event.target.files?.[0]; if (file) onFile(file); event.currentTarget.value = '' }} /></div><small className="settings-note">完整备份包含所有页面数据，不包含音乐原文件与实时 Bangumi 数据。</small><div className="partial-backup-heading"><div><strong>局部备份</strong><small>按页面导出；导入时只替换对应页面。</small></div><Button variant="outline" className="button secondary" onClick={onImportPartial}><Upload size={15} />导入局部备份</Button></div><div className="partial-backup-grid">{partialBackupSectionMeta.map((section) => <div className="partial-backup-item" key={section.id}><div><strong>{section.label}</strong><small>{section.description}</small></div><Button variant="ghost" size="sm" className="partial-backup-export" onClick={() => onExportPartial(section.id)}><Download size={14} />导出</Button></div>)}</div><input ref={partialInputRef} hidden type="file" accept="application/json,.json" onChange={(event) => { const file = event.target.files?.[0]; if (file) onPartialFile(file); event.currentTarget.value = '' }} /></section>
}

function AboutSettings() {
  const desktop = Boolean(window.sylunae)
  const [toolsStatus, setToolsStatus] = useState<MediaToolsStatus | null>(null)
  const [toolsDialogOpen, setToolsDialogOpen] = useState(false)
  const refreshTools = () => { if (desktop) void window.sylunae!.music.getMediaToolsStatus().then(setToolsStatus) }
  useEffect(refreshTools, [desktop])
  return <div className="about-settings">
    <section className="settings-pane"><SettingHeading icon={desktop ? <HardDrive /> : <Globe2 />} title="运行环境" description={desktop ? 'Electron 桌面版' : '浏览器轻量版'} /><dl className="environment-list"><div><dt>数据位置</dt><dd>{desktop ? '本机 SQLite 数据库' : '浏览器 IndexedDB'}</dd></div><div><dt>本地音乐</dt><dd>{desktop ? '可用' : '仅桌面版可用'}</dd></div><div><dt>云端同步</dt><dd>未启用</dd></div><div><dt>应用版本</dt><dd>0.1.0</dd></div></dl></section>
    {desktop && <section className="settings-pane media-tools-pane">
      <SettingHeading icon={<PackageOpen />} title="媒体工具" description="按需启用 YouTube 音频导入能力。" />
      <div className="media-tools-card"><span className={toolsStatus?.ready ? 'ready' : ''}>{toolsStatus?.ready ? <CheckCircle2 /> : <Download />}</span><div><strong>{toolsStatus?.ready ? '媒体工具已安装' : '媒体工具尚未安装'}</strong><small>{toolsStatus?.ready ? 'FFmpeg 与 yt-dlp 已准备完成' : '使用时再下载，约占用 96 MB 本地空间'}</small></div></div>
      <Button variant="outline" className="button secondary" onClick={() => setToolsDialogOpen(true)} disabled={!toolsStatus || toolsStatus.ready}>{toolsStatus?.ready ? <CheckCircle2 /> : <Download />}{toolsStatus?.ready ? '已准备完成' : '预先下载媒体工具'}</Button>
      <MediaToolsDialog open={toolsDialogOpen} onOpenChange={setToolsDialogOpen} onReady={refreshTools} />
    </section>}
  </div>
}

function SettingHeading({ icon, title, description }: { icon: React.ReactNode; title: string; description: string }) {
  return <div className="settings-title"><span>{icon}</span><div><h3>{title}</h3><p>{description}</p></div></div>
}

function ThemeOption({ value, active, icon, title, onClick }: { value: ThemeMode; active: boolean; icon: React.ReactNode; title: string; onClick: (theme: ThemeMode) => void }) {
  return <button className={active ? 'active' : ''} onClick={() => onClick(value)}><span>{icon}</span><strong>{title}</strong>{active && <i><Check size={12} /></i>}</button>
}

function NotebookCount({ value, label }: { value: number; label: string }) {
  return <><strong>{value}</strong><span>{label}</span></>
}

function useMediaQuery(query: string) {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches)
  useEffect(() => {
    const media = window.matchMedia(query)
    const updateMatch = () => setMatches(media.matches)
    updateMatch()
    media.addEventListener('change', updateMatch)
    return () => media.removeEventListener('change', updateMatch)
  }, [query])
  return matches
}
