// @vitest-environment happy-dom
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
/*
 * A post is saved through `sanitizeTiptapContent` and shown through
 * `generateContentHTML`; these properties hold the pair, the first as the gate
 * H8 and H9 name ("removed when the post is saved") and the second as the page.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import fc from 'fast-check'

const mockConfig = vi.hoisted(() => ({
  s3PublicUrl: undefined as string | undefined,
  baseUrl: 'http://localhost:3000',
}))
vi.mock('@/lib/server/config', () => ({ config: mockConfig }))

import { sanitizeTiptapContent } from '../sanitize-tiptap'
import { generateContentHTML } from '@/lib/shared/content-html'
import { contentJsonToMarkdown } from '../markdown-tiptap'
import type { TiptapContent } from '@/lib/server/db'

const ACCEPTED_VIDEO_TYPES = [
  'video/mp4',
  'video/webm',
  'video/quicktime',
  'video/x-m4v',
  'video/m4v',
]
const RENDERED_VIDEO_ATTRIBUTES = [
  'class',
  'controls',
  'playsinline',
  'preload',
  'src',
  'title',
  'type',
]

interface VideoAttrs {
  src?: unknown
  mimeType?: unknown
  title?: unknown
  [other: string]: unknown
}

function postWithVideo(attrs: VideoAttrs): TiptapContent {
  return {
    type: 'doc',
    content: [
      { type: 'paragraph', content: [{ type: 'text', text: 'Steps to reproduce' }] },
      { type: 'video', attrs },
    ],
  } as TiptapContent
}

/** A post holding nothing but the video, so every element on the page is its. */
function postWithOnlyVideo(attrs: VideoAttrs): TiptapContent {
  return { type: 'doc', content: [{ type: 'video', attrs }] } as TiptapContent
}

function save(attrs: VideoAttrs): TiptapContent {
  return sanitizeTiptapContent(postWithVideo(attrs))
}

function videoElements(html: string): HTMLVideoElement[] {
  const container = document.createElement('div')
  container.innerHTML = html
  return Array.from(container.querySelectorAll('video'))
}

/** A storage key: path segments of ordinary file-name characters. */
const storageKey = fc
  .array(fc.stringMatching(/^[A-Za-z0-9_-]{1,12}$/), { minLength: 1, maxLength: 3 })
  .chain((segments) =>
    fc
      .constantFrom('mp4', 'webm', 'mov', 'm4v')
      .map((extension) => `portal-media/${segments.join('/')}.${extension}`)
  )

const ownStorageSrc = fc.oneof(
  storageKey.map((key) => `/api/storage/${key}`),
  storageKey.map((key) => `http://localhost:3000/api/storage/${key}`),
  storageKey.map((key) => `https://localhost/api/storage/${key}`)
)

const foreignHost = fc
  .domain()
  .filter((host) => host !== 'localhost' && !host.endsWith('.localhost'))

/** Every way a source names another host while looking like ours. */
const foreignSrc = fc
  .tuple(foreignHost, storageKey)
  .chain(([host, key]) =>
    fc
      .constantFrom(
        `https://${host}/api/storage/${key}`,
        `http://${host}/api/storage/${key}`,
        `//${host}/api/storage/${key}`,
        `/\\${host}/api/storage/${key}`,
        `/\t/${host}/api/storage/${key}`,
        `http://localhost:3000@${host}/api/storage/${key}`,
        `https://localhost.${host}/api/storage/${key}`,
        `HTTPS://${host.toUpperCase()}/api/storage/${key}`
      )
      .map((src) => ({ src, host }))
  )

const nonHttpScheme = fc
  .tuple(
    fc.constantFrom(
      'javascript',
      'data',
      'vbscript',
      'blob',
      'file',
      'ftp',
      'about',
      'jav\tascript'
    ),
    fc.constantFrom('', ' ', '\n', '\u0001'),
    fc.boolean(),
    storageKey
  )
  .map(([scheme, lead, upper, key]) => {
    const cased = upper ? scheme.toUpperCase() : scheme
    return `${lead}${cased}:/api/storage/${key}`
  })

