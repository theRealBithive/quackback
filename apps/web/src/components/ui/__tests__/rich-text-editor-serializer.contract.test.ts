/**
 * What the editor reports as markdown when its serializer fails.
 *
 * Contract for the batch F pick (upstream 395821636) -- the confirmed list
 * item this suite pins:
 *
 *   F1 A changelog entry whose editor shows content is saved, even when the
 *      markdown projection of that content is empty or the serializer failed.
 *
 * The editor half of that sentence: a serializer that throws must not stop the
 * edit from being reported, and must not leave a visible body without any
 * markdown beside it (the server reads an empty string next to an empty
 * document as "Content is required"; the client sends the document too, which
 * is pinned in the changelog dialog suite).
 */
import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import { markdownFromEditor } from '../rich-text-editor'

const failingSerializer = {
  getMarkdown: () => {
    throw new Error('unknown node')
  },
}

const lineText = fc.stringMatching(/^[a-z]{1,10}$/)

function paragraphDoc(lines: string[]) {
  return {
    type: 'doc',
    content: lines.map((line) => ({ type: 'paragraph', content: [{ type: 'text', text: line }] })),
  }
}

describe('markdownFromEditor when the serializer fails', () => {
  it('(F1) still reports the edit, with every line of the visible text', () => {
    fc.assert(
      fc.property(fc.array(lineText, { minLength: 1, maxLength: 5 }), (lines) => {
        const reported = markdownFromEditor(failingSerializer, 3, '', paragraphDoc(lines))

        expect(reported.split('\n')).toEqual(lines)
      })
    )
  })

  it('(F1) reports the successful serialization when the serializer works', () => {
    fc.assert(
      fc.property(lineText, (text) => {
        const working = { getMarkdown: () => text }

        expect(markdownFromEditor(working, 3, '', paragraphDoc(['ignored']))).toBe(text)
      })
    )
  })

  it('(F1) a document with no text reports no markdown', () => {
    const emptyDoc = { type: 'doc', content: [{ type: 'paragraph' }] }

    expect(markdownFromEditor(failingSerializer, 3, '', emptyDoc)).toBe('')
  })
})
