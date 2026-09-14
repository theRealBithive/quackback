/**
 * C — Conversation attachment tray (upstream #539)
 *
 * C1 Pasting or dropping an image into a conversation composer (new
 *    conversation, new ticket, agent reply) adds it to the attachment tray
 *    instead of inlining it; non-image files are left to the browser; a paste
 *    or drop without images changes nothing.
 * C2 The paperclip opens a file picker; chosen files land in the tray and the
 *    input resets so the same file can be chosen again.
 * C3 A message with only attachments can be sent; while an upload is in flight
 *    it cannot.
 * C4 Closing and reopening the dialog clears pending attachments.
 * C5 An upload failure is shown as a toast carrying the error's message.
 * C6 An image inserted into a post or changelog entry keeps its natural aspect:
 *    the node carries the natural size scaled to the editor's bounds plus
 *    keep-ratio; when the size cannot be read, only src and keep-ratio are set.
 * C7 A stored inline image lifted onto the tray gets its content type from the
 *    extension (png, jpg, gif, webp, avif, else `image/*`) and its name from
 *    the URL, or `image` when the URL is unreadable.
 * C8 An attachment is rendered only when safe: an image with a sanitizable URL,
 *    a same-origin path, or an http(s) URL; anything else is dropped.
 *
 * This module holds C6. The probe that reads a file's natural size is a browser
 * `Image` against an object URL, and no test environment here ever loads one —
 * so the stub below is what makes the success half of C6 reachable at all.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import fc from 'fast-check'
import { scaleImageInsertSize, resizableImageInsertAttrs } from '../resizable-image-insert-attrs'

/** The cap the module scales an insert down to. */
const MAX_INSERT_WIDTH = 500

interface ImageProbe {
  /** What the next `new Image()` does once a `src` is assigned to it. */
  outcome: { kind: 'load'; naturalWidth: number; naturalHeight: number } | { kind: 'error' }
  /** Every `src` the production code assigned, in order. */
  sources: string[]
}

/**
 * Replace `Image` and the object-URL pair for the duration of one test.
 *
 * The production code assigns `onload`/`onerror` before it assigns `src`, so
 * scheduling the callback out of the `src` setter (rather than firing it
 * synchronously) is what a real browser does and what the code expects.
 */
function installImageStub(outcome: ImageProbe['outcome']): {
  probe: ImageProbe
  created: string[]
  revoked: string[]
} {
  const probe: ImageProbe = { outcome, sources: [] }
  const created: string[] = []
  const revoked: string[] = []
  let nextUrl = 0

  class StubImage {
    onload: (() => void) | null = null
    onerror: (() => void) | null = null
    naturalWidth = 0
    naturalHeight = 0

    set src(value: string) {
      probe.sources.push(value)
      queueMicrotask(() => {
        if (probe.outcome.kind === 'load') {
          this.naturalWidth = probe.outcome.naturalWidth
          this.naturalHeight = probe.outcome.naturalHeight
          this.onload?.()
          return
        }
        this.onerror?.()
      })
    }
  }

  vi.stubGlobal('Image', StubImage)
  vi.spyOn(URL, 'createObjectURL').mockImplementation(() => {
    const url = `blob:stub/${nextUrl++}`
    created.push(url)
    return url
  })
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation((url: string) => {
    revoked.push(url)
  })

  return { probe, created, revoked }
}

