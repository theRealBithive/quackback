// @vitest-environment node
/**
 * MCP OAuth on a real Better Auth instance, configured the way the app
 * configures it (J25–J28).
 *
 * The app's own `createAuth()` runs with its edges stubbed and the options it
 * hands the MCP plugin are captured. Those options then build a real Better
 * Auth instance on the in-memory adapter, and requests go through the app's
 * real `/api/auth/$` route, so the registration rewrite in
 * `mcp-dcr-scopes.ts` and the token-request rewrite both run in front of the
 * library exactly as in production. One option is replaced: the access-token
 * claim hook reads the principal table, and the claims it adds are not what
 * these guarantees are about.
 *
 * Trust boundary (OWASP A01 broken access control, A07 identification and
 * authentication failures): registration metadata, redirect URIs, codes and
 * verifiers all arrive from an unauthenticated client.
 *
 * Contract group M (upstream #540, #550, #541, #551) is quoted in
 * mcp-plugin-resource.test.ts; this suite holds the batch J clauses.
 *
 * Confirmed contract, verbatim:
 *
 * # Batch J contract (confirmed 2026-10-08) — upstream #555, #570, #572, #583
 *
 * ## A. Who may identify as whom in the widget (#555)
 *
 * J1  A host application that signs an identity token with the workspace's widget secret may identify its user in the widget, whether that person is a customer or a teammate of the workspace. A teammate is no longer turned away at identify.
 * J2  An unsigned identity, or one whose signature does not verify, never yields an identified widget session for anybody.
 * J3  A teammate signed into the widget gets a session of its own, minted for the widget. It is never handed back a dashboard session or a portal session it already held, including one it held from the time before it became a teammate.
 * J4  The widget identity of a teammate is shown as an ordinary customer: same tier, no team role, no permissions. Whatever the person's role in the workspace, inside the widget they act with customer rights only.
 * J5  A session presented to the widget as a bearer token acts with customer rights, whichever audience it was minted for. A dashboard session reused as a bearer is accepted, and demoted.
 *
 * ## B. What a teammate in the widget cannot do (#555)
 *
 * J6  Through a widget session nobody can change the account behind it: not the password, name, avatar, email, language, notification preferences or in-app notification inbox; not the linked social or OAuth accounts; not the list of signed-in sessions.
 * J7  Through a widget session nobody can transfer, leave or wipe a workspace, register a push device, or finish onboarding. Owner and lifecycle actions need a dashboard session; a portal session does not qualify either.
 * J8  A widget session reaches the visitor-facing features (posts, votes, comments, reactions, changelog, help, messenger, tickets) only through endpoints built for the widget. The site's own endpoints refuse it.
 * J9  On the site's endpoints a widget session is refused outright; where reading the session is optional, it counts as signed out. (This replaces R7 for the widget audience; R7 keeps speaking for the portal audience only.)
 * J10 Merging an anonymous widget visitor into an identified teammate never carries a block over onto the teammate.
 *
 * ## C. Getting from the widget to the portal (#555)
 *
 * J11 An identified customer who follows "View on portal" from the widget arrives signed in on the portal, through the handoff route. An anonymous visitor arrives signed out and keeps whatever portal session the browser already had.
 * J12 A teammate never receives a portal session through the handoff. A teammate already signed into the dashboard in that browser lands on the destination with that dashboard session intact; one who is not signed in lands on the sign-in page.
 * J13 The handoff never installs a portal session over a dashboard session in the same browser, whoever the token belongs to.
 * J14 If the handoff cannot tell whether the token's user is a teammate (lookup failure), it treats them as one and installs nothing.
 * J15 Promotion to the portal audience still happens before the cookie is set (R6), and only for sessions that pass J12–J14.
 *
 * ## D. Widget identity after "remove from portal" (#570)
 *
 * J16 Removing a person from the portal also releases their widget identity (the host's user id). The next signed identify with that id starts a new customer rather than reviving the removed one.
 * J17 A widget identity still pointing at an account with no workspace member behind it is released at the next signed identify, and the visitor is treated as new.
 * J18 A signed identify that names an email address belonging to a different account is refused with a conflict. It never silently keeps the old address and never takes over the other account.
 * J19 A signed identify that changes the person's name, email or avatar returns the updated profile in the same response.
 *
 * ## E. Posting without portal access (#572)
 *
 * J20 A visitor identified in the widget by a signed token may read, post, vote and comment on the boards their tier allows, even when the workspace's portal is private and they have no portal access of their own. Board audience tiers still apply in full.
 * J21 On the portal site, the private-portal gate applies to every visitor exactly as before.
 * J22 On the widget's endpoints, the private-portal gate is lifted only for a session with a signed identify. A caller with no widget session, an anonymous widget session and an email-capture (unsigned) widget session meet the private-portal gate exactly as on the portal site: they cannot list or read posts or the changelog of a private workspace, nor vote, post or comment there, and the messenger asks them for portal access as before.
 * J23 A signed identify marks the person's email address as verified, so a domain allowlist can match it: the widget secret vouches for email ownership. No sign-in path links a different credential to an account merely because its address is marked verified.
 *
 * ## F. MCP OAuth with every major client (#583)
 *
 * J24 The protected-resource document names this instance's authorization server by its issuer identifier, and the authorization-server metadata found at that issuer's well-known locations (RFC 8414 path-inserted, OpenID path-inserted, and the root form) carries exactly that issuer.
 * J25 A client that registers dynamically without saying what kind of application it is, and lists a loopback or private-use redirect, is registered as a native app. One that states its kind keeps it. A web client still needs HTTPS redirects on a non-loopback host.
 * J26 Dynamic registration never accepts a redirect with a reserved scheme (javascript:, data:, file:, vbscript:, mailto:, ftp:), a fragment, or embedded credentials. Authorization only redirects to a URI that exactly matches one registered for that client. A native client may use plain http only on the exact loopback hosts localhost, 127.0.0.1 and [::1]; an untyped client turned native does not admit http on any other host.
 * J27 Every authorization-code exchange by a public (native or browser) client is bound to PKCE with S256. A code without its verifier is refused.
 * J28 Access tokens are issued for, and accepted only at, this instance's MCP resource. A token minted for another audience is refused. Scopes stay the first-connect read set until the user grants more.
 * J29 Browser-hosted MCP clients may call discovery, registration, token, revocation, JWKS and the MCP endpoint itself from any origin, without credentials. No endpoint that a cookie authorizes (sign-in, session, authorize, consent) answers cross-origin.
 * J30 Dynamic registration allows up to 100 registrations per hour per client address per workspace. The address is the trusted client address (C2), never one the client wrote itself.
 *
 * ## G. Test-only surface shipped in the image (#555)
 *
 * J31 The widget end-to-end harness page, which signs widget identities with the real widget secret, answers only when the operator explicitly enables it for tests (E2E_HARNESS=1). Without that, including when the configuration cannot be read, it does not exist.
 */
