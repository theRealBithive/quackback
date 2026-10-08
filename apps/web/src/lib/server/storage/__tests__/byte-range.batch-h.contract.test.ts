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
import { isSingleByteRange } from '../byte-range'

const position = fc.bigInt({ min: 0n, max: 10n ** 30n })

describe('the Range headers the proxy passes on (H13, H14, H15)', () => {
  it('passes on one well-formed byte range in each of its three forms (H13)', async () => {
    await fc.assert(
      fc.property(position, position, (a, b) => {
        const first = a < b ? a : b
        const last = a < b ? b : a
        expect(isSingleByteRange(`bytes=${first}-${last}`)).toBe(true)
        expect(isSingleByteRange(`bytes=${first}-`)).toBe(true)
      })
    )
    await fc.assert(
      fc.property(fc.bigInt({ min: 1n, max: 10n ** 30n }), (length) => {
        expect(isSingleByteRange(`bytes=-${length}`)).toBe(true)
      })
    )
    expect(isSingleByteRange('bytes=0-0')).toBe(true)
    expect(isSingleByteRange('bytes=12-')).toBe(true)
    expect(isSingleByteRange('bytes=-12')).toBe(true)
    expect(isSingleByteRange('bytes=12-34')).toBe(true)
    expect(isSingleByteRange('bytes=7-7')).toBe(true)
  })

  it('refuses an inverted range, compared exactly however long the positions are (H14)', async () => {
    await fc.assert(
      fc.property(position, fc.bigInt({ min: 1n, max: 10n ** 6n }), (last, gap) => {
        expect(isSingleByteRange(`bytes=${last + gap}-${last}`)).toBe(false)
      })
    )
    // Equal as floating point, different as integers.
    expect(isSingleByteRange('bytes=9007199254740993-9007199254740992')).toBe(false)
    expect(isSingleByteRange('bytes=9007199254740992-9007199254740993')).toBe(true)
  })

  it('refuses several ranges, an empty one, and anything not a byte range (H14)', () => {
    for (const header of [
      'bytes=0-1,4-5',
      'bytes=0-1,',
      'bytes=',
      'bytes=-',
      'bytes=--1',
      'bytes= 0-1',
      'bytes=0 -1',
      'Bytes=0-1',
      'items=0-1',
      'bytes=a-b',
      'bytes=1.5-2',
      'xbytes=0-1',
      'bytes=0-1x',
      '0-1',
      '',
      'bytes=-5,',
      'bytes=-5 1',
      'abytes=-5',
      'bytes=--5',
      'bytes=5-x',
      'abytes=5-6',
    ]) {
      expect(isSingleByteRange(header), header).toBe(false)
    }
  })

  it('refuses the last zero bytes, which no file holds (H15)', () => {
    expect(isSingleByteRange('bytes=-0')).toBe(false)
    expect(isSingleByteRange('bytes=-000')).toBe(false)
    expect(isSingleByteRange('bytes=-1')).toBe(true)
  })
})
