import { LocalNotifications } from '@capacitor/local-notifications'
import type { PomodoroState } from '../shared/types'

export const pomodoroNotificationId = 2000000001
let notifications: Promise<unknown> = Promise.resolve()

export function syncAndroidPomodoro(timer: Pick<PomodoroState, 'running' | 'endsAt' | 'mode'>) {
  const next = notifications.then(async () => {
    await LocalNotifications.cancel({ notifications: [{ id: pomodoroNotificationId }] })
    if (!timer.running || !timer.endsAt || Date.parse(timer.endsAt) <= Date.now()) return
    let permissions = await LocalNotifications.checkPermissions()
    if (permissions.display === 'prompt') permissions = await LocalNotifications.requestPermissions()
    if (permissions.display !== 'granted') return
    await LocalNotifications.schedule({ notifications: [{
      id: pomodoroNotificationId, title: '丝月工坊 · 番茄钟',
      body: timer.mode === 'focus' ? '专注结束，休息一下吧。' : '休息结束，开始下一段专注。',
      schedule: { at: new Date(timer.endsAt), allowWhileIdle: true },
    }] })
  })
  notifications = next.catch(() => undefined)
  return next
}
