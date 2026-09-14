// @vitest-environment happy-dom
/**
 * Tests for mention rendering in generateContentHTML and RichTextContent.
 *
 *  - generateContentHTML emits a styled <span class="mention"> with
 *    data-principal-id and data-display-name attrs.
 *  - Attribute values are HTML-escaped so they survive a malicious label
 *    without breaking out of the attribute.
 *  - RichTextContent runs the output through DOMPurify on the client. The
 *    allow-list must include both data attributes so the hover-card overlay
 *    can resolve the chip by principalId.
 *
 * The mounted-editor tests at the end of the file answer for two upstream
 * promises. The tests above them predate both and carry no number.
 *
 * C6 An image inserted into a post or changelog entry keeps its natural aspect:
 *    the node carries the natural size scaled to the editor's bounds plus
 *    keep-ratio; when the size cannot be read, only src and keep-ratio are set.
 *
 * E1 Enter in a comment inserts a line break and never submits the surrounding
 *    form; the submit button still does.
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import type { JSONContent } from '@tiptap/core'
import { renderWithIntl } from '@/test/render-with-intl'
import enMessages from '@/locales/en.json'
import { COMMENT_EDITOR_FEATURES } from '@/components/public/comment-editor-features'
import { generateContentHTML, RichTextContent, RichTextEditor } from '../rich-text-editor'

const english = enMessages as Record<string, string>

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))

describe('generateContentHTML — mention nodes', () => {
  it('emits styled span with data attributes for mention nodes', () => {
    const html = generateContentHTML({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Hi ' },
            { type: 'mention', attrs: { id: 'principal_jane', label: 'Jane Doe' } },
          ],
        },
      ],
    })
    expect(html).toContain('class="mention"')
    expect(html).toContain('data-principal-id="principal_jane"')
    expect(html).toContain('data-display-name="Jane Doe"')
    expect(html).toContain('@Jane Doe')
  })

  it('escapes attribute values to prevent injection', () => {
    const html = generateContentHTML({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'mention',
              attrs: { id: 'principal_x', label: 'Evil"><script>x</script>' },
            },
          ],
        },
      ],
    })
    expect(html).not.toContain('<script>')
    expect(html).toContain('&quot;')
    expect(html).toContain('&lt;script&gt;')
  })

  it('skips mention nodes that have no id', () => {
    const html = generateContentHTML({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'mention', attrs: { label: 'NoId' } }],
        },
      ],
    })
    expect(html).not.toContain('class="mention"')
  })
})

describe('RichTextContent — mention chip survives DOMPurify', () => {
  it('retains data-principal-id and data-display-name after sanitization', () => {
    const doc: JSONContent = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'mention', attrs: { id: 'principal_x', label: 'X' } }],
        },
      ],
    }
    const { container } = render(<RichTextContent content={doc} />)
    const chip = container.querySelector('.mention') as HTMLElement | null
    expect(chip).not.toBeNull()
    expect(chip!.getAttribute('data-principal-id')).toBe('principal_x')
    expect(chip!.getAttribute('data-display-name')).toBe('X')
    expect(chip!.textContent).toBe('@X')
  })
})

describe('RichTextContent — embed placeholder survives DOMPurify', () => {
  it('retains data-quackback-embed/kind/id after sanitization', () => {
    const doc: JSONContent = {
      type: 'doc',
      content: [
        {
          type: 'quackbackEmbed',
          attrs: { kind: 'post', id: 'post_01ktjwt5tyf6br9mw521h13n6n' },
        },
      ],
    }
    const { container } = render(<RichTextContent content={doc} />)
    const placeholder = container.querySelector('[data-quackback-embed]') as HTMLElement | null
    expect(placeholder).not.toBeNull()
    expect(placeholder!.getAttribute('data-kind')).toBe('post')
    expect(placeholder!.getAttribute('data-id')).toBe('post_01ktjwt5tyf6br9mw521h13n6n')
  })
})

/**
 * Make `new Image()` settle, because nothing in a test environment loads one:
 * without this the promise inside `resizableImageInsertAttrs` never settles and
 * every insert path that awaits it hangs instead of failing.
 */
function stubImageLoading(naturalWidth: number, naturalHeight: number): () => void {
  const realCreateObjectURL = URL.createObjectURL
  const realRevokeObjectURL = URL.revokeObjectURL
  let nextUrl = 0

  class StubImage {
    onload: (() => void) | null = null
    onerror: (() => void) | null = null
    naturalWidth = 0
    naturalHeight = 0

    set src(_value: string) {
      queueMicrotask(() => {
        this.naturalWidth = naturalWidth
        this.naturalHeight = naturalHeight
        this.onload?.()
      })
    }
  }

  vi.stubGlobal('Image', StubImage)
  URL.createObjectURL = () => `blob:stub/${nextUrl++}`
  URL.revokeObjectURL = () => {}

  return () => {
    vi.unstubAllGlobals()
    URL.createObjectURL = realCreateObjectURL
    URL.revokeObjectURL = realRevokeObjectURL
  }
}

