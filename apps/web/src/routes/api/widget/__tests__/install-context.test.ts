/**
 * ## P — Widget install pairing (upstream 98b18e3ee)
 * - P2 The host app redeems the pairing code over HTTP; a malformed body is a
 *   400 validation error.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import fc from 'fast-check'

const redeemWidgetInstallCode = vi.fn()
const enforcePerIpLimit = vi.fn()
const pooled = { current: false }

vi.mock('@/lib/server/domains/settings/widget-install-pairing', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/lib/server/domains/settings/widget-install-pairing')>()
  return {
    ...actual,
    redeemWidgetInstallCode: (...a: unknown[]) => redeemWidgetInstallCode(...a),
  }
})
vi.mock('@/lib/server/widget/public-endpoint', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/server/widget/public-endpoint')>()
  return {
    ...actual,
    enforcePerIpLimit: (...a: unknown[]) => enforcePerIpLimit(...a),
  }
})
vi.mock('@/lib/server/workspaces/mode', () => ({
  isPooledTenancy: () => pooled.current,
}))
// Plain arrays rather than spies: the route registers itself once, while the
// module is imported, and `vi.clearAllMocks()` in beforeEach would wipe a spy's
// record of that before any test could read it. Hoisted, because the import
// that triggers the registration runs before a plain `const` is initialised.
const { logLines, fileRoutePaths } = vi.hoisted(() => ({
  logLines: [] as { level: string; args: unknown[] }[],
  fileRoutePaths: [] as unknown[],
}))

function recordingLogger() {
  const record =
    (level: string) =>
    (...args: unknown[]) => {
      logLines.push({ level, args })
    }
  return {
    trace: record('trace'),
    debug: record('debug'),
    info: record('info'),
    warn: record('warn'),
    error: record('error'),
    fatal: record('fatal'),
    child: () => recordingLogger(),
  }
}

vi.mock('@/lib/server/logger', () => ({ logger: recordingLogger() }))
// Hands the route's own options straight back, so the exported Route carries
// the POST handler the server would call without a router being built, and
// keeps the path it was registered under.
vi.mock('@tanstack/react-router', () => ({
  createFileRoute: vi.fn((path: unknown) => {
    fileRoutePaths.push(path)
    return (opts: unknown) => ({ options: opts })
  }),
}))

import { Route, handleWidgetInstallContext } from '../install-context'
import { widgetCorsHeaders, widgetJsonError } from '@/lib/server/widget/public-endpoint'

function post(
  body: unknown,
  url = 'http://127.0.0.1:3020/api/widget/install-context',
  extraHeaders: Record<string, string> = {}
) {
  return new Request(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-forwarded-for': '203.0.113.9',
      ...extraHeaders,
    },
    body: JSON.stringify(body),
  })
}

/** A body the handler has to read as text: not necessarily valid JSON. */
function rawPost(body: string) {
  return new Request('http://127.0.0.1:3020/api/widget/install-context', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-forwarded-for': '203.0.113.9',
    },
    body,
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  logLines.length = 0
  pooled.current = false
  enforcePerIpLimit.mockResolvedValue(null)
  redeemWidgetInstallCode.mockResolvedValue({
    instanceUrl: 'https://feedback.example.com',
    sdkUrl: 'https://feedback.example.com/api/widget/sdk.js',
    signingSecret: 'wgt_fromredeem',
  })
})

describe('POST /api/widget/install-context', () => {
  it('returns instance URL, sdk URL, and signing secret on a valid code', async () => {
    const res = await handleWidgetInstallContext(post({ code: 'qbi_validcode12' }))
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({
      instanceUrl: 'https://feedback.example.com',
      sdkUrl: 'https://feedback.example.com/api/widget/sdk.js',
      signingSecret: 'wgt_fromredeem',
    })
    expect(redeemWidgetInstallCode).toHaveBeenCalledWith('qbi_validcode12')
    expect(enforcePerIpLimit).toHaveBeenCalledWith(
      expect.any(Request),
      expect.objectContaining({
        keyPrefix: 'widget:install-context',
        limit: 20,
        windowSeconds: 15 * 60,
      })
    )
  })

  it('rejects an unknown or spent code', async () => {
    redeemWidgetInstallCode.mockResolvedValue(null)
    const res = await handleWidgetInstallContext(post({ code: 'qbi_unknowncode' }))
    expect(res.status).toBe(404)
    await expect(res.json()).resolves.toMatchObject({ error: { code: 'CODE_INVALID' } })
  })

  it('rate-limits by IP', async () => {
    enforcePerIpLimit.mockResolvedValue(
      widgetJsonError(429, 'RATE_LIMITED', 'Too many install attempts, try again later')
    )
    const res = await handleWidgetInstallContext(post({ code: 'qbi_validcode12' }))
    expect(res.status).toBe(429)
    expect(redeemWidgetInstallCode).not.toHaveBeenCalled()
  })

  it('requires HTTPS on Cloud (pooled tenancy)', async () => {
    pooled.current = true
    const res = await handleWidgetInstallContext(post({ code: 'qbi_validcode12' }))
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({ error: { code: 'HTTPS_REQUIRED' } })
    expect(redeemWidgetInstallCode).not.toHaveBeenCalled()
  })

  it('allows HTTPS Cloud redeem', async () => {
    pooled.current = true
    const res = await handleWidgetInstallContext(
      post({ code: 'qbi_validcode12' }, 'https://acme.quackback.app/api/widget/install-context', {
        'x-forwarded-proto': 'https',
      })
    )
    expect(res.status).toBe(200)
  })

  it('trusts the first forwarded proto on Cloud', async () => {
    pooled.current = true
    const res = await handleWidgetInstallContext(
      post({ code: 'qbi_validcode12' }, 'http://internal/api/widget/install-context', {
        'x-forwarded-proto': 'https, http',
      })
    )
    expect(res.status).toBe(200)
  })
})

