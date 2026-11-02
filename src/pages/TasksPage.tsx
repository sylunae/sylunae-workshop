import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import confetti, { type Options as ConfettiOptions } from 'canvas-confetti'
import { CalendarClock, CalendarDays, CakeSlice, Check, ChevronDown, Circle, Clock3, Flag, FolderOpen, Heart, History, Image as ImageIcon, ListTodo, Pause, Pencil, Pin, Plane, Play, Plus, Repeat2, RotateCcw, Settings2, SlidersHorizontal, Sparkles, Star, Target, TimerReset, Trash2, TrendingUp } from 'lucide-react'
import { useAppStore } from '../app/AppStore'
import type { CountdownAccent, CountdownCategory, CountdownEvent, CountdownMode, CountdownRepeat, PomodoroMode, QuickTodo, RecurringTodo, RecurringTodoFrequency, TodoPriority } from '../shared/types'
import { newId, nowIso } from '../utils'
import { countdownResult, preciseCountdownParts, type CountdownResult } from '../countdowns/countdown'
import { localDateKey, occursOnDate, recurringLabel } from '../todos/recurring'
import { compareQuickTodos, compareTodoPriority, nextTodoPriority, todoPriorityLabel } from '../todos/priority'
import { GoalsPage } from './GoalsPage'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { DatePicker } from '../components/DatePicker'
import { Button } from '../components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../components/ui/collapsible'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../components/ui/dialog'
import { Input } from '../components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../components/ui/tooltip'
import { Switch } from '../components/ui/switch'
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '../components/ui/sheet'
import { Tabs, TabsList, TabsTrigger } from '../components/ui/tabs'
import { Textarea } from '../components/ui/textarea'
import { unlockPomodoroAlarm } from '../utils/pomodoroAlarm'
import { usePersistentState } from '../lib/usePersistentState'

export type TaskView = 'goals' | 'todos' | 'pomodoro' | 'countdown'

const viewMeta: Record<TaskView, { label: string; icon: typeof Target }> = {
  goals: { label: '目标追踪', icon: Target },
  todos: { label: '快速待办', icon: ListTodo },
  pomodoro: { label: '番茄钟', icon: Clock3 },
  countdown: { label: '倒数日', icon: CalendarClock },
}

const todoConfetti = confetti.create(undefined, { resize: true, useWorker: false })

export function TasksPage({ initialView = 'goals', startPomodoro = false, view, onViewChange }: { initialView?: TaskView; startPomodoro?: boolean; view?: TaskView; onViewChange?: (view: TaskView) => void }) {
  const [storedView, setStoredView] = usePersistentState<TaskView>('navigation.tasksView', initialView)
  const activeView = view ?? storedView
  const setView = onViewChange ?? setStoredView
  const pageRef = useRef<HTMLElement>(null)
  useEffect(() => { if (initialView !== 'goals') setView(initialView) }, [initialView, setView])
  useEffect(() => { pageRef.current?.scrollTo({ top: 0 }) }, [activeView])
  return <section ref={pageRef} className="page tasks-page">
    <header className="page-header"><div><span className="eyebrow">TASK SPACE</span><h1>任务箱</h1><p>让计划、专注与日常小事在同一个地方有序发生</p></div></header>
    <Tabs value={activeView} onValueChange={(value) => setView(value as TaskView)} className="workspace-tabs">
      <TabsList className="workspace-tab-list">{Object.entries(viewMeta).map(([id, item]) => { const Icon = item.icon; return <TabsTrigger key={id} value={id}><Icon size={16} />{item.label}</TabsTrigger> })}</TabsList>
    </Tabs>
    {activeView === 'goals' && <GoalsPage embedded />}
    {activeView === 'todos' && <TodoPanel />}
    {activeView === 'pomodoro' && <PomodoroPanel autoStart={startPomodoro} />}
    {activeView === 'countdown' && <CountdownPanel />}
  </section>
}

