// @vitest-environment happy-dom
/**
 * Enter in the rich text editor, in the shapes the application mounts it in.
 *
 * Contract for the batch F pick (upstream 6b2a20f4d, #567, "restore rich text
 * editor newlines") -- the confirmed list item this suite pins:
 *
 *   F27 Enter in the rich text editor inserts a new line.
 *
 * A "new line" is a paragraph break or a hard break (the comment editor
 * deliberately breaks the line inside the paragraph). What matters is that
 * the text typed after Enter does not sit on the same line as the text
 * before it, so the content is read back as lines, whatever node made the
 * break.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import fc from 'fast-check'
import { cleanup, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { JSONContent } from '@tiptap/react'
import { RichTextEditor } from '../rich-text-editor'
import { COMMENT_EDITOR_FEATURES } from '@/components/public/comment-editor-features'
import { renderWithIntl } from '@/test/render-with-intl'

afterEach(cleanup)

/** The text of the document, one entry per visual line. */
function linesOf(doc: JSONContent): string[] {
  const lines: string[] = ['']
  function startLine() {
    lines.push('')
  }
  function walk(node: JSONContent) {
    if (node.type === 'text') {
      lines[lines.length - 1] += node.text ?? ''
      return
    }
    if (node.type === 'hardBreak') {
      startLine()
      return
    }
    const isBlock = node.type !== 'doc'
    if (isBlock && lines[lines.length - 1] !== '') startLine()
    for (const child of node.content ?? []) walk(child)
    if (isBlock && lines[lines.length - 1] !== '') startLine()
  }
  walk(doc)
  return lines.filter((line) => line !== '')
}

interface EditorShape {
  name: string
  props: Partial<React.ComponentProps<typeof RichTextEditor>>
}

const SHAPES: EditorShape[] = [
  { name: 'default', props: {} },
  {
    name: 'feedback composer',
    props: {
      borderless: true,
      toolbarPosition: 'bottom',
      features: { images: true, quackbackEmbeds: true },
      onImageUpload: vi.fn(),
    },
  },
  {
    name: 'comment',
    props: {
      borderless: true,
      minHeight: '72px',
      features: COMMENT_EDITOR_FEATURES,
      onImageUpload: vi.fn(),
    },
  },
]

// Words without whitespace, so a line is exactly what was typed between Enters.
const word = fc.stringMatching(/^[a-z]{1,8}$/)

async function typeLines(shape: EditorShape, typedLines: string[]): Promise<JSONContent> {
  let latest: JSONContent = { type: 'doc' }
  const onChange = (json: JSONContent, _html: string, _markdown: string) => {
    latest = json
  }
  const { container } = renderWithIntl(
    <RichTextEditor value="" onChange={onChange} {...shape.props} />
  )
  const editor = await waitFor(() => {
    const element = container.querySelector<HTMLElement>('.ProseMirror')
    expect(element).not.toBeNull()
    return element!
  })
  const user = userEvent.setup()
  await user.click(editor)
  await user.type(editor, typedLines.join('{Enter}'))
  return latest
}

describe('rich text editor Enter', () => {
  for (const shape of SHAPES) {
    it(`(F27) puts the text after Enter on a new line (${shape.name} editor)`, async () => {
      const doc = await typeLines(shape, ['line one', 'line two'])

      expect(linesOf(doc)).toEqual(['line one', 'line two'])
    })

    it(`(F27) keeps every Enter-separated line apart, whatever was typed (${shape.name} editor)`, async () => {
      await fc.assert(
        fc.asyncProperty(fc.array(word, { minLength: 2, maxLength: 4 }), async (typedLines) => {
          cleanup()
          const doc = await typeLines(shape, typedLines)

          expect(linesOf(doc)).toEqual(typedLines)
        }),
        { numRuns: 6 }
      )
    })
  }
})