function pngFile(): File {
  return new File([new Uint8Array([1, 2, 3])], 'shot.png', { type: 'image/png' })
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('scaleImageInsertSize', () => {
  it('keeps a landscape screenshot proportional under the 500px cap (C6)', () => {
    expect(scaleImageInsertSize(1920, 1080)).toEqual({ width: 500, height: 281 })
  })

  it('does not upscale a small image (C6)', () => {
    expect(scaleImageInsertSize(200, 100)).toEqual({ width: 200, height: 100 })
  })

  it('does not emit a 1:1 box for a wide image (C6)', () => {
    const { width, height } = scaleImageInsertSize(1600, 900)
    expect(width).toBe(500)
    expect(width / height).toBeCloseTo(1600 / 900, 2)
  })
})

describe('resizableImageInsertAttrs', () => {
  it('carries the measured natural size, scaled to the cap, plus keep-ratio (C6)', async () => {
    const { created, revoked, probe } = installImageStub({
      kind: 'load',
      naturalWidth: 1920,
      naturalHeight: 1080,
    })

    const attrs = await resizableImageInsertAttrs('https://cdn.example.com/shot.png', pngFile())

    expect(attrs).toEqual({
      src: 'https://cdn.example.com/shot.png',
      'data-keep-ratio': true,
      width: 500,
      height: 281,
    })
    // The probe reads the file through an object URL and hands it back.
    expect(probe.sources).toEqual(created)
    expect(revoked).toEqual(created)
  })

  it('keeps a small image at its own size rather than padding it to the cap (C6)', async () => {
    installImageStub({ kind: 'load', naturalWidth: 320, naturalHeight: 200 })

    const attrs = await resizableImageInsertAttrs('https://cdn.example.com/small.png', pngFile())

    expect(attrs).toEqual({
      src: 'https://cdn.example.com/small.png',
      'data-keep-ratio': true,
      width: 320,
      height: 200,
    })
  })

  it('falls back to src and keep-ratio when the image will not load (C6)', async () => {
    const { created, revoked } = installImageStub({ kind: 'error' })

    const attrs = await resizableImageInsertAttrs('https://cdn.example.com/broken.png', pngFile())

    expect(attrs).toEqual({
      src: 'https://cdn.example.com/broken.png',
      'data-keep-ratio': true,
    })
    // The failure path releases the object URL too — otherwise every rejected
    // paste leaks a blob for the lifetime of the tab.
    expect(revoked).toEqual(created)
  })

  it('falls back to src and keep-ratio when the natural size reads as zero (C6)', async () => {
    installImageStub({ kind: 'load', naturalWidth: 0, naturalHeight: 0 })

    const attrs = await resizableImageInsertAttrs('https://cdn.example.com/empty.png', pngFile())

    expect(attrs).toEqual({
      src: 'https://cdn.example.com/empty.png',
      'data-keep-ratio': true,
    })
  })

  /**
   * The brief asked for "keeps the natural aspect ratio within rounding". That
   * is not what the code promises and could not be: a 100000×1 image scaled to
   * 500 wide would be 0.005px high, and `Math.max(1, …)` floors it at 1 rather
   * than emit a zero-height box. Stating the ratio unconditionally would
   * therefore be red on a counterexample the implementation is right about, so
   * the property is stated as the contract actually reads — the ratio holds
   * wherever a whole pixel can express it, and the floor is named as the one
   * place it does not.
   *
   * The three invariants above the branch are unguarded: they hold on every
   * input, floor included.
   */
  it('never upscales, never exceeds the cap, and keeps the ratio a whole pixel can express (C6)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 100_000 }),
        fc.integer({ min: 1, max: 100_000 }),
        async (naturalWidth, naturalHeight) => {
          installImageStub({ kind: 'load', naturalWidth, naturalHeight })
          const attrs = await resizableImageInsertAttrs('https://cdn.example.com/x.png', pngFile())
          vi.unstubAllGlobals()
          vi.restoreAllMocks()

          const width = attrs.width!
          const height = attrs.height!

          // Unguarded: true on both branches and on the floored case.
          expect(width).toBeLessThanOrEqual(MAX_INSERT_WIDTH)
          expect(width).toBeLessThanOrEqual(naturalWidth)
          expect(height).toBeGreaterThanOrEqual(1)

          if (naturalWidth <= MAX_INSERT_WIDTH) {
            expect({ width, height }).toEqual({ width: naturalWidth, height: naturalHeight })
            return
          }
          expect(width).toBe(MAX_INSERT_WIDTH)
          const exact = (MAX_INSERT_WIDTH * naturalHeight) / naturalWidth
          const roundsToTheRatio = Math.abs(height - exact) <= 0.5
          const flooredAtOnePixel = height === 1 && exact < 1
          expect(roundsToTheRatio || flooredAtOnePixel).toBe(true)
        }
      ),
      { numRuns: 200 }
    )
  })
})