function TodoPanel() {
  const { snapshot, update } = useAppStore()
  const todos = snapshot?.todos ?? []
  const routines = snapshot?.recurringTodos ?? []
  const completionRecords = snapshot?.todoCompletionRecords ?? []
  const [draft, setDraft] = useState('')
  const [routineDialogOpen, setRoutineDialogOpen] = useState(false)
  const [editingRoutine, setEditingRoutine] = useState<RecurringTodo | null>(null)
  const [showAllRoutines, setShowAllRoutines] = useState(false)
  const [routineSaveNotice, setRoutineSaveNotice] = useState('')
  // Keep the pre-edit priority for sorting until this panel is left and remounted.
  const [sortingPriorities, setSortingPriorities] = useState<Map<string, TodoPriority>>(() => new Map())
  const preserveSortPriority = (key: string, priority: TodoPriority) => setSortingPriorities((current) => current.has(key) ? current : new Map(current).set(key, priority))
  const today = useTodayKey()
  const inputRef = useRef<HTMLInputElement>(null)
  const visible = useMemo(() => [...todos].sort((a, b) => compareQuickTodos(
    { ...a, priority: sortingPriorities.get(`todo:${a.id}`) ?? a.priority },
    { ...b, priority: sortingPriorities.get(`todo:${b.id}`) ?? b.priority },
  )), [todos, sortingPriorities])
  const todayRoutines = useMemo(() => routines.filter((routine) => occursOnDate(routine, today)), [routines, today])
  const displayedRoutines = useMemo(() => [...(showAllRoutines ? routines : todayRoutines)].sort((a, b) => {
    const completed = (id: string) => completionRecords.some((record) => record.recurringTodoId === id && record.occurrenceDate === today)
    return Number(completed(a.id)) - Number(completed(b.id)) || compareTodoPriority(
      { priority: sortingPriorities.get(`routine:${a.id}`) ?? a.priority },
      { priority: sortingPriorities.get(`routine:${b.id}`) ?? b.priority },
    )
  }), [showAllRoutines, routines, todayRoutines, completionRecords, today, sortingPriorities])
  useEffect(() => {
    const timer = window.setTimeout(() => inputRef.current?.focus(), 50)
    return () => window.clearTimeout(timer)
  }, [])
  const add = () => {
    const title = draft.trim()
    if (!title) return
    const now = nowIso()
    const todo: QuickTodo = { id: newId(), title, priority: 'medium', dueDate: '', completed: false, completedAt: null, createdAt: now, updatedAt: now }
    update((state) => ({ ...state, todos: [todo, ...state.todos] }))
    setDraft('')
  }
  const patch = (id: string, value: Partial<QuickTodo>) => update((state) => ({ ...state, todos: state.todos.map((todo) => todo.id === id ? { ...todo, ...value, updatedAt: nowIso() } : todo) }))
  const remove = (id: string) => update((state) => ({ ...state, todos: state.todos.filter((todo) => todo.id !== id) }))
  const toggle = (todo: QuickTodo, target: HTMLButtonElement) => {
    if (todo.completed) { patch(todo.id, { completed: false, completedAt: null }); return }
    const rect = target.getBoundingClientRect()
    patch(todo.id, { completed: true, inProgress: false, completedAt: nowIso() })
    launchTodoConfetti(rect)
  }
  const routineCompletion = (routineId: string) => completionRecords.find((record) => record.recurringTodoId === routineId && record.occurrenceDate === today)
  const toggleRoutine = (routine: RecurringTodo, target: HTMLButtonElement) => {
    if (!occursOnDate(routine, today)) return
    const completion = routineCompletion(routine.id)
    if (completion) { update((state) => ({ ...state, todoCompletionRecords: state.todoCompletionRecords.filter((record) => record.id !== completion.id) })); return }
    const rect = target.getBoundingClientRect()
    update((state) => ({ ...state, todoCompletionRecords: [...state.todoCompletionRecords, { id: newId(), recurringTodoId: routine.id, occurrenceDate: today, completedAt: nowIso() }] }))
    launchTodoConfetti(rect)
  }
  const saveRoutine = (draftRoutine: Omit<RecurringTodo, 'id' | 'createdAt' | 'updatedAt'>) => {
    const now = nowIso()
    if (editingRoutine) update((state) => ({ ...state, recurringTodos: state.recurringTodos.map((routine) => routine.id === editingRoutine.id ? { ...routine, ...draftRoutine, updatedAt: now } : routine) }))
    else update((state) => ({ ...state, recurringTodos: [...state.recurringTodos, { ...draftRoutine, id: newId(), createdAt: now, updatedAt: now }] }))
    setRoutineSaveNotice(editingRoutine ? '例行待办已保存。' : '例行待办已添加；可在“全部例行”中随时查看。')
    setEditingRoutine(null)
    setRoutineDialogOpen(false)
  }
  const deleteRoutine = (routine: RecurringTodo) => update((state) => ({ ...state, recurringTodos: state.recurringTodos.filter((item) => item.id !== routine.id), todoCompletionRecords: state.todoCompletionRecords.filter((record) => record.recurringTodoId !== routine.id) }))
  const now = Date.now()
  const startOfToday = new Date(); startOfToday.setHours(0, 0, 0, 0)
  const sevenDaysAgo = now - 7 * 86400000
  const openTodos = todos.filter((todo) => !todo.completed)
  const completedOneOffToday = todos.filter((todo) => todo.completed && new Date(todo.completedAt ?? todo.updatedAt).getTime() >= startOfToday.getTime())
  const completedRoutineToday = completionRecords.filter((record) => record.occurrenceDate === today)
  const completedToday = completedOneOffToday.length + completedRoutineToday.length
  const completedRecently = todos.filter((todo) => todo.completed && new Date(todo.completedAt ?? todo.updatedAt).getTime() >= sevenDaysAgo)
  const completedRoutineRecently = completionRecords.filter((record) => new Date(record.completedAt).getTime() >= sevenDaysAgo)
  const timedCompleted = completedRecently.filter((todo) => todo.completedAt)
  const averageHours = timedCompleted.length ? timedCompleted.reduce((sum, todo) => sum + Math.max(0, new Date(todo.completedAt!).getTime() - new Date(todo.createdAt).getTime()), 0) / timedCompleted.length / 3600000 : 0
  const oldest = [...openTodos].sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0]
  const oldestDays = oldest ? Math.max(0, Math.floor((now - new Date(oldest.createdAt).getTime()) / 86400000)) : 0
  const insight = !openTodos.length ? '待办清单清理完毕，好棒好棒！' : oldestDays >= 7 ? `“${oldest.title}”已经停留 ${oldestDays} 天，也许可以把它拆小或删掉。` : openTodos.length > 8 ? '清单有点拥挤，先选一件两分钟内能完成的小事吧。' : '清单保持轻盈，完成一件就会为下一件腾出空间。'
  return <div className="task-panel todo-panel">
    <div className="panel-heading"><div><h2>今日清单</h2><p>{todayRoutines.length ? `${todayRoutines.length} 件例行事项，完成后明天会自动焕新` : '添加例行事项，让每天从轻松的一步开始'}</p></div><span className="todo-completion-count"><Check size={14} />今天完成 {completedToday}</span></div>
    <div className="todo-routine-toolbar"><span>{showAllRoutines ? `全部例行 · ${routines.length}` : '例行待办'}</span><div className="todo-routine-actions"><Button type="button" variant="ghost" size="sm" onClick={() => setShowAllRoutines((current) => !current)}><CalendarDays size={14} />{showAllRoutines ? '今日清单' : '全部例行'}</Button><Button type="button" variant="outline" size="sm" onClick={() => { setEditingRoutine(null); setRoutineDialogOpen(true) }}><Repeat2 size={14} />添加例行</Button></div></div>
    {routineSaveNotice && <p className="routine-save-notice" role="status">{routineSaveNotice}</p>}
    <div className="todo-list routine-list">{displayedRoutines.length ? displayedRoutines.map((routine) => {
      const completion = routineCompletion(routine.id)
      const dueToday = occursOnDate(routine, today)
      return <div className={`todo-row priority-${routine.priority} ${completion ? 'completed' : ''}`} key={routine.id}><button className={`todo-check ${dueToday ? '' : 'routine-not-due'}`} onClick={(event) => toggleRoutine(routine, event.currentTarget)} disabled={!dueToday} aria-label={dueToday ? (completion ? '恢复例行待办' : '完成例行待办') : '今天不需要完成'}>{completion ? <Check size={16} /> : <Circle size={18} />}</button><div className="todo-copy"><strong className="todo-title user-content">{routine.title}</strong><div className="todo-meta-line"><span className="todo-routine-tag"><Repeat2 size={11} />{recurringLabel(routine)}</span>{!dueToday && <span className="todo-time-line">今天不需要完成</span>}{completion && <span className="todo-time-line"><Clock3 size={11} />完成于 {formatTodoTimestamp(completion.completedAt)}</span>}</div></div><TodoPriorityButton priority={routine.priority} title={routine.title} onChange={(priority) => { preserveSortPriority(`routine:${routine.id}`, routine.priority); update((state) => ({ ...state, recurringTodos: state.recurringTodos.map((item) => item.id === routine.id ? { ...item, priority, updatedAt: nowIso() } : item) })) }} /><button className="icon-button todo-routine-edit" onClick={() => { setEditingRoutine(routine); setRoutineDialogOpen(true) }} aria-label="编辑例行待办"><Pencil size={15} /></button></div>
    }) : <div className="routine-empty"><Repeat2 size={18} /><span>{showAllRoutines ? '还没有例行待办，添加一件规律的小事吧。' : '今天没有例行待办；可切换到全部例行查看后续安排。'}</span></div>}</div>
    <div className="todo-section-heading"><span>临时待办</span><small>完成 24 小时后自动删除</small></div>
    <div className="todo-quick-composer"><Plus size={19} /><Input ref={inputRef} value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) add() }} placeholder="现在要做什么？按 Enter 添加" aria-label="快速添加待办" /><kbd>Enter</kbd></div>
    <div className="todo-list quick-list">{visible.length ? visible.map((todo) => <div className={`todo-row priority-${todo.priority} ${todo.completed ? 'completed' : ''}`} key={todo.id}>
      <button className="todo-check" onClick={(event) => toggle(todo, event.currentTarget)} aria-label={todo.completed ? '恢复待办' : '完成待办'}>{todo.completed ? <Check size={16} /> : <Circle size={18} />}</button>
      <div className="todo-copy"><TodoTitleInput todo={todo} onSave={(title) => patch(todo.id, { title })} /><div className="todo-meta-line"><span className="todo-time-line"><Clock3 size={11} />{todo.completed && todo.completedAt ? `完成于 ${formatTodoTimestamp(todo.completedAt)} · 用时 ${formatTodoDuration(Math.max(0, (new Date(todo.completedAt).getTime() - new Date(todo.createdAt).getTime()) / 3600000))}` : `创建于 ${formatTodoTimestamp(todo.createdAt)} · 已存留 ${formatTodoDuration(Math.max(0, (Date.now() - new Date(todo.createdAt).getTime()) / 3600000))}`}</span></div></div>
      {!todo.completed && <TodoProgressButton todo={todo} onToggle={() => patch(todo.id, { inProgress: !todo.inProgress })} />}
      <TodoPriorityButton priority={todo.priority} title={todo.title} onChange={(priority) => { preserveSortPriority(`todo:${todo.id}`, todo.priority); patch(todo.id, { priority }) }} />
      <button className="icon-button danger todo-remove" onClick={() => remove(todo.id)} aria-label="删除待办"><Trash2 size={16} /></button>
    </div>) : <div className="compact-empty"><ListTodo size={28} /><strong>这里很清爽</strong><span>输入一件小事，按下 Enter 就记好了。</span></div>}</div>
    <section className="todo-review" aria-label="待办复盘"><div className="todo-review-heading"><div><Sparkles size={17} /><div><strong>清单复盘</strong><small>了解自己的节奏</small></div></div></div><div className="todo-review-grid"><TodoInsight icon={<Check />} value={String(completedToday)} label="今天完成" /><TodoInsight icon={<TrendingUp />} value={String(completedRecently.length + completedRoutineRecently.length)} label="近 7 天完成" /><TodoInsight icon={<History />} value={timedCompleted.length ? formatTodoDuration(averageHours) : '—'} label="平均完成用时" /><TodoInsight icon={<Clock3 />} value={oldest ? (oldestDays ? `${oldestDays} 天` : '今天') : '—'} label="最长等待" /></div><p>{insight}</p></section>
    <RoutineDialog open={routineDialogOpen} routine={editingRoutine} onOpenChange={(open) => { setRoutineDialogOpen(open); if (!open) setEditingRoutine(null) }} onSave={saveRoutine} onDelete={editingRoutine ? () => { deleteRoutine(editingRoutine); setRoutineDialogOpen(false); setEditingRoutine(null) } : undefined} />
  </div>
}

