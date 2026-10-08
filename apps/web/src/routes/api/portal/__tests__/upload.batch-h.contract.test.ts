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
 * Who may upload. The rate buckets are an in-memory counter here, so a limit is
 * exercised by actually sending requests, and the client address is resolved
 * by the real `getClientIp` behind one trusted proxy hop: the address is the
 * rightmost X-Forwarded-For entry, everything left of it is what the client
 * wrote itself.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import fc from 'fast-check'
import {
  mockSession,
  mockPrincipal,
  mockImageFile,
  mockVideoFile,
} from '../../__tests__/upload-fixtures'

vi.mock('@/lib/server/config', () => ({ config: { trustedProxyHops: 1 } }))

vi.mock('@/lib/server/auth', () => ({
  auth: { api: { getSession: vi.fn() } },
}))

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: { query: { principal: { findFirst: vi.fn() } } },
  eq: vi.fn(),
}))

vi.mock('@/lib/server/storage/s3', async () => {
  const { createS3MockFactory } = await import('../../__tests__/s3-upload-mock')
  return createS3MockFactory()
})

vi.mock('@/lib/server/functions/workspace', () => ({ getSettings: vi.fn() }))

const buckets = vi.hoisted(() => new Map<string, number>())
vi.mock('@/lib/server/utils/rate-bucket', () => ({
  incrementBucket: vi.fn(async ({ key }: { key: string }) => {
    const count = (buckets.get(key) ?? 0) + 1
    buckets.set(key, count)
    return { count }
  }),
  incrementBuckets: vi.fn(async () => []),
  bucketRetryAfter: vi.fn(async () => 42),
}))

import { auth } from '@/lib/server/auth'
import { db } from '@/lib/server/db'
import { getSettings } from '@/lib/server/functions/workspace'
import { uploadObject } from '@/lib/server/storage/s3'
import { handlePortalUpload, Route } from '../upload'

const MEGABYTE = 1024 * 1024
const PER_SESSION_LIMIT = 20
const TWO_GIGABYTES = 2 * 1024 * MEGABYTE
const LARGEST_VIDEO = 100 * MEGABYTE

type Settings = Awaited<ReturnType<typeof getSettings>>

function settingsWith(portalConfig: unknown): Settings {
  return { id: 'workspace_test', portalConfig } as unknown as Settings
}

const ANONYMOUS_ALLOWED = settingsWith(JSON.stringify({ features: { allowAnonymous: true } }))
const ANONYMOUS_HELD_BACK = settingsWith(JSON.stringify({ features: { allowAnonymous: false } }))

let nextUser = 0

/** A session nobody has used before: what minting a fresh anonymous session costs. */
function freshSession(type: 'anonymous' | 'user') {
  nextUser += 1
  const id = `user_fresh${nextUser}`
  vi.mocked(auth.api.getSession).mockResolvedValueOnce(
    mockSession({ user: { id, email: type === 'user' ? `${id}@example.com` : '' } })
  )
  vi.mocked(db.query.principal.findFirst).mockResolvedValueOnce(mockPrincipal({ type }))
}

function sameSession(id: string, type: 'anonymous' | 'user') {
  vi.mocked(auth.api.getSession).mockResolvedValueOnce(mockSession({ user: { id } }))
  vi.mocked(db.query.principal.findFirst).mockResolvedValueOnce(mockPrincipal({ type }))
}

function uploadFrom(forwardedFor: string): Promise<Response> {
  const formData = new FormData()
  formData.append('file', mockImageFile('shot.png', 'image/png'))
  return handlePortalUpload({
    request: new Request('http://localhost/api/portal/upload', {
      method: 'POST',
      body: formData,
      headers: { 'x-forwarded-for': forwardedFor },
    }),
  })
}

const ipv4 = fc
  .tuple(
    fc.integer({ min: 1, max: 223 }),
    fc.nat(255),
    fc.nat(255),
    fc.integer({ min: 1, max: 254 })
  )
  .map((parts) => parts.join('.'))

/** What a client may write into X-Forwarded-For itself, left of the trusted hop. */
const forgedPrefix = fc.array(fc.oneof(ipv4, fc.constant('unknown'), fc.constant('::1')), {
  maxLength: 3,
})

function chain(forged: string[], clientAddress: string): string {
  return [...forged, clientAddress].join(', ')
}

beforeEach(() => {
  vi.clearAllMocks()
  buckets.clear()
  vi.mocked(getSettings).mockResolvedValue(ANONYMOUS_ALLOWED)
})