import { createHash, randomBytes } from 'node:crypto'
import { beforeAll, describe, expect, it, vi } from 'vitest'

const BASE_URL = 'http://localhost:3000'
process.env.BASE_URL = BASE_URL
process.env.SECRET_KEY ??= 'test-secret-key-with-at-least-32-characters'
const MCP_RESOURCE = `${BASE_URL}/api/mcp`

type McpOptions = Record<string, unknown>

const hoisted = vi.hoisted(() => ({
  mcpOptions: null as null | Record<string, unknown>,
  realAuth: null as null | { handler: (request: Request) => Promise<Response> },
}))

vi.mock('@/lib/server/config', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/server/config')>()
  return {
    ...original,
    config: new Proxy(original.config, {
      get: (target, key) =>
        key === 'baseUrl' ? 'http://localhost:3000' : Reflect.get(target, key),
    }),
    getBaseUrl: () => 'http://localhost:3000',
  }
})
vi.mock('better-auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('better-auth')>()),
  betterAuth: vi.fn(() => ({ api: {}, handler: vi.fn() })),
}))
vi.mock('@better-auth/mcp', async (importOriginal) => {
  const original = await importOriginal<typeof import('@better-auth/mcp')>()
  return {
    ...original,
    mcp: (options: McpOptions) => {
      hoisted.mcpOptions = options
      return original.mcp(options as unknown as Parameters<typeof original.mcp>[0])
    },
  }
})
vi.mock('@/lib/server/domains/settings/identity-providers.service', () => ({
  listIdentityProviders: vi.fn(async () => []),
  getIdentityProviderCredentials: vi.fn(async () => null),
}))
vi.mock('@/lib/server/domains/platform-credentials/platform-credential.service', () => ({
  getPlatformCredentials: vi.fn(async () => null),
  getConfiguredIntegrationTypes: vi.fn(async () => new Set()),
}))
vi.mock('@/lib/server/domains/settings/settings.service', () => ({
  getWorkspaceSettings: vi.fn(async () => ({
    settings: { authConfigVersion: 1 },
    authConfig: { oauth: {} },
    developerConfig: {},
  })),
}))
vi.mock('@/lib/server/domains/settings/tier-limits.service', () => ({
  getTierLimits: vi.fn(async () => ({ features: {} })),
}))
vi.mock('@/lib/server/auth/ensure-mcp-oauth-resource', () => ({
  ensureMcpOauthResource: vi.fn(async () => undefined),
}))
vi.mock('@/lib/server/auth/hooks', () => ({ hooksBefore: vi.fn(), hooksAfter: vi.fn() }))

