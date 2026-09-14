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
 * This module holds C7. The four tests here that carry no number predate the
 * contract and pin the lift's other halves (dropping a hostile src, the
 * attachment cap, and reference identity when nothing is lifted); group C
 * states no guarantee about those.
 */
import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import { liftInlineImagesToAttachments } from '../lift-inline-images'
import { MAX_CONVERSATION_ATTACHMENTS } from '../types'
import type { ConversationAttachment } from '../types'

const png = (url: string, extra?: Partial<ConversationAttachment>): ConversationAttachment => ({
  url,
  name: extra?.name ?? 'shot.png',
  contentType: extra?.contentType ?? 'image/png',
  size: extra?.size ?? 10,
})

describe('liftInlineImagesToAttachments', () => {
  it('returns contentJson null for a missing doc', () => {
    const attachments: ConversationAttachment[] = []
    expect(liftInlineImagesToAttachments(null, attachments)).toEqual({
      contentJson: null,
      attachments,
    })
    expect(liftInlineImagesToAttachments(undefined, attachments)).toEqual({
      contentJson: null,
      attachments,
    })
  })

  it('returns the same references when the doc has no images', () => {
    const attachments: ConversationAttachment[] = []
    const doc = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'hi' }] }],
    }
    const result = liftInlineImagesToAttachments(doc, attachments)
    expect(result.contentJson).toBe(doc)
    expect(result.attachments).toBe(attachments)
  })

  it('lifts a square 500×500 resizableImage onto attachments and strips the node (C7)', () => {
    const result = liftInlineImagesToAttachments(
      {
        type: 'doc',
        content: [
          {
            type: 'resizableImage',
            attrs: {
              src: 'https://cdn.example.com/shot.png',
              alt: 'Install page',
              width: 500,
              height: 500,
            },
          },
        ],
      },
      []
    )
    expect(result.attachments).toEqual([
      {
        url: 'https://cdn.example.com/shot.png',
        name: 'Install page',
        contentType: 'image/png',
        size: 0,
      },
    ])
    expect(result.contentJson).toEqual({ type: 'doc', content: [] })
  })

  it('lifts chatImage and image nodes, keeps surrounding text, and dedupes by URL (C7)', () => {
    const existing = [png('https://cdn.example.com/a.png')]
    const result = liftInlineImagesToAttachments(
      {
        type: 'doc',
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: 'hi' }] },
          { type: 'chatImage', attrs: { src: 'https://cdn.example.com/a.png', alt: 'dup' } },
          { type: 'image', attrs: { src: 'https://cdn.example.com/b.jpg' } },
        ],
      },
      existing
    )
    expect(result.attachments).toEqual([
      existing[0],
      {
        url: 'https://cdn.example.com/b.jpg',
        name: 'b.jpg',
        contentType: 'image/jpeg',
        size: 0,
      },
    ])
    expect(result.contentJson).toEqual({
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'hi' }] }],
    })
  })

  it('strips a javascript: image without attaching it', () => {
    const result = liftInlineImagesToAttachments(
      {
        type: 'doc',
        content: [{ type: 'image', attrs: { src: 'javascript:alert(1)' } }],
      },
      []
    )
    expect(result.attachments).toEqual([])
    expect(result.contentJson).toEqual({ type: 'doc', content: [] })
  })

  it('does not exceed MAX_CONVERSATION_ATTACHMENTS', () => {
    const existing = Array.from({ length: MAX_CONVERSATION_ATTACHMENTS }, (_, i) =>
      png(`https://cdn.example.com/${i}.png`)
    )
    const result = liftInlineImagesToAttachments(
      {
        type: 'doc',
        content: [{ type: 'image', attrs: { src: 'https://cdn.example.com/overflow.png' } }],
      },
      existing
    )
    expect(result.attachments).toBe(existing)
    expect(result.contentJson).toEqual({ type: 'doc', content: [] })
  })
})

