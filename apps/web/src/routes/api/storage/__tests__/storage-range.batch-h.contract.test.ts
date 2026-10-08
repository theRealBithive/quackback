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
 * The storage proxy (S3_PROXY on) in front of a fake bucket that answers the
 * way S3 documents it: a satisfiable single range is a 206 with exactly those
 * bytes, a range that starts past the end is an `InvalidRange` (416), and a
 * Range header S3 cannot parse is IGNORED — it answers 200 with the whole
 * object. That last rule is why H14 has to be enforced by the proxy itself.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import fc from 'fast-check'

const mockConfig = { s3Proxy: true }

interface StoredObject {
  bytes: Uint8Array
  contentType: string
}

const bucket = new Map<string, StoredObject>()

class InvalidRange extends Error {
  name = 'InvalidRange'
  $metadata = { httpStatusCode: 416 }
}

/** S3's reading of a Range header: a [first, last] pair, 'unsatisfiable', or 'ignored'. */
function s3RangeOf(range: string, size: number): [number, number] | 'unsatisfiable' | 'ignored' {
  const match = /^bytes=(\d*)-(\d*)$/.exec(range)
  if (!match || (match[1] === '' && match[2] === '')) return 'ignored'
  if (match[1] === '') {
    const suffix = Number(match[2])
    if (suffix === 0) return 'unsatisfiable'
    return [Math.max(0, size - suffix), size - 1]
  }
  const first = Number(match[1])
  const last = match[2] === '' ? size - 1 : Math.min(Number(match[2]), size - 1)
  if (match[2] !== '' && Number(match[2]) < first) return 'ignored'
  if (first >= size) return 'unsatisfiable'
  return [first, last]
}

const getS3Object = vi.fn(async (key: string, range?: string) => {
  const object = bucket.get(key)
  if (!object) throw Object.assign(new Error('missing'), { name: 'NoSuchKey' })
  const size = object.bytes.length
  const whole = {
    body: new Blob([new Uint8Array(object.bytes)]).stream(),
    contentType: object.contentType,
    contentLength: size,
    acceptRanges: 'bytes',
  }
  if (!range) return whole
  const reading = s3RangeOf(range, size)
  if (reading === 'ignored') return whole
  if (reading === 'unsatisfiable') throw new InvalidRange('range')
  const [first, last] = reading
  return {
    body: new Blob([object.bytes.slice(first, last + 1)]).stream(),
    contentType: object.contentType,
    contentLength: last - first + 1,
    contentRange: `bytes ${first}-${last}/${size}`,
    acceptRanges: 'bytes',
  }
})

vi.mock('@/lib/server/config', () => ({ config: mockConfig }))
vi.mock('@/lib/server/storage/s3', () => ({
  isS3Usable: vi.fn(() => true),
  getStorageSigningSecret: vi.fn(() => 'test-secret'),
  isPublicStorageKey: vi.fn(() => true),
  verifyStorageReadToken: vi.fn(() => true),
  getS3Object,
  generatePresignedGetUrl: vi.fn(async () => 'https://s3.example.com/presigned'),
  StorageUnavailableError: class StorageUnavailableError extends Error {},
}))

const { handleStorageGet } = await import('../$')

let objectCounter = 0

/** Put an object under a key no earlier test used, so the proxy cache starts cold for it. */
function store(bytes: Uint8Array, contentType: string, extension = 'mp4'): string {
  objectCounter += 1
  const key = `portal-media/object-${objectCounter}.${extension}`
  bucket.set(key, { bytes, contentType })
  return key
}

function get(key: string, range?: string): Promise<Response> {
  const headers: Record<string, string> = range ? { Range: range } : {}
  return handleStorageGet({
    request: new Request(`https://app.example.com/api/storage/${key}`, { headers }),
  })
}

async function bodyOf(response: Response): Promise<Uint8Array> {
  return new Uint8Array(await response.arrayBuffer())
}

const objectBytes = fc.uint8Array({ minLength: 1, maxLength: 300 })
const servedType = fc.constantFrom('video/mp4', 'video/webm', 'image/gif', 'image/png')