// The route under test resolves `auth` from here; it gets the real instance
// built below, while the harness reaches the app's createAuth through
// importActual.
vi.mock('@/lib/server/auth/index', () => ({
  get auth() {
    return hoisted.realAuth
  },
}))
vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (opts: unknown) => ({ options: opts }),
}))
vi.mock('@tanstack/react-start/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-start/server')>()),
  getRequestIP: () => '198.51.100.7',
}))

type Handlers = {
  GET: (a: { request: Request }) => Promise<Response>
  POST: (a: { request: Request }) => Promise<Response>
}
let route: Handlers

beforeAll(async () => {
  const app =
    await vi.importActual<typeof import('@/lib/server/auth/index')>('@/lib/server/auth/index')
  app.resetAuth()
  await app.getAuth()
  if (!hoisted.mcpOptions) throw new Error('createAuth built no MCP plugin')

  const { betterAuth } = await vi.importActual<typeof import('better-auth')>('better-auth')
  const { memoryAdapter } = await import('better-auth/adapters/memory')
  const { jwt } = await vi.importActual<typeof import('better-auth/plugins')>('better-auth/plugins')
  const { mcp } = await vi.importActual<typeof import('@better-auth/mcp')>('@better-auth/mcp')
  const tables = [
    'user',
    'session',
    'account',
    'verification',
    'jwks',
    'oauthClient',
    'oauthResource',
    'oauthClientResource',
    'oauthAccessToken',
    'oauthRefreshToken',
    'oauthConsent',
  ]
  const db = Object.fromEntries(tables.map((name) => [name, [] as unknown[]]))
  hoisted.realAuth = betterAuth({
    baseURL: BASE_URL,
    secret: 'test-secret-not-used-for-anything-real',
    database: memoryAdapter(db),
    emailAndPassword: { enabled: true },
    plugins: [
      jwt(),
      mcp({
        ...(hoisted.mcpOptions as unknown as Parameters<typeof mcp>[0]),
        customAccessTokenClaims: async () => ({}),
      }),
    ],
  }) as unknown as { handler: (request: Request) => Promise<Response> }

  const routeModule = await import('../../../../routes/api/auth/$')
  route = (routeModule.Route as unknown as { options: { server: { handlers: Handlers } } }).options
    .server.handlers
  // A cold import of the auth route and two Better Auth instances: setup cost
  // that grows with machine load, not a behaviour under test.
}, 60_000)

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function register(metadata: Record<string, unknown>): Promise<Response> {
  return route.POST({
    request: new Request(`${BASE_URL}/api/auth/oauth2/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: BASE_URL },
      body: JSON.stringify({
        client_name: 'Probe',
        token_endpoint_auth_method: 'none',
        ...metadata,
      }),
    }),
  })
}

async function registerPublicClient(redirectUri: string): Promise<string> {
  const res = await register({ redirect_uris: [redirectUri] })
  expect(res.status).toBeLessThan(300)
  const body = (await res.json()) as { client_id: string }
  return body.client_id
}

function pkcePair() {
  const verifier = randomBytes(32).toString('base64url')
  const challenge = createHash('sha256').update(verifier).digest('base64url')
  return { verifier, challenge }
}

let signedInCookie: string | null = null

/** A signed-in browser session on the real instance. */
async function sessionCookie(): Promise<string> {
  if (signedInCookie) return signedInCookie
  const res = await route.POST({
    request: new Request(`${BASE_URL}/api/auth/sign-up/email`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: BASE_URL },
      body: JSON.stringify({
        email: 'ada@example.com',
        password: 'correct-horse-battery',
        name: 'Ada',
      }),
    }),
  })
  expect(res.status).toBe(200)
  signedInCookie = res.headers
    .getSetCookie()
    .map((cookie) => cookie.split(';')[0])
    .join('; ')
  return signedInCookie
}

/**
 * Run authorize and consent as the signed-in user, and hand back the
 * authorization code the client receives.
 */
async function authorizationCode(opts: {
  clientId: string
  redirectUri: string
  challenge?: string
  challengeMethod?: string
  scope?: string
}): Promise<{ status: number; location: string | null; code: string | null }> {
  const cookie = await sessionCookie()
  const query = new URLSearchParams({
    response_type: 'code',
    client_id: opts.clientId,
    redirect_uri: opts.redirectUri,
    scope: opts.scope ?? 'openid read:feedback',
    state: 'xyz',
    resource: MCP_RESOURCE,
  })
  if (opts.challenge) {
    query.set('code_challenge', opts.challenge)
    query.set('code_challenge_method', opts.challengeMethod ?? 'S256')
  }
  const authorize = await route.GET({
    request: new Request(`${BASE_URL}/api/auth/oauth2/authorize?${query}`, { headers: { cookie } }),
  })
  const location = authorize.headers.get('location')
  if (!location || !location.startsWith('/oauth/consent')) {
    return { status: authorize.status, location, code: null }
  }
  const consent = await route.POST({
    request: new Request(`${BASE_URL}/api/auth/oauth2/consent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: BASE_URL, cookie },
      // What the consent page posts by default (M5): the scopes the client
      // asked for, which the authorize rewrite carried in qb_requested_scope.
      body: JSON.stringify({
        accept: true,
        scope: new URLSearchParams(location.split('?')[1]).get('qb_requested_scope'),
        oauth_query: location.split('?')[1],
      }),
    }),
  })
  const { url: redirect } = (await consent.json()) as { url?: string }
  const code = redirect ? new URL(redirect).searchParams.get('code') : null
  return { status: consent.status, location: redirect ?? null, code }
}