describe('POST /api/widget/install-context refuses a malformed body', () => {
  it('answers 400 when the body is not JSON at all (P2)', async () => {
    const res = await handleWidgetInstallContext(rawPost('this is not json'))

    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({ error: { code: 'VALIDATION_ERROR' } })
    expect(redeemWidgetInstallCode).not.toHaveBeenCalled()
  })

  it('answers 400 when the code is too short to be a pairing code (P2)', async () => {
    const res = await handleWidgetInstallContext(post({ code: 'qbi_123' }))

    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({ error: { code: 'VALIDATION_ERROR' } })
    expect(redeemWidgetInstallCode).not.toHaveBeenCalled()
  })

  it('answers 400 when the body carries no code at all (P2)', async () => {
    const res = await handleWidgetInstallContext(post({ secret: 'wgt_notacode' }))

    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({ error: { code: 'VALIDATION_ERROR' } })
    expect(redeemWidgetInstallCode).not.toHaveBeenCalled()
  })

  it('never reaches the pairing store for any malformed body (P2)', async () => {
    // Characters that survive a trim, so length stays the reason it is refused.
    const opaque = (min: number, max: number) =>
      fc
        .array(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789_'), {
          minLength: min,
          maxLength: max,
        })
        .map((chars) => chars.join(''))

    const malformedBody = fc.oneof(
      fc.constant('this is not json'),
      fc.constant(''),
      fc.constant('{"code":'),
      fc.constant(JSON.stringify(null)),
      fc.constant(JSON.stringify('qbi_justastring')),
      fc.constant(JSON.stringify([{ code: 'qbi_inanarray' }])),
      fc.constant(JSON.stringify({})),
      fc.integer().map((n) => JSON.stringify({ code: n })),
      fc.boolean().map((b) => JSON.stringify({ code: b })),
      opaque(0, 7).map((code) => JSON.stringify({ code })),
      opaque(81, 140).map((code) => JSON.stringify({ code }))
    )

    await fc.assert(
      fc.asyncProperty(malformedBody, async (body) => {
        redeemWidgetInstallCode.mockClear()

        const res = await handleWidgetInstallContext(rawPost(body))

        expect(res.status).toBe(400)
        expect(await res.json()).toMatchObject({ error: { code: 'VALIDATION_ERROR' } })
        expect(redeemWidgetInstallCode).not.toHaveBeenCalled()
      }),
      { numRuns: 200 }
    )
  })

  it('still redeems a well-formed code, so the refusal is about the body (P2)', async () => {
    const res = await handleWidgetInstallContext(
      rawPost(JSON.stringify({ code: '  qbi_padded12  ' }))
    )

    expect(res.status).toBe(200)
    expect(redeemWidgetInstallCode).toHaveBeenCalledWith('qbi_padded12')
  })
})

