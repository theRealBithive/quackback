/**
 * The pure TipTap-JSON → HTML serializer extracted from the rich-text editor so
 * it can run server-side (e.g. outbound conversation email) with no React,
 * tiptap-react, or browser globals. These pin the block/mark rendering the email
 * body relies on, and the text-node escaping that stops stored content from
 * injecting raw HTML into a recipient's inbox.
 *
 * Image dimensions. The editor stores a width and a height with every image,
 * and for a pasted screenshot those are the extension's 500x500 defaults, not
 * the picture's. The reader therefore promises:
 *
 * V1 An image is shown in its own proportions. The dimensions saved with it
 *    may reserve its space before it loads, but never stretch or squash the
 *    loaded image.
 * V2 When both dimensions were saved, the reader reserves exactly that box
 *    (width and height) before the image loads.
 * V3 When only a width was saved, the reader fixes the width and leaves the
 *    height to the image: no box is reserved and no ratio is stated.
 * V4 A saved dimension the reader does not trust (above 4096 px) counts as not
 *    saved. Stored attributes are input, and `safePositiveInt` is the bound.
 * V5 An image the reader will not show leaves nothing behind: no tag, no
 *    placeholder, whether its source was rejected or it never had one.
 * V6 An image without alternative text carries an empty alt, never invented
 *    text.
 */
import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import type { JSONContent } from '@tiptap/core'
import { generateContentHTML } from '../content-html'

describe('generateContentHTML', () => {
  it('renders paragraphs with bold and italic marks', () => {
    const html = generateContentHTML({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Hello ' },
            { type: 'text', text: 'bold', marks: [{ type: 'bold' }] },
            { type: 'text', text: ' and ' },
            { type: 'text', text: 'italic', marks: [{ type: 'italic' }] },
          ],
        },
      ],
    })
    expect(html).toBe('<p>Hello <strong>bold</strong> and <em>italic</em></p>')
  })

  it('renders bullet lists, unwrapping single-paragraph list items', () => {
    const html = generateContentHTML({
      type: 'doc',
      content: [
        {
          type: 'bulletList',
          content: [
            {
              type: 'listItem',
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'one' }] }],
            },
            {
              type: 'listItem',
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'two' }] }],
            },
          ],
        },
      ],
    })
    expect(html).toBe('<ul><li>one</li><li>two</li></ul>')
  })

  it('renders ordered lists', () => {
    const html = generateContentHTML({
      type: 'doc',
      content: [
        {
          type: 'orderedList',
          content: [
            {
              type: 'listItem',
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'first' }] }],
            },
          ],
        },
      ],
    })
    expect(html).toBe('<ol><li>first</li></ol>')
  })

  it('renders a code block, escaping its contents and carrying the language class', () => {
    const html = generateContentHTML({
      type: 'doc',
      content: [
        {
          type: 'codeBlock',
          attrs: { language: 'ts' },
          content: [{ type: 'text', text: 'const x = 1 < 2' }],
        },
      ],
    })
    expect(html).toContain('<pre')
    expect(html).toContain('class="language-ts"')
    expect(html).toContain('const x = 1 &lt; 2')
  })

  it('renders an image node with a sanitized src', () => {
    const html = generateContentHTML({
      type: 'doc',
      content: [
        {
          type: 'image',
          attrs: { src: 'https://cdn.example.com/a.png', alt: 'shot' },
        },
      ],
    })
    expect(html).toContain('<img')
    expect(html).toContain('src="https://cdn.example.com/a.png"')
    expect(html).toContain('alt="shot"')
  })

  it('drops an image with an unsafe (javascript:) src', () => {
    const html = generateContentHTML({
      type: 'doc',
      content: [{ type: 'image', attrs: { src: 'javascript:alert(1)' } }],
    })
    expect(html).not.toContain('<img')
  })

  it('renders a mention chip with escaped data attributes', () => {
    const html = generateContentHTML({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'mention', attrs: { id: 'principal_jane', label: 'Jane' } }],
        },
      ],
    })
    expect(html).toContain('class="mention"')
    expect(html).toContain('data-principal-id="principal_jane"')
    expect(html).toContain('@Jane')
  })

  it('escapes <script> in text nodes so stored content cannot inject HTML', () => {
    const html = generateContentHTML({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: '<script>alert(1)</script> & <b>x</b>' }],
        },
      ],
    })
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt; &amp; &lt;b&gt;x&lt;/b&gt;')
  })

  it('renders a combined document (paragraph + bold + list + code + image) as expected HTML', () => {
    const doc: JSONContent = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Intro ' },
            { type: 'text', text: 'strong', marks: [{ type: 'bold' }] },
          ],
        },
        {
          type: 'bulletList',
          content: [
            {
              type: 'listItem',
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'item' }] }],
            },
          ],
        },
        {
          type: 'codeBlock',
          attrs: { language: 'js' },
          content: [{ type: 'text', text: 'x()' }],
        },
        { type: 'image', attrs: { src: 'https://cdn.example.com/z.png', alt: '' } },
      ],
    }
    const html = generateContentHTML(doc)
    expect(html).toBe(
      '<p>Intro <strong>strong</strong></p>' +
        '<ul><li>item</li></ul>' +
        '<pre class="not-prose rounded-lg bg-muted p-4 overflow-x-auto"><code class="language-js">x()</code></pre>' +
        '<img src="https://cdn.example.com/z.png" alt="" class="max-w-full h-auto rounded-lg"  />'
    )
  })
})

