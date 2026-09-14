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
vi.mock('@/lib/server/logger', () => ({
  logger: { child: () => ({ info: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}))
// Hands the route's own options straight back, so the exported Route carries
// the POST handler the server would call without a router being built.
vi.mock('@tanstack/react-router', () => ({
  createFileRoute: vi.fn(() => (opts: unknown) => ({ options: opts })),
}))

import { Route, handleWidgetInstallContext } from '../install-context'
import { widgetJsonError } from '@/lib/server/widget/public-endpoint'

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

describe('the install-context route', () => {
  type PostHandler = (ctx: { request: Request }) => Promise<Response>

  it('serves the redeem handler as its POST method (P2)', async () => {
    const { POST } = (
      Route as unknown as { options: { server: { handlers: { POST: PostHandler } } } }
    ).options.server.handlers

    const res = await POST({ request: post({ code: 'qbi_validcode12' }) })

    expect(res.status).toBe(200)
    expect(redeemWidgetInstallCode).toHaveBeenCalledWith('qbi_validcode12')
  })
})