/** Text a person could type into a title or a type: quotes, brackets, entities, scripts. */
const hostileText = fc.oneof(
  fc.string({ maxLength: 40 }),
  fc
    .array(
      fc.constantFrom(
        '"',
        "'",
        '<',
        '>',
        '&',
        '&quot;',
        '/',
        '=',
        ' ',
        'onerror=alert(1)',
        '<script>',
        '</video>',
        'x'
      ),
      { maxLength: 12 }
    )
    .map((parts) => parts.join(''))
)

beforeEach(() => {
  mockConfig.s3PublicUrl = undefined
})

describe('a video plays only from the workspace’s own storage (H8)', () => {
  it('keeps a video from the workspace’s storage when the post is saved (H8)', async () => {
    await fc.assert(
      fc.property(ownStorageSrc, (src) => {
        const saved = save({ src, mimeType: 'video/mp4', title: 'Recording' })
        expect(saved.content?.[1]).toEqual({
          type: 'video',
          attrs: { src, mimeType: 'video/mp4', title: 'Recording' },
        })
        expect(videoElements(generateContentHTML(saved))).toHaveLength(1)
      })
    )
  })

  it('removes a video pointing anywhere else, leaving no trace of the host (H8)', async () => {
    await fc.assert(
      fc.property(foreignSrc, hostileText, ({ src, host }, title) => {
        const saved = save({ src, mimeType: 'video/mp4', title })
        const savedText = JSON.stringify(saved).toLowerCase()
        expect(savedText).not.toContain(host.toLowerCase())
        const html = generateContentHTML(saved)
        expect(videoElements(html)).toHaveLength(0)
        expect(html.toLowerCase()).not.toContain(host.toLowerCase())
      }),
      { numRuns: 300 }
    )
  })

  it('trusts the public storage bucket on a path boundary, not its siblings (H8)', () => {
    mockConfig.s3PublicUrl = 'https://cdn.example.com/bucket'
    const inside = save({ src: 'https://cdn.example.com/bucket/portal-media/a.mp4' })
    expect(inside.content?.[1]?.attrs?.src).toBe(
      'https://cdn.example.com/bucket/portal-media/a.mp4'
    )
    for (const src of [
      'https://cdn.example.com/bucket-evil/portal-media/a.mp4',
      'https://cdn.example.com/other/portal-media/a.mp4',
      'https://cdn.example.com.evil.test/bucket/portal-media/a.mp4',
    ]) {
      const saved = save({ src })
      expect(saved.content?.[1]?.attrs?.src, src).toBe('')
    }
  })

  it('removes a video whose source is missing or not a string (H8)', () => {
    for (const src of [undefined, null, '', 42, { href: 'https://evil.test/x.mp4' }]) {
      const saved = save({ src, title: 'x' })
      expect(saved.content?.[1]?.attrs?.src, String(src)).toBe('')
      expect(videoElements(generateContentHTML(saved))).toHaveLength(0)
    }
  })
})

describe('a video source that is not http(s) is never rendered (H9)', () => {
  it('is removed when the post is saved (H9)', async () => {
    await fc.assert(
      fc.property(nonHttpScheme, (src) => {
        const saved = save({ src, mimeType: 'video/mp4' })
        expect(saved.content?.[1]?.attrs?.src).toBe('')
      })
    )
  })

  it('is not rendered even if one reached the page unsaved (H9)', async () => {
    await fc.assert(
      fc.property(nonHttpScheme, (src) => {
        const html = generateContentHTML(postWithVideo({ src, mimeType: 'video/mp4' }))
        expect(videoElements(html)).toHaveLength(0)
      })
    )
    expect(generateContentHTML(postWithVideo({ src: 'data:video/mp4;base64,AAAA' }))).not.toContain(
      '<video'
    )
  })
})

describe('a source no URL parser can read is never rendered (H9)', () => {
  it('renders nothing for a source that does not parse (H9)', () => {
    for (const src of ['http://[::1', 'https://exa mple.com:99999/x.mp4', 'http://%zz/']) {
      expect(videoElements(generateContentHTML(postWithVideo({ src }))), src).toHaveLength(0)
      expect(save({ src }).content?.[1]?.attrs?.src, src).toBe('')
    }
  })
})

