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
 * These run against the real `uploadMediaFromFormData`, with only the S3 client
 * replaced: "stored" means a PutObject reached the client. The route suites use
 * a re-implementation of this function and so cannot speak for it.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import fc from 'fast-check'

const mockConfig = {
  s3Bucket: 'my-bucket',
  s3Region: 'us-east-1',
  s3AccessKeyId: 'access-key',
  s3SecretAccessKey: 'secret-key',
  s3Endpoint: undefined as string | undefined,
  s3ForcePathStyle: false,
  s3PublicUrl: undefined as string | undefined,
  s3Proxy: false,
  baseUrl: 'https://app.example.com',
}

vi.mock('@/lib/server/config', () => ({ config: mockConfig }))

const LOCAL_WORKSPACE = 'workspace_01kzf9848he8h86ct48hanask6'
vi.mock('@/lib/server/db', () => ({
  db: { query: { settings: { findFirst: async () => ({ id: LOCAL_WORKSPACE }) } } },
}))

const mockSend = vi.fn(async (_command: unknown) => ({}))

vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: vi.fn(function () {
    return { send: mockSend, destroy: vi.fn() }
  }),
  PutObjectCommand: vi.fn(function (input: unknown) {
    return { input }
  }),
  GetObjectCommand: vi.fn(function (input: unknown) {
    return { input }
  }),
  DeleteObjectCommand: vi.fn(function (input: unknown) {
    return { input }
  }),
}))

vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: vi.fn(async () => 'https://s3.amazonaws.com/presigned'),
}))

const { uploadMediaFromFormData } = await import('@/lib/server/storage/s3')
const { validateMediaFile } = await import('@/lib/client/hooks/use-image-upload')
const {
  anyRasterImage,
  ebmlDocument,
  isoMediaImage,
  isoMediaVideo,
  rasterImage,
  RASTER_IMAGE_TYPES,
} = await import('../content/__tests__/media-container-arbitraries')

const MEGABYTE = 1024 * 1024
const MP4_FAMILY = ['video/mp4', 'video/quicktime', 'video/x-m4v', 'video/m4v'] as const
const MP4_FAMILY_EXTENSIONS: Record<string, string> = {
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  m4v: 'video/x-m4v',
}
const IMAGE_EXTENSIONS: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
}

interface StoredObject {
  ContentType?: string
  Body?: Buffer
}

function storedObjects(): StoredObject[] {
  const calls = mockSend.mock.calls as unknown as Array<[{ input: StoredObject }]>
  return calls.map((call) => call[0].input)
}

async function upload(bytes: Uint8Array, name: string, type: string): Promise<Response> {
  const formData = new FormData()
  formData.append('file', new File([new Uint8Array(bytes)], name, { type }))
  return uploadMediaFromFormData(formData, 'portal-media')
}

/** A file of `size` bytes whose first bytes are `header`. */
function paddedTo(header: Uint8Array, size: number): Uint8Array {
  const bytes = new Uint8Array(size)
  bytes.set(header)
  return bytes
}

/** The container a declared type claims: the MP4 family, WebM, or the image type itself. */
function containerFamilyOf(declared: string): string {
  if ((MP4_FAMILY as readonly string[]).includes(declared)) return 'mp4'
  if (declared === 'video/webm') return 'webm'
  return declared
}

beforeEach(() => {
  mockSend.mockClear()
})

