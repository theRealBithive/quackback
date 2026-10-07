// @vitest-environment happy-dom
/**
 * The prefill a post form runs as its board changes. The contract is listed
 * in full in `lib/shared/__tests__/post-template.test.ts`; this suite holds
 * the parts that only exist in a live form:
 *
 *   V1  A board with its own template prefills the description with that template.
 *   V3  With neither, the description starts empty — exactly today's behaviour.
 *   V5  Switching boards replaces the description only while the author has not
 *       changed it; once they have typed, a board switch never discards their text.
 *   V7  After a successful submit or cancel, the next empty form starts again
 *       with the template of the selected board.
 */
import { describe, it, expect } from 'vitest'
import { useState } from 'react'
import { act, renderHook } from '@testing-library/react'
import type { TiptapContent } from '@/lib/shared/db-types'
import { usePostTemplatePrefill } from '../use-post-template-prefill'

function docSaying(text: string): TiptapContent {
  return { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] }
}

const BUG_TEMPLATE = docSaying('Steps to reproduce:')
const IDEA_TEMPLATE = docSaying('What would this help you do?')

/** What the editor emits for a document it was handed: same words, default attributes. */
function editorEcho(doc: TiptapContent): TiptapContent {
  return {
    type: 'doc',
    content: (doc.content ?? []).map((block) => ({ ...block, attrs: { textAlign: null } })),
  }
}

function renderForm(initialTemplate: TiptapContent | undefined) {
  return renderHook(
    ({ template }: { template: TiptapContent | undefined }) => {
      const [description, setDescription] = useState<TiptapContent | null>(null)
      const prefill = usePostTemplatePrefill({ template, description, setDescription })
      return { description, setDescription, reset: prefill.reset }
    },
    { initialProps: { template: initialTemplate } }
  )
}

describe('a post form prefilling its description', () => {
  it('starts with the selected board template (V1)', () => {
    const form = renderForm(BUG_TEMPLATE)
    expect(form.result.current.description).toEqual(BUG_TEMPLATE)
  })

  it('starts empty when there is no template (V3)', () => {
    const form = renderForm(undefined)
    expect(form.result.current.description).toBeNull()
  })

  it('swaps an untouched template for the next board template (V5)', () => {
    const form = renderForm(BUG_TEMPLATE)
    act(() => form.result.current.setDescription(editorEcho(BUG_TEMPLATE)))

    form.rerender({ template: IDEA_TEMPLATE })

    expect(form.result.current.description).toEqual(IDEA_TEMPLATE)
  })

  it('clears an untouched template when the next board has none (V5, V3)', () => {
    const form = renderForm(BUG_TEMPLATE)
    form.rerender({ template: undefined })
    expect(form.result.current.description).toBeNull()
  })

  it('keeps what the author typed when the board changes (V5)', () => {
    const form = renderForm(BUG_TEMPLATE)
    const typed = docSaying('Steps to reproduce: click save twice')
    act(() => form.result.current.setDescription(typed))

    form.rerender({ template: IDEA_TEMPLATE })
    expect(form.result.current.description).toEqual(typed)

    form.rerender({ template: undefined })
    expect(form.result.current.description).toEqual(typed)
  })

  it('keeps text typed on a board without a template when a templated board is picked (V5)', () => {
    const form = renderForm(undefined)
    const typed = docSaying('The export is broken')
    act(() => form.result.current.setDescription(typed))

    form.rerender({ template: BUG_TEMPLATE })

    expect(form.result.current.description).toEqual(typed)
  })

  it('keeps typed text when the same template arrives again as a new object (V5)', () => {
    const form = renderForm(BUG_TEMPLATE)
    const typed = docSaying('Steps to reproduce: open it')
    act(() => form.result.current.setDescription(typed))

    form.rerender({ template: structuredClone(BUG_TEMPLATE) })

    expect(form.result.current.description).toEqual(typed)
  })

  it('prefills again once the author has emptied the description (V5)', () => {
    const form = renderForm(BUG_TEMPLATE)
    act(() => form.result.current.setDescription(docSaying('mine')))
    form.rerender({ template: IDEA_TEMPLATE })
    act(() => form.result.current.setDescription({ type: 'doc', content: [{ type: 'paragraph' }] }))

    form.rerender({ template: BUG_TEMPLATE })

    expect(form.result.current.description).toEqual(BUG_TEMPLATE)
  })

  it('starts the next post with the template again after a reset (V7)', () => {
    const form = renderForm(BUG_TEMPLATE)
    act(() => form.result.current.setDescription(docSaying('Steps to reproduce: done')))

    act(() => form.result.current.reset())

    expect(form.result.current.description).toEqual(BUG_TEMPLATE)
  })

  it('treats the template restored by a reset as untouched (V7, V5)', () => {
    const form = renderForm(BUG_TEMPLATE)
    act(() => form.result.current.setDescription(docSaying('typed on the bug board')))
    form.rerender({ template: IDEA_TEMPLATE })
    act(() => form.result.current.reset())
    expect(form.result.current.description).toEqual(IDEA_TEMPLATE)

    form.rerender({ template: BUG_TEMPLATE })

    expect(form.result.current.description).toEqual(BUG_TEMPLATE)
  })

  it('resets to empty when the selected board has no template (V7, V3)', () => {
    const form = renderForm(undefined)
    act(() => form.result.current.setDescription(docSaying('posted')))

    act(() => form.result.current.reset())

    expect(form.result.current.description).toBeNull()
  })
})
