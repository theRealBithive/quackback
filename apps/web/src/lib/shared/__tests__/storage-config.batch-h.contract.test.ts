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
import {
  MAX_FILE_SIZE,
  MAX_VIDEO_FILE_SIZE,
  VIDEO_FILE_ACCEPT,
  isAllowedImageType,
  isAllowedMediaType,
  isAllowedVideoType,
  maxMediaFileSize,
  normalizeVideoMimeType,
  resolveMediaMimeType,
  resolveVideoMimeType,
} from '../storage-config'

const MEGABYTE = 1024 * 1024
const VIDEO_TYPES = ['video/mp4', 'video/webm', 'video/quicktime', 'video/x-m4v', 'video/m4v']
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/avif']
const GENERIC_TYPES = ['', 'application/octet-stream']

const EXTENSION_TYPES: Record<string, string> = {
  mp4: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
  m4v: 'video/x-m4v',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
}

/** A file name: a stem, then the extension in any letter case. */
const nameWithExtension = (extensions: string[]) =>
  fc
    .tuple(
      fc.stringMatching(/^[a-zA-Z0-9 ._-]{0,20}$/),
      fc.constantFrom(...extensions),
      fc.array(fc.boolean(), { minLength: 4, maxLength: 4 })
    )
    .map(([stem, extension, upper]) => {
      const cased = [...extension]
        .map((letter, index) => (upper[index % 4] ? letter.toUpperCase() : letter))
        .join('')
      return { name: `${stem}.${cased}`, extension }
    })

describe('what may be uploaded, and how large (H1)', () => {
  it('accepts the four video containers and the images, nothing else (H1)', () => {
    for (const type of VIDEO_TYPES) {
      expect(isAllowedVideoType(type), type).toBe(true)
      expect(isAllowedMediaType(type), type).toBe(true)
    }
    for (const type of IMAGE_TYPES) {
      expect(isAllowedImageType(type), type).toBe(true)
      expect(isAllowedVideoType(type), type).toBe(false)
      expect(isAllowedMediaType(type), type).toBe(true)
    }
    for (const type of ['video/x-matroska', 'video/ogg', 'image/svg+xml', 'text/html', '']) {
      expect(isAllowedMediaType(type), type).toBe(false)
    }
  })

  it('allows 100 MB per video and keeps images at 5 MB (H1)', () => {
    expect(MAX_VIDEO_FILE_SIZE).toBe(100 * MEGABYTE)
    expect(MAX_FILE_SIZE).toBe(5 * MEGABYTE)
    for (const type of VIDEO_TYPES) expect(maxMediaFileSize(type), type).toBe(100 * MEGABYTE)
    for (const type of IMAGE_TYPES) expect(maxMediaFileSize(type), type).toBe(5 * MEGABYTE)
  })

  it('offers the four containers in the file picker (H1)', () => {
    const offered = VIDEO_FILE_ACCEPT.split(',')
    for (const entry of ['.mp4', '.webm', '.mov', '.m4v', 'video/mp4', 'video/webm']) {
      expect(offered, entry).toContain(entry)
    }
    expect(offered).toContain('video/quicktime')
    expect(offered).toContain('video/x-m4v')
  })
})

describe('a file with no type or a generic one (H3)', () => {
  it('is judged by its extension, in any letter case (H3)', async () => {
    await fc.assert(
      fc.property(
        fc.constantFrom(...GENERIC_TYPES),
        nameWithExtension(Object.keys(EXTENSION_TYPES)),
        (declared, { name, extension }) => {
          expect(resolveMediaMimeType(declared, name)).toBe(EXTENSION_TYPES[extension])
        }
      )
    )
  })

  it('has no type when the extension is not an accepted one (H3)', async () => {
    await fc.assert(
      fc.property(
        fc.constantFrom(...GENERIC_TYPES),
        nameWithExtension(['avi', 'mkv', 'svg', 'html', 'exe', 'mp4.exe', 'png.html']),
        (declared, { name }) => {
          expect(resolveMediaMimeType(declared, name)).toBeNull()
        }
      )
    )
    expect(resolveMediaMimeType('', '')).toBeNull()
    expect(resolveMediaMimeType('', 'mp4')).toBeNull()
    expect(resolveMediaMimeType('application/octet-stream', 'noextension')).toBeNull()
  })

  it('a declared specific type is never overridden by the extension (H3)', async () => {
    await fc.assert(
      fc.property(
        fc.constantFrom(...VIDEO_TYPES, ...IMAGE_TYPES),
        nameWithExtension(Object.keys(EXTENSION_TYPES)),
        (declared, { name }) => {
          expect(resolveMediaMimeType(declared, name)).toBe(declared)
        }
      )
    )
    await fc.assert(
      fc.property(
        fc.constantFrom('text/html', 'image/svg+xml', 'video/x-matroska', 'application/pdf'),
        nameWithExtension(Object.keys(EXTENSION_TYPES)),
        (declared, { name }) => {
          expect(resolveMediaMimeType(declared, name)).toBeNull()
        }
      )
    )
  })

  it('the video-only resolver judges only video extensions (H3)', () => {
    expect(resolveVideoMimeType('', 'clip.MOV')).toBe('video/quicktime')
    expect(resolveVideoMimeType('application/octet-stream', 'clip.m4v')).toBe('video/x-m4v')
    expect(resolveVideoMimeType('', 'photo.png')).toBeNull()
    expect(resolveVideoMimeType('video/webm', 'photo.png')).toBe('video/webm')
    expect(resolveVideoMimeType('image/png', 'clip.mp4')).toBeNull()
    expect(resolveVideoMimeType('')).toBeNull()
  })
})

describe("a stored video's type on the page (H11)", () => {
  it('is always one of the accepted video types, whatever was stored (H11)', async () => {
    await fc.assert(
      fc.property(fc.oneof(fc.string(), fc.constantFrom(...VIDEO_TYPES), fc.anything()), (raw) => {
        expect(VIDEO_TYPES).toContain(normalizeVideoMimeType(raw))
      })
    )
  })

  it('keeps WebM and QuickTime, and plays every MP4-family type as MP4 (H11)', () => {
    expect(normalizeVideoMimeType('video/webm')).toBe('video/webm')
    expect(normalizeVideoMimeType('video/quicktime')).toBe('video/quicktime')
    expect(normalizeVideoMimeType('video/mp4')).toBe('video/mp4')
    expect(normalizeVideoMimeType('video/x-m4v')).toBe('video/mp4')
    expect(normalizeVideoMimeType('text/html"><script>')).toBe('video/mp4')
  })
})
