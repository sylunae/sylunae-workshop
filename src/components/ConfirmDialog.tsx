import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
} from './ui/alert-dialog'

export function ConfirmDialog({ open, title, description, confirmLabel = '确认', destructive = false, icon, onConfirm, onOpenChange }: {
  open: boolean
  title: ReactNode
  description: ReactNode
  confirmLabel?: string
  destructive?: boolean
  icon?: ReactNode
  onConfirm: () => void | Promise<void>
  onOpenChange: (open: boolean) => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const running = useRef(false)
  useEffect(() => { if (open) setError('') }, [open])
  const confirm = async () => {
    if (running.current) return
    running.current = true; setBusy(true); setError('')
    try { await onConfirm(); onOpenChange(false) }
    catch (cause) { setError(cause instanceof Error ? cause.message : '操作失败，请重试。') }
    finally { running.current = false; setBusy(false) }
  }
  return <AlertDialog open={open} onOpenChange={(next) => { if (!running.current) onOpenChange(next) }}>
    <AlertDialogContent>
      <AlertDialogHeader>
        {icon && <AlertDialogMedia>{icon}</AlertDialogMedia>}
        <AlertDialogTitle>{title}</AlertDialogTitle>
        <AlertDialogDescription asChild><div>{description}</div></AlertDialogDescription>
      </AlertDialogHeader>
      {error && <p className="notice error" role="alert">{error}</p>}
      <AlertDialogFooter>
        <AlertDialogCancel disabled={busy}>取消</AlertDialogCancel>
        <AlertDialogAction disabled={busy} variant={destructive ? 'destructive' : 'default'} onClick={(event) => { event.preventDefault(); void confirm() }}>{busy ? '正在处理…' : confirmLabel}</AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
}
