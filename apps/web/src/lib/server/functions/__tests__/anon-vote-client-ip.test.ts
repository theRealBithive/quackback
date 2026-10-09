/**
 * The anonymous vote limiter counts the anonymous sessions Better Auth created
 * from the voter's address in the last hour, by comparing the address it is
 * handed with the `ipAddress` stored on each session. So "the same address" is
 * not a matter of resolving it the same way: it has to be the same string
 * Better Auth stored, or the count is zero and the limit never applies.
 *
 * Checked against a real Better Auth instance (memory adapter, anonymous
 * plugin) configured the way the app configures it, so the comparison is with
 * what the library actually records rather than with a copy of its rules.
 *
 * Contract (confirmed list for batch K, upstream #662; the full list is in
 * auth/__tests__/client-ip.test.ts):
 *
 *   C5 When no address can be determined, nothing the client wrote is used in
 *      its place.
 *   C6 Anonymous votes are rate-limited by the same address.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import fc from 'fast-check'
import { betterAuth } from 'better-auth'
import { memoryAdapter } from 'better-auth/adapters/memory'
import { anonymous } from 'better-auth/plugins'

const hoisted = vi.hoisted(() => ({
  proxy: { hops: 0 },
  requestHeaders: new Headers(),
  getRequestIP: vi.fn(),
  requireAuth: vi.fn(),
  getSettings: vi.fn(),
  checkAnonVoteRateLimit: vi.fn(async (_ip: string) => true),
  voteOnPost: vi.fn(async () => ({ voted: true, voteCount: 1 })),
}))

// The exported const stays callable, so the suite reaches toggleVoteFn by name.
vi.mock('@tanstack/react-start', () => ({
  // #555 moved handler bodies into createServerOnlyFn helpers; run them as-is.
  createServerOnlyFn: <T>(fn: T) => fn,
  createServerFn: () => {
    const chain = {
      validator: () => chain,
      handler: (fn: (args: unknown) => unknown) =>
        Object.assign((args: unknown) => fn(args ?? {}), chain),
    }
    return chain
  },
}))
vi.mock('@tanstack/react-start/server', () => ({
  getRequestHeaders: () => hoisted.requestHeaders,
  getRequestIP: hoisted.getRequestIP,
}))
vi.mock('@/lib/server/config', () => ({
  config: {
    get trustedProxyHops() {
      return hoisted.proxy.hops
    },
  },
}))
vi.mock('@/lib/server/functions/auth-helpers', () => ({
  requireAuth: hoisted.requireAuth,
  getOptionalAuth: vi.fn(),
  hasAuthCredentials: vi.fn(() => false),
  hasSessionCookie: vi.fn(() => false),
  policyActorFromAuth: vi.fn(async () => ({ principalId: null, role: null })),
}))
vi.mock('@/lib/server/functions/portal-access', () => ({
  resolvePortalAccessForRequest: vi.fn(async () => ({ granted: true, reason: 'public' })),
}))
vi.mock('@/lib/server/domains/posts/post.access', () => ({
  assertPostViewable: vi.fn(async () => undefined),
  assertPostVotable: vi.fn(async () => undefined),
}))
vi.mock('@/lib/server/functions/workspace', () => ({ getSettings: hoisted.getSettings }))
vi.mock('@/lib/server/utils/anon-rate-limit', () => ({
  checkAnonVoteRateLimit: hoisted.checkAnonVoteRateLimit,
}))
vi.mock('@/lib/server/domains/posts/post.voting', () => ({ voteOnPost: hoisted.voteOnPost }))
vi.mock('@/lib/server/domains/posts/post.public', () => ({
  listPublicPosts: vi.fn(),
  getAllUserVotedPostIds: vi.fn(),
}))
vi.mock('@/lib/server/domains/posts/post.service', () => ({ createPost: vi.fn() }))
vi.mock('@/lib/server/domains/posts/post.permissions', () => ({ getPostPermissions: vi.fn() }))
vi.mock('@/lib/server/domains/posts/post.user-actions', () => ({
  userEditPost: vi.fn(),
  softDeletePost: vi.fn(),
}))
vi.mock('@/lib/server/domains/boards/board.public', () => ({ getPublicBoardById: vi.fn() }))
vi.mock('@/lib/server/domains/statuses/status.service', () => ({ getDefaultStatus: vi.fn() }))
vi.mock('@/lib/server/domains/principals/principal.service', () => ({
  getMemberByUser: vi.fn(),
}))
vi.mock('@/lib/server/domains/roadmaps/roadmap.service', () => ({ listPublicRoadmaps: vi.fn() }))
vi.mock('@/lib/server/domains/roadmaps/roadmap.query', () => ({
  getPublicRoadmapPosts: vi.fn(),
}))
vi.mock('@/lib/server/policy/authorize', () => ({ can: vi.fn() }))
vi.mock('@/lib/server/sanitize-tiptap', () => ({ sanitizeTiptapContent: (v: unknown) => v }))

const ANON_AUTH = {
  principal: { id: 'principal_anon', type: 'anonymous', role: 'user' },
  user: { id: 'user_anon' },
}

beforeEach(() => {
  vi.clearAllMocks()
  hoisted.proxy.hops = 0
  hoisted.requireAuth.mockResolvedValue(ANON_AUTH)
  hoisted.getSettings.mockResolvedValue({ portalConfig: { features: { allowAnonymous: true } } })
})

/** The address the vote limiter was handed for one anonymous vote with these headers. */
async function addressTheVoteIsCountedUnder(headers: Headers): Promise<string> {
  const { toggleVoteFn } = await import('../public-posts')
  hoisted.checkAnonVoteRateLimit.mockClear()
  hoisted.requestHeaders = headers

  await (toggleVoteFn as unknown as (args: unknown) => Promise<unknown>)({
    data: { postId: 'post_1' },
  })

  expect(hoisted.checkAnonVoteRateLimit).toHaveBeenCalledTimes(1)
  return hoisted.checkAnonVoteRateLimit.mock.calls[0][0]
}