describe('nobody without a session can upload (H5)', () => {
  it('refuses a portal upload without a session, and stores nothing (H5, H4)', async () => {
    vi.mocked(auth.api.getSession).mockResolvedValueOnce(null)
    const response = await uploadFrom('203.0.113.7')
    expect(response.status).toBe(401)
    expect(uploadObject).not.toHaveBeenCalled()
  })

  it('refuses a session without a principal (H5, H4)', async () => {
    vi.mocked(auth.api.getSession).mockResolvedValueOnce(mockSession())
    vi.mocked(db.query.principal.findFirst).mockResolvedValueOnce(undefined)
    const response = await uploadFrom('203.0.113.7')
    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({ error: 'Forbidden' })
    expect(uploadObject).not.toHaveBeenCalled()
  })

  it('reads the session from the request itself, and the principal by that session (H5)', async () => {
    freshSession('user')
    const formData = new FormData()
    formData.append('file', mockImageFile('shot.png', 'image/png'))
    const request = new Request('http://localhost/api/portal/upload', {
      method: 'POST',
      body: formData,
      headers: { cookie: 'session=abc' },
    })
    await handlePortalUpload({ request })
    expect(auth.api.getSession).toHaveBeenCalledWith({ headers: request.headers })
    expect(db.query.principal.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ columns: { type: true } })
    )
  })

  it('is the handler the route serves for POST (H5)', () => {
    const options = Route.options as unknown as {
      server: { handlers: { POST: unknown } }
    }
    expect(options.server.handlers.POST).toBe(handlePortalUpload)
  })

  it('refuses a body that is not a form, and stores nothing (H4)', async () => {
    freshSession('user')
    const response = await handlePortalUpload({
      request: new Request('http://localhost/api/portal/upload', {
        method: 'POST',
        body: 'not a form',
        headers: { 'content-type': 'multipart/form-data; boundary=x' },
      }),
    })
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'Invalid request body' })
    expect(uploadObject).not.toHaveBeenCalled()
  })
})

describe('what the portal route stores (H1, H2, H4)', () => {
  function uploadFile(file: File): Promise<Response> {
    const formData = new FormData()
    formData.append('file', file)
    return handlePortalUpload({
      request: new Request('http://localhost/api/portal/upload', {
        method: 'POST',
        body: formData,
        headers: { 'x-forwarded-for': '203.0.113.7' },
      }),
    })
  }

  it('stores a WebM recording from an anonymous visitor (H1)', async () => {
    freshSession('anonymous')
    const response = await uploadFile(mockVideoFile('clip.webm', 'video/webm'))
    expect(response.status).toBe(200)
    expect(uploadObject).toHaveBeenCalledWith(
      expect.stringContaining('portal-media'),
      expect.any(Buffer),
      'video/webm'
    )
  })

  it('refuses a file whose bytes are not its type, and stores nothing (H2, H4)', async () => {
    freshSession('user')
    const pngBytes = await mockImageFile('shot.png', 'image/png').arrayBuffer()
    const response = await uploadFile(new File([pngBytes], 'clip.mp4', { type: 'video/mp4' }))
    expect(response.status).toBe(400)
    expect(uploadObject).not.toHaveBeenCalled()
  })

  it('reports a store that failed as a failure, never with an address (H4)', async () => {
    freshSession('user')
    vi.mocked(uploadObject).mockRejectedValueOnce(new Error('bucket unavailable'))
    const response = await uploadFile(mockVideoFile())
    expect(response.status).toBe(500)
    expect(await response.json()).not.toHaveProperty('publicUrl')
  })
})

describe('an anonymous visitor uploads only where anonymous visitors may post (H6)', () => {
  it('refuses an anonymous upload where the workspace holds anonymous posting back (H6, H4)', async () => {
    const heldBack = [
      ANONYMOUS_HELD_BACK,
      settingsWith(JSON.stringify({ features: {} })),
      settingsWith('{not json'),
      settingsWith(null),
      settingsWith({ features: { allowAnonymous: 'true' } }),
      null,
    ]
    for (const settings of heldBack) {
      vi.mocked(getSettings).mockResolvedValue(settings)
      freshSession('anonymous')
      const response = await uploadFrom('203.0.113.7')
      expect(response.status, JSON.stringify(settings)).toBe(403)
      expect(await response.json()).toEqual({ error: 'Forbidden' })
    }
    expect(uploadObject).not.toHaveBeenCalled()
  })

  it('accepts an anonymous upload where the workspace lets anonymous visitors post (H6)', async () => {
    for (const settings of [
      ANONYMOUS_ALLOWED,
      settingsWith({ features: { allowAnonymous: true } }),
    ]) {
      vi.mocked(getSettings).mockResolvedValue(settings)
      freshSession('anonymous')
      const response = await uploadFrom('203.0.113.7')
      expect(response.status).toBe(200)
    }
    expect(uploadObject).toHaveBeenCalledTimes(2)
  })

  it('does not let the workspace setting decide for a signed-in user (H6)', async () => {
    vi.mocked(getSettings).mockResolvedValue(ANONYMOUS_HELD_BACK)
    freshSession('user')
    const response = await uploadFrom('203.0.113.7')
    expect(response.status).toBe(200)
  })

  it('does not trust anything the client says about itself (H6)', async () => {
    vi.mocked(getSettings).mockResolvedValue(ANONYMOUS_HELD_BACK)
    freshSession('anonymous')
    const formData = new FormData()
    formData.append('file', mockImageFile('shot.png', 'image/png'))
    formData.append('allowAnonymous', 'true')
    formData.append('canPostAnonymously', 'true')
    const response = await handlePortalUpload({
      request: new Request('http://localhost/api/portal/upload?allowAnonymous=true', {
        method: 'POST',
        body: formData,
        headers: { 'x-forwarded-for': '203.0.113.7', 'x-allow-anonymous': 'true' },
      }),
    })
    expect(response.status).toBe(403)
  })
})

