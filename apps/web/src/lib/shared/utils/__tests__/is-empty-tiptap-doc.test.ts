import { describe, it, expect } from 'vitest'
import { isEmptyTiptapDoc } from '../is-empty-tiptap-doc'
import type { TiptapContent } from '@/lib/shared/db-types'

describe('isEmptyTiptapDoc', () => {
  it('treats undefined as empty', () => {
    expect(isEmptyTiptapDoc(undefined)).toBe(true)
  })

  it('treats a doc with no content as empty', () => {
    expect(isEmptyTiptapDoc({ type: 'doc' })).toBe(true)
  })

  it('treats a single empty paragraph as empty', () => {
    expect(isEmptyTiptapDoc({ type: 'doc', content: [{ type: 'paragraph' }] })).toBe(true)
  })

  it('treats a paragraph with only whitespace as empty', () => {
    const doc: TiptapContent = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: '   ' }],
        },
      ],
    }
    expect(isEmptyTiptapDoc(doc)).toBe(true)
  })

  it('treats a paragraph with real text as non-empty', () => {
    const doc: TiptapContent = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'hello' }],
        },
      ],
    }
    expect(isEmptyTiptapDoc(doc)).toBe(false)
  })

  it('treats a doc with an image node as non-empty', () => {
    const doc: TiptapContent = {
      type: 'doc',
      content: [{ type: 'image', attrs: { src: 'https://example.com/x.png' } }],
    }
    expect(isEmptyTiptapDoc(doc)).toBe(false)
  })

  it('treats a doc with a heading as non-empty', () => {
    const doc: TiptapContent = {
      type: 'doc',
      content: [
        {
          type: 'heading',
          attrs: { level: 2 },
          content: [{ type: 'text', text: 'Welcome' }],
        },
      ],
    }
    expect(isEmptyTiptapDoc(doc)).toBe(false)
  })

  it('treats a doc with a horizontalRule as non-empty', () => {
    const doc: TiptapContent = {
      type: 'doc',
      content: [{ type: 'horizontalRule' }],
    }
    expect(isEmptyTiptapDoc(doc)).toBe(false)
  })

  it('treats an empty bullet list as empty', () => {
    const doc: TiptapContent = {
      type: 'doc',
      content: [
        {
          type: 'bulletList',
          content: [
            {
              type: 'listItem',
              content: [{ type: 'paragraph' }],
            },
          ],
        },
      ],
    }
    expect(isEmptyTiptapDoc(doc)).toBe(true)
  })

  it('treats a bullet list with text as non-empty', () => {
    const doc: TiptapContent = {
      type: 'doc',
      content: [
        {
          type: 'bulletList',
          content: [
            {
              type: 'listItem',
              content: [
                {
                  type: 'paragraph',
                  content: [{ type: 'text', text: 'GIF per link' }],
                },
              ],
            },
          ],
        },
      ],
    }
    expect(isEmptyTiptapDoc(doc)).toBe(false)
  })

  it('treats an empty heading as empty', () => {
    const doc: TiptapContent = {
      type: 'doc',
      content: [{ type: 'heading', attrs: { level: 1 } }],
    }
    expect(isEmptyTiptapDoc(doc)).toBe(true)
  })

  it('treats an empty table shell as empty', () => {
    const doc: TiptapContent = {
      type: 'doc',
      content: [
        {
          type: 'table',
          content: [
            {
              type: 'tableRow',
              content: [{ type: 'tableCell', content: [{ type: 'paragraph' }] }],
            },
          ],
        },
      ],
    }
    expect(isEmptyTiptapDoc(doc)).toBe(true)
  })
})

describe('isEmptyTiptapDoc — every child counts, not just one', () => {
  const emptyParagraph: TiptapContent = { type: 'paragraph' }
  const image: TiptapContent = { type: 'image', attrs: { src: 'https://example.com/x.png' } }
  const wordParagraph: TiptapContent = {
    type: 'paragraph',
    content: [{ type: 'text', text: 'hello' }],
  }

  it('is not empty when an image follows an empty paragraph', () => {
    expect(isEmptyTiptapDoc({ type: 'doc', content: [emptyParagraph, image] })).toBe(false)
  })

  it('is not empty when an empty paragraph follows a paragraph with text', () => {
    expect(isEmptyTiptapDoc({ type: 'doc', content: [wordParagraph, emptyParagraph] })).toBe(false)
  })

  it('is not empty when a paragraph holds text next to whitespace', () => {
    const doc: TiptapContent = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'hello' },
            { type: 'text', text: '  ' },
          ],
        },
      ],
    }
    expect(isEmptyTiptapDoc(doc)).toBe(false)
  })

  it('is empty when a text node carries no text at all', () => {
    const doc: TiptapContent = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text' }] }],
    }
    expect(isEmptyTiptapDoc(doc)).toBe(true)
  })
})

describe('isEmptyTiptapDoc — every text block and container type', () => {
  const textBlocksAndContainers = [
    'paragraph',
    'heading',
    'blockquote',
    'bulletList',
    'orderedList',
    'listItem',
    'taskList',
    'taskItem',
    'table',
    'tableRow',
    'tableHeader',
    'tableCell',
  ]

  it.each(textBlocksAndContainers)('treats an empty %s as empty', (type) => {
    expect(isEmptyTiptapDoc({ type: 'doc', content: [{ type }] })).toBe(true)
  })

  it.each(textBlocksAndContainers)('treats a %s holding only whitespace as empty', (type) => {
    const doc: TiptapContent = {
      type: 'doc',
      content: [{ type, content: [{ type: 'text', text: ' ' }] }],
    }
    expect(isEmptyTiptapDoc(doc)).toBe(true)
  })

  it.each(textBlocksAndContainers)('treats a %s holding text as non-empty', (type) => {
    const doc: TiptapContent = {
      type: 'doc',
      content: [{ type, content: [{ type: 'text', text: 'hello' }] }],
    }
    expect(isEmptyTiptapDoc(doc)).toBe(false)
  })
})

describe('isEmptyTiptapDoc — nesting depth limit', () => {
  /** A chain of `levels` nested bullet lists whose innermost node is an empty paragraph. */
  function nestedEmptyLists(levels: number): TiptapContent {
    let node: TiptapContent = { type: 'paragraph' }
    for (let level = 0; level < levels; level++) {
      node = { type: 'bulletList', content: [node] }
    }
    return { type: 'doc', content: [node] }
  }

  it('still reads a chain whose deepest node sits at the depth limit as empty', () => {
    // 51 nodes below the doc: the deepest is at depth 50.
    expect(isEmptyTiptapDoc(nestedEmptyLists(50))).toBe(true)
  })

  it('treats a chain one level deeper as content rather than recursing further', () => {
    expect(isEmptyTiptapDoc(nestedEmptyLists(51))).toBe(false)
  })

  it('treats a pathologically deep chain as content without overflowing the stack', () => {
    expect(isEmptyTiptapDoc(nestedEmptyLists(20_000))).toBe(false)
  })
})
