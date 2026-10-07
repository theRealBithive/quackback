/**
 * Description templates — the text a new post's description starts with.
 *
 * The contract, as confirmed before implementation (V10 narrowed on
 * 2026-10-07 from "boards they can post to" to "boards they can see", because
 * a board's settings already reach every reader who can see the board):
 *
 *   V1  A board with its own template prefills the description with that template.
 *   V2  A board without its own template prefills the workspace default template.
 *   V3  With neither, the description starts empty — exactly today's behaviour.
 *   V4  A template that holds no visible text counts as "no template" (board
 *       falls back to the workspace default; workspace default means nothing).
 *   V5  Switching boards replaces the description only while the author has not
 *       changed it; once they have typed, a board switch never discards their text.
 *   V6  The template is never enforced: a post is accepted and stored unchanged
 *       whether the template was kept, edited, partly filled or deleted.
 *   V7  After a successful submit or cancel, the next empty form starts again
 *       with the template of the selected board.
 *   V8  For the same board, portal, widget and admin dialog show the same template.
 *   V9  Template content is sanitized like other rich text; markup that could run
 *       script or link to `javascript:` never reaches an author's editor.
 *   V10 Only someone allowed to manage the board can change its template; only
 *       someone allowed to manage settings can change the workspace default.
 *       Readers see a board's template only for boards they are allowed to see.
 *   V11 Saving a board's template never discards the board's other settings
 *       (roadmap statuses, custom fields).
 *   V12 A template over the size limit is rejected at save time with a clear
 *       error, never truncated silently.
 *
 * This module holds V1–V5 and V12 on its own: the resolution every form calls
 * (which is also what makes V8 hold — there is one function, not three), the
 * decision whether a description may be replaced, and the save-time limit.
 * V5/V7 in a live form: `lib/client/hooks/__tests__/use-post-template-prefill.test.tsx`.
 * V6, V9–V11 on the server: `lib/server/functions/__tests__/board-description-template.db.test.ts`
 * and `lib/server/domains/settings/__tests__/portal-post-template.db.test.ts`.
 */
import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import type { TiptapContent } from '@/lib/shared/db-types'
import {
  POST_TEMPLATE_MAX_LENGTH,
  POST_TEMPLATE_TOO_LONG_MESSAGE,
  hasSameVisibleContent,
  mayReplaceDescription,
  postTemplateSchema,
  resolvePostTemplate,
} from '../post-template'

// ---------------------------------------------------------------------------
// Generators: real TipTap documents, not random JSON. They reach headings,
// paragraphs, lists, marks and the editor's default attributes, plus the
// shapes that are empty to a reader (no content, empty paragraphs,
// whitespace-only text, empty lists).
// ---------------------------------------------------------------------------

const visibleWord = fc
  .string({ minLength: 1, maxLength: 12 })
  .filter((text) => text.trim().length > 0)

const whitespace = fc.constantFrom('', ' ', '  ', '\n', '\t ')

const markList = fc.subarray([{ type: 'bold' }, { type: 'italic' }, { type: 'code' }])

const visibleText = fc
  .record({ text: visibleWord, marks: markList })
  .map(({ text, marks }): TiptapContent => {
    if (marks.length === 0) return { type: 'text', text }
    return { type: 'text', text, marks }
  })

const visibleParagraph = fc
  .array(visibleText, { minLength: 1, maxLength: 3 })
  .map((content): TiptapContent => ({ type: 'paragraph', content }))

const visibleHeading = fc
  .record({ level: fc.constantFrom(1, 2, 3), text: visibleText })
  .map(({ level, text }): TiptapContent => ({
    type: 'heading',
    attrs: { level },
    content: [text],
  }))

const visibleList = fc
  .array(visibleParagraph, { minLength: 1, maxLength: 3 })
  .map((paragraphs): TiptapContent => ({
    type: 'bulletList',
    content: paragraphs.map((paragraph) => ({ type: 'listItem', content: [paragraph] })),
  }))

const visibleBlock = fc.oneof(visibleParagraph, visibleHeading, visibleList)

const emptyBlock = fc.oneof(
  fc.constant<TiptapContent>({ type: 'paragraph' }),
  whitespace.map((text): TiptapContent => ({
    type: 'paragraph',
    content: [{ type: 'text', text }],
  })),
  fc.constant<TiptapContent>({
    type: 'bulletList',
    content: [{ type: 'listItem', content: [{ type: 'paragraph' }] }],
  })
)

