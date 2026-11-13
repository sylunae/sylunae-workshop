import type { Editor } from '@tiptap/core'

export function noteLinkAtSelection(editor: Editor): string {
  const href = editor.getAttributes('link').href
  return typeof href === 'string' ? href : ''
}

export function removeNoteLink(editor: Editor) {
  return editor.chain().focus().extendMarkRange('link').unsetLink().run()
}

/** Applies a link to selected text, or inserts a visible link when the cursor is collapsed. */
export function applyNoteLink(editor: Editor, href: string) {
  if (editor.state.selection.empty && !noteLinkAtSelection(editor)) {
    return editor.chain().focus().insertContent({
      type: 'text',
      text: href,
      marks: [{ type: 'link', attrs: { href } }],
    }).run()
  }

  return editor.chain().focus().extendMarkRange('link').setLink({ href }).run()
}