function TodoProgressButton({ todo, onToggle }: { todo: QuickTodo; onToggle: () => void }) {
  const label = todo.inProgress ? '正在进行中，点击关闭' : '标记为正在进行中'
  return <TooltipProvider><Tooltip><TooltipTrigger asChild><Button type="button" variant="ghost" size="icon" className="todo-progress" aria-label={`${todo.title}：${label}`} aria-pressed={Boolean(todo.inProgress)} onClick={onToggle}><Play size={15} fill={todo.inProgress ? 'currentColor' : 'none'} /></Button></TooltipTrigger><TooltipContent>{label}</TooltipContent></Tooltip></TooltipProvider>
}

function TodoPriorityButton({ priority, title, onChange }: { priority: TodoPriority; title: string; onChange: (priority: TodoPriority) => void }) {
  const next = nextTodoPriority(priority)
  return <Button type="button" variant="ghost" className={`todo-priority priority-${priority}`} onClick={() => onChange(next)} aria-label={`${title}：${todoPriorityLabel[priority]}优先级，点击切换为${todoPriorityLabel[next]}优先级`}><Flag size={14} fill={priority === 'high' ? 'currentColor' : 'none'} /><span>{todoPriorityLabel[priority]}</span></Button>
}

function useTodayKey(): string {
  const [today, setToday] = useState(() => localDateKey())
  useEffect(() => {
    const scheduleNextDay = () => {
      const now = new Date()
      const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 1)
      return window.setTimeout(() => { setToday(localDateKey()); timer = scheduleNextDay() }, next.getTime() - now.getTime())
    }
    let timer = scheduleNextDay()
    return () => window.clearTimeout(timer)
  }, [])
  return today
}

function TodoTitleInput({ todo, onSave }: { todo: QuickTodo; onSave: (title: string) => void }) {
  const [draft, setDraft] = useState(todo.title)
  useEffect(() => setDraft(todo.title), [todo.id, todo.title])
  const commit = () => {
    const title = draft.trim()
    if (title && title !== todo.title) onSave(title)
    else if (!title) setDraft(todo.title)
  }
  return <input value={draft} onChange={(event) => setDraft(event.target.value)} onBlur={commit} onKeyDown={(event) => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) event.currentTarget.blur() }} aria-label="编辑待办" />
}

