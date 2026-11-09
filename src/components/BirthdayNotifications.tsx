import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { Toast } from 'radix-ui'
import { Cake, X } from 'lucide-react'
import { useAppStore } from '../app/AppStore'
import { dueBirthdayReminders } from '../birthdays/reminders'
import { Button } from './ui/button'

export function externalNotificationStatus(): string {
  if (window.sylunae?.platform === 'android') return 'Android 使用系统通知，请在系统设置中允许丝月工坊发送通知。'
  if (window.sylunae) return '桌面端使用系统通知，请在系统设置中允许丝月工坊发送通知。'
  if (!window.isSecureContext || !('Notification' in window)) return '当前环境不支持系统通知；App 内提醒仍可使用。网页请使用 HTTPS 或 localhost。'
  if (Notification.permission === 'denied') return '系统通知已被浏览器阻止，请在网站权限中手动允许。'
  return Notification.permission === 'granted' ? '已允许浏览器系统通知。' : '点击「允许系统通知」授权浏览器发送提醒。'
}

export async function sendBirthdayNotification(body: string): Promise<boolean> {
  try {
    if (window.sylunae) return await window.sylunae.system.notifyBirthday(body)
    if (!window.isSecureContext || !('Notification' in window) || Notification.permission !== 'granted') return false
    new Notification('丝月工坊 · 生日提醒', { body })
    return true
  } catch { return false }
}

const BirthdayToastContext = createContext<(body: string) => void>(() => undefined)
export const useBirthdayToast = () => useContext(BirthdayToastContext)

export function BirthdayNotifications({ children }: { children: ReactNode }) {
  const { snapshot, update } = useAppStore()
  const latest = useRef(snapshot)
  latest.current = snapshot
  const claimed = useRef(new Map<string, string>())
  const [messages, setMessages] = useState<Array<{ id: number; body: string }>>([])
  const sequence = useRef(0)
  const showToast = useCallback((body: string) => {
    const id = ++sequence.current
    setMessages((current) => [...current, { id, body }])
  }, [])

  useEffect(() => {
    const tick = async () => {
      const state = latest.current?.birthdays
      if (!state) return
      const now = new Date()
      const due = dueBirthdayReminders(state, now).filter((item) => {
        const signature = `${item.occurrence}:${item.count}`
        if (claimed.current.get(item.person.id) === signature) return false
        claimed.current.set(item.person.id, signature)
        return true
      })
      if (!due.length) return
      const delivered: typeof due = []
      for (const item of due) {
        if (state.settings.toast) showToast(item.body)
        const externalSent = state.settings.external ? await sendBirthdayNotification(item.body) : false
        if (state.settings.toast || externalSent) delivered.push(item)
        else claimed.current.delete(item.person.id)
      }
      if (!delivered.length) return
      update((current) => ({ ...current, birthdays: { ...current.birthdays, deliveries: {
        ...current.birthdays.deliveries,
        ...Object.fromEntries(delivered.filter((item) => current.birthdays.people.some((person) => person.id === item.person.id && person.date === item.person.date)).map((item) => [item.person.id, { occurrence: item.occurrence, count: item.count, lastSentAt: now.toISOString() }])),
      } } }))
    }
    tick()
    const timer = window.setInterval(tick, 30000)
    window.addEventListener('focus', tick)
    document.addEventListener('visibilitychange', tick)
    return () => {
      clearInterval(timer)
      window.removeEventListener('focus', tick)
      document.removeEventListener('visibilitychange', tick)
    }
  }, [Boolean(snapshot), update, showToast])

  return <BirthdayToastContext.Provider value={showToast}>
    <Toast.Provider duration={10000} swipeDirection="right" label="生日通知">
      {children}
      {messages.map((message) => <Toast.Root key={message.id} className="birthday-toast" onOpenChange={(open) => { if (!open) setMessages((current) => current.filter((item) => item.id !== message.id)) }}>
        <Cake size={22} />
        <div><Toast.Title className="birthday-toast-title">生日提醒</Toast.Title><Toast.Description className="user-content">{message.body}</Toast.Description></div>
        <Toast.Close asChild><Button variant="ghost" size="icon" aria-label="关闭生日提醒"><X size={16} /></Button></Toast.Close>
      </Toast.Root>)}
      <Toast.Viewport className="birthday-toast-viewport" />
    </Toast.Provider>
  </BirthdayToastContext.Provider>
}
