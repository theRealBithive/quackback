// @vitest-environment node
/**
 * The ID token nonce setting of an OIDC provider: what sign-in sends, what it
 * accepts, what the connection test does with the same provider row, and what
 * a provider that existed before the setting does.
 *
 * Contract for batch F, upstream #609 (`94acff2f7`, "detect providers that
 * leave out the ID token nonce"). Items owned by this file, verbatim:
 *
 *   F9  By default a nonce is sent and an ID token without the matching nonce
 *       is rejected.
 *   F10 A provider set to "no nonce" sends none and accepts a token without
 *       one, while signature, issuer and audience are still verified.
 *   F11 The stored setting drives sign-in; the connection test detects a
 *       provider that leaves the nonce out and records that finding.
 *
 * F11 was first confirmed as "the nonce setting is applied identically to real
 * sign-in and the connection test". That cannot hold by design: the test sends
 * a nonce even for a provider set to "no nonce", because sending one is how it
 * finds out the provider drops it. The owner confirmed the corrected wording
 * above (2026-10-02).
 *   F12 Providers that existed before the migration keep the nonce check on.
 *
 * Sign-in is the sign-in library's own code (Better Auth over the configs
 * `buildGenericOAuthConfigs` builds) against signed ID tokens, so a library
 * that stops honouring the setting fails here. The connection test is the real
 * `runHandshake` and the real `startSsoTestFn`.
 *
 * On F11, read this before editing: the connection test is deliberately NOT a
 * mirror of sign-in for one token. It sends a nonce even for a provider set to
 * "no nonce", and a validly signed token without a nonce passes it and is
 * recorded as "no nonce" (that is how the setting gets discovered). So the
 * tests below pin what the two really share: the same verdict on a wrong
 * issuer, audience, signature or nonce value, no nonce for a provider sign-in
 * cannot bind, and that the finding the test records is exactly what makes
 * sign-in accept (or keep requiring) the token the test saw.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
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
  cacheSet: vi.fn(),
  requireAuth: vi.fn(),
  getIdentityProviderCredentials: vi.fn(),
  storedRows: [] as object[],
}))

vi.mock('@/lib/server/cache', () => ({
  cacheGet: vi.fn(),
  cacheSet: hoisted.cacheSet,
  cacheDel: vi.fn(),
  CACHE_KEYS: {},
}))
vi.mock('@/lib/server/functions/auth-helpers', () => ({ requireAuth: hoisted.requireAuth }))
vi.mock('@/lib/server/config', () => ({ config: { baseUrl: 'https://app.example' } }))
vi.mock('@/lib/server/auth', () => ({ resetAuth: vi.fn() }))
vi.mock('@/lib/server/auth/config-version', () => ({ bumpAuthConfigVersionInTx: vi.fn() }))
vi.mock('@/lib/server/domains/platform-credentials/platform-credential.service', () => ({
  hasPlatformCredentials: vi.fn(),
  getConfiguredIntegrationTypes: vi.fn().mockResolvedValue(new Set<string>()),
}))
// The service module is the real one (it reads the stored rows for F12); only
// the credential lookup the test-start path needs is replaced.
vi.mock('@/lib/server/domains/settings/identity-providers.service', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('@/lib/server/domains/settings/identity-providers.service')
  >()),
  getIdentityProviderCredentials: hoisted.getIdentityProviderCredentials,
}))
vi.mock('@/lib/server/db', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/server/db')>()
  return {
    ...real,
    db: {
      select: () => ({
        from: (table: unknown) => ({
          orderBy: async () => (table === real.identityProvider ? hoisted.storedRows : []),
        }),
      }),
    },
  }
})
// The handshake's outbound fetches go through the SSRF guard; here they go to
// the stubbed identity provider instead.
vi.mock('@/lib/server/content/ssrf-guard', () => ({
  SsrfError: class SsrfError extends Error {
    reason = 'blocked'
  },
  safeFetch: (url: string, options: RequestInit) => globalThis.fetch(url, options),
}))

await import('@/lib/server/functions/sso-test')
const startSsoTest = handlers[0]

import { runHandshake, type HandshakeInput } from '../sso-test-handshake'
import { listIdentityProviders } from '@/lib/server/domains/settings/identity-providers.service'
import {
  CLIENT_ID,
  buildAuthFor,
  installIdentityProviderFetch,
  providerRow,
  returnToCallback,
  startIdentityProviderStub,
  startSignIn,
  type IdTokenSpec,
  type IdentityProviderStub,
} from './oidc-contract-harness'

let stub: IdentityProviderStub

beforeAll(async () => {
  stub = await startIdentityProviderStub()
  installIdentityProviderFetch(stub)
})

afterAll(() => {
  vi.unstubAllGlobals()
})

beforeEach(() => {
  hoisted.requireAuth.mockResolvedValue({ user: { id: 'user_admin' } })
  hoisted.getIdentityProviderCredentials.mockResolvedValue({ clientSecret: 'secret' })
  hoisted.cacheSet.mockReset()
  hoisted.cacheSet.mockResolvedValue(undefined)
  hoisted.storedRows = []
})

// ---------------------------------------------------------------------------
// Sign-in, through the library
// ---------------------------------------------------------------------------

interface SignInResult {
  signedIn: boolean
  /** The nonce parameter of the authorization request, if there was one. */
  nonceSent: string | null
}