describe('uploads are limited per session and, for anonymous ones, per address (H7)', () => {
  it('limits one session to 20 uploads a minute (H7)', async () => {
    const statuses: number[] = []
    for (let attempt = 0; attempt < PER_SESSION_LIMIT + 1; attempt++) {
      sameSession('user_steady', 'user')
      statuses.push((await uploadFrom(`198.51.100.${attempt + 1}`)).status)
    }
    expect(statuses.slice(0, PER_SESSION_LIMIT).every((status) => status === 200)).toBe(true)
    expect(statuses[PER_SESSION_LIMIT]).toBe(429)
  })

  it('one address cannot reach 2 GB a minute by minting a session per upload (H7)', async () => {
    await fc.assert(
      fc.asyncProperty(
        ipv4,
        fc.array(forgedPrefix, { minLength: 25, maxLength: 25 }),
        async (address, prefixes) => {
          buckets.clear()
          let accepted = 0
          let refusedOnce = false
          for (const forged of prefixes) {
            freshSession('anonymous')
            const response = await uploadFrom(chain(forged, address))
            if (response.status === 200) {
              // Once refused, the address stays refused for the rest of the window.
              expect(refusedOnce).toBe(false)
              accepted += 1
            } else {
              expect(response.status).toBe(429)
              expect(response.headers.get('Retry-After')).toBe('42')
              refusedOnce = true
            }
          }
          expect(accepted).toBeGreaterThan(0)
          expect(accepted * LARGEST_VIDEO).toBeLessThan(TWO_GIGABYTES)
        }
      ),
      { numRuns: 20 }
    )
  })

  it('lets one address make exactly the ten anonymous uploads a minute chosen for it (H7)', async () => {
    // The per-address number is the operator-facing decision recorded with the
    // H7 fix: ten 100 MB videos, half of what one session may send.
    const statuses: number[] = []
    for (let attempt = 0; attempt < 11; attempt++) {
      freshSession('anonymous')
      statuses.push((await uploadFrom('203.0.113.80')).status)
    }
    expect(statuses).toEqual([...Array(10).fill(200), 429])
  })

  it('gives every client address its own budget (H7)', async () => {
    const addresses = ['203.0.113.1', '203.0.113.2', '2001:db8::5']
    for (const address of addresses) {
      let accepted = 0
      for (let attempt = 0; attempt < 25; attempt++) {
        freshSession('anonymous')
        if ((await uploadFrom(chain(['10.0.0.1'], address))).status === 200) accepted += 1
      }
      expect(accepted, address).toBeGreaterThan(0)
      expect(accepted * LARGEST_VIDEO, address).toBeLessThan(TWO_GIGABYTES)
    }
    freshSession('anonymous')
    expect((await uploadFrom('203.0.113.99')).status).toBe(200)
  })

  it('reads the address from the trusted hop, never from what the client forged (H7)', async () => {
    let refusedAt = -1
    for (let attempt = 0; attempt < 25 && refusedAt < 0; attempt++) {
      freshSession('anonymous')
      const forged = [`192.0.2.${attempt + 1}`]
      if ((await uploadFrom(chain(forged, '203.0.113.50'))).status === 429) refusedAt = attempt
    }
    expect(refusedAt).toBeGreaterThan(0)
    const addressKeys = [...buckets.keys()].filter((key) => key.includes(':ip:'))
    expect(addressKeys).toEqual([expect.stringContaining('203.0.113.50')])
    expect(addressKeys[0]).not.toContain('192.0.2.')
  })

  it('does not count a signed-in user against the address, so a shared office is not throttled (H7)', async () => {
    for (let attempt = 0; attempt < 25; attempt++) {
      freshSession('user')
      expect((await uploadFrom('203.0.113.60')).status).toBe(200)
    }
    expect([...buckets.keys()].some((key) => key.includes(':ip:'))).toBe(false)
  })

  it('refuses an over-limit anonymous upload before storing it (H7, H4)', async () => {
    let refused = 0
    for (let attempt = 0; attempt < 25; attempt++) {
      freshSession('anonymous')
      if ((await uploadFrom('203.0.113.70')).status === 429) refused += 1
    }
    expect(refused).toBeGreaterThan(0)
    expect(vi.mocked(uploadObject).mock.calls.length).toBe(25 - refused)
  })
})