/** A satisfiable single range over a file of `size` bytes, in each of its three forms. */
function satisfiableRange(
  size: number
): fc.Arbitrary<{ header: string; first: number; last: number }> {
  const bounded = fc
    .tuple(fc.nat(size - 1), fc.nat(size + 50))
    .filter(([first, end]) => end >= first)
    .map(([first, end]) => ({
      header: `bytes=${first}-${end}`,
      first,
      last: Math.min(end, size - 1),
    }))
  const open = fc
    .nat(size - 1)
    .map((first) => ({ header: `bytes=${first}-`, first, last: size - 1 }))
  const suffix = fc.integer({ min: 1, max: size + 50 }).map((length) => ({
    header: `bytes=-${length}`,
    first: Math.max(0, size - length),
    last: size - 1,
  }))
  return fc.oneof(bounded, open, suffix)
}

const digits = fc.stringMatching(/^[0-9]{1,25}$/)

/** Range headers that are not one well-formed byte range. */
const malformedRange = fc.oneof(
  fc
    .tuple(fc.integer({ min: 1, max: 10_000 }), fc.integer({ min: 0, max: 9_999 }))
    .filter(([first, last]) => last < first)
    .map(([first, last]) => `bytes=${first}-${last}`),
  fc
    .tuple(fc.bigInt({ min: 2n ** 53n, max: 10n ** 24n }), fc.bigInt({ min: 1n, max: 2n ** 20n }))
    .map(([first, below]) => `bytes=${first}-${first - below}`),
  fc
    .array(fc.tuple(fc.nat(100), fc.nat(100)), { minLength: 2, maxLength: 4 })
    .map(
      (pairs) => `bytes=${pairs.map(([a, b]) => `${Math.min(a, b)}-${Math.max(a, b)}`).join(',')}`
    ),
  fc.tuple(digits, digits).map(([a, b]) => `bytes=${a}-${b},`),
  fc.constantFrom(
    'bytes=',
    'bytes=-',
    'bytes=--1',
    // Only inner whitespace: a field value's leading and trailing whitespace is
    // not part of it (RFC 9110 §5.5) and `Headers` strips it, so `bytes=0-1 `
    // reaches the server as the well-formed `bytes=0-1`. An early run of this
    // property drew exactly that and was right to be answered with a 206.
    'bytes= 0-1',
    'bytes=0 -1',
    'Bytes=0-1',
    'items=0-1',
    'bytes=a-b',
    'bytes=0x10-20',
    'bytes=1.5-2',
    'bytes=+1-2',
    'bytes=0-1;q=1',
    '0-1',
    'bytes=-0'
  )
)

beforeEach(() => {
  mockConfig.s3Proxy = true
  getS3Object.mockClear()
})

describe('a video can be played from any point (H13)', () => {
  it('answers a single byte range with exactly those bytes, as a 206 (H13)', async () => {
    await fc.assert(
      fc.asyncProperty(
        objectBytes.chain((bytes) =>
          fc.tuple(fc.constant(bytes), satisfiableRange(bytes.length), servedType)
        ),
        async ([bytes, { header, first, last }, contentType]) => {
          const key = store(bytes, contentType)
          const response = await get(key, header)
          expect(response.status).toBe(206)
          expect(await bodyOf(response)).toEqual(bytes.slice(first, last + 1))
          expect(response.headers.get('Content-Range')).toBe(
            `bytes ${first}-${last}/${bytes.length}`
          )
          expect(response.headers.get('Content-Length')).toBe(String(last - first + 1))
          expect(response.headers.get('Accept-Ranges')).toBe('bytes')
        }
      ),
      { numRuns: 200 }
    )
  })

  it('answers a request without a range with the whole file, as a 200 (H13)', async () => {
    await fc.assert(
      fc.asyncProperty(objectBytes, servedType, async (bytes, contentType) => {
        const key = store(bytes, contentType)
        const response = await get(key)
        expect(response.status).toBe(200)
        expect(await bodyOf(response)).toEqual(bytes)
      })
    )
  })

  it('advertises ranges on a whole video, so the player knows it can seek (H13)', async () => {
    const key = store(new Uint8Array([1, 2, 3]), 'video/mp4')
    const response = await get(key)
    expect(response.headers.get('Accept-Ranges')).toBe('bytes')
    expect(response.headers.get('Content-Length')).toBe('3')
  })
})

