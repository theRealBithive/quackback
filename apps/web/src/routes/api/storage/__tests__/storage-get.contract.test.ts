/**
 * What the storage route sends when a browser opens a stored file.
 *
 * Contract for upstream batch F (#608, `d166bf7ee`) — the confirmed list for
 * this area (the policy half is in
 * `lib/server/storage/__tests__/serve-policy.contract.test.ts`):
 *
 *   F23 A stored file opens in the browser only if its stored type is a raster
 *       image, audio, video or PDF; everything else, HTML and SVG included, is
 *       served as a download under a sandbox policy.
 *   F24 A download carries the file's own name, not the storage id.
 *   F25 A redirect to object storage follows the same rule as F23, decided from
 *       the file's extension.
 *   F26 Images and videos embedded in pages keep rendering.
 *
 * Generators: stored types from the openable set and from structured dangerous
 * types, each with random case, parameters and padding; keys of the shape
 * uploads produce, `logos/<yyyy>/<mm>/<uuid>-<stem>.<ext>` (a `logos/` key is
 * public, so no read token is needed). Every proxied key is unique per run so
 * the in-memory cache cannot answer for an earlier example.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import fc from 'fast-check'

const mockConfig = { s3Proxy: false }

const storedObject = { contentType: 'image/gif' }

const getS3Object = vi.fn(async (_key: string) => ({
  body: new Blob([new Uint8Array([0x47, 0x49, 0x46])]).stream(),
  contentType: storedObject.contentType,
}))

const generatePresignedGetUrl = vi.fn(
  async (_key: string, _expiresIn?: number, _downloadName?: string, _contentType?: string) =>
    'https://s3.example.com/presigned'
)

vi.mock('@/lib/server/config', () => ({ config: mockConfig }))
vi.mock('@/lib/server/storage/s3', () => ({
  isS3Usable: vi.fn(() => true),
  getStorageSigningSecret: vi.fn(() => 'test-secret'),
  isPublicStorageKey: vi.fn((key: string) => key.startsWith('logos/')),
  verifyStorageReadToken: vi.fn(() => false),
  getS3Object,
  generatePresignedGetUrl,
  StorageUnavailableError: class StorageUnavailableError extends Error {},
}))

const { handleStorageGet } = await import('../$')

const OPENABLE_TYPES = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/avif',
  'image/x-icon',
  'video/mp4',
  'video/webm',
  'video/quicktime',
  'video/x-m4v',
  'audio/mpeg',
  'audio/ogg',
  'audio/wav',
  'audio/webm',
  'audio/mp4',
  'application/pdf',
]
const EMBEDDED_MEDIA_TYPES = OPENABLE_TYPES.filter(
  (type) => type.startsWith('image/') || type.startsWith('video/')
)
const SCRIPTABLE_TYPES = [
  'text/html',
  'application/xhtml+xml',
  'image/svg+xml',
  'text/xml',
  'application/xml',
  'text/javascript',
  'text/plain',
  'application/octet-stream',
  'image/pngx',
  '',
]
const OPENABLE_EXTENSIONS = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  ico: 'image/x-icon',
  mp4: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
  m4v: 'video/x-m4v',
  mp3: 'audio/mpeg',
  ogg: 'audio/ogg',
  wav: 'audio/wav',
  m4a: 'audio/mp4',
  pdf: 'application/pdf',
}
const SCRIPTABLE_EXTENSIONS = ['html', 'htm', 'xhtml', 'svg', 'svgz', 'xml', 'js', 'txt', 'zip']

const SAFE_HEADER_FILENAME = /^[A-Za-z0-9._-]+$/

function withRandomCase(text: string): fc.Arbitrary<string> {
  return fc
    .array(fc.boolean(), { minLength: text.length, maxLength: text.length })
    .map((upperFlags) =>
      text
        .split('')
        .map((character, index) =>
          upperFlags[index] ? character.toUpperCase() : character.toLowerCase()
        )
        .join('')
    )
}

function decoratedType(types: string[]) {
  return fc
    .tuple(
      fc.constantFrom(...types),
      fc.constantFrom('', '; charset=utf-8', '; codecs="avc1"'),
      fc.constantFrom('', ' ')
    )
    .chain(([type, suffix, padding]) =>
      withRandomCase(type).map((spelled) => `${padding}${spelled}${suffix}${padding}`)
    )
}

const uuid = fc.uuid().map((value) => value.toLowerCase())
const safeStem = fc.stringMatching(/^[A-Za-z0-9_-]{1,20}$/)

let keyCounter = 0
function uniqueKey(id: string, name: string): string {
  keyCounter += 1
  return `logos/2026/09/${id}-r${keyCounter}-${name}`
}

const get = (key: string) =>
  handleStorageGet({
    request: new Request(`https://app.example.com/api/storage/${encodeURIComponent(key)}`),
  })

/**
 * The Content-Type a response carries for a stored type, as HTTP delivers it.
 *
 * The Fetch standard normalises a header value by stripping its leading and
 * trailing whitespace, so a stored type of " image/jpeg " reaches the browser
 * as "image/jpeg". "With its own type" means that value, not the raw column.
 * Whether the normalisation has already happened depends on the Headers
 * implementation (CI's trims, happy-dom here does not), so both sides are
 * compared normalised: the first CI run drew the padded case and failed on
 * exactly this, which was the property misstating HTTP, not the route.
 */