/** What the identity provider puts in the ID token, given the nonce it was sent. */
type TokenForNonce = (sentNonce: string | null) => IdTokenSpec

async function signIn(row: Record<string, unknown>, token: TokenForNonce): Promise<SignInResult> {
  stub.tokenFor = token
  const auth = await buildAuthFor(providerRow(row))
  const start = await startSignIn(auth, 'oidc_1')
  const outcome = await returnToCallback(auth, start, '/api/auth/callback/oidc_1')
  const signedIn = outcome.signedIn && !(outcome.location ?? '').includes('error=')
  return { signedIn, nonceSent: start.authorizeUrl.searchParams.get('nonce') }
}

const echoesNonce: TokenForNonce = (sent) => ({ nonce: sent ?? undefined })
const leavesNonceOut: TokenForNonce = () => ({})

type Defect = 'wrong-issuer' | 'wrong-audience' | 'foreign-signature'

/** An otherwise correct token (echoing the nonce when one was sent) with one defect. */
function withDefect(defect: Defect): TokenForNonce {
  return (sent) => {
    const base: IdTokenSpec = { nonce: sent ?? undefined }
    if (defect === 'wrong-issuer') return { ...base, issuer: 'https://evil.example' }
    if (defect === 'wrong-audience') return { ...base, audience: 'someone-elses-client' }
    return { ...base, signWithForeignKey: true }
  }
}

const defects = fc.constantFrom<Defect>('wrong-issuer', 'wrong-audience', 'foreign-signature')

/** Stored values that mean "check": never set, cleared, the explicit default, or unrecognised. */
const settingsThatCheck = fc.oneof(
  fc.constant({}),
  fc.constant({ idTokenNonce: null }),
  fc.constant({ idTokenNonce: undefined }),
  fc.constant({ idTokenNonce: 'check' }),
  fc
    .string({ maxLength: 12 })
    .filter((value) => value !== 'off')
    .map((value) => ({ idTokenNonce: value }))
)

const settingOff = { idTokenNonce: 'off' }

const anyNonce = fc.stringMatching(/^[A-Za-z0-9_-]{1,43}$/)

describe('the default nonce setting in real sign-in (F9)', () => {
  it('(F9) sends a nonce, and signs in only a token that echoes it', async () => {
    await fc.assert(
      fc.asyncProperty(settingsThatCheck, anyNonce, async (setting, otherNonce) => {
        const echoed = await signIn(setting, echoesNonce)
        expect(echoed.nonceSent).toBeTruthy()
        expect(echoed.signedIn).toBe(true)

        const missing = await signIn(setting, leavesNonceOut)
        expect(missing.nonceSent).toBeTruthy()
        expect(missing.signedIn).toBe(false)

        const mismatched = await signIn(setting, (sent) => ({ nonce: `${sent}${otherNonce}` }))
        expect(mismatched.signedIn).toBe(false)
      }),
      { numRuns: 12 }
    )
  })

  it('(F9) a token carrying an unrelated nonce is rejected, whatever that nonce is', async () => {
    await fc.assert(
      fc.asyncProperty(anyNonce, async (replayedNonce) => {
        const result = await signIn({}, (sent) => ({
          nonce: replayedNonce === sent ? `${replayedNonce}x` : replayedNonce,
        }))
        expect(result.signedIn).toBe(false)
      }),
      { numRuns: 10 }
    )
  })
})