describe('a saved video stays in the post’s markdown (H12)', () => {
  it('keeps a saved video as a link to its source when the post is turned into markdown (H12)', async () => {
    await fc.assert(
      fc.property(ownStorageSrc, (src) => {
        const markdown = contentJsonToMarkdown(save({ src, mimeType: 'video/mp4' }), 'fallback')
        expect(markdown).toContain(src)
        expect(markdown).toContain('Steps to reproduce')
      })
    )
  })

  it('marks a video whose source was removed, instead of dropping it silently (H12)', () => {
    const markdown = contentJsonToMarkdown(save({ src: 'https://evil.test/x.mp4' }), 'fallback')
    // Markdown escapes the brackets so the placeholder is not read as a link.
    expect(markdown).toContain('\\[video\\]')
    expect(markdown).not.toContain('evil.test')
  })
})

describe('what a person wrote into a video’s attributes reaches the page escaped (H10)', () => {
  it('renders exactly one video element with a fixed attribute set, title intact (H10)', async () => {
    await fc.assert(
      fc.property(ownStorageSrc, hostileText, hostileText, (src, title, mimeType) => {
        const html = generateContentHTML(
          sanitizeTiptapContent(postWithOnlyVideo({ src, title, mimeType }))
        )
        const container = document.createElement('div')
        container.innerHTML = html
        expect(container.querySelectorAll('*')).toHaveLength(1)
        const [video] = videoElements(html)
        expect(video).toBeDefined()
        expect(video.getAttributeNames().sort()).toEqual(RENDERED_VIDEO_ATTRIBUTES)
        expect(video.getAttribute('title')).toBe(title.slice(0, 500))
        expect(video.getAttribute('src')).toBe(src)
      }),
      { numRuns: 300 }
    )
  })

  it('escapes an unsaved title and source too, so no attribute breaks out (H10)', async () => {
    await fc.assert(
      fc.property(storageKey, hostileText, hostileText, (key, suffix, title) => {
        const src = `/api/storage/${key}?v=${suffix}`
        const html = generateContentHTML(postWithOnlyVideo({ src, title }))
        const container = document.createElement('div')
        container.innerHTML = html
        expect(container.querySelectorAll('*')).toHaveLength(1)
        const [video] = videoElements(html)
        expect(video.getAttributeNames().sort()).toEqual(RENDERED_VIDEO_ATTRIBUTES)
        expect(video.getAttribute('title')).toBe(title)
        expect(video.getAttribute('src')).toBe(src)
      })
    )
  })

  it('a title never changes the source or the type, and a type never changes the title (H10)', async () => {
    await fc.assert(
      fc.property(
        ownStorageSrc,
        hostileText,
        hostileText,
        hostileText,
        (src, mimeType, titleA, titleB) => {
          const [first] = videoElements(generateContentHTML(save({ src, mimeType, title: titleA })))
          const [second] = videoElements(
            generateContentHTML(save({ src, mimeType, title: titleB }))
          )
          expect(second.getAttribute('src')).toBe(first.getAttribute('src'))
          expect(second.getAttribute('type')).toBe(first.getAttribute('type'))
          const [third] = videoElements(
            generateContentHTML(save({ src, mimeType: titleB, title: titleA }))
          )
          expect(third.getAttribute('title')).toBe(first.getAttribute('title'))
          expect(third.getAttribute('src')).toBe(first.getAttribute('src'))
        }
      )
    )
  })

  it('drops every attribute a person added beyond source, type and title (H10)', () => {
    const saved = save({
      src: '/api/storage/portal-media/a.mp4',
      mimeType: 'video/mp4',
      title: 'a',
      autoplay: true,
      onerror: 'alert(1)',
      poster: 'https://evil.test/p.png',
      style: 'position:fixed',
    })
    expect(Object.keys(saved.content?.[1]?.attrs ?? {}).sort()).toEqual([
      'mimeType',
      'src',
      'title',
    ])
  })
})

describe('a stored video’s type on the page is an accepted one (H11)', () => {
  it('saves and renders an accepted video type, whatever the stored attribute said (H11)', async () => {
    await fc.assert(
      fc.property(
        ownStorageSrc,
        fc.oneof(hostileText, fc.constantFrom(...ACCEPTED_VIDEO_TYPES), fc.anything()),
        (src, mimeType) => {
          const saved = save({ src, mimeType })
          expect(ACCEPTED_VIDEO_TYPES).toContain(saved.content?.[1]?.attrs?.mimeType)
          const html = generateContentHTML(postWithVideo({ src, mimeType }))
          expect(ACCEPTED_VIDEO_TYPES).toContain(videoElements(html)[0].getAttribute('type'))
        }
      )
    )
  })
})