function RoutineDialog({ open, routine, onOpenChange, onSave, onDelete }: { open: boolean; routine: RecurringTodo | null; onOpenChange: (open: boolean) => void; onSave: (routine: Omit<RecurringTodo, 'id' | 'createdAt' | 'updatedAt'>) => void; onDelete?: () => void }) {
  const [title, setTitle] = useState('')
  const [frequency, setFrequency] = useState<RecurringTodoFrequency>('daily')
  const [weekdays, setWeekdays] = useState<number[]>([])
  const [dayOfMonth, setDayOfMonth] = useState('')
  const [intervalDays, setIntervalDays] = useState('2')
  const [startDate, setStartDate] = useState(localDateKey())
  const [paused, setPaused] = useState(false)
  useEffect(() => {
    if (!open) return
    setTitle(routine?.title ?? '')
    setFrequency(routine?.frequency ?? 'daily')
    setWeekdays(routine?.weekdays ?? [])
    setDayOfMonth(String(routine?.dayOfMonth ?? new Date().getDate()))
    setIntervalDays(String(routine?.intervalDays ?? 2))
    setStartDate(routine?.startDate ?? localDateKey())
    setPaused(routine?.paused ?? false)
  }, [open, routine])
  const save = () => {
    const cleanTitle = title.trim()
    if (!cleanTitle) return
    const interval = Math.max(1, Math.min(365, Number.parseInt(intervalDays, 10) || 1))
    const day = Math.max(1, Math.min(31, Number.parseInt(dayOfMonth, 10) || 1))
    onSave({ title: cleanTitle, priority: routine?.priority ?? 'medium', frequency, startDate, weekdays: frequency === 'weekly' ? (weekdays.length ? weekdays : [new Date(`${startDate}T00:00:00`).getDay()]) : undefined, dayOfMonth: frequency === 'monthly' ? day : undefined, intervalDays: frequency === 'interval' ? interval : undefined, paused })
  }
  const weekdayNames = ['日', '一', '二', '三', '四', '五', '六']
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="modal-card routine-dialog"><DialogHeader className="modal-title"><div><span className="eyebrow">ROUTINE</span><DialogTitle>{routine ? '编辑例行待办' : '添加例行待办'}</DialogTitle><DialogDescription>完成后会在下一次该做的日子自动出现。</DialogDescription></div></DialogHeader><div className="routine-form"><label>要做什么？<Input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="例如：晨间拉伸 10 分钟" autoFocus /></label><label>重复方式<Select value={frequency} onValueChange={(value) => setFrequency(value as RecurringTodoFrequency)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="daily">每天</SelectItem><SelectItem value="weekly">每周</SelectItem><SelectItem value="monthly">每月</SelectItem><SelectItem value="interval">每 N 天</SelectItem></SelectContent></Select></label>{frequency === 'weekly' && <fieldset className="routine-weekdays"><legend>在哪几天做？</legend><div>{weekdayNames.map((name, day) => <Button type="button" variant={weekdays.includes(day) ? 'default' : 'outline'} size="sm" key={name} onClick={() => setWeekdays((current) => current.includes(day) ? current.filter((item) => item !== day) : [...current, day])}>周{name}</Button>)}</div></fieldset>}{frequency === 'monthly' && <label>每月几号？<Input type="number" min="1" max="31" value={dayOfMonth} onChange={(event) => setDayOfMonth(event.target.value)} /></label>}{frequency === 'interval' && <label>间隔天数<Input type="number" min="1" max="365" value={intervalDays} onChange={(event) => setIntervalDays(event.target.value)} /></label>}<label>从哪天开始？<DatePicker value={startDate} onChange={setStartDate} ariaLabel="例行待办开始日期" /></label>{routine && <label className="routine-pause"><span><strong>暂停这项例行</strong><small>暂停后不再出现在今日清单，历史会保留。</small></span><Switch checked={paused} onCheckedChange={setPaused} /></label>}</div><DialogFooter className="modal-actions">{onDelete && <Button variant="ghost" className="danger" onClick={onDelete}><Trash2 size={15} />删除</Button>}<Button variant="outline" onClick={() => onOpenChange(false)}>取消</Button><Button onClick={save}>{routine ? '保存更改' : '加入今日清单'}</Button></DialogFooter></DialogContent></Dialog>
}

function launchTodoConfetti(source: DOMRect) {
  const origin = {
    x: Math.min(0.98, Math.max(0.02, (source.left + source.width / 2) / window.innerWidth)),
    y: Math.min(0.96, Math.max(0.04, (source.top + source.height / 2) / window.innerHeight)),
  }
  const base: ConfettiOptions = {
    colors: ['#ef476f', '#ffd166', '#06d6a0', '#118ab2', '#7b61ff', '#f78c6b'],
    disableForReducedMotion: true,
    angle: 90,
    gravity: 1.08,
    decay: 0.91,
    ticks: 170,
    scalar: 0.9,
    spread: 54,
    startVelocity: 38,
    origin,
    zIndex: 130,
  }
  void todoConfetti({ ...base, particleCount: 44 })
  window.setTimeout(() => void todoConfetti({ ...base, particleCount: 18, spread: 68, startVelocity: 30 }), 90)
}

function formatTodoDuration(hours: number): string {
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))} 分钟`
  if (hours < 24) return `${Math.round(hours)} 小时`
  return `${Math.round(hours / 24)} 天`
}

function formatTodoTimestamp(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '未知时间'
  const now = new Date()
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const startOfYesterday = startOfToday - 86400000
  const time = date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })
  if (date.getTime() >= startOfToday) return `今天 ${time}`
  if (date.getTime() >= startOfYesterday) return `昨天 ${time}`
  return `${date.getMonth() + 1}月${date.getDate()}日 ${time}`
}

function TodoInsight({ icon, value, label }: { icon: React.ReactNode; value: string; label: string }) {
  return <div><span>{icon}</span><strong>{value}</strong><small>{label}</small></div>
}

const modeLabels: Record<PomodoroMode, string> = { focus: '专注', shortBreak: '短休息', longBreak: '长休息' }

function PomodoroPanel({ autoStart = false }: { autoStart?: boolean }) {
  const { snapshot, update } = useAppStore()
  const timer = snapshot!.pomodoro
  const autoStarted = useRef(false)
  const [editing, setEditing] = useState(false)
  const [draftConfig, setDraftConfig] = useState({ focusMinutes: String(timer.focusMinutes), shortBreakMinutes: String(timer.shortBreakMinutes), longBreakMinutes: String(timer.longBreakMinutes), sessionsBeforeLongBreak: String(timer.sessionsBeforeLongBreak) })

  useEffect(() => {
    if (!autoStart || autoStarted.current || timer.running) return
    autoStarted.current = true
    update((state) => ({ ...state, pomodoro: { ...state.pomodoro, running: true, endsAt: new Date(Date.now() + state.pomodoro.secondsRemaining * 1000).toISOString() } }))
  }, [autoStart, timer.running, update])

  const minutesFor = (mode: PomodoroMode) => mode === 'focus' ? timer.focusMinutes : mode === 'shortBreak' ? timer.shortBreakMinutes : timer.longBreakMinutes
  const switchMode = (mode: PomodoroMode) => update((state) => ({ ...state, pomodoro: { ...state.pomodoro, mode, secondsRemaining: minutesFor(mode) * 60, running: false, endsAt: null } }))
  const toggle = async () => {
    if (!timer.running) unlockPomodoroAlarm()
    if (!timer.running && 'Notification' in window && Notification.permission === 'default') void Notification.requestPermission()
    update((state) => ({ ...state, pomodoro: { ...state.pomodoro, running: !state.pomodoro.running, endsAt: state.pomodoro.running ? null : new Date(Date.now() + state.pomodoro.secondsRemaining * 1000).toISOString() } }))
  }
  const reset = () => update((state) => ({ ...state, pomodoro: { ...state.pomodoro, secondsRemaining: minutesFor(state.pomodoro.mode) * 60, running: false, endsAt: null } }))
  const total = Math.max(1, minutesFor(timer.mode) * 60)
  const progress = Math.min(100, Math.max(0, ((total - timer.secondsRemaining) / total) * 100))
  const timeText = `${String(Math.floor(timer.secondsRemaining / 60)).padStart(2, '0')}:${String(timer.secondsRemaining % 60).padStart(2, '0')}`
  const saveConfig = () => {
    const numberInRange = (value: string, fallback: number, min: number, max: number) => Math.min(max, Math.max(min, Number(value) || fallback))
    const config = {
      focusMinutes: numberInRange(draftConfig.focusMinutes, timer.focusMinutes, 1, 120),
      shortBreakMinutes: numberInRange(draftConfig.shortBreakMinutes, timer.shortBreakMinutes, 1, 60),
      longBreakMinutes: numberInRange(draftConfig.longBreakMinutes, timer.longBreakMinutes, 1, 90),
      sessionsBeforeLongBreak: numberInRange(draftConfig.sessionsBeforeLongBreak, timer.sessionsBeforeLongBreak, 2, 10),
    }
    update((state) => {
      const durationKey = state.pomodoro.mode === 'focus' ? 'focusMinutes' : state.pomodoro.mode === 'shortBreak' ? 'shortBreakMinutes' : 'longBreakMinutes'
      return { ...state, pomodoro: { ...state.pomodoro, ...config, secondsRemaining: config[durationKey] * 60, running: false, endsAt: null } }
    })
  }

  return <div className="task-panel pomodoro-panel">
    <div className="panel-heading"><div><h2>番茄钟</h2><p>用清晰的专注与休息节奏，保护注意力</p></div><Button variant="outline" className="button secondary" onClick={() => setEditing((value) => !value)}><Settings2 size={16} />参数设置</Button></div>
    {editing && <div className="timer-settings"><label>专注时长<Input type="number" min="1" max="120" value={draftConfig.focusMinutes} onChange={(e) => setDraftConfig({ ...draftConfig, focusMinutes: e.target.value })} /><span>分钟</span></label><label>短休息<Input type="number" min="1" max="60" value={draftConfig.shortBreakMinutes} onChange={(e) => setDraftConfig({ ...draftConfig, shortBreakMinutes: e.target.value })} /><span>分钟</span></label><label>长休息<Input type="number" min="1" max="90" value={draftConfig.longBreakMinutes} onChange={(e) => setDraftConfig({ ...draftConfig, longBreakMinutes: e.target.value })} /><span>分钟</span></label><label>长休息间隔<Input type="number" min="2" max="10" value={draftConfig.sessionsBeforeLongBreak} onChange={(e) => setDraftConfig({ ...draftConfig, sessionsBeforeLongBreak: e.target.value })} /><span>轮</span></label><Button className="button primary" onClick={() => { saveConfig(); setEditing(false) }}>保存参数</Button></div>}
    <div className="pomodoro-layout"><div className="timer-card">
      <div className="timer-modes">{(['focus', 'shortBreak', 'longBreak'] as const).map((mode) => <button key={mode} className={timer.mode === mode ? 'active' : ''} onClick={() => switchMode(mode)}>{modeLabels[mode]}</button>)}</div>
      <div className="timer-ring" style={{ '--timer-progress': `${progress * 3.6}deg` } as CSSProperties}><div><span>{modeLabels[timer.mode]}</span><strong>{timeText}</strong><small>{timer.running ? '保持专注，慢慢来' : '准备好时就开始'}</small></div></div>
      <div className="timer-actions"><Button variant="outline" size="icon" className="timer-reset" onClick={reset} aria-label="重置"><RotateCcw size={18} /></Button><Button className="timer-main" onClick={toggle}>{timer.running ? <Pause size={22} /> : <Play size={22} fill="currentColor" />}{timer.running ? '暂停' : '开始'}</Button><Button variant="outline" size="icon" className="timer-reset" onClick={() => switchMode('shortBreak')} aria-label="跳到休息"><TimerReset size={18} /></Button></div>
      <div className="session-dots" aria-label={`已完成 ${timer.completedSessions} 轮专注`}>{Array.from({ length: timer.sessionsBeforeLongBreak }, (_, index) => <i key={index} className={index < timer.completedSessions % timer.sessionsBeforeLongBreak ? 'filled' : ''} />)}<span>完成 {timer.completedSessions} 轮</span></div>
    </div>
    <aside className="focus-guide"><h3>专注小提示</h3><ol><li>开始前，只选择一件现在要完成的事。</li><li>专注期间暂时记录打断，不立刻处理。</li><li>休息时离开屏幕，让眼睛和身体放松。</li></ol><div className="focus-quote">“一次只做一件事，也是一种温柔的秩序。”</div></aside></div>
  </div>
}

const countdownCategoryMeta: Record<CountdownCategory, { label: string; icon: typeof Star }> = {
  birthday: { label: '生日', icon: CakeSlice },
  anniversary: { label: '纪念日', icon: Heart },
  travel: { label: '旅行', icon: Plane },
  event: { label: '重要事件', icon: Flag },
  other: { label: '其他', icon: Star },
}

const countdownRepeatLabels: Record<CountdownRepeat, string> = { none: '不重复', weekly: '每周', monthly: '每月', yearly: '每年' }
const countdownModeLabels: Record<CountdownMode, string> = { auto: '自动判断', countdown: '倒数', countup: '正数' }
const countdownAccentLabels: Record<CountdownAccent, string> = { neutral: '月白', rose: '蔷薇', amber: '暖阳', sage: '青叶', sky: '晴空' }

function CountdownPanel() {
  const { snapshot, update } = useAppStore()
  const countdowns = snapshot?.countdowns ?? []
  const [now, setNow] = useState(() => new Date())
  const [editing, setEditing] = useState<CountdownEvent | null | undefined>(undefined)
  const [deleting, setDeleting] = useState<CountdownEvent | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [coverUrls, setCoverUrls] = useState<Record<string, string>>({})

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), countdowns.some((event) => event.precise) ? 1_000 : 60_000)
    return () => window.clearInterval(timer)
  }, [countdowns])

  const usedCoverPaths = useMemo(() => {
    return [...new Set(countdowns.map((event) => event.coverImagePath).filter(Boolean))]
  }, [countdowns])
  useEffect(() => {
    if (!window.sylunae || usedCoverPaths.length === 0) return
    let active = true
    window.sylunae.images.getUrls(usedCoverPaths).then((urls) => { if (active) setCoverUrls((current) => ({ ...current, ...urls })) })
    return () => { active = false }
  }, [usedCoverPaths])

  const entries = useMemo(() => countdowns.map((event) => ({ event, result: countdownResult(event, now) })).filter((entry): entry is { event: CountdownEvent; result: CountdownResult } => Boolean(entry.result)), [countdowns, now])
  const upcoming = entries
    .filter(({ result }) => result.state !== 'past')
    .sort((a, b) => Number(b.event.pinned) - Number(a.event.pinned) || a.result.occurrence.getTime() - b.result.occurrence.getTime())
  const past = entries
    .filter(({ result }) => result.state === 'past')
    .sort((a, b) => Number(b.event.pinned) - Number(a.event.pinned) || b.result.occurrence.getTime() - a.result.occurrence.getTime())
  const featured = [...upcoming].sort((a, b) => a.result.occurrence.getTime() - b.result.occurrence.getTime())[0]
    ?? [...past].sort((a, b) => b.result.occurrence.getTime() - a.result.occurrence.getTime())[0]
  const selected = countdowns.find((event) => event.id === selectedId) ?? null
  const selectedResult = selected ? countdownResult(selected, now) : null

  const save = (draft: Omit<CountdownEvent, 'id' | 'createdAt' | 'updatedAt'>) => {
    const timestamp = nowIso()
    update((state) => ({
      ...state,
      countdowns: editing
        ? state.countdowns.map((item) => item.id === editing.id ? { ...item, ...draft, updatedAt: timestamp } : item)
        : [{ ...draft, id: newId(), createdAt: timestamp, updatedAt: timestamp }, ...state.countdowns],
    }))
    setEditing(undefined)
  }
  const patch = (id: string, value: Partial<CountdownEvent>) => update((state) => ({ ...state, countdowns: state.countdowns.map((item) => item.id === id ? { ...item, ...value, updatedAt: nowIso() } : item) }))
  const remove = () => {
    if (!deleting) return
    update((state) => ({ ...state, countdowns: state.countdowns.filter((item) => item.id !== deleting.id) }))
    setDeleting(null)
  }
  const coverUrlFor = (event: CountdownEvent): string => {
    return event.coverImagePath ? coverUrls[event.coverImagePath] ?? '' : ''
  }

  return <div className="task-panel countdown-panel">
    <div className="panel-heading"><div><h2>倒数日</h2><p>{countdowns.length ? `${countdowns.length} 个日子，未来与过去一目了然` : '记下一个名称和日期，就完成了'}</p></div><Button className="button primary" onClick={() => setEditing(null)}><Plus size={16} />添加倒数日</Button></div>
    {featured && <CountdownFeatureHero event={featured.event} result={featured.result} coverUrl={coverUrlFor(featured.event)} onOpen={() => setSelectedId(featured.event.id)} />}
    {entries.length ? <div className="countdown-list">
      {upcoming.length > 0 && <CountdownSection title="即将到来" count={upcoming.length} entries={upcoming} onOpen={setSelectedId} onEdit={setEditing} onDelete={setDeleting} onPin={(event) => patch(event.id, { pinned: !event.pinned })} />}
      {past.length > 0 && <CountdownSection title="已经过去" count={past.length} entries={past} past onOpen={setSelectedId} onEdit={setEditing} onDelete={setDeleting} onPin={(event) => patch(event.id, { pinned: !event.pinned })} />}
    </div> : <section className="countdown-empty-hero"><span><CalendarClock /></span><h3>还没有倒数日</h3><p>只需要名称和日期，就能开始记录。</p><Button variant="outline" onClick={() => setEditing(null)}><Plus size={15} />添加第一个倒数日</Button></section>}
    <CountdownEditor open={editing !== undefined} event={editing ?? null} onClose={() => setEditing(undefined)} onSave={save} />
    <CountdownDetail event={selected} result={selectedResult} coverUrl={selected ? coverUrlFor(selected) : ''} onClose={() => setSelectedId(null)} onEdit={() => { if (selected) { setEditing(selected); setSelectedId(null) } }} onPin={() => { if (selected) patch(selected.id, { pinned: !selected.pinned }) }} onDelete={() => { if (selected) { setDeleting(selected); setSelectedId(null) } }} />
    <ConfirmDialog open={Boolean(deleting)} onOpenChange={(open) => { if (!open) setDeleting(null) }} title="删除这个倒数日？" description={<>“<span className="user-content">{deleting?.title}</span>”删除后无法恢复。</>} confirmLabel="删除" destructive icon={<Trash2 />} onConfirm={remove} />
  </div>
  }

function CountdownFeatureHero({ event, result, coverUrl, onOpen }: { event: CountdownEvent; result: CountdownResult; coverUrl: string; onOpen: () => void }) {
  const meta = countdownCategoryMeta[event.category]
  const Icon = meta.icon
  const label = result.state === 'today' && result.displayDays === 0 ? '就是今天' : result.state === 'past' ? `已经过去 ${result.displayDays} 天` : `还有 ${result.displayDays} 天`
  return <article className={`countdown-feature-hero accent-${event.accent} ${result.state}`} style={countdownCoverStyle(coverUrl)} role="button" tabIndex={0} onClick={onOpen} onKeyDown={(keyEvent) => { if (keyEvent.key === 'Enter' || keyEvent.key === ' ') { keyEvent.preventDefault(); onOpen() } }} aria-label={`查看倒数日：${event.title}`}>
    <div className="countdown-feature-copy"><span><Icon size={15} />最近的倒数日 · {meta.label}</span><h3 className="user-content">{event.title}</h3><p>{formatCountdownDate(event, result.occurrence)}</p></div>
    <div className="countdown-feature-value"><span>{label}</span>{event.precise ? <PreciseCountdown result={result} compact /> : <strong>{result.displayDays}</strong>}<small>{event.precise ? '精确计时' : '天'}</small></div>
  </article>
}

function CountdownSection({ title, count, entries, past = false, onOpen, onEdit, onDelete, onPin }: { title: string; count: number; entries: Array<{ event: CountdownEvent; result: CountdownResult }>; past?: boolean; onOpen: (id: string) => void; onEdit: (event: CountdownEvent) => void; onDelete: (event: CountdownEvent) => void; onPin: (event: CountdownEvent) => void }) {
  return <section className={`countdown-section ${past ? 'past' : 'future'}`}><header><h3>{title}</h3><span>{count}</span></header><div>{entries.map(({ event, result }) => <CountdownRow key={event.id} event={event} result={result} onOpen={() => onOpen(event.id)} onEdit={() => onEdit(event)} onDelete={() => onDelete(event)} onPin={() => onPin(event)} />)}</div></section>
}

function CountdownRow({ event, result, onOpen, onEdit, onDelete, onPin }: { event: CountdownEvent; result: CountdownResult; onOpen: () => void; onEdit: () => void; onDelete: () => void; onPin: () => void }) {
  const meta = countdownCategoryMeta[event.category]
  const Icon = meta.icon
  const phrase = result.state === 'today' && result.displayDays === 0 ? '就是今天' : result.state === 'past' ? `已经${result.displayDays}天` : `还有${result.displayDays}天`
  return <article className={`countdown-row accent-${event.accent} ${result.state}`} role="button" tabIndex={0} onClick={onOpen} onKeyDown={(keyEvent) => { if (keyEvent.key === 'Enter' || keyEvent.key === ' ') onOpen() }}>
    <span className="countdown-row-icon"><Icon size={17} /></span>
    <div className="countdown-row-copy"><p>{event.pinned && <Pin className="countdown-row-pin" size={12} fill="currentColor" />}<strong className="user-content">{event.title}</strong><span>{phrase}</span></p><small>{formatCountdownDate(event, result.occurrence)}{event.note ? ` · ${event.note}` : ''}</small></div>
    <div className="countdown-row-actions"><button className={event.pinned ? 'active' : ''} onClick={(clickEvent) => { clickEvent.stopPropagation(); onPin() }} aria-label={event.pinned ? '取消置顶' : '置顶'} title={event.pinned ? '取消置顶' : '置顶'}><Pin size={14} fill={event.pinned ? 'currentColor' : 'none'} /></button><button onClick={(clickEvent) => { clickEvent.stopPropagation(); onEdit() }} aria-label="编辑" title="编辑"><Pencil size={14} /></button><button className="danger" onClick={(clickEvent) => { clickEvent.stopPropagation(); onDelete() }} aria-label="删除" title="删除"><Trash2 size={14} /></button></div>
  </article>
}

function CountdownEditor({ open, event, onClose, onSave }: { open: boolean; event: CountdownEvent | null; onClose: () => void; onSave: (event: Omit<CountdownEvent, 'id' | 'createdAt' | 'updatedAt'>) => void }) {
  const [title, setTitle] = useState('')
  const [targetDate, setTargetDate] = useState('')
  const [targetTime, setTargetTime] = useState('09:00')
  const [category, setCategory] = useState<CountdownCategory>('event')
  const [note, setNote] = useState('')
  const [precise, setPrecise] = useState(false)
  const [repeat, setRepeat] = useState<CountdownRepeat>('none')
  const [mode, setMode] = useState<CountdownMode>('auto')
  const [includeStartDay, setIncludeStartDay] = useState(false)
  const [pinned, setPinned] = useState(false)
  const [accent, setAccent] = useState<CountdownAccent>('neutral')
  const [coverImagePath, setCoverImagePath] = useState('')
  const [coverPreviewUrl, setCoverPreviewUrl] = useState('')
  const [error, setError] = useState('')
  const [advancedOpen, setAdvancedOpen] = useState(false)
  useEffect(() => {
    if (!open) return
    setTitle(event?.title ?? '')
    setTargetDate(event?.targetDate ?? localDateInputValue(new Date()))
    setTargetTime(event?.targetTime ?? '09:00')
    setCategory(event?.category ?? 'event')
    setNote(event?.note ?? '')
    setPrecise(event?.precise ?? false)
    setRepeat(event?.repeat ?? (event?.yearly ? 'yearly' : 'none'))
    setMode(event?.mode ?? 'auto')
    setIncludeStartDay(event?.includeStartDay ?? false)
    setPinned(event?.pinned ?? false)
    setAccent(event?.accent ?? 'neutral')
    setCoverImagePath(event?.coverImagePath ?? '')
    setError('')
    setAdvancedOpen(false)
  }, [open, event])
  useEffect(() => {
    if (!open || !coverImagePath || !window.sylunae) { setCoverPreviewUrl(''); return }
    let active = true
    window.sylunae.images.getUrls([coverImagePath]).then((urls) => { if (active) setCoverPreviewUrl(urls[coverImagePath] ?? '') })
    return () => { active = false }
  }, [open, coverImagePath])
  const chooseCoverImage = async () => {
    if (!window.sylunae) { setError('本地图片选择仅在桌面端可用'); return }
    try {
      const selected = await window.sylunae.images.pickFile()
      if (selected) { setCoverImagePath(selected.path); setError('') }
    } catch { setError('无法读取这张图片，请重新选择') }
  }
  const submit = () => {
    const cleanTitle = title.trim()
    if (!cleanTitle) { setError('请写下这个日子的名称'); return }
    if (!targetDate) { setError('请选择日期'); return }
    if (precise && !targetTime) { setError('请选择具体时间'); return }
    onSave({ title: cleanTitle, targetDate, targetTime, category, note: note.trim(), yearly: undefined, precise, repeat: mode === 'countup' ? 'none' : repeat, mode, includeStartDay, accent, coverImagePath, pinned })
  }
  return <Dialog open={open} onOpenChange={(nextOpen) => { if (!nextOpen) onClose() }}><DialogContent className="countdown-dialog" size="md"><DialogHeader><DialogTitle>{event ? '编辑倒数日' : '添加倒数日'}</DialogTitle><DialogDescription>写下名称，选一个日期，就完成了。</DialogDescription></DialogHeader><div className="countdown-quick-create">
    <Input className="countdown-title-input" autoFocus value={title} onChange={(e) => { setTitle(e.target.value); setError('') }} onKeyDown={(e) => { if (e.key === 'Enter') submit() }} placeholder="这是什么日子？" aria-label="倒数日名称" maxLength={60} />
    <DatePicker value={targetDate} onChange={(value) => { setTargetDate(value); setError('') }} className="countdown-date-trigger" ariaLabel="倒数日日期" />
    <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}><CollapsibleTrigger asChild><Button variant="ghost" className="countdown-advanced-trigger"><SlidersHorizontal size={15} />高级选项<ChevronDown size={14} /></Button></CollapsibleTrigger><CollapsibleContent className="countdown-advanced"><div className="countdown-form">
      <div className="countdown-form-row"><label>计数方式<Select value={mode} onValueChange={(value) => { const next = value as CountdownMode; setMode(next); if (next === 'countup') setRepeat('none'); if (next === 'countdown') setIncludeStartDay(false) }}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{Object.entries(countdownModeLabels).map(([id, label]) => <SelectItem key={id} value={id}>{label}</SelectItem>)}</SelectContent></Select></label><label>重复<Select value={repeat} disabled={mode === 'countup'} onValueChange={(value) => setRepeat(value as CountdownRepeat)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{Object.entries(countdownRepeatLabels).map(([id, label]) => <SelectItem key={id} value={id}>{label}</SelectItem>)}</SelectContent></Select></label></div>
      <div className="countdown-form-row"><label>分类<Select value={category} onValueChange={(value) => setCategory(value as CountdownCategory)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{Object.entries(countdownCategoryMeta).map(([id, item]) => <SelectItem key={id} value={id}>{item.label}</SelectItem>)}</SelectContent></Select></label><label>主题颜色<Select value={accent} onValueChange={(value) => setAccent(value as CountdownAccent)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{Object.entries(countdownAccentLabels).map(([id, label]) => <SelectItem key={id} value={id}>{label}</SelectItem>)}</SelectContent></Select></label></div>
      <label className="countdown-yearly"><span><strong>精确计时</strong><small>显示到时、分、秒</small></span><Switch checked={precise} onCheckedChange={(checked) => { setPrecise(checked); if (checked) setIncludeStartDay(false) }} /></label>
      {precise && <label>具体时间<Input type="time" value={targetTime} onChange={(e) => setTargetTime(e.target.value)} /></label>}
      <label className="countdown-yearly"><span><strong>包含起始日</strong><small>从“第 1 天”开始计算</small></span><Switch checked={includeStartDay} disabled={precise || mode === 'countdown'} onCheckedChange={setIncludeStartDay} /></label>
      <label className="countdown-yearly"><span><strong>置顶</strong><small>在对应分组中优先显示</small></span><Switch checked={pinned} onCheckedChange={setPinned} /></label>
      <label>备注<Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="补充一些说明……" rows={2} maxLength={200} /></label>
      <div className="countdown-cover-field"><span>背景图片</span><div className="countdown-cover-picker">{coverPreviewUrl ? <img src={coverPreviewUrl} alt="倒数日背景预览" /> : <span className="countdown-cover-placeholder"><ImageIcon size={19} /></span>}<div><strong className="private-image-value">{coverImagePath ? localFileName(coverImagePath) : '未选择图片'}</strong><small>{coverImagePath ? '已保存本地文件索引' : '从电脑中选择一张图片'}</small></div><Button type="button" variant="outline" onClick={() => void chooseCoverImage()}><FolderOpen size={15} />{coverImagePath ? '更换' : '选择'}</Button>{coverImagePath && <Button type="button" variant="ghost" size="icon" onClick={() => setCoverImagePath('')} aria-label="移除背景图片"><Trash2 size={15} /></Button>}</div></div>
    </div></CollapsibleContent></Collapsible>
    {error && <p className="countdown-form-error">{error}</p>}
  </div><DialogFooter><Button variant="outline" onClick={onClose}>取消</Button><Button onClick={submit}>{event ? '保存' : '添加'}</Button></DialogFooter></DialogContent></Dialog>
}

function CountdownDetail({ event, result, coverUrl, onClose, onEdit, onPin, onDelete }: { event: CountdownEvent | null; result: CountdownResult | null; coverUrl: string; onClose: () => void; onEdit: () => void; onPin: () => void; onDelete: () => void }) {
  if (!event || !result) return <Sheet open={false}><SheetContent /></Sheet>
  const meta = countdownCategoryMeta[event.category]
  const Icon = meta.icon
  return <Sheet open onOpenChange={(open) => { if (!open) onClose() }}><SheetContent className="countdown-detail" showCloseButton><SheetHeader><SheetTitle className="user-content">{event.title}</SheetTitle><SheetDescription>{formatCountdownDate(event, result.occurrence)}</SheetDescription></SheetHeader><div className={`countdown-detail-hero accent-${event.accent}`} style={countdownCoverStyle(coverUrl)}><span>{result.wording}</span>{event.precise ? <PreciseCountdown result={result} /> : <strong>{result.displayDays}</strong>}<small>{event.precise ? '精确计时' : result.state === 'today' && result.displayDays === 0 ? '就是今天' : '天'}</small></div><div className="countdown-detail-meta"><span><Icon size={15} />{meta.label}</span><span><Repeat2 size={15} />{countdownRepeatLabels[event.repeat]}</span><span><CalendarClock size={15} />{countdownModeLabels[event.mode]}</span>{event.includeStartDay && <span><Check size={15} />包含起始日</span>}{event.coverImagePath && <span><ImageIcon size={15} />本地图片背景</span>}</div>{event.note && <p className="countdown-detail-note user-content">{event.note}</p>}<SheetFooter className="countdown-detail-actions"><Button variant="ghost" className="danger" onClick={onDelete}><Trash2 size={15} />删除</Button><Button variant="outline" onClick={onPin}><Pin size={15} fill={event.pinned ? 'currentColor' : 'none'} />{event.pinned ? '取消置顶' : '置顶'}</Button><Button onClick={onEdit}><Pencil size={15} />编辑</Button></SheetFooter></SheetContent></Sheet>
}

function PreciseCountdown({ result, compact = false }: { result: CountdownResult; compact?: boolean }) {
  const parts = preciseCountdownParts(result)
  return <div className={`countdown-precise ${compact ? 'compact' : ''}`}><span><strong>{parts.days}</strong><small>天</small></span><span><strong>{String(parts.hours).padStart(2, '0')}</strong><small>时</small></span><span><strong>{String(parts.minutes).padStart(2, '0')}</strong><small>分</small></span><span><strong>{String(parts.seconds).padStart(2, '0')}</strong><small>秒</small></span></div>
}

function localDateInputValue(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function localFileName(filePath: string): string {
  return filePath.split(/[\\/]/).pop() || filePath
}

function formatCountdownDate(event: CountdownEvent, occurrence?: Date): string {
  const [year, month, day] = event.targetDate.split('-').map(Number)
  if (!year || !month || !day) return '日期未知'
  const date = occurrence ?? new Date(year, month - 1, day)
  const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
  const repeated = event.repeat !== 'none' ? ` · ${countdownRepeatLabels[event.repeat]}` : ''
  const time = event.precise ? ` ${event.targetTime}` : ''
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日 ${weekdays[date.getDay()]}${time}${repeated}`
}

function countdownCoverStyle(url: string): CSSProperties | undefined {
  return url ? { '--countdown-cover': `url("${url.replaceAll('"', '\\"')}")` } as CSSProperties : undefined
}