describe('a provider set to "no nonce" in real sign-in (F10)', () => {
  it('(F10) sends no nonce and accepts a token that has none', async () => {
    const result = await signIn(settingOff, leavesNonceOut)
    expect(result.nonceSent).toBeNull()
    expect(result.signedIn).toBe(true)
  })

  it('(F10) verifies signature, issuer and audience in both settings', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom<Record<string, unknown>>({}, settingOff),
        defects,
        async (setting, defect) => {
          // Control: with this setting, a correct token does sign in.
          const control = await signIn(setting, echoesNonce)
          expect(control.signedIn).toBe(true)

          // The defective token is correct in every other respect, including the
          // nonce when one was sent, so only the defect can be the reason.
          const defective = await signIn(setting, withDefect(defect))
          expect(defective.signedIn).toBe(false)
        }
      ),
      { numRuns: 12 }
    )
  })
})

// ---------------------------------------------------------------------------
// The connection test
// ---------------------------------------------------------------------------

const DISCOVERY_URL = 'https://idp.example/.well-known/openid-configuration'

async function connectionTest(token: IdTokenSpec, expectedNonce: string | undefined) {
  stub.tokenFor = () => token
  const input: HandshakeInput = {
    state: 's',
    code: 'c',
    expectedState: 's',
    expectedNonce,
    discoveryUrl: DISCOVERY_URL,
    clientId: CLIENT_ID,
    clientSecret: 'secret',
    redirectUri: 'https://app.example/api/auth/callback/oidc_1',
    codeVerifier: 'v',
  }
  return runHandshake(input)
}

const SENT_BY_TEST = 'nonce-the-test-sent'

