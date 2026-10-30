import { acquireNoteImageUrl, createImageExternalizer, noteAssetPrefix, storeNoteImage } from '../data/noteAssets'
import { mergeAttributes } from '@tiptap/core'
import Image from '@tiptap/extension-image'
import { NodeSelection, Plugin, PluginKey, type EditorState } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

const imageSelectionKey = new PluginKey('noteImageSelection')

function imageBeforeCursor(state: EditorState) {
  const { selection } = state
  if (!selection.empty) return null

  const { $from } = selection
  if ($from.parent.isTextblock && $from.parentOffset !== 0) return null

  for (let depth = $from.depth; depth >= 0; depth -= 1) {
    const index = $from.index(depth)
    if (index === 0) continue

    const node = $from.node(depth).child(index - 1)
    if (node.type.name !== 'image') return null

    const boundary = $from.posAtIndex(index, depth)
    return { from: boundary - node.nodeSize, to: boundary }
  }

  return null
}

export const NoteImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      caption: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-caption'),
        renderHTML: (attributes) => attributes.caption ? { 'data-caption': attributes.caption } : {},
      },
    }
  },

  renderHTML({ HTMLAttributes }) {
    const { 'data-caption': caption, ...imageAttributes } = HTMLAttributes
    const figureAttributes = caption ? { 'data-caption': caption } : {}
    const children: unknown[] = ['figure', mergeAttributes({ 'data-type': 'note-image' }, figureAttributes), ['img', mergeAttributes(this.options.HTMLAttributes, imageAttributes, figureAttributes)]]
    if (caption) children.push(['figcaption', {}, caption])
    return children as [string, Record<string, unknown>, ...unknown[]]
  },

  addNodeView() {
    return ({ node, editor, getPos }) => {
      let current = node
      let version = 0
      let release: (() => void) | undefined
      let destroyed = false
      const figure = document.createElement('figure')
      figure.dataset.type = 'note-image'
      const image = document.createElement('img')
      const caption = document.createElement('figcaption')
      figure.append(image)
      const render = () => {
        const generation = ++version
        release?.(); release = undefined
        const source = String(current.attrs.src ?? '')
        image.alt = current.attrs.alt ?? ''
        if (current.attrs.title) image.title = current.attrs.title
        else image.removeAttribute('title')
        const text = current.attrs.caption
        if (text) { figure.dataset.caption = text; caption.textContent = text; figure.append(caption) }
        else { delete figure.dataset.caption; caption.remove() }
        const show = (url: string) => { if (!destroyed && generation === version) image.src = url }
        if (source.startsWith(noteAssetPrefix)) {
          const resource = acquireNoteImageUrl(source)
          release = resource.release
          void resource.url.then(show, () => { if (!destroyed && generation === version) image.alt = '图片读取失败' })
        } else {
          image.src = source
          // HTML paste and older Markdown can still introduce embedded data URLs.
          // Convert once, then update only this node if it still has the same source.
          if (/^data:image\/[a-z0-9.+-]+;base64,/i.test(source)) {
            void createImageExternalizer()(source).then((src) => {
              if (destroyed || editor.isDestroyed || generation !== version) return
              const pos = getPos()
              if (typeof pos !== 'number') return
              const latest = editor.state.doc.nodeAt(pos)
              if (latest?.type.name === 'image' && latest.attrs.src === source) {
                editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, { ...latest.attrs, src }).setMeta('addToHistory', false))
              }
            }, () => { /* Keep the original image and content if conversion fails. */ })
          }
        }
      }
      render()
      return {
        dom: figure,
        ignoreMutation: (mutation) => mutation.type !== 'selection',
        update(next) {
          if (next.type !== current.type) return false
          const sourceChanged = next.attrs.src !== current.attrs.src
          current = next
          if (sourceChanged) render()
          else {
            image.alt = current.attrs.alt ?? ''
            if (current.attrs.caption) { figure.dataset.caption = current.attrs.caption; caption.textContent = current.attrs.caption; figure.append(caption) }
            else { delete figure.dataset.caption; caption.remove() }
          }
          return true
        },
        destroy() { destroyed = true; version++; release?.() },
      }
    }
  },

  addProseMirrorPlugins() {
    return [
      ...(this.parent?.() ?? []),
      new Plugin({
        key: imageSelectionKey,
        props: {
          decorations: (state) => {
            const adjacent = imageBeforeCursor(state)
            if (!adjacent) return DecorationSet.empty
            return DecorationSet.create(state.doc, [Decoration.node(adjacent.from, adjacent.to, { class: 'image-cursor-adjacent' })])
          },
        },
      }),
    ]
  },
})

export function isImageNodeSelection(selection: EditorState['selection']): selection is NodeSelection {
  return selection instanceof NodeSelection && selection.node.type.name === 'image'
}

export async function readImageFile(file: File) {
  return storeNoteImage(new Uint8Array(await file.arrayBuffer()), file.type)
}