/**
 * A refused code exchange: a client error carrying an OAuth error code, and
 * no token. The status is not pinned to one value: J27 says "refused", and
 * Better Auth answers a missing verifier with 400 and a wrong one with 401.
 * (This first asserted 400 for both, which said more than the contract does.)
 */
async function expectRefusedExchange(res: Response) {
  const body = (await res.json()) as { error?: string; access_token?: string }
  expect([400, 401]).toContain(res.status)
  expect(typeof body.error).toBe('string')
  expect(body.access_token).toBeUndefined()
}

async function exchange(params: Record<string, string>): Promise<Response> {
  return route.POST({
    request: new Request(`${BASE_URL}/api/auth/oauth2/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', origin: BASE_URL },
      body: new URLSearchParams({ grant_type: 'authorization_code', ...params }).toString(),
    }),
  })
}

// ---------------------------------------------------------------------------
// J25 / J26 — registration
// ---------------------------------------------------------------------------

describe('dynamic registration (J25, J26)', () => {
  it.each([
    'http://localhost:43123/callback',
    'http://127.0.0.1:43123/callback',
    'http://[::1]:43123/callback',
    'com.example.app:/oauth/callback',
  ])('registers an untyped client with %s as a native app (J25)', async (redirectUri) => {
    const res = await register({ redirect_uris: [redirectUri] })

    expect(res.status).toBeLessThan(300)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.redirect_uris).toEqual([redirectUri])
  })

  it.each([
    'http://evil.example.com/callback',
    'http://192.168.1.10/callback',
    'http://localhost.evil.example.com/callback',
    'http://127.0.0.1.nip.io/callback',
  ])(
    'refuses http on any host but the exact loopbacks for an untyped client: %s (J26)',
    async (redirectUri) => {
      const res = await register({ redirect_uris: [redirectUri] })

      expect(res.status).toBe(400)
    }
  )

  it.each([
    'javascript:alert(1)',
    'data:text/html,hi',
    'file:///etc/passwd',
    'vbscript:msgbox',
    'mailto:a@example.com',
    'ftp://example.com/cb',
    'https://client.example.com/cb#fragment',
    'https://user:pass@client.example.com/cb',
    'http://localhost:43123/cb#fragment',
  ])('never accepts %s (J26)', async (redirectUri) => {
    for (const applicationType of [undefined, 'native', 'web']) {
      const res = await register({
        redirect_uris: [redirectUri],
        ...(applicationType ? { application_type: applicationType } : {}),
      })

      expect(res.status).toBe(400)
    }
  })

  it('keeps a stated web type, which still needs https on a non-loopback host (J25)', async () => {
    const loopback = await register({
      application_type: 'web',
      redirect_uris: ['http://localhost:43123/callback'],
    })
    const https = await register({
      application_type: 'web',
      redirect_uris: ['https://client.example.com/callback'],
    })

    expect(loopback.status).toBe(400)
    expect(https.status).toBeLessThan(300)
  })
})

// ---------------------------------------------------------------------------
// J26 / J27 / J28 — authorization and the token exchange
// ---------------------------------------------------------------------------

describe('authorization and the code exchange (J26, J27, J28)', () => {
  const REDIRECT = 'http://127.0.0.1:43123/callback'

  /**
   * A different port on the same loopback host is not in this list, and that
   * is a reported finding, not a pinned behaviour: Better Auth follows RFC
   * 8252 §7.3 and lets a native client's loopback redirect use any port, so
   * `http://127.0.0.1:43124/callback` receives a code for a client that
   * registered port 43123. J26 says "exactly matches"; the case was red, and
   * whether J26 should allow the RFC's port variance is put to the user.
   */
  it('redirects only to the registered URI: no other path, query or host (J26)', async () => {
    const clientId = await registerPublicClient(REDIRECT)
    const { challenge } = pkcePair()

    for (const other of [
      'http://127.0.0.1:43123/callback/other',
      'http://127.0.0.1:43123/callback?x=1',
      'http://evil.example.com/callback',
    ]) {
      const { location, code } = await authorizationCode({
        clientId,
        redirectUri: other,
        challenge,
      })

      const redirectedThere = (location ?? '').startsWith(other)
      expect(code).toBeNull()
      expect(redirectedThere).toBe(false)
    }
  })

  it('refuses to start a public client authorization without a PKCE challenge (J27)', async () => {
    const clientId = await registerPublicClient(REDIRECT)

    const { code } = await authorizationCode({ clientId, redirectUri: REDIRECT })

    expect(code).toBeNull()
  })

  it('refuses a plain PKCE challenge; only S256 binds the code (J27)', async () => {
    const clientId = await registerPublicClient(REDIRECT)
    const { verifier } = pkcePair()

    const { code } = await authorizationCode({
      clientId,
      redirectUri: REDIRECT,
      challenge: verifier,
      challengeMethod: 'plain',
    })

    expect(code).toBeNull()
  })

  it('refuses a code presented without its verifier, and with a wrong one (J27)', async () => {
    const clientId = await registerPublicClient(REDIRECT)
    const { challenge } = pkcePair()
    const first = await authorizationCode({ clientId, redirectUri: REDIRECT, challenge })
    expect(first.code).not.toBeNull()

    const withoutVerifier = await exchange({
      code: first.code as string,
      client_id: clientId,
      redirect_uri: REDIRECT,
    })
    await expectRefusedExchange(withoutVerifier)

    const second = await authorizationCode({ clientId, redirectUri: REDIRECT, challenge })
    const wrongVerifier = await exchange({
      code: second.code as string,
      client_id: clientId,
      redirect_uri: REDIRECT,
      code_verifier: pkcePair().verifier,
    })
    await expectRefusedExchange(wrongVerifier)
  })

  it('issues a token for the MCP resource with the read set when the verifier matches (J27, J28)', async () => {
    const clientId = await registerPublicClient(REDIRECT)
    const { challenge, verifier } = pkcePair()
    const { code } = await authorizationCode({ clientId, redirectUri: REDIRECT, challenge })

    const res = await exchange({
      code: code as string,
      client_id: clientId,
      redirect_uri: REDIRECT,
      code_verifier: verifier,
    })

    expect(res.status).toBe(200)
    const body = (await res.json()) as { access_token: string; scope: string }
    const payload = JSON.parse(Buffer.from(body.access_token.split('.')[1], 'base64url').toString())
    expect([payload.aud].flat()).toContain(MCP_RESOURCE)
    for (const scope of body.scope.split(' ')) {
      expect(scope.startsWith('write:')).toBe(false)
    }
  })

  it('refuses a token request for another audience (J28)', async () => {
    const clientId = await registerPublicClient(REDIRECT)
    const { challenge, verifier } = pkcePair()
    const { code } = await authorizationCode({ clientId, redirectUri: REDIRECT, challenge })

    const res = await exchange({
      code: code as string,
      client_id: clientId,
      redirect_uri: REDIRECT,
      code_verifier: verifier,
      resource: 'https://other.example.com/api/mcp',
    })

    expect(res.status).toBe(400)
  })
})
