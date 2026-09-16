/**
 * Images in rendered post/message content: what they cost the reader before
 * they are on screen, and what shape they hold once they are.
 *
 * The fork already holds the proportions half of this in `content-html.test.ts`
 * (the `aspect-ratio: auto` property). Upstream's pick added the loading
 * attributes and, in doing so, dropped the `auto` keyword; the conflict was
 * resolved by keeping both, so this suite states the law over every image the
 * renderer can emit rather than over the one node kind upstream's snapshot
 * happens to cover.
 *
 * Contract for the batch E pick (upstream #553, `f8062929a`) — the confirmed
 * list; the whole of it is in
 * `lib/client/conversation/__tests__/reconcile-cached-thread.contract.test.ts`:
 *
 *   E10 A pasted screenshot keeps its own proportions once loaded, and an
 *       image below the fold is not fetched until it is needed.
 */
import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import { generateContentHTML } from '../content-html'

/** Every `<img …>` tag in a rendered document. */
function imageTags(html: string): string[] {
  return [...html.matchAll(/<img\b[^>]*>/g)].map((match) => match[0])
}

const IMAGE_NODE_TYPES = ['image', 'resizableImage', 'chatImage'] as const

function document(nodes: unknown[]) {
  return { type: 'doc', content: nodes } as Parameters<typeof generateContentHTML>[0]
}

describe('rendered content images (E10)', () => {
  it('never fetches an image before it is needed, whichever node produced it', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            type: fc.constantFrom(...IMAGE_NODE_TYPES),
            width: fc.option(fc.integer({ min: 1, max: 4000 }), { nil: undefined }),
            height: fc.option(fc.integer({ min: 1, max: 4000 }), { nil: undefined }),
          }),
          { minLength: 1, maxLength: 6 }
        ),
        (specs) => {
          const html = generateContentHTML(
            document(
              specs.map((spec) => ({
                type: spec.type,
                attrs: {
                  src: 'https://cdn.example.com/shot.png',
                  alt: 'a screenshot',
                  width: spec.width,
                  height: spec.height,
                },
              }))
            )
          )

          const tags = imageTags(html)
          // One tag per node, so the laws below cannot pass by rendering less.
          expect(tags).toHaveLength(specs.length)
          for (const tag of tags) {
            expect(tag).toContain('loading="lazy"')
            expect(tag).toContain('decoding="async"')
          }
        }
      ),
      { numRuns: 200 }
    )
  })

  it('reserves a stored box without pinning a screenshot to it', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 4000 }),
        fc.integer({ min: 1, max: 4000 }),
        (width, height) => {
          const html = generateContentHTML(
            document([
              {
                type: 'resizableImage',
                attrs: { src: 'https://cdn.example.com/shot.png', alt: '', width, height },
              },
            ])
          )

          // The keyword is the whole point: without it the editor's 500x500
          // default squashes a wide screenshot into a square for good.
          expect(html).toContain(`aspect-ratio: auto ${width} / ${height};`)
          expect(html).not.toMatch(/aspect-ratio:(?!\s*auto\b)/)
        }
      ),
      { numRuns: 200 }
    )
  })
})
