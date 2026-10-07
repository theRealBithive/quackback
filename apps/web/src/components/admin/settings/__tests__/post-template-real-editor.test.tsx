// @vitest-environment happy-dom
/**
 * Description templates against the real TipTap editor, not a stub. The
 * contract is listed in full in `lib/shared/__tests__/post-template.test.ts`;
 * this suite holds the two promises a stub cannot answer for:
 *
 *   V5  Switching boards replaces the description only while the author has not
 *       changed it; once they have typed, a board switch never discards their text.
 *   V8  For the same board, portal, widget and admin dialog show the same template.
 *
 * V5 depends on recognising a template the editor has handed back — with the
 * attributes and normalisation the real editor applies, which no stub knows.
 * V8 depends on every form's editor being able to show what the template
 * editor lets an administrator write: the portal runs the editor with no
 * optional blocks, so the template editor is limited to the same set.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { useState } from 'react'
import { cleanup, waitFor } from '@testing-library/react'
import { renderWithIntl } from '@/test/render-with-intl'
import type { JSONContent } from '@tiptap/react'
import { RichTextEditor, type EditorFeatures } from '@/components/ui/rich-text-editor'
import { POST_TEMPLATE_EDITOR_FEATURES } from '../post-template-editor'
import { usePostTemplatePrefill } from '@/lib/client/hooks/use-post-template-prefill'
import type { TiptapContent } from '@/lib/shared/db-types'

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))

/** The feature sets the three post forms pass today. */
const PORTAL_FEATURES: EditorFeatures = { images: false, quackbackEmbeds: true }
const WIDGET_AND_ADMIN_FEATURES: EditorFeatures = {
  headings: true,
  codeBlocks: true,
  taskLists: true,
  blockquotes: true,
  dividers: true,
  tables: true,
  images: true,
  embeds: true,
  quackbackEmbeds: true,
  bubbleMenu: true,
  slashMenu: true,
}

/** Everything the template editor offers: marks, both list kinds, a link. */
const BUG_TEMPLATE: TiptapContent = {
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      content: [{ type: 'text', text: 'Steps to reproduce', marks: [{ type: 'bold' }] }],
    },
    {
      type: 'orderedList',
      content: [
        {
          type: 'listItem',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Open' }] }],
        },
        {
          type: 'listItem',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Click' }] }],
        },
      ],
    },
    {
      type: 'paragraph',
      content: [{ type: 'text', text: 'Expected vs. actual', marks: [{ type: 'italic' }] }],
    },
    {
      type: 'bulletList',
      content: [
        {
          type: 'listItem',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Version' }] }],
        },
      ],
    },
    {
      type: 'paragraph',
      content: [
        {
          type: 'text',
          text: 'Guidelines',
          marks: [{ type: 'link', attrs: { href: 'https://example.com/guide' } }],
        },
      ],
    },
  ],
}

const IDEA_TEMPLATE: TiptapContent = {
  type: 'doc',
  content: [
    { type: 'paragraph', content: [{ type: 'text', text: 'What would this help you do?' }] },
  ],
}

/** A post form reduced to its description: state, prefill and a real editor. */
function DescriptionForm({
  template,
  features,
  onDescription,
}: {
  template: TiptapContent | undefined
  features: EditorFeatures
  onDescription: (doc: JSONContent | null) => void
}) {
  const [description, setDescription] = useState<JSONContent | null>(null)
  usePostTemplatePrefill({ template, description, setDescription })
  onDescription(description)

  function handleChange(json: JSONContent) {
    setDescription(json)
  }

  return <RichTextEditor value={description || ''} onChange={handleChange} features={features} />
}

function surfaceText(): string {
  return document.querySelector('.ProseMirror')?.textContent ?? ''
}

const TEMPLATE_WORDS = [
  'Steps to reproduce',
  'Open',
  'Click',
  'Expected vs. actual',
  'Version',
  'Guidelines',
]

afterEach(cleanup)

describe('templates in the real editor', () => {
  it('the template editor offers no block the portal editor lacks (V8)', () => {
    const optionalBlocks: (keyof EditorFeatures)[] = [
      'headings',
      'codeBlocks',
      'taskLists',
      'blockquotes',
      'dividers',
      'tables',
      'images',
      'embeds',
    ]
    for (const block of optionalBlocks) {
      const offeredByTemplateEditor = POST_TEMPLATE_EDITOR_FEATURES[block] === true
      const shownByPortal = PORTAL_FEATURES[block] === true
      expect({ block, offered: offeredByTemplateEditor && !shownByPortal }).toEqual({
        block,
        offered: false,
      })
    }
  })

  it.each([
    ['portal', PORTAL_FEATURES],
    ['widget and admin dialog', WIDGET_AND_ADMIN_FEATURES],
  ])('the %s editor shows every word of the template (V8)', async (_form, features) => {
    renderWithIntl(
      <DescriptionForm template={BUG_TEMPLATE} features={features} onDescription={() => {}} />
    )

    await waitFor(() => expect(surfaceText()).toContain('Guidelines'))
    for (const word of TEMPLATE_WORDS) {
      expect(surfaceText()).toContain(word)
    }
  })

  it.each([
    ['portal', PORTAL_FEATURES],
    ['widget and admin dialog', WIDGET_AND_ADMIN_FEATURES],
  ])(
    'the %s editor swaps an untouched template on a board switch (V5)',
    async (_form, features) => {
      const view = renderWithIntl(
        <DescriptionForm template={BUG_TEMPLATE} features={features} onDescription={() => {}} />
      )
      await waitFor(() => expect(surfaceText()).toContain('Guidelines'))

      view.rerender(
        <DescriptionForm template={IDEA_TEMPLATE} features={features} onDescription={() => {}} />
      )
      await waitFor(() => expect(surfaceText()).toBe('What would this help you do?'))

      // The editor has now echoed IDEA_TEMPLATE back through onChange, so this
      // switch compares the editor's own output with the stored template.
      view.rerender(
        <DescriptionForm template={BUG_TEMPLATE} features={features} onDescription={() => {}} />
      )
      await waitFor(() => expect(surfaceText()).toContain('Steps to reproduce'))
      expect(surfaceText()).not.toContain('What would this help you do?')
    }
  )
})
