import type { ComponentPropsWithoutRef } from 'react'

export function WorkspaceLink({ onNavigate, ...props }: ComponentPropsWithoutRef<'a'> & { onNavigate: () => void }) {
  return <a {...props} onClick={(event) => {
    props.onClick?.(event)
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    event.preventDefault()
    onNavigate()
  }} />
}