describe('generateContentHTML image dimensions', () => {
  const doc = (attrs: Record<string, unknown>): JSONContent => ({
    type: 'doc',
    content: [
      { type: 'resizableImage', attrs: { src: 'https://cdn.example.com/shot.png', ...attrs } },
    ],
  })

  it('reserves the saved box before load and lets the image keep its own proportions (V1, V2)', () => {
    const html = generateContentHTML(doc({ width: 500, height: 500 }))
    expect(html).toContain('width="500" height="500"')
    expect(html).toContain('style="aspect-ratio: auto 500 / 500;"')
    expect(html).toContain('class="max-w-full h-auto rounded-lg"')
  })

  it('never states a ratio the browser must obey, whatever dimensions were saved (V1, V2, V4)', () => {
    // A `500 / 500` without `auto` is what squashed pasted screenshots into
    // squares. Every ratio the reader writes has to yield to the loaded image.
    //
    // The range is the extension's own maximum (16384), which reaches past the
    // reader's trust bound. The first run of this property, written as "the
    // ratio is always stated", failed at [1, 4097]: a dimension above 4096 is
    // dropped by `safePositiveInt` and the image falls back to the width-only
    // form. That bound predates this change and is deliberate input
    // validation, so the property now states it (V4) instead of asserting a
    // box the reader must not trust.
    const TRUSTED_MAX = 4096
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 16384 }),
        fc.integer({ min: 1, max: 16384 }),
        (w, h) => {
          const html = generateContentHTML(doc({ width: w, height: h }))
          // Unguarded, across both branches: no ratio without `auto`, ever.
          expect(html).not.toMatch(/aspect-ratio:(?!\s*auto\b)/)
          if (w <= TRUSTED_MAX && h <= TRUSTED_MAX) {
            expect(html).toContain(`width="${w}" height="${h}"`)
            expect(html).toContain(`aspect-ratio: auto ${w} / ${h};`)
          } else {
            expect(html).not.toContain('height=')
            expect(html).not.toContain('aspect-ratio')
          }
        }
      )
    )
  })

  it('fixes only the width when no height was saved, so the image decides its height (V3)', () => {
    const html = generateContentHTML(doc({ width: 640 }))
    expect(html).toContain('style="width:640px;"')
    expect(html).not.toContain('height=')
    expect(html).not.toContain('aspect-ratio')
  })

  it('leaves nothing behind for an image it will not show (V5)', () => {
    expect(generateContentHTML(doc({ src: 'javascript:alert(1)', width: 500, height: 500 }))).toBe(
      ''
    )
    expect(generateContentHTML({ type: 'doc', content: [{ type: 'image' }] })).toBe('')
  })

  it('gives an image without alternative text an empty alt (V6)', () => {
    expect(generateContentHTML(doc({ width: 500, height: 500 }))).toContain(' alt="" ')
  })
})
