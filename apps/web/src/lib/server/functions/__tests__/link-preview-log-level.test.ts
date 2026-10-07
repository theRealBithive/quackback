/**
 * A caller the unfurl endpoint refuses (signed out, or a session it does not
 * serve) is expected traffic and logs at warn; a failure while unfurling is
 * still an error.
 *
 * Upstream drives this through a helper module this fork does not have
 * (`@/test/server-fns-in-process`); here `createServerFn` is replaced by a
 * chain whose `.handler(fn)` returns a callable, so the exported const runs
 * the real handler body.
 *
 * Contract (confirmed list for batch K, upstream #688; the full list is in
 * lib/server/__tests__/runtime-error-log.test.ts):
 *
 *   L6 A caller without a usable session at the link-preview endpoint is
 *      logged as a warning.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import fc from 'fast-check'

const hoisted = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  unfurlExternalUrl: vi.fn(),
  log: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))

vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => {
    const chain = {
      validator: () => chain,
      handler: (fn: (args: unknown) => unknown) =>
        Object.assign((args: unknown) => fn(args ?? {}), chain),
    }
    return chain
  },
}))
vi.mock('@/lib/server/functions/auth-helpers', () => ({ requireAuth: hoisted.requireAuth }))
vi.mock('@/lib/server/domains/settings/settings.service', () => ({
  isFeatureEnabled: vi.fn(async () => true),
}))
vi.mock('@/lib/server/content/unfurl', () => ({ unfurlExternalUrl: hoisted.unfurlExternalUrl }))
vi.mock('@/lib/server/cache', () => ({
  cacheGet: vi.fn(async () => null),
  cacheSet: vi.fn(async () => undefined),
}))
vi.mock('@/lib/server/utils/rate-bucket', () => ({ incrementBuckets: vi.fn(async () => [1, 1]) }))
vi.mock('@/lib/server/domains/api/rate-limit', () => ({ getClientIp: () => '203.0.113.7' }))
vi.mock('@tanstack/react-start/server', () => ({ getRequestHeaders: () => new Headers() }))
vi.mock('@/lib/server/logger', () => ({ logger: { child: () => hoisted.log } }))

const URL_IN = 'https://news.example/post'

async function unfurl(url: string): Promise<unknown> {
  const { unfurlLinkFn } = await import('../link-preview')
  return (unfurlLinkFn as unknown as (args: unknown) => Promise<unknown>)({ data: { url } })
}

beforeEach(() => vi.clearAllMocks())

describe('unfurlLinkFn log level', () => {
  it('logs an auth denial at warn, not error, and renders no card (L6)', async () => {
    hoisted.requireAuth.mockRejectedValue(
      new Error('Access denied: Widget sessions cannot access this resource')
    )

    await expect(unfurl(URL_IN)).resolves.toBeNull()

    expect(hoisted.log.error).not.toHaveBeenCalled()
    expect(hoisted.log.warn).toHaveBeenCalledTimes(1)
  })

  it('logs every way a caller can lack a usable session at warn (L6)', async () => {
    const denial = fc.oneof(
      fc.constant('Authentication required'),
      fc.string().map((reason) => `Access denied: ${reason}`),
      fc.string().map((reason) => `Authentication required: ${reason}`)
    )
    await fc.assert(
      fc.asyncProperty(denial, async (message) => {
        vi.clearAllMocks()
        hoisted.requireAuth.mockRejectedValue(new Error(message))

        await expect(unfurl(URL_IN)).resolves.toBeNull()

        expect(hoisted.log.warn).toHaveBeenCalledTimes(1)
        expect(hoisted.log.error).not.toHaveBeenCalled()
      }),
      { numRuns: 100 }
    )
  })

  it('still logs an unexpected failure at error (L6)', async () => {
    hoisted.requireAuth.mockResolvedValue({
      principal: { id: 'principal_1', role: 'admin' },
      user: { id: 'user_1' },
    })
    hoisted.unfurlExternalUrl.mockRejectedValue(new TypeError('socket hang up'))

    await expect(unfurl(URL_IN)).resolves.toBeNull()

    expect(hoisted.log.error).toHaveBeenCalledTimes(1)
    expect(hoisted.log.warn).not.toHaveBeenCalled()
  })
})
