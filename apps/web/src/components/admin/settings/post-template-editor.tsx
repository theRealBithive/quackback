import type { JSONContent } from '@tiptap/react'
import { RichTextEditor, type EditorFeatures } from '@/components/ui/rich-text-editor'
import type { TiptapContent } from '@/lib/shared/db-types'

/** An empty template: a board or workspace with this has no template. */
export const EMPTY_POST_TEMPLATE: TiptapContent = { type: 'doc', content: [{ type: 'paragraph' }] }

interface PostTemplateEditorProps {
  value: TiptapContent
  onChange: (next: TiptapContent) => void
  placeholder: string
}

/**
 * The formatting a template may use: what every post form's editor can show.
 * The portal's submit form runs the editor with no optional blocks, so a
 * heading, checklist, quote, code block or divider offered here would be
 * dropped there while the widget and the admin dialog kept it. Images are left
 * out as well: every post would reference the same uploaded file.
 */
export const POST_TEMPLATE_EDITOR_FEATURES: EditorFeatures = { bubbleMenu: true }

/** Edits a description template — the text a new post starts with. */
export function PostTemplateEditor({ value, onChange, placeholder }: PostTemplateEditorProps) {
  function handleChange(json: JSONContent) {
    onChange(json as TiptapContent)
  }

  return (
    <RichTextEditor
      value={value}
      onChange={handleChange}
      placeholder={placeholder}
      minHeight="160px"
      features={POST_TEMPLATE_EDITOR_FEATURES}
    />
  )
}