function screenshotFile(): File {
  return new File([new Uint8Array([1, 2, 3])], 'shot.png', { type: 'image/png' })
}

/** Every image node in a document the editor emitted, whatever it called it. */
function imageNodesIn(doc: JSONContent | undefined): JSONContent[] {
  if (!doc) return []
  const found: JSONContent[] = []
  const walk = (node: JSONContent) => {
    if (node.type === 'image' || node.type === 'resizableImage') found.push(node)
    node.content?.forEach(walk)
  }
  walk(doc)
  return found
}

describe('RichTextEditor — an uploaded image keeps its natural aspect', () => {
  afterEach(cleanup)

  it('the toolbar’s image button inserts the measured, scaled, ratio-keeping node (C6)', async () => {
    const restore = stubImageLoading(1920, 1080)
    const pickers: HTMLInputElement[] = []
    const realCreateElement = document.createElement.bind(document)
    const createElement = vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const element = realCreateElement(tag)
      if (tag === 'input') pickers.push(element as HTMLInputElement)
      return element
    })
    const documents: JSONContent[] = []

    renderWithIntl(
      <RichTextEditor
        value={undefined}
        onChange={(json) => documents.push(json as JSONContent)}
        features={{ images: true }}
        onImageUpload={async () => 'https://cdn.example.com/shot.png'}
      />
    )

    fireEvent.click(screen.getByTitle(english['ui.editor.action.insertImage']!))
    const picker = pickers.at(-1)!
    Object.defineProperty(picker, 'files', { value: [screenshotFile()], configurable: true })
    await picker.onchange?.(new Event('change'))

    createElement.mockRestore()
    await waitFor(() => expect(imageNodesIn(documents.at(-1))).toHaveLength(1))
    restore()

    expect(imageNodesIn(documents.at(-1))[0]!.attrs).toMatchObject({
      src: 'https://cdn.example.com/shot.png',
      width: 500,
      height: 281,
      'data-keep-ratio': true,
    })
  })

  it('pasting an image inserts the measured, scaled, ratio-keeping node (C6)', async () => {
    const restore = stubImageLoading(1600, 900)
    const documents: JSONContent[] = []

    renderWithIntl(
      <RichTextEditor
        value={undefined}
        onChange={(json) => documents.push(json as JSONContent)}
        features={{ images: true }}
        onImageUpload={async () => 'https://cdn.example.com/pasted.png'}
      />
    )

    const surface = document.querySelector('.ProseMirror') as HTMLElement
    const file = screenshotFile()
    fireEvent.paste(surface, {
      clipboardData: {
        files: [file],
        items: [{ kind: 'file', type: 'image/png', getAsFile: () => file }],
        types: ['Files'],
      },
    })

    await waitFor(() => expect(imageNodesIn(documents.at(-1))).toHaveLength(1))
    restore()

    expect(imageNodesIn(documents.at(-1))[0]!.attrs).toMatchObject({
      src: 'https://cdn.example.com/pasted.png',
      width: 500,
      height: 281,
      'data-keep-ratio': true,
    })
  })
})

describe('RichTextEditor — Enter inside a form', () => {
  afterEach(cleanup)

  /**
   * The comment preset inside a form, with a native keydown listener on the
   * form. Native rather than React's `onKeyDown`: React delegates from the
   * container, so a synthetic handler would not see the propagation the editor
   * is supposed to stop.
   */
  function mountInAForm() {
    const reachedTheForm = vi.fn()
    renderWithIntl(
      <form data-testid="surrounding-form">
        <RichTextEditor value={undefined} onChange={() => {}} features={COMMENT_EDITOR_FEATURES} />
      </form>
    )
    screen.getByTestId('surrounding-form').addEventListener('keydown', reachedTheForm)
    return { reachedTheForm, surface: document.querySelector('.ProseMirror') as HTMLElement }
  }

  it('keeps a plain Enter inside the editor, where it cannot reach the form (E1)', () => {
    const { reachedTheForm, surface } = mountInAForm()

    fireEvent.keyDown(surface, { key: 'Enter' })

    expect(reachedTheForm).not.toHaveBeenCalled()
  })

  it('lets the Cmd/Ctrl+Enter chord through, which is how a comment is sent (E1)', () => {
    const { reachedTheForm, surface } = mountInAForm()

    fireEvent.keyDown(surface, { key: 'Enter', ctrlKey: true })
    fireEvent.keyDown(surface, { key: 'Enter', metaKey: true })

    expect(reachedTheForm).toHaveBeenCalledTimes(2)
  })

  it('lets every other key through untouched (E1)', () => {
    const { reachedTheForm, surface } = mountInAForm()

    fireEvent.keyDown(surface, { key: 'a' })

    expect(reachedTheForm).toHaveBeenCalledOnce()
  })
})