/** A document a reader sees text in. */
const visibleDoc = fc
  .record({
    leading: fc.array(emptyBlock, { maxLength: 2 }),
    blocks: fc.array(visibleBlock, { minLength: 1, maxLength: 4 }),
  })
  .map(({ leading, blocks }): TiptapContent => ({ type: 'doc', content: [...leading, ...blocks] }))

/** A document a reader sees nothing in. */
const emptyDoc = fc.oneof(
  fc.constant<TiptapContent>({ type: 'doc' }),
  fc.constant<TiptapContent>({ type: 'doc', content: [] }),
  fc
    .array(emptyBlock, { minLength: 1, maxLength: 3 })
    .map((content): TiptapContent => ({ type: 'doc', content }))
)

/** Either kind, or a template that is simply not there. */
const maybeTemplate = fc.oneof(visibleDoc, emptyDoc, fc.constant(undefined))

/**
 * What the editor hands back for a document it was given: the same text, with
 * the default attributes it fills in on every block (alignment, heading ids).
 */
function asEditorEchoes(node: TiptapContent): TiptapContent {
  const echoed: TiptapContent = { ...node }
  if (node.type === 'paragraph' || node.type === 'heading') {
    echoed.attrs = { ...node.attrs, textAlign: null }
  }
  if (node.content) {
    echoed.content = node.content.map(asEditorEchoes)
  }
  return echoed
}

/** The author typed something of their own at the end of the description. */
function withAuthorText(doc: TiptapContent, typed: string): TiptapContent {
  const authorParagraph: TiptapContent = {
    type: 'paragraph',
    content: [{ type: 'text', text: typed }],
  }
  return { ...doc, content: [...(doc.content ?? []), authorParagraph] }
}

// ---------------------------------------------------------------------------

describe('which template a new post starts with', () => {
  it('uses the board template when it has visible text, whatever the workspace holds (V1)', () => {
    fc.assert(
      fc.property(visibleDoc, maybeTemplate, (boardTemplate, workspaceTemplate) => {
        expect(resolvePostTemplate(boardTemplate, workspaceTemplate)).toBe(boardTemplate)
      })
    )
  })

  it('falls back to the workspace default when the board has none (V2)', () => {
    fc.assert(
      fc.property(visibleDoc, (workspaceTemplate) => {
        expect(resolvePostTemplate(undefined, workspaceTemplate)).toBe(workspaceTemplate)
      })
    )
  })

  it('starts empty when neither exists (V3)', () => {
    expect(resolvePostTemplate(undefined, undefined)).toBeUndefined()
  })

  it('treats a board template without visible text as no template (V4)', () => {
    fc.assert(
      fc.property(emptyDoc, maybeTemplate, (boardTemplate, workspaceTemplate) => {
        const resolved = resolvePostTemplate(boardTemplate, workspaceTemplate)
        expect(resolved).toBe(resolvePostTemplate(undefined, workspaceTemplate))
      })
    )
  })

  it('treats a workspace default without visible text as no template (V4)', () => {
    fc.assert(
      fc.property(emptyDoc, emptyDoc, (boardTemplate, workspaceTemplate) => {
        expect(resolvePostTemplate(boardTemplate, workspaceTemplate)).toBeUndefined()
      })
    )
  })

  it('hands out a template exactly when one of the two has visible text (V1–V4, all branches)', () => {
    const tagged = fc.oneof(
      visibleDoc.map((doc) => ({ doc: doc as TiptapContent | undefined, visible: true })),
      emptyDoc.map((doc) => ({ doc: doc as TiptapContent | undefined, visible: false })),
      fc.constant({ doc: undefined as TiptapContent | undefined, visible: false })
    )
    fc.assert(
      fc.property(tagged, tagged, (board, workspace) => {
        const resolved = resolvePostTemplate(board.doc, workspace.doc)
        const someTemplateVisible = board.visible || workspace.visible
        expect(resolved !== undefined).toBe(someTemplateVisible)
      })
    )
  })
})