describe('the content type and name a lifted image gets', () => {
  /** The extensions the lift claims to recognise, and what each one means. */
  const KNOWN_EXTENSIONS: Record<string, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    avif: 'image/avif',
  }

  /**
   * Extensions outside that set. Stated up front rather than filtered out of a
   * random generator: none of them ends in a known extension, so the property
   * below says "anything else" without needing a counterexample removed later.
   */
  const UNKNOWN_EXTENSIONS = ['pdf', 'txt', 'tiff', 'heic', 'bmp', 'zip', 'pngx', 'jpg2']

  /** Lift a single stored inline image and hand back the attachment it became. */
  function liftOne(src: string): ConversationAttachment {
    const result = liftInlineImagesToAttachments(
      { type: 'doc', content: [{ type: 'image', attrs: { src } }] },
      []
    )
    expect(result.attachments).toHaveLength(1)
    return result.attachments[0]!
  }

  it('reads gif, webp and avif off the extension (C7)', () => {
    expect(liftOne('https://cdn.example.com/loop.gif').contentType).toBe('image/gif')
    expect(liftOne('https://cdn.example.com/shot.webp').contentType).toBe('image/webp')
    expect(liftOne('https://cdn.example.com/shot.avif').contentType).toBe('image/avif')
  })

  it('falls back to image/* for an extension it does not know (C7)', () => {
    expect(liftOne('https://cdn.example.com/scan.tiff').contentType).toBe('image/*')
    expect(liftOne('https://cdn.example.com/no-extension').contentType).toBe('image/*')
  })

  it('reads the extension regardless of case (C7)', () => {
    expect(liftOne('https://cdn.example.com/SHOT.WEBP').contentType).toBe('image/webp')
  })

  it('names the attachment "image" when the URL cannot be read back (C7)', () => {
    // A malformed percent escape survives sanitizing — it is a well-formed
    // https URL — and only blows up when the file name is decoded out of it.
    const attachment = liftOne('https://cdn.example.com/%zz')
    expect(attachment.name).toBe('image')
    expect(attachment.url).toBe('https://cdn.example.com/%zz')
  })

  it('takes an explicit alt over the URL even when the URL is unreadable (C7)', () => {
    const result = liftInlineImagesToAttachments(
      {
        type: 'doc',
        content: [{ type: 'image', attrs: { src: 'https://cdn.example.com/%zz', alt: 'Login' } }],
      },
      []
    )
    expect(result.attachments[0]!.name).toBe('Login')
  })

  it('reads any known extension off any path, and names the file after it (C7)', () => {
    fc.assert(
      fc.property(
        fc.stringMatching(/^[a-z0-9][a-z0-9_-]{0,11}$/),
        fc.stringMatching(/^[a-z0-9][a-z0-9_-]{0,11}$/),
        fc.constantFrom(...Object.keys(KNOWN_EXTENSIONS)),
        (directory, base, extension) => {
          const attachment = liftOne(`https://cdn.example.com/${directory}/${base}.${extension}`)
          expect(attachment.contentType).toBe(KNOWN_EXTENSIONS[extension])
          expect(attachment.name).toBe(`${base}.${extension}`)
        }
      ),
      { numRuns: 200 }
    )
  })

  it('reads image/* for any extension outside that set (C7)', () => {
    fc.assert(
      fc.property(
        fc.stringMatching(/^[a-z0-9][a-z0-9_-]{0,11}$/),
        fc.constantFrom(...UNKNOWN_EXTENSIONS),
        (base, extension) => {
          expect(liftOne(`https://cdn.example.com/${base}.${extension}`).contentType).toBe(
            'image/*'
          )
        }
      ),
      { numRuns: 200 }
    )
  })

  it('lets nothing after the "?" change the content type (C7)', () => {
    // Non-interference: a signed-URL query is not part of the file name, even
    // when it happens to contain something that looks like an extension.
    fc.assert(
      fc.property(
        fc.stringMatching(/^[a-z0-9][a-z0-9_-]{0,11}$/),
        fc.constantFrom(...Object.keys(KNOWN_EXTENSIONS), ...UNKNOWN_EXTENSIONS),
        fc.stringMatching(/^[a-zA-Z0-9=&._-]{1,20}$/),
        (base, extension, query) => {
          const plain = liftOne(`https://cdn.example.com/${base}.${extension}`)
          const queried = liftOne(`https://cdn.example.com/${base}.${extension}?${query}`)
          expect(queried.contentType).toBe(plain.contentType)
        }
      ),
      { numRuns: 200 }
    )
  })
})