describe('what can be uploaded (H1)', () => {
  it('stores an MP4, MOV, M4V and WebM video under the type it was sent as (H1)', async () => {
    const mp4 = fc.sample(isoMediaVideo, 1)[0]
    const webm = fc.sample(ebmlDocument('webm'), 1)[0]
    const cases: Array<[Uint8Array, string, string]> = [
      [mp4, 'clip.mp4', 'video/mp4'],
      [mp4, 'clip.mov', 'video/quicktime'],
      [mp4, 'clip.m4v', 'video/x-m4v'],
      [mp4, 'clip.m4v', 'video/m4v'],
      [webm, 'clip.webm', 'video/webm'],
    ]
    for (const [bytes, name, type] of cases) {
      mockSend.mockClear()
      const response = await upload(bytes, name, type)
      expect(response.status, type).toBe(200)
      expect(
        storedObjects().map((object) => object.ContentType),
        type
      ).toEqual([type])
    }
  })

  it('stores a video of exactly 100 MB and refuses one byte more (H1)', async () => {
    const header = fc.sample(isoMediaVideo, 1)[0]
    const atLimit = await upload(paddedTo(header, 100 * MEGABYTE), 'clip.mp4', 'video/mp4')
    expect(atLimit.status).toBe(200)
    expect(storedObjects()).toHaveLength(1)

    mockSend.mockClear()
    const overLimit = await upload(paddedTo(header, 100 * MEGABYTE + 1), 'clip.mp4', 'video/mp4')
    expect(overLimit.status).toBe(400)
    expect(storedObjects()).toHaveLength(0)
  })

  it('keeps images at 5 MB: exactly 5 MB is stored, one byte more is refused (H1)', async () => {
    const header = fc.sample(rasterImage('image/png'), 1)[0]
    const atLimit = await upload(paddedTo(header, 5 * MEGABYTE), 'shot.png', 'image/png')
    expect(atLimit.status).toBe(200)

    mockSend.mockClear()
    const overLimit = await upload(paddedTo(header, 5 * MEGABYTE + 1), 'shot.png', 'image/png')
    expect(overLimit.status).toBe(400)
    expect(storedObjects()).toHaveLength(0)
  })

  it('an image does not get the video allowance by being named like a video (H1)', async () => {
    const header = fc.sample(rasterImage('image/png'), 1)[0]
    const response = await upload(paddedTo(header, 6 * MEGABYTE), 'shot.mp4', 'image/png')
    expect(response.status).toBe(400)
    expect(storedObjects()).toHaveLength(0)
  })

  it('the client applies the same limits before sending (H1)', () => {
    const file = (size: number, name: string, type: string) =>
      new File([new Uint8Array(size)], name, { type })
    expect(validateMediaFile(file(100 * MEGABYTE, 'clip.mp4', 'video/mp4'))).toBeNull()
    expect(validateMediaFile(file(100 * MEGABYTE + 1, 'clip.mp4', 'video/mp4'))).toBeInstanceOf(
      Error
    )
    expect(validateMediaFile(file(5 * MEGABYTE, 'shot.png', 'image/png'))).toBeNull()
    expect(validateMediaFile(file(5 * MEGABYTE + 1, 'shot.png', 'image/png'))).toBeInstanceOf(Error)
    expect(validateMediaFile(file(10, 'clip.mkv', 'video/x-matroska'))).toBeInstanceOf(Error)
    expect(validateMediaFile(file(10, 'shot.png', ''))).toBeNull()
    expect(validateMediaFile(file(10, 'clip.mov', 'application/octet-stream'))).toBeNull()
  })
})

describe('what a file is decides whether it is stored (H2, H4)', () => {
  it('stores a file exactly when its bytes are the container its type claims (H2, H4)', async () => {
    const anyContainer = fc.oneof(
      isoMediaVideo.map((bytes) => ({ bytes, family: 'mp4' })),
      ebmlDocument('webm').map((bytes) => ({ bytes, family: 'webm' })),
      ebmlDocument('matroska').map((bytes) => ({ bytes, family: 'matroska' })),
      isoMediaImage.map((bytes) => ({ bytes, family: 'iso-image' })),
      anyRasterImage.map(({ type, bytes }) => ({ bytes, family: type }))
    )
    const anyDeclaredType = fc.constantFrom(...MP4_FAMILY, 'video/webm', ...RASTER_IMAGE_TYPES)
    await fc.assert(
      fc.asyncProperty(anyContainer, anyDeclaredType, async ({ bytes, family }, declared) => {
        mockSend.mockClear()
        const response = await upload(bytes, 'upload', declared)
        const shouldStore = family === containerFamilyOf(declared)
        const stored = storedObjects()
        // Unguarded across every branch: a 200 is a stored file, anything else stored nothing.
        expect(stored.length).toBe(response.status === 200 ? 1 : 0)
        expect(response.status === 200).toBe(shouldStore)
        if (shouldStore) expect(stored[0].ContentType).toBe(declared)
      }),
      { numRuns: 300 }
    )
  })

  it('refuses an AVIF or HEIC image presented as a video (H2, H4)', async () => {
    await fc.assert(
      fc.asyncProperty(isoMediaImage, fc.constantFrom(...MP4_FAMILY), async (bytes, declared) => {
        mockSend.mockClear()
        const response = await upload(bytes, 'clip.mp4', declared)
        expect(response.status).toBe(400)
        expect(storedObjects()).toHaveLength(0)
      })
    )
  })

  it('refuses a video presented as an image (H2, H4)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.oneof(isoMediaVideo, ebmlDocument('webm')),
        fc.constantFrom(...RASTER_IMAGE_TYPES, 'image/avif'),
        async (bytes, declared) => {
          mockSend.mockClear()
          const response = await upload(bytes, 'shot.png', declared)
          expect(response.status).toBe(400)
          expect(storedObjects()).toHaveLength(0)
        }
      )
    )
  })

  it('refuses a type outside the accepted ones before storing anything (H2, H4)', async () => {
    for (const type of ['text/html', 'image/svg+xml', 'video/x-matroska', 'application/pdf']) {
      mockSend.mockClear()
      const webm = fc.sample(ebmlDocument('webm'), 1)[0]
      const response = await upload(webm, 'clip.webm', type)
      expect(response.status, type).toBe(400)
      expect(storedObjects(), type).toHaveLength(0)
    }
  })

  it('stores nothing when the form carries no file (H4)', async () => {
    const response = await uploadMediaFromFormData(new FormData(), 'portal-media')
    expect(response.status).toBe(400)
    expect(storedObjects()).toHaveLength(0)
  })
})