describe('several ranges, or a malformed one, are refused (H14)', () => {
  it('answers 416 and never the whole file (H14)', async () => {
    await fc.assert(
      fc.asyncProperty(
        objectBytes,
        malformedRange,
        servedType,
        async (bytes, range, contentType) => {
          const key = store(bytes, contentType)
          const response = await get(key, range)
          expect(response.status, range).toBe(416)
          expect((await bodyOf(response)).length, range).toBe(0)
        }
      ),
      { numRuns: 300 }
    )
  })
})

describe('a range outside the file is refused (H15)', () => {
  it('answers 416 for a range starting at or past the end (H15)', async () => {
    await fc.assert(
      fc.asyncProperty(
        objectBytes,
        fc.nat(1000),
        fc.option(fc.nat(1000)),
        async (bytes, past, length) => {
          const first = bytes.length + past
          const header = length === null ? `bytes=${first}-` : `bytes=${first}-${first + length}`
          const key = store(bytes, 'video/mp4')
          const response = await get(key, header)
          expect(response.status, header).toBe(416)
          expect((await bodyOf(response)).length).toBe(0)
        }
      )
    )
  })
})

describe('a partial answer is never the cached whole file (H16)', () => {
  it('a range request does not fill the cache, and the next full request gets the whole file (H16)', async () => {
    await fc.assert(
      fc.asyncProperty(
        objectBytes.chain((bytes) => fc.tuple(fc.constant(bytes), satisfiableRange(bytes.length))),
        fc.constantFrom('image/gif', 'image/png', 'video/mp4'),
        async ([bytes, { header }], contentType) => {
          const key = store(bytes, contentType, 'gif')
          await get(key, header)
          const full = await get(key)
          expect(full.status).toBe(200)
          expect(await bodyOf(full)).toEqual(bytes)
        }
      )
    )
  })

  it('a cached whole file is not served for a range request (H16)', async () => {
    await fc.assert(
      fc.asyncProperty(
        objectBytes.chain((bytes) => fc.tuple(fc.constant(bytes), satisfiableRange(bytes.length))),
        async ([bytes, { header, first, last }]) => {
          const key = store(bytes, 'image/gif', 'gif')
          await get(key)
          await get(key)
          getS3Object.mockClear()
          const partial = await get(key, header)
          expect(partial.status).toBe(206)
          expect(await bodyOf(partial)).toEqual(bytes.slice(first, last + 1))
          expect(getS3Object).toHaveBeenCalledWith(key, header)
        }
      )
    )
  })

  it('serves the second full request of a small image from the cache (H16)', async () => {
    const key = store(new Uint8Array([0x47, 0x49, 0x46]), 'image/gif', 'gif')
    await get(key)
    getS3Object.mockClear()
    const second = await get(key)
    expect(getS3Object).not.toHaveBeenCalled()
    expect(await bodyOf(second)).toEqual(new Uint8Array([0x47, 0x49, 0x46]))
  })
})

describe('every proxied answer carries nosniff and the stored type (H17)', () => {
  it('on a full answer, a cached answer and a partial answer alike (H17)', async () => {
    const anyStoredType = fc.constantFrom(
      'video/mp4',
      'video/webm',
      'image/gif',
      'image/png',
      'text/html',
      'application/pdf',
      'image/svg+xml'
    )
    await fc.assert(
      fc.asyncProperty(
        objectBytes.chain((bytes) => fc.tuple(fc.constant(bytes), satisfiableRange(bytes.length))),
        anyStoredType,
        async ([bytes, { header }], contentType) => {
          const key = store(bytes, contentType, 'bin')
          const answers = [await get(key), await get(key), await get(key, header)]
          for (const answer of answers) {
            expect(answer.headers.get('X-Content-Type-Options')).toBe('nosniff')
            expect(answer.headers.get('Content-Type')).toBe(contentType)
          }
        }
      )
    )
  })

  it('a stored page fetched by range is still a download (H17)', async () => {
    const key = store(
      new TextEncoder().encode('<html><script>1</script></html>'),
      'text/html',
      'html'
    )
    const response = await get(key, 'bytes=0-5')
    expect(response.status).toBe(206)
    expect(response.headers.get('Content-Disposition')).toMatch(/^attachment/)
  })
})
