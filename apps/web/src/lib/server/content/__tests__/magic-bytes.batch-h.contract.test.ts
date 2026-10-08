/**
 * Contract for batch H, pasted verbatim as confirmed. Every test names the
 * guarantee it pins, e.g. "(H6)".
 *
 * # Batch H contract (confirmed 2026-10-08) — upstream #566 video uploads, #568 headings
 *
 * ## V — What can be uploaded
 *
 * H1 A feedback post, a comment, the widget and the admin editors accept an MP4, WebM, MOV or M4V video in addition to images, up to 100 MB per video. Images stay limited to 5 MB.
 * H2 What a file is decides whether it is stored, not what the browser says it is: a file is stored only when its bytes are the container it claims (an MP4 family file for MP4/MOV/M4V, WebM for WebM). An AVIF or HEIC image presented as a video is refused, and so is a video presented as an image.
 * H3 A file with no type or a generic one is judged by its extension, and then still by its bytes (H2).
 * H4 A refused upload stores nothing.
 *
 * ## A — Who can upload
 *
 * H5 Nobody without a session can upload.
 * H6 An anonymous portal visitor may upload only where the workspace lets anonymous visitors post; otherwise the upload is refused, as before.
 * H7 Uploads are limited per session (20 per minute). Because an anonymous session costs nothing to mint, anonymous uploads are additionally limited per client address, so one client cannot upload 2 GB a minute by rotating sessions.
 *
 * ## P — How a stored video is shown
 *
 * H8 A video in a post plays only from the workspace's own storage. A video pointing anywhere else is removed when the post is saved, so a post can never make the reader's browser contact a third party.
 * H9 A video source that is not http(s) (data:, javascript:, …) is removed, never rendered.
 * H10 Everything a person wrote into a video's attributes (title, type) reaches the page escaped; no attribute can break out of the video element.
 * H11 A stored video's type on the page is one of the accepted video types, whatever the stored attribute said.
 * H12 Videos saved before an editor offered videos stay visible and editable in every editor, including ones that do not offer video upload.
 *
 * ## S — Serving through the storage proxy
 *
 * H13 A video served through the storage proxy can be played from any point: a single byte range is answered with exactly those bytes (206), and the whole file with 200.
 * H14 A request for several ranges at once, or a malformed range, is answered with 416, never with the whole file.
 * H15 A range outside the file is answered with 416.
 * H16 A partial answer is never stored in, or served from, the proxy cache as if it were the whole file.
 * H17 Every proxied answer carries nosniff and the stored content type, so a browser never re-interprets an upload.
 *
 * ## L — Language and composer
 *
 * H18 Every control and message the video feature adds (menu item, toolbar button, remove button, failure message) reads in the page's language, in all nine languages, the German formal.
 * H19 The public feedback composer offers headings (#568; the fork already did, kept).
 */
import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { canonicalizeVideoMime, sniffImageMime, sniffVideoMime } from '../magic-bytes'
import {
  anyRasterImage,
  ebmlDocument,
  ebmlHeader,
  ebmlWithoutDocType,
  ftypBox,
  isoMediaImage,
  isoMediaVideo,
} from './media-container-arbitraries'

const MP4_FAMILY_TYPES = ['video/mp4', 'video/quicktime', 'video/x-m4v', 'video/m4v']