function asHeaderValue(storedType: string): string {
  return storedType.trim()
}

beforeEach(() => {
  mockConfig.s3Proxy = true
  storedObject.contentType = 'image/gif'
  getS3Object.mockClear()
  generatePresignedGetUrl.mockClear()
})

describe('a proxied file opens only if its stored type is safe (F23)', () => {
  it('(F23) an openable stored type is served inline, with its own type and no attachment', async () => {
    await fc.assert(
      fc.asyncProperty(decoratedType(OPENABLE_TYPES), uuid, safeStem, async (type, id, stem) => {
        storedObject.contentType = type

        const response = await get(uniqueKey(id, `${stem}.bin`))

        expect(response.status).toBe(200)
        expect(asHeaderValue(response.headers.get('Content-Type') ?? '')).toBe(asHeaderValue(type))
        expect(response.headers.get('Content-Disposition')).toBeNull()
        expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff')
      }),
      { numRuns: 40 }
    )
  })

  it('(F23) any other stored type is a download under the sandbox policy, also when answered from the cache', async () => {
    await fc.assert(
      fc.asyncProperty(decoratedType(SCRIPTABLE_TYPES), uuid, safeStem, async (type, id, stem) => {
        storedObject.contentType = type
        getS3Object.mockClear()
        const key = uniqueKey(id, `${stem}.png`)

        const fresh = await get(key)
        const cached = await get(key)

        for (const response of [fresh, cached]) {
          expect(response.status).toBe(200)
          expect(response.headers.get('Content-Disposition')).toMatch(/^attachment; /)
          expect(response.headers.get('Content-Security-Policy')).toContain('sandbox')
          expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff')
        }
        expect(getS3Object).toHaveBeenCalledTimes(1)
      }),
      { numRuns: 40 }
    )
  })
})

describe('a proxied download is saved under the file name (F24)', () => {
  it('(F24) the saved name is the name the file was sent with, never the storage id', async () => {
    await fc.assert(
      fc.asyncProperty(decoratedType(SCRIPTABLE_TYPES), uuid, safeStem, async (type, id, stem) => {
        storedObject.contentType = type
        const name = `${stem}.html`

        const response = await get(`logos/2026/09/${id}-${name}`)

        const disposition = response.headers.get('Content-Disposition')!
        expect(disposition).toBe(`attachment; filename="${name}"`)
        expect(disposition.toLowerCase()).not.toContain(id)
      }),
      { numRuns: 20 }
    )
  })

  it('(F24) a hostile name never puts a quote or a line break into the header', async () => {
    const hostile = fc.oneof(
      fc.string({ unit: 'grapheme' }),
      fc.constantFrom('"; filename="evil.html', 'a\r\nSet-Cookie: x=1.txt', 'x"y.txt', 'ünï.pdf')
    )
    await fc.assert(
      fc.asyncProperty(uuid, hostile, async (id, name) => {
        storedObject.contentType = 'text/html'
        // The traversal and slash rules of the key are not under test here.
        const keyName = name.replaceAll('..', '._').replaceAll('/', '_')

        const response = await get(uniqueKey(id, keyName))

        expect(response.status).toBe(200)
        const disposition = response.headers.get('Content-Disposition')!
        const match = /^attachment; filename="([^"]*)"$/.exec(disposition)
        expect(match, disposition).not.toBeNull()
        expect(match![1]).toMatch(SAFE_HEADER_FILENAME)
        expect(disposition.toLowerCase()).not.toContain(id)
      }),
      { numRuns: 40 }
    )
  })
})