describe('the connection test and real sign-in share one verdict (F11)', () => {
  it('(F11) both reject a token with a defect in signature, issuer or audience, in either setting', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom<Record<string, unknown>>({}, settingOff),
        defects,
        async (setting, defect) => {
          const signInVerdict = await signIn(setting, withDefect(defect))
          const testVerdict = await connectionTest(withDefect(defect)(SENT_BY_TEST), SENT_BY_TEST)
          expect(signInVerdict.signedIn).toBe(false)
          expect(testVerdict.ok).toBe(false)
        }
      ),
      { numRuns: 12 }
    )
  })

  it('(F11) both reject a nonce that is not the one they sent, when the check is on', async () => {
    await fc.assert(
      fc.asyncProperty(settingsThatCheck, anyNonce, async (setting, foreign) => {
        const wrong = `${foreign}-not-the-sent-one`
        const signInVerdict = await signIn(setting, () => ({ nonce: wrong }))
        const testVerdict = await connectionTest({ nonce: wrong }, SENT_BY_TEST)
        expect(signInVerdict.signedIn).toBe(false)
        expect(testVerdict.ok).toBe(false)
      }),
      { numRuns: 10 }
    )
  })

  it('(F11) both accept a token that echoes the nonce they sent', async () => {
    const signInVerdict = await signIn({}, echoesNonce)
    const testVerdict = await connectionTest({ nonce: SENT_BY_TEST }, SENT_BY_TEST)
    expect(signInVerdict.signedIn).toBe(true)
    expect(testVerdict.ok).toBe(true)
  })

  it('(F11) a provider the test finds echoing the nonce keeps requiring it at sign-in', async () => {
    const finding = await connectionTest({ nonce: SENT_BY_TEST }, SENT_BY_TEST)
    expect(finding.ok && finding.idTokenNonce).toBe('check')

    const afterwards = await signIn({ idTokenNonce: 'check' }, leavesNonceOut)
    expect(afterwards.signedIn).toBe(false)
  })

  it('(F11) a provider the test finds leaving the nonce out signs in without one afterwards', async () => {
    const finding = await connectionTest({}, SENT_BY_TEST)
    expect(finding.ok && finding.idTokenNonce).toBe('off')

    const afterwards = await signIn({ idTokenNonce: 'off' }, leavesNonceOut)
    expect(afterwards.nonceSent).toBeNull()
    expect(afterwards.signedIn).toBe(true)
  })

  it('(F11) a stored value switches the check off in sign-in only when it is exactly "off"', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.oneof(fc.constant('off'), fc.constant('check'), fc.string({ maxLength: 12 })),
        async (stored) => {
          const result = await signIn({ idTokenNonce: stored }, leavesNonceOut)
          expect(result.signedIn).toBe(stored === 'off')
        }
      ),
      { numRuns: 15 }
    )
  })

  it('(F11) neither sends a nonce for a manual-endpoint provider, which sign-in cannot bind', async () => {
    const manualRow = {
      discoveryUrl: null,
      authorizationUrl: 'https://idp.example/authorize',
      tokenUrl: 'https://idp.example/token',
      jwksUri: 'https://idp.example/jwks',
      issuer: 'https://idp.example',
    }
    hoisted.storedRows = [{ ...storedRowFromBeforeTheMigration(), ...manualRow, kind: 'other' }]
    const authorizeRequestOfSignIn = await (async () => {
      const auth = await buildAuthFor(providerRow(manualRow))
      return (await startSignIn(auth, 'oidc_1')).authorizeUrl
    })()

    const started = (await startSsoTest({ data: { registrationId: 'oidc_1' } })) as {
      authorizeUrl: string
    }
    expect(authorizeRequestOfSignIn.searchParams.has('nonce')).toBe(false)
    expect(new URL(started.authorizeUrl).searchParams.has('nonce')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Providers that existed before the setting
// ---------------------------------------------------------------------------

describe('providers stored before the migration (F12)', () => {
  const migration = readFileSync(
    path.resolve(
      __dirname,
      '../../../../../../../packages/db/drizzle/0281_identity_provider_id_token_nonce.sql'
    ),
    'utf8'
  )
  const statements = migration
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('--'))
    .join('\n')

  it('(F12) the migration adds a nullable column with no default and rewrites no existing row', () => {
    expect(statements).toMatch(/ADD COLUMN IF NOT EXISTS "id_token_nonce" text\s*;/)
    expect(statements).not.toMatch(/NOT NULL/i)
    expect(statements).not.toMatch(/DEFAULT/i)
    expect(statements).not.toMatch(/UPDATE/i)
  })

  it('(F12) the migration is registered in the journal', () => {
    const journal = readFileSync(
      path.resolve(__dirname, '../../../../../../../packages/db/drizzle/meta/_journal.json'),
      'utf8'
    )
    expect(journal).toContain('"0281_identity_provider_id_token_nonce"')
  })

  it('(F12) a stored row with an empty nonce column is read back with the check on', async () => {
    hoisted.storedRows = [storedRowFromBeforeTheMigration()]
    const [provider] = await listIdentityProviders()
    expect(provider.idTokenNonce).toBeNull()

    const result = await signIn(provider, leavesNonceOut)
    expect(result.nonceSent).toBeTruthy()
    expect(result.signedIn).toBe(false)
  })

  it('(F12) such a provider sends a nonce and still signs in with a token that echoes it', async () => {
    const result = await signIn({ idTokenNonce: null }, echoesNonce)
    expect(result.nonceSent).toBeTruthy()
    expect(result.signedIn).toBe(true)
  })
})

/** A row as the database returns it for a provider created before the column existed. */
function storedRowFromBeforeTheMigration() {
  const now = new Date('2026-01-01T00:00:00.000Z')
  return {
    id: 'idp_01h455vb4pex5vsknk084sn02q',
    registrationId: 'oidc_1',
    label: 'Acme',
    kind: 'other',
    discoveryUrl: DISCOVERY_URL,
    authorizationUrl: null,
    tokenUrl: null,
    userInfoUrl: null,
    jwksUri: null,
    issuer: null,
    clientId: CLIENT_ID,
    scopes: null,
    prompt: null,
    tokenEndpointAuthMethod: null,
    idTokenNonce: null,
    enabled: true,
    autoCreateUsers: true,
    autoProvisionRole: null,
    claimMapping: null,
    showButton: true,
    logoKey: null,
    detailsChangedAt: null,
    lastSuccessfulTestAt: null,
    lastTestCapture: null,
    createdAt: now,
  }
}