describe('whether a board switch may replace the description', () => {
  it('may replace an empty description, whichever template was there (V5)', () => {
    fc.assert(
      fc.property(emptyDoc, maybeTemplate, (description, insertedTemplate) => {
        expect(mayReplaceDescription(description, insertedTemplate)).toBe(true)
        expect(mayReplaceDescription(null, insertedTemplate)).toBe(true)
      })
    )
  })

  it('may replace a template the author left untouched, as the editor echoes it (V5)', () => {
    fc.assert(
      fc.property(visibleDoc, (template) => {
        expect(mayReplaceDescription(asEditorEchoes(template), template)).toBe(true)
      })
    )
  })

  it('never replaces a description the author added text to (V5)', () => {
    fc.assert(
      fc.property(visibleDoc, visibleWord, (template, typed) => {
        const edited = withAuthorText(asEditorEchoes(template), typed)
        expect(mayReplaceDescription(edited, template)).toBe(false)
      })
    )
  })

  it('never replaces text written where no template was inserted (V5)', () => {
    fc.assert(
      fc.property(visibleDoc, (written) => {
        expect(mayReplaceDescription(written, undefined)).toBe(false)
      })
    )
  })

  it('never replaces a description whose words differ from the template (V5)', () => {
    fc.assert(
      fc.property(visibleDoc, visibleDoc, (template, written) => {
        fc.pre(!hasSameVisibleContent(template, written))
        expect(mayReplaceDescription(written, template)).toBe(false)
      })
    )
  })

  it('treats a changed mark as the author changing the description (V5)', () => {
    const template: TiptapContent = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Steps' }] }],
    }
    const emphasised: TiptapContent = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'Steps', marks: [{ type: 'bold' }] }],
        },
      ],
    }
    expect(mayReplaceDescription(emphasised, template)).toBe(false)
  })

  it('treats swapping one mark for another as the author changing the description (V5)', () => {
    function stepsMarked(markType: string): TiptapContent {
      return {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'Steps', marks: [{ type: markType }] }],
          },
        ],
      }
    }
    expect(mayReplaceDescription(stepsMarked('italic'), stepsMarked('bold'))).toBe(false)
  })

  it('reads marks regardless of their order (V5)', () => {
    const boldItalic: TiptapContent = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'x', marks: [{ type: 'bold' }, { type: 'italic' }] }],
        },
      ],
    }
    const italicBold: TiptapContent = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'x', marks: [{ type: 'italic' }, { type: 'bold' }] }],
        },
      ],
    }
    expect(hasSameVisibleContent(boldItalic, italicBold)).toBe(true)
  })

  it('tells a heading from a paragraph with the same words (V5)', () => {
    const asParagraph: TiptapContent = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Steps' }] }],
    }
    const asHeading: TiptapContent = {
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Steps' }] },
      ],
    }
    expect(hasSameVisibleContent(asParagraph, asHeading)).toBe(false)
  })
})

describe('what counts as the same visible content', () => {
  /** The same document, with every absent list written out as an empty one. */
  function withEmptyListsSpelledOut(node: TiptapContent): TiptapContent {
    const spelled: TiptapContent = { ...node, marks: node.marks ?? [] }
    spelled.content = (node.content ?? []).map(withEmptyListsSpelledOut)
    return spelled
  }

  it('reads an absent mark or child list like an empty one (V5)', () => {
    fc.assert(
      fc.property(visibleDoc, (template) => {
        const spelledOut = withEmptyListsSpelledOut(template)
        expect(mayReplaceDescription(spelledOut, template)).toBe(true)
        expect(hasSameVisibleContent(template, spelledOut)).toBe(true)
      })
    )
  })
})

describe('the size limit on a saved template', () => {
  function docOfLength(textLength: number): TiptapContent {
    return {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'a'.repeat(textLength) }] }],
    }
  }
  const wrapperLength = JSON.stringify(docOfLength(0)).length

  it('accepts a template exactly at the limit, unchanged (V12)', () => {
    const atLimit = docOfLength(POST_TEMPLATE_MAX_LENGTH - wrapperLength)
    expect(JSON.stringify(atLimit).length).toBe(POST_TEMPLATE_MAX_LENGTH)
    const parsed = postTemplateSchema.safeParse(atLimit)
    expect(parsed.success).toBe(true)
    expect(parsed.data).toEqual(atLimit)
  })

  it('rejects a template one character over the limit with a clear message (V12)', () => {
    const overLimit = docOfLength(POST_TEMPLATE_MAX_LENGTH - wrapperLength + 1)
    const parsed = postTemplateSchema.safeParse(overLimit)
    expect(parsed.success).toBe(false)
    expect(parsed.error?.issues[0]?.message).toBe(POST_TEMPLATE_TOO_LONG_MESSAGE)
    expect(POST_TEMPLATE_TOO_LONG_MESSAGE).toContain(String(POST_TEMPLATE_MAX_LENGTH))
  })
})