describe('a redirect follows the same rule, from the extension (F25)', () => {
  beforeEach(() => {
    mockConfig.s3Proxy = false
  })

  it('(F25) an openable extension is presigned with a forced type that F23 opens inline', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(...Object.keys(OPENABLE_EXTENSIONS)),
        uuid,
        safeStem,
        async (extension, id, stem) => {
          generatePresignedGetUrl.mockClear()

          const response = await get(`logos/2026/09/${id}-${stem}.${extension}`)

          expect(response.status).toBe(302)
          const [, , downloadName, forcedType] = generatePresignedGetUrl.mock.calls[0]!
          expect(downloadName).toBeUndefined()
          expect(forcedType).toBe(
            OPENABLE_EXTENSIONS[extension as keyof typeof OPENABLE_EXTENSIONS]
          )
        }
      ),
      { numRuns: 30 }
    )
  })

  it('(F25) any other extension is presigned as a download under the file name, with no forced type', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(...SCRIPTABLE_EXTENSIONS),
        uuid,
        safeStem,
        async (extension, id, stem) => {
          generatePresignedGetUrl.mockClear()

          const response = await get(`logos/2026/09/${id}-${stem}.${extension}`)

          expect(response.status).toBe(302)
          const [, , downloadName, forcedType] = generatePresignedGetUrl.mock.calls[0]!
          expect(forcedType).toBeUndefined()
          expect(downloadName).toBe(`${stem}.${extension}`)
        }
      ),
      { numRuns: 30 }
    )
  })

  it('(F25) a redirect never both forces a type and names a download, and never does neither', async () => {
    await fc.assert(
      fc.asyncProperty(uuid, fc.stringMatching(/^[A-Za-z0-9_.-]{1,24}$/), async (id, name) => {
        generatePresignedGetUrl.mockClear()

        const response = await get(`logos/2026/09/${id}-${name}`)
        const presignCalls = generatePresignedGetUrl.mock.calls

        // A key the route refuses (a name holding "..") is never presigned at
        // all; every key it serves is presigned exactly one of the two ways.
        if (response.status !== 302) {
          expect(presignCalls).toHaveLength(0)
          return
        }
        expect(presignCalls).toHaveLength(1)
        const [, , downloadName, forcedType] = presignCalls[0]!
        expect((downloadName === undefined) !== (forcedType === undefined)).toBe(true)
      })
    )
  })
})

describe('embedded images and videos keep rendering (F26)', () => {
  it('(F26) a proxied image or video carries no attachment and no sandbox, and keeps its type', async () => {
    mockConfig.s3Proxy = true
    await fc.assert(
      fc.asyncProperty(
        decoratedType(EMBEDDED_MEDIA_TYPES),
        uuid,
        safeStem,
        async (type, id, stem) => {
          storedObject.contentType = type

          const response = await get(uniqueKey(id, `${stem}.png`))

          expect(response.status).toBe(200)
          expect(asHeaderValue(response.headers.get('Content-Type') ?? '')).toBe(
            asHeaderValue(type)
          )
          expect(response.headers.get('Content-Disposition')).toBeNull()
          expect(response.headers.get('Content-Security-Policy')).toBeNull()
        }
      ),
      { numRuns: 30 }
    )
  })

  it('(F26) a redirected image or video is presigned with its own type and not as a download', async () => {
    mockConfig.s3Proxy = false
    const mediaExtensionTypes = [
      ['jpg', 'image/jpeg'],
      ['png', 'image/png'],
      ['gif', 'image/gif'],
      ['webp', 'image/webp'],
      ['mp4', 'video/mp4'],
      ['webm', 'video/webm'],
      ['mov', 'video/quicktime'],
      ['m4v', 'video/x-m4v'],
    ] as const

    for (const [extension, type] of mediaExtensionTypes) {
      generatePresignedGetUrl.mockClear()

      await get(`logos/2026/09/3f2b8c1e-1a2b-4c3d-9e8f-0123456789ab-clip.${extension}`)

      const [, , downloadName, forcedType] = generatePresignedGetUrl.mock.calls[0]!
      expect(downloadName, extension).toBeUndefined()
      expect(forcedType, extension).toBe(type)
    }
  })
})
