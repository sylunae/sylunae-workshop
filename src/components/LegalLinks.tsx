import { useState } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from './ui/dialog'
import { legalDocuments, legalUpdatedAt, renderLegalDocument, type LegalDocumentId } from '../legal/documents'

export function LegalLinks() {
  const [active, setActive] = useState<LegalDocumentId | null>(null)
  return <>
    <nav className="legal-links" aria-label="法律与隐私">
      {(['privacy', 'terms'] as const).map((id) => <a key={id} href={`./${id}.html`} onClick={(event) => {
        // Keep playback, unsaved editors and native clients in the current app.
        if (event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
        event.preventDefault()
        setActive(id)
      }}>{legalDocuments[id].title}</a>)}
    </nav>
    <Dialog open={active !== null} onOpenChange={(open) => { if (!open) setActive(null) }}>
      <DialogContent size="xl" mobileSize="fullscreen" className="legal-dialog">
        {active && <>
          <header className="legal-heading"><span className="eyebrow">{legalDocuments[active].english}</span><DialogTitle>{legalDocuments[active].title}</DialogTitle><DialogDescription>{legalDocuments[active].summary}</DialogDescription><small>更新与生效日期：{legalUpdatedAt}</small></header>
          <div className="legal-reader" key={active} onClick={(event) => {
            const link = (event.target as HTMLElement).closest<HTMLAnchorElement>('a[href]')
            if (link && window.sylunae) { event.preventDefault(); void window.sylunae.system.openExternal(link.href) }
          }} dangerouslySetInnerHTML={{ __html: renderLegalDocument(active) }} />
        </>}
      </DialogContent>
    </Dialog>
  </>
}