describe('a file with no type or a generic one (H3)', () => {
  const genericType = fc.constantFrom('', 'application/octet-stream')

  it('is stored under the type its extension names when the bytes agree (H3)', async () => {
    await fc.assert(
      fc.asyncProperty(
        genericType,
        fc.constantFrom(...Object.keys(MP4_FAMILY_EXTENSIONS)),
        isoMediaVideo,
        async (declared, extension, bytes) => {
          mockSend.mockClear()
          const response = await upload(bytes, `clip.${extension}`, declared)
          expect(response.status).toBe(200)
          expect(storedObjects()[0].ContentType).toBe(MP4_FAMILY_EXTENSIONS[extension])
        }
      )
    )
    const webm = fc.sample(ebmlDocument('webm'), 1)[0]
    const response = await upload(webm, 'clip.WEBM', '')
    expect(response.status).toBe(200)
  })

  it('judges an image the same way, by its extension and then its bytes (H3)', async () => {
    await fc.assert(
      fc.asyncProperty(
        genericType,
        fc.constantFrom(...Object.keys(IMAGE_EXTENSIONS)),
        async (declared, extension) => {
          mockSend.mockClear()
          const type = IMAGE_EXTENSIONS[extension]
          const bytes = fc.sample(rasterImage(type), 1)[0]
          const response = await upload(bytes, `shot.${extension}`, declared)
          expect(response.status).toBe(200)
          expect(storedObjects()[0].ContentType).toBe(type)
        }
      )
    )
  })

  it('is still refused when the bytes are not what the extension names (H3, H2, H4)', async () => {
    const mismatched = fc.oneof(
      fc.tuple(isoMediaImage, fc.constantFrom('clip.mp4', 'clip.mov', 'clip.m4v')),
      fc.tuple(ebmlDocument('matroska'), fc.constant('clip.webm')),
      fc.tuple(isoMediaVideo, fc.constantFrom('clip.webm', 'shot.png', 'shot.jpg')),
      fc.tuple(
        anyRasterImage.map(({ bytes }) => bytes),
        fc.constantFrom('clip.mp4', 'clip.webm')
      )
    )
    await fc.assert(
      fc.asyncProperty(genericType, mismatched, async (declared, [bytes, name]) => {
        mockSend.mockClear()
        const response = await upload(bytes, name, declared)
        expect(response.status).toBe(400)
        expect(storedObjects()).toHaveLength(0)
      })
    )
  })

  it('is refused when the extension names no accepted type (H3, H4)', async () => {
    const mp4 = fc.sample(isoMediaVideo, 1)[0]
    for (const name of ['clip.avi', 'clip.mkv', 'clip', 'clip.mp4.html']) {
      mockSend.mockClear()
      const response = await upload(mp4, name, '')
      expect(response.status, name).toBe(400)
      expect(storedObjects(), name).toHaveLength(0)
    }
  })
})