describe('the HTTPS gate a pooled instance puts in front of the redeem', () => {
  const body = { code: 'qbi_validcode12' }
  const httpsUrl = 'https://acme.quackback.app/api/widget/install-context'
  const httpUrl = 'http://internal.acme/api/widget/install-context'

  it('refuses a hop the proxy took over plain http, https URL or not (P2)', async () => {
    pooled.current = true

    const res = await handleWidgetInstallContext(
      post(body, httpsUrl, { 'x-forwarded-proto': 'http' })
    )

    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toEqual({
      error: { code: 'HTTPS_REQUIRED', message: 'Redeem pairing codes over HTTPS' },
    })
    expect(redeemWidgetInstallCode).not.toHaveBeenCalled()
  })

  it('refuses when the first hop of the chain is plain http (P2)', async () => {
    pooled.current = true

    const res = await handleWidgetInstallContext(
      post(body, httpsUrl, { 'x-forwarded-proto': 'http, https' })
    )

    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({ error: { code: 'HTTPS_REQUIRED' } })
  })

  it('trims the first hop before reading it, so padding in the chain is not a refusal (P2)', async () => {
    pooled.current = true

    // The Request constructor strips padding around the whole header value, so
    // only an interior hop can still carry it by the time the route reads it.
    const res = await handleWidgetInstallContext(
      post(body, httpUrl, { 'x-forwarded-proto': 'https , http' })
    )

    expect(res.status).toBe(200)
    expect(redeemWidgetInstallCode).toHaveBeenCalledWith('qbi_validcode12')
  })

  it('falls back to the request URL when no proxy announced a protocol (P2)', async () => {
    pooled.current = true

    const res = await handleWidgetInstallContext(post(body, httpsUrl))

    expect(res.status).toBe(200)
    expect(redeemWidgetInstallCode).toHaveBeenCalledWith('qbi_validcode12')
  })

  it('refuses a plain http request URL when no proxy announced a protocol (P2)', async () => {
    pooled.current = true

    const res = await handleWidgetInstallContext(post(body, httpUrl))

    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({ error: { code: 'HTTPS_REQUIRED' } })
    expect(redeemWidgetInstallCode).not.toHaveBeenCalled()
  })

  it('decides on the first announced hop alone, whatever follows it (P2)', async () => {
    pooled.current = true
    // No whitespace-only hop: a header that normalises to the empty string is
    // no header at all, and then the request URL decides instead.
    const hop = fc.constantFrom('https', 'http', 'ftp', 'https ', ' http', 'httpsx')

    await fc.assert(
      fc.asyncProperty(
        hop,
        fc.array(hop, { maxLength: 3 }),
        fc.constantFrom(httpUrl, httpsUrl),
        async (firstHop, laterHops, requestUrl) => {
          redeemWidgetInstallCode.mockClear()
          const chain = [firstHop, ...laterHops].join(',')

          const res = await handleWidgetInstallContext(
            post(body, requestUrl, { 'x-forwarded-proto': chain })
          )

          const arrivedOverHttps = firstHop.trim() === 'https'
          expect(res.status).toBe(arrivedOverHttps ? 200 : 400)
          expect(redeemWidgetInstallCode).toHaveBeenCalledTimes(arrivedOverHttps ? 1 : 0)
        }
      ),
      { numRuns: 200 }
    )
  })
})

describe('what the install-context endpoint tells the host app', () => {
  it('names the attempt limit in the message the caller is handed (P2)', async () => {
    await handleWidgetInstallContext(post({ code: 'qbi_validcode12' }))

    expect(enforcePerIpLimit).toHaveBeenCalledWith(expect.any(Request), {
      keyPrefix: 'widget:install-context',
      limit: 20,
      windowSeconds: 15 * 60,
      message: 'Too many install attempts, try again later',
    })
  })

  it('names the body as the reason a malformed request is refused (P2)', async () => {
    const res = await handleWidgetInstallContext(rawPost('this is not json'))

    await expect(res.json()).resolves.toEqual({
      error: { code: 'VALIDATION_ERROR', message: 'Invalid request body' },
    })
  })

  it('names the code as invalid or expired when the redeem finds nothing (P2)', async () => {
    redeemWidgetInstallCode.mockResolvedValue(null)

    const res = await handleWidgetInstallContext(post({ code: 'qbi_unknowncode' }))

    await expect(res.json()).resolves.toEqual({
      error: { code: 'CODE_INVALID', message: 'Invalid or expired install code' },
    })
  })

  it('answers a successful redeem with the widget CORS headers (P2)', async () => {
    const res = await handleWidgetInstallContext(post({ code: 'qbi_validcode12' }))

    expect(res.status).toBe(200)
    // Spelled out as well as compared, so an empty header set cannot satisfy
    // the loop by having nothing to check.
    expect(res.headers.get('access-control-allow-origin')).toBe('*')
    expect(res.headers.get('cache-control')).toBe('no-store')
    for (const [header, value] of Object.entries(widgetCorsHeaders())) {
      expect(res.headers.get(header)).toBe(value)
    }
  })

  it('records the redeemed pairing in the operator log (P2)', async () => {
    await handleWidgetInstallContext(post({ code: 'qbi_validcode12' }))

    expect(logLines).toContainEqual({ level: 'info', args: ['widget install pairing redeemed'] })
  })
})

describe('the install-context route', () => {
  type PostHandler = (ctx: { request: Request }) => Promise<Response>

  it('is registered under the widget install-context path (P2)', () => {
    expect(fileRoutePaths).toEqual(['/api/widget/install-context'])
  })

  it('serves the redeem handler as its POST method (P2)', async () => {
    const { POST } = (
      Route as unknown as { options: { server: { handlers: { POST: PostHandler } } } }
    ).options.server.handlers

    const res = await POST({ request: post({ code: 'qbi_validcode12' }) })

    expect(res.status).toBe(200)
    expect(redeemWidgetInstallCode).toHaveBeenCalledWith('qbi_validcode12')
  })
})
