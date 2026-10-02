// @vitest-environment node
/**
 * The callback URI an OIDC provider is registered under: what the admin UI
 * shows, what sign-in sends, what test sign-in sends, and what still works for
 * a customer who registered the old URL.
 *
 * Contract for batch F, upstream #586 (`e339b9a38`, "advertise the callback URI
 * Better Auth actually sends for OIDC"). Items owned by this file, verbatim:
 *
 *   F7 The callback URI the admin UI shows for an OIDC provider is the one
 *      sign-in actually sends, and test sign-in uses the same one.
 *   F8 A return to the legacy callback path still completes sign-in.
 *
 * Found by F7: test sign-in stripped only ONE trailing slash from BASE_URL while the
 * admin UI and Better Auth strip all of them, so `https://host//` produced a test
 * redirect URI of `https://host//api/...`. `sso-test.ts` now strips `/+$`.
 *
 * The "sign-in actually sends" side is not read off our own helper: it is the
 * `redirect_uri` on the authorization request that Better Auth itself builds
 * (see oidc-contract-harness.ts), so a library that moves its path fails here.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest'
import fc from 'fast-check'

type AnyHandler = (args: { data: Record<string, unknown> }) => Promise<unknown>
const handlers: AnyHandler[] = []

vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => {
    const chain = {
      validator: () => chain,
      handler(fn: AnyHandler) {
        handlers.push(fn)
        return chain
      },
    }
    return chain
  },
}))

const hoisted = vi.hoisted(() => ({
  baseUrl: 'https://qb.test',
  cacheSet: vi.fn(),
  requireAuth: vi.fn(),
  listIdentityProviders: vi.fn(),
  getIdentityProviderCredentials: vi.fn(),
  safeFetch: vi.fn(),
}))

vi.mock('@/lib/server/cache', () => ({
  cacheGet: vi.fn(),
  cacheSet: hoisted.cacheSet,
  cacheDel: vi.fn(),
  CACHE_KEYS: {},
}))
vi.mock('@/lib/server/functions/auth-helpers', () => ({ requireAuth: hoisted.requireAuth }))
vi.mock('@/lib/server/domains/settings/identity-providers.service', () => ({
  listIdentityProviders: hoisted.listIdentityProviders,
  getIdentityProviderCredentials: hoisted.getIdentityProviderCredentials,
}))
vi.mock('@/lib/server/content/ssrf-guard', () => ({ safeFetch: hoisted.safeFetch }))
vi.mock('@/lib/server/config', () => ({
  config: {
    get baseUrl() {
      return hoisted.baseUrl
    },
  },
}))

await import('@/lib/server/functions/sso-test')
const startSsoTest = handlers[0]

import { redirectUriFor, newRegistrationId } from '../provider-shared'
import { rewriteLegacyOAuthCallback } from '@/lib/server/auth/legacy-oauth-callback'
import { isSsoTestCallbackPath } from '@/lib/shared/sso-test-keys'
import {
  BASE_URL,
  buildAuthFor,
  installIdentityProviderFetch,
  providerRow,
  returnToCallback,
  startIdentityProviderStub,
  startSignIn,
  type IdentityProviderStub,
} from '@/lib/server/auth/__tests__/oidc-contract-harness'

let stub: IdentityProviderStub

beforeAll(async () => {
  stub = await startIdentityProviderStub()
})

afterAll(() => {
  vi.unstubAllGlobals()
})

beforeEach(() => {
  hoisted.requireAuth.mockResolvedValue({ user: { id: 'user_admin' } })
  hoisted.cacheSet.mockReset()
})

const registrationIds = fc.oneof(
  fc.constant('sso'),
  fc.constant('custom-oidc'),
  fc.constant('oidc_0'),
  fc.stringMatching(/^[a-z0-9]{8}$/).map((suffix) => `oidc_${suffix}`),
  fc.constant(null).map(() => newRegistrationId())
)

/** Where the registered redirect URI is rooted; the deployment's own base URL. */
const origins = fc.constantFrom(
  'https://qb.test',
  'https://feedback.acme.example',
  'https://app.example',
  'http://localhost:3000'
)

/** How an operator may have written the same base URL in the environment. */
const trailingSlashes = fc.constantFrom('', '/', '//')

