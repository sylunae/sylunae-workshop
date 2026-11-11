import type { Plugin } from 'vite'
import { legalDocuments, renderLegalPage, type LegalDocumentId } from '../src/legal/documents'

export function legalPagesPlugin(): Plugin {
  return {
    name: 'public-legal-pages',
    transformIndexHtml: {
      order: 'pre',
      handler(html, context) {
        const id = /(?:^|[/\\])(privacy|terms)\.html$/.exec(context.filename)?.[1] as LegalDocumentId | undefined
        if (!id) return html
        return html.replace('<!-- legal-title -->', `${legalDocuments[id].title} · 丝月工坊`)
          .replace('<!-- legal-content -->', renderLegalPage(id))
      },
    },
  }
}
