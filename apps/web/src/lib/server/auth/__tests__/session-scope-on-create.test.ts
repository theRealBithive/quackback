/**
 * The audience a freshly minted session is stamped with.
 *
 * Two separate claims, and the split matters. `stampSessionAudience` is the
 * rule — which sign-in path belongs to the widget — and it is a pure function,
 * so it is read directly. Whether the rule is *reached* is a fact about the
 * Better Auth options object, and nothing about the function can show it: a
 * hook nobody wired in passes every unit test it has. So the options the real
 * `createAuth()` hands the library are captured and asserted too. Only the
 * library and the edges are doubled here; what is checked is what production
 * builds.
 *
 * Contract (from the confirmed list for this batch; the full list is in
 * functions/__tests__/auth-scope.test.ts):
 *
 *   R1 A session is stamped with the audience it was minted for: the
 *      dashboard, the embedded widget, or the customer portal.
 *   R5 An anonymous visitor the widget signs in lazily gets a widget session,
 *      although nothing identified them.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import fc from 'fast-check'

const hoisted = vi.hoisted(() => ({
  betterAuth: vi.fn((_options: unknown) => ({ api: {}, handler: vi.fn() })),
}))

vi.mock('@/lib/server/config', () => ({
  config: {
    get baseUrl() {
      return 'https://feedback.example.com'
    },
  },
  getBaseUrl: () => 'https://feedback.example.com',
}))
vi.mock('better-auth', () => ({
  betterAuth: (options: unknown) => hoisted.betterAuth(options),
}))
vi.mock('better-auth/adapters/drizzle', () => ({ drizzleAdapter: vi.fn(() => ({})) }))
vi.mock('better-auth/tanstack-start', () => ({ tanstackStartCookies: vi.fn(() => ({})) }))
vi.mock('@better-auth/mcp', () => ({ mcp: vi.fn(() => ({ id: 'mcp' })) }))
vi.mock('better-auth/plugins', () => ({
  anonymous: vi.fn(() => ({ id: 'anonymous' })),
  emailOTP: vi.fn(() => ({ id: 'emailOTP' })),
  oneTimeToken: vi.fn(() => ({ id: 'oneTimeToken' })),
  magicLink: vi.fn(() => ({ id: 'magicLink' })),
  jwt: vi.fn(() => ({ id: 'jwt' })),
  genericOAuth: vi.fn(() => ({ id: 'genericOAuth' })),
  bearer: vi.fn(() => ({ id: 'bearer' })),
  twoFactor: vi.fn(() => ({ id: 'twoFactor' })),
}))
vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: {
    insert: () => ({ values: () => ({ async onConflictDoNothing() {} }) }),
    query: {},
  },
}))
vi.mock('@quackback/email', () => ({
  isEmailConfigured: () => false,
  sendPasswordResetEmail: vi.fn(),
  sendVerifyAddressEmail: vi.fn(),
}))
vi.mock('@/lib/server/secret-key', () => ({ activeSecretKey: () => 'test-secret' }))
vi.mock('@/lib/server/domains/platform-credentials/platform-credential.service', () => ({
  getPlatformCredentials: vi.fn(async () => null),
}))
vi.mock('@/lib/server/domains/settings/tier-limits.service', () => ({
  getTierLimits: vi.fn(async () => ({ features: { customOidcProvider: false } })),
}))
vi.mock('@/lib/server/domains/settings/settings.service', () => ({
  getWorkspaceSettings: vi.fn(async () => null),
}))
vi.mock('@/lib/server/domains/settings/identity-providers.service', () => ({
  listIdentityProviders: vi.fn(async () => []),
  getIdentityProviderCredentials: vi.fn(async () => null),
}))
vi.mock('@/lib/server/auth/build-oauth-configs', () => ({
  buildGenericOAuthConfigs: vi.fn(async () => []),
}))
vi.mock('@/lib/server/domains/principals/principal.factory', () => ({
  ensurePrincipalForUser: vi.fn(),
}))
vi.mock('@/lib/server/content/ssrf-guard', () => ({ safeFetch: vi.fn() }))
vi.mock('@/lib/server/auth/hooks', () => ({ hooksBefore: vi.fn(), hooksAfter: vi.fn() }))

import { getAuth, resetAuth } from '../index'
import { ANONYMOUS_SIGN_IN_PATH, stampSessionAudience } from '../session-scope'

/** The options the most recent start-up handed Better Auth. */
// oxlint-disable-next-line @typescript-eslint/no-explicit-any
function builtOptions(): any {
  return hoisted.betterAuth.mock.calls.at(-1)?.[0]
}