/** The `ipAddress` a real Better Auth instance stores on an anonymous session minted with these headers. */
async function addressStoredOnAnonymousSession(headers: Headers): Promise<unknown> {
  const { betterAuthIpAddressOptions, withTrustedClientIpRequest } =
    await import('@/lib/server/auth/client-ip')
  const tables = { user: [], session: [] as Record<string, unknown>[], account: [] }
  const instance = betterAuth({
    baseURL: 'https://acme.example',
    secret: 'test-secret-not-used-for-anything-real',
    database: memoryAdapter(tables),
    plugins: [anonymous()],
    advanced: { ipAddress: betterAuthIpAddressOptions },
    rateLimit: { enabled: false },
  })
  const response = await instance.handler(
    withTrustedClientIpRequest(
      new Request('https://acme.example/api/auth/sign-in/anonymous', {
        method: 'POST',
        headers,
        body: '{}',
      })
    )
  )
  expect(response.status).toBe(200)
  return tables.session[0]?.ipAddress
}

const ipAddress = fc.oneof(
  fc.ipV4(),
  fc.ipV6(),
  fc.ipV4().map((v4) => `::ffff:${v4}`)
)

/** A request from a determinable address: the peer directly, or the trusted hop behind proxies. */
const requestFromKnownAddress = fc.integer({ min: 0, max: 3 }).chain((hops) =>
  fc.record({
    hops: fc.constant(hops),
    peer: ipAddress,
    realClient: ipAddress,
    innerProxies: fc.array(fc.ipV4(), {
      minLength: Math.max(0, hops - 1),
      maxLength: Math.max(0, hops - 1),
    }),
    prefix: fc.array(fc.oneof(fc.ipV4(), fc.constantFrom('unknown', 'junk')), { maxLength: 3 }),
    spoofedPrivateHeader: fc.ipV4(),
  })
)

describe('the address an anonymous vote is counted under', () => {
  it('is the address Better Auth stored on the anonymous sessions it counts (C6)', async () => {
    await fc.assert(
      fc.asyncProperty(requestFromKnownAddress, async (request) => {
        hoisted.proxy.hops = request.hops
        hoisted.getRequestIP.mockReturnValue(request.peer)
        const forwarded = [...request.prefix, request.realClient, ...request.innerProxies]
        const headers = new Headers({
          'content-type': 'application/json',
          'x-forwarded-for': forwarded.join(', '),
          'x-quackback-client-ip': request.spoofedPrivateHeader,
        })

        const stored = await addressStoredOnAnonymousSession(headers)
        const counted = await addressTheVoteIsCountedUnder(headers)

        expect(counted).toBe(stored)
      }),
      { numRuns: 60 }
    )
  })

  it('is nothing the client wrote when the peer is unknown (C5)', async () => {
    await fc.assert(
      // Better Auth answers 127.0.0.1 for an unresolvable request under test
      // (and nothing in production), so that one value says nothing here.
      fc.asyncProperty(
        fc.ipV4().filter((ip) => ip !== '127.0.0.1'),
        async (spoofed) => {
          hoisted.proxy.hops = 0
          hoisted.getRequestIP.mockReturnValue(undefined)

          const counted = await addressTheVoteIsCountedUnder(
            new Headers({
              'x-forwarded-for': spoofed,
              'x-real-ip': spoofed,
              'x-quackback-client-ip': spoofed,
            })
          )

          expect(counted).not.toBe(spoofed)
        }
      ),
      { numRuns: 50 }
    )
  })
})

describe('an anonymous voter over the limit', () => {
  // Not a batch J guarantee: the limiter predates #555, which only moved it
  // into the run helper the widget shares. This pins that the move kept it.
  it('is refused, and no vote is recorded', async () => {
    const { toggleVoteFn } = await import('../public-posts')
    hoisted.getRequestIP.mockReturnValue('203.0.113.9')
    hoisted.checkAnonVoteRateLimit.mockResolvedValueOnce(false)

    await expect(
      (toggleVoteFn as unknown as (args: unknown) => Promise<unknown>)({
        data: { postId: 'post_1' },
      })
    ).rejects.toThrow(/Too many votes/)
    expect(hoisted.voteOnPost).not.toHaveBeenCalled()
  })
})