describe('what the bytes are decides the container (H2)', () => {
  it('reads an ISO media file with only video brands as the MP4 family (H2)', async () => {
    await fc.assert(
      fc.property(isoMediaVideo, (bytes) => {
        expect(sniffVideoMime(bytes)).toBe('video/mp4')
      })
    )
  })

  it('never reads an AVIF or HEIC image as a video, wherever it names its brand (H2)', async () => {
    await fc.assert(
      fc.property(isoMediaImage, (bytes) => {
        expect(sniffVideoMime(bytes)).toBeNull()
      })
    )
  })

  it('reads an EBML document as WebM only when its DocType is webm (H2)', async () => {
    await fc.assert(
      fc.property(ebmlDocument('webm'), (bytes) => {
        expect(sniffVideoMime(bytes)).toBe('video/webm')
      })
    )
    await fc.assert(
      fc.property(ebmlDocument('matroska'), (bytes) => {
        expect(sniffVideoMime(bytes)).toBeNull()
      })
    )
  })

  it('does not take a bare EBML magic, with no DocType to read, for WebM (H2)', () => {
    expect(sniffVideoMime(Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0]))).toBeNull()
    expect(sniffVideoMime(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))).toBeNull()
  })

  it('does not take an EBML header that names no DocType for WebM (H2)', async () => {
    await fc.assert(
      fc.property(ebmlWithoutDocType, (bytes) => {
        expect(sniffVideoMime(bytes)).toBeNull()
      })
    )
  })

  it('reads the DocType whatever width its sizes are written in (H2)', () => {
    for (let width = 1; width <= 8; width++) {
      expect(sniffVideoMime(Buffer.from(ebmlHeader('webm', [], width))), `width ${width}`).toBe(
        'video/webm'
      )
      expect(
        sniffVideoMime(Buffer.from(ebmlHeader('matroska', [], width))),
        `width ${width}`
      ).toBeNull()
    }
  })

  it('does not read a DocType past the end of a truncated header (H2)', () => {
    const complete = ebmlHeader('webm')
    for (let length = 4; length < complete.length; length++) {
      expect(sniffVideoMime(Buffer.from(complete.slice(0, length))), `length ${length}`).toBeNull()
    }
    expect(sniffVideoMime(Buffer.from(complete))).toBe('video/webm')
  })

  it('does not read compatible brands beyond the ftyp box it was given (H2)', () => {
    // The box claims 16 bytes, so the "avif" after it is the next box's data,
    // not a brand of this file; the file is a video.
    const box = ftypBox('isom', [])
    const bytes = Buffer.from([...box, ...Buffer.from('avif')])
    expect(sniffVideoMime(bytes)).toBe('video/mp4')
    // A box that claims more bytes than the buffer holds stops at the buffer.
    const truncated = Buffer.from(ftypBox('MA1B', ['avif']).slice(0, 18))
    expect(() => sniffVideoMime(truncated)).not.toThrow()
  })

  it('does not take a header behind any other magic for WebM (H2)', () => {
    const header = ebmlHeader('webm')
    for (let index = 0; index < 4; index++) {
      const altered = [...header]
      altered[index] = altered[index] ^ 0x01
      expect(sniffVideoMime(Buffer.from(altered)), `byte ${index}`).toBeNull()
    }
  })

  it('does not read a header whose elements are malformed (H2)', () => {
    const docType = [0x42, 0x82, 0x84, ...Buffer.from('webm')]
    const withBody = (body: number[]) =>
      Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x80 | body.length, ...body])
    // An element id of 0x00 has no length marker.
    expect(sniffVideoMime(withBody([0x00, 0x81, 0x01, ...docType]))).toBeNull()
    // An element size of 0x00 has no length marker either.
    expect(sniffVideoMime(withBody([0x42, 0x86, 0x00, ...docType]))).toBeNull()
    // A header size of 0x00 is no size at all.
    expect(sniffVideoMime(Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x00, ...docType]))).toBeNull()
    // An element whose payload runs past the header's end.
    expect(sniffVideoMime(withBody([0x42, 0x86, 0x8f, 0x01, ...docType]))).toBeNull()
    // An id that runs past the header's end.
    expect(sniffVideoMime(withBody([...docType, 0x10]))).toBe('video/webm')
    expect(sniffVideoMime(withBody([0x10, 0x00, ...docType]))).toBeNull()
    // The DocType sitting right at the end of the header is read.
    expect(sniffVideoMime(withBody(docType))).toBe('video/webm')
  })

  it('does not trust a header that claims more bytes than the file holds (H2)', () => {
    // The DocType comes first and is complete, but the header it belongs to is cut short.
    const docType = [0x42, 0x82, 0x84, ...Buffer.from('webm')]
    const sibling = [0x42, 0x86, 0x81, 0x01]
    const body = [...docType, ...sibling]
    const complete = [0x1a, 0x45, 0xdf, 0xa3, 0x80 | body.length, ...body]
    expect(sniffVideoMime(Buffer.from(complete))).toBe('video/webm')
    expect(sniffVideoMime(Buffer.from(complete.slice(0, complete.length - 1)))).toBeNull()
  })

  it('does not read a DocType whose value runs past the header it belongs to (H2)', () => {
    const docType = [0x42, 0x82, 0x84, ...Buffer.from('webm')]
    // The header claims one byte less than its DocType element needs; the
    // missing byte is there, but it belongs to whatever follows the header.
    const bytes = [0x1a, 0x45, 0xdf, 0xa3, 0x80 | (docType.length - 1), ...docType]
    expect(sniffVideoMime(Buffer.from(bytes))).toBeNull()
  })

  it('does not read a file shorter than the EBML magic as WebM (H2)', () => {
    expect(sniffVideoMime(Buffer.from([0x1a, 0x45, 0xdf]))).toBeNull()
    expect(sniffVideoMime(Buffer.from([]))).toBeNull()
  })

  it('needs a whole ftyp box before it calls a file a video (H2)', () => {
    const box = ftypBox('isom', [])
    expect(box).toHaveLength(16)
    expect(sniffVideoMime(Buffer.from(box))).toBe('video/mp4')
    for (let length = 8; length < 16; length++) {
      expect(sniffVideoMime(Buffer.from(box.slice(0, length))), `length ${length}`).toBeNull()
    }
    const notFtyp = [...box]
    notFtyp[4] = 0x67 // 'g' instead of 'f'
    expect(sniffVideoMime(Buffer.from(notFtyp))).toBeNull()
  })

  it('identifies a still image only from a whole signature (H2)', () => {
    const ascii = (text: string) => [...Buffer.from(text, 'latin1')]
    expect(sniffImageMime(Buffer.from([0xff, 0xd8, 0xff]))).toBeNull()
    expect(sniffImageMime(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]))).toBe('image/jpeg')
    expect(sniffImageMime(Buffer.from([...ascii('RIFF'), 0, 0, 0, 0, ...ascii('WEBP')]))).toBe(
      'image/webp'
    )
    expect(sniffImageMime(Buffer.from([...ascii('RIFX'), 0, 0, 0, 0, ...ascii('WEBP')]))).toBeNull()
    expect(sniffImageMime(Buffer.from([...ascii('RIFF'), 0, 0, 0, 0, ...ascii('WAVE')]))).toBeNull()
    expect(sniffImageMime(Buffer.from([...ascii('RIFF'), 0, 0, 0, 0, ...ascii('WEB')]))).toBeNull()
    expect(sniffImageMime(Buffer.from([0, 0, 0, 12, ...ascii('ftypavif')]))).toBe('image/avif')
    expect(sniffImageMime(Buffer.from([0, 0, 0, 12, ...ascii('ftypavis')]))).toBe('image/avif')
    expect(sniffImageMime(Buffer.from([0, 0, 0, 12, ...ascii('xtypavif')]))).toBeNull()
    expect(sniffImageMime(Buffer.from([0, 0, 0, 12, ...ascii('ftypmp42')]))).toBeNull()
  })

  it('never reads a still image as a video, nor a video as a still image (H2)', async () => {
    await fc.assert(
      fc.property(anyRasterImage, ({ type, bytes }) => {
        expect(sniffImageMime(bytes)).toBe(type)
        expect(sniffVideoMime(bytes)).toBeNull()
      })
    )
    await fc.assert(
      fc.property(fc.oneof(isoMediaVideo, ebmlDocument('webm')), (bytes) => {
        expect(sniffImageMime(bytes)).toBeNull()
      })
    )
  })

  it('compares every declared MP4-family type against the MP4 container and WebM against WebM (H2)', () => {
    for (const type of MP4_FAMILY_TYPES) expect(canonicalizeVideoMime(type), type).toBe('video/mp4')
    expect(canonicalizeVideoMime('video/webm')).toBe('video/webm')
    for (const type of ['image/png', 'video/x-matroska', 'video/ogg', '', 'video/mp4 ']) {
      expect(canonicalizeVideoMime(type), type).toBeNull()
    }
  })
})