beforeEach(() => {
  resetAuth()
  vi.clearAllMocks()
})

describe('what the instance declares about the audience column (R1)', () => {
  it('carries scope as a stored session field defaulting to the dashboard', async () => {
    await getAuth()

    expect(builtOptions().session.storeSessionInDatabase).toBe(true)
    expect(builtOptions().session.additionalFields.scope).toEqual({
      type: 'string',
      required: false,
      // No caller may hand the audience in: it is decided by the path a
      // session was minted on, never by the body of the request that asked.
      input: false,
      defaultValue: 'dashboard',
    })
  })

  it('reaches the audience rule on every session it creates', async () => {
    await getAuth()

    expect(builtOptions().databaseHooks.session.create.before).toBe(stampSessionAudience)
  })
})

describe('stampSessionAudience (R5)', () => {
  it('stamps the widget audience on the lazy anonymous mint', async () => {
    // The path is spelled out rather than taken from the constant: the
    // constant has to be the endpoint Better Auth actually routes the
    // anonymous plugin to, and a test that reads it back from itself would
    // hold any spelling at all.
    const stamped = await stampSessionAudience(
      { id: 'sess_1', userId: 'user_1' },
      { path: '/sign-in/anonymous' }
    )

    expect(stamped).toEqual({ data: { id: 'sess_1', userId: 'user_1', scope: 'widget' } })
    expect(ANONYMOUS_SIGN_IN_PATH).toBe('/sign-in/anonymous')
  })

  it('leaves the row untouched on a dashboard sign-in', async () => {
    for (const path of [
      '/sign-in/email',
      '/sign-in/social',
      '/callback/oidc',
      '/magic-link/verify',
    ]) {
      expect(await stampSessionAudience({ id: 'sess_1' }, { path })).toBeUndefined()
    }
  })

  it('leaves the row untouched when there is no path at all', async () => {
    expect(await stampSessionAudience({ id: 'sess_1' }, undefined)).toBeUndefined()
    expect(await stampSessionAudience({ id: 'sess_1' }, null)).toBeUndefined()
    expect(await stampSessionAudience({ id: 'sess_1' }, {})).toBeUndefined()
  })

  it('claims the widget audience for that one path and no other (R5)', async () => {
    await fc.assert(
      fc.asyncProperty(fc.string(), async (path) => {
        const stamped = await stampSessionAudience({ id: 'sess_1' }, { path })

        // The conservation law: either the row is handed back untouched, or it
        // is the anonymous mint and the stamp says widget. There is no third
        // answer, and no path may produce a stamp of anything else.
        if (path === ANONYMOUS_SIGN_IN_PATH) {
          expect(stamped?.data.scope).toBe('widget')
        } else {
          expect(stamped).toBeUndefined()
        }
      }),
      { numRuns: 300 }
    )
  })

  it('never drops a field the library put on the row', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.dictionary(
          fc.string({ minLength: 1 }).filter((k) => k !== 'scope'),
          fc.string()
        ),
        async (row) => {
          const stamped = await stampSessionAudience(row, { path: ANONYMOUS_SIGN_IN_PATH })

          expect(stamped?.data).toMatchObject(row)
        }
      ),
      { numRuns: 200 }
    )
  })
})