/** The URI test sign-in puts on the authorize request, and caches for the token exchange. */
async function redirectUrisOfTestSignIn(registrationId: string) {
  hoisted.listIdentityProviders.mockResolvedValue([
    {
      id: 'idp_1',
      registrationId,
      discoveryUrl: 'https://idp.example/.well-known/openid-configuration',
      clientId: 'client-1',
      domains: [],
    },
  ])
  hoisted.getIdentityProviderCredentials.mockResolvedValue({ clientSecret: 'secret' })
  hoisted.safeFetch.mockImplementation(
    async () =>
      new Response(
        JSON.stringify({
          issuer: 'https://idp.example',
          authorization_endpoint: 'https://idp.example/authorize',
          token_endpoint: 'https://idp.example/token',
          jwks_uri: 'https://idp.example/jwks',
        })
      )
  )
  hoisted.cacheSet.mockResolvedValue(undefined)
  hoisted.cacheSet.mockClear()

  const result = (await startSsoTest({ data: { registrationId } })) as { authorizeUrl: string }
  const [, session] = hoisted.cacheSet.mock.calls[0] as [string, { redirectUri: string }]
  return {
    onAuthorizeRequest: new URL(result.authorizeUrl).searchParams.get('redirect_uri'),
    onTokenExchange: session.redirectUri,
  }
}

describe('the callback URI for an OIDC provider (F7)', () => {
  it('(F7) the admin UI shows what sign-in sends, and test sign-in sends the same', async () => {
    installIdentityProviderFetch(stub)
    await fc.assert(
      fc.asyncProperty(registrationIds, origins, trailingSlashes, async (id, origin, slashes) => {
        const baseUrl = `${origin}${slashes}`
        hoisted.baseUrl = baseUrl

        const shownInAdminUi = redirectUriFor(baseUrl, id)

        const auth = await buildAuthFor(providerRow({ registrationId: id }), baseUrl)
        const start = await startSignIn(auth, id)
        const sentBySignIn = start.authorizeUrl.searchParams.get('redirect_uri')

        const testSignIn = await redirectUrisOfTestSignIn(id)

        expect(sentBySignIn).toBe(shownInAdminUi)
        expect(testSignIn.onAuthorizeRequest).toBe(shownInAdminUi)
        // The token exchange must present the very URI the authorize request carried.
        expect(testSignIn.onTokenExchange).toBe(testSignIn.onAuthorizeRequest)
      }),
      { numRuns: 40 }
    )
  })

  it('(F7) the URI points at the app and carries the provider id, not a fixed path', async () => {
    // Guards the property above against comparing three copies of one wrong value.
    installIdentityProviderFetch(stub)
    const auth = await buildAuthFor(providerRow({ registrationId: 'oidc_acme' }), BASE_URL)
    const start = await startSignIn(auth, 'oidc_acme')
    const sent = new URL(start.authorizeUrl.searchParams.get('redirect_uri') ?? '')
    expect(sent.origin).toBe(BASE_URL)
    expect(sent.pathname.endsWith('/oidc_acme')).toBe(true)
  })
})

describe('a return to the legacy callback path (F8)', () => {
  const LEGACY_PREFIX = '/api/auth/oauth2/callback/'

  it('(F8) completes sign-in, and does not without the rewrite', async () => {
    installIdentityProviderFetch(stub)
    await fc.assert(
      fc.asyncProperty(registrationIds, async (id) => {
        const auth = await buildAuthFor(providerRow({ registrationId: id }), BASE_URL)
        const start = await startSignIn(auth, id)
        const viaLegacyPath = await returnToCallback(
          auth,
          start,
          `${LEGACY_PREFIX}${id}`,
          rewriteLegacyOAuthCallback
        )
        expect(viaLegacyPath.signedIn).toBe(true)
        expect(viaLegacyPath.location).not.toContain('error=')

        // Control: the same return, left alone, is not served by the library.
        const authAgain = await buildAuthFor(providerRow({ registrationId: id }), BASE_URL)
        const startAgain = await startSignIn(authAgain, id)
        const withoutRewrite = await returnToCallback(
          authAgain,
          startAgain,
          `${LEGACY_PREFIX}${id}`
        )
        expect(withoutRewrite.signedIn).toBe(false)
      }),
      { numRuns: 15 }
    )
  })

  it('(F8) is still recognised as a possible test sign-in return, as is the current path', () => {
    fc.assert(
      fc.property(registrationIds, (id) => {
        expect(isSsoTestCallbackPath(`${LEGACY_PREFIX}${id}`)).toBe(true)
        expect(isSsoTestCallbackPath(`/api/auth/callback/${id}`)).toBe(true)
      })
    )
  })

  it('(F8) keeps the query the identity provider sent when it rewrites the path', () => {
    fc.assert(
      fc.property(
        registrationIds,
        fc.stringMatching(/^[A-Za-z0-9_-]{1,40}$/),
        fc.stringMatching(/^[A-Za-z0-9_-]{1,40}$/),
        (id, code, state) => {
          const legacy = new Request(`${BASE_URL}${LEGACY_PREFIX}${id}?code=${code}&state=${state}`)
          const rewritten = new URL(rewriteLegacyOAuthCallback(legacy).url)
          expect(rewritten.pathname).toBe(`/api/auth/callback/${id}`)
          expect(rewritten.searchParams.get('code')).toBe(code)
          expect(rewritten.searchParams.get('state')).toBe(state)
        }
      )
    )
  })
})
