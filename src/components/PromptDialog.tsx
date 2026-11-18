import { useEffect, useId, useState } from 'react'
import { Button } from './ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog'
import { Input } from './ui/input'

export function PromptDialog({ open, title, description, initialValue = '', placeholder, confirmLabel = '确认', destructiveLabel, allowEmpty = false, validate, onSubmit, onDestructive, onOpenChange, onCloseAutoFocus }: {
  open: boolean
  title: string
  description?: string
  initialValue?: string
  placeholder?: string
  confirmLabel?: string
  destructiveLabel?: string
  allowEmpty?: boolean
  validate?: (value: string) => string | null
  onSubmit: (value: string) => void
  onDestructive?: () => void
  onOpenChange: (open: boolean) => void
  onCloseAutoFocus?: (event: Event) => void
}) {
  const id = useId()
  const [value, setValue] = useState(initialValue)
  const [error, setError] = useState('')

  useEffect(() => {
    if (open) { setValue(initialValue); setError('') }
  }, [open, initialValue])

  const submit = () => {
    const clean = value.trim()
    const validationError = validate?.(clean)
    if (validationError) { setError(validationError); return }
    if (!clean && !allowEmpty) return
    onSubmit(clean)
    onOpenChange(false)
  }

  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="prompt-dialog" onCloseAutoFocus={onCloseAutoFocus}>
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        {description && <DialogDescription>{description}</DialogDescription>}
      </DialogHeader>
      <label htmlFor={id} className="sr-only">{title}</label>
      <Input id={id} autoFocus value={value} onChange={(event) => { setValue(event.target.value); setError('') }} onKeyDown={(event) => { if (event.key === 'Enter' && !event.nativeEvent.isComposing && event.keyCode !== 229 && !event.repeat) submit() }} placeholder={placeholder} aria-invalid={Boolean(error)} />
      {error && <p className="prompt-error">{error}</p>}
      <DialogFooter>
        {destructiveLabel && onDestructive && <Button variant="destructive" className="prompt-dialog-delete" onClick={() => { onDestructive(); onOpenChange(false) }}>{destructiveLabel}</Button>}
        <Button variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
        <Button disabled={!allowEmpty && !value.trim()} onClick={submit}>{confirmLabel}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
}
