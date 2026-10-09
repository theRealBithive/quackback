/**
 * Implicit account linking on the app's own linking rules (J23).
 *
 * #572 made a signed widget identify mark the person's address verified.
 * Better Auth uses that mark when an OAuth or OIDC sign-in arrives with the
 * same address: for a provider the fork trusts by name (every configured OIDC
 * and social provider, see `index.ts` and `provider-trust.ts`) it is the only
 * condition, so the provider's own word on the address did not matter. A
 * probe showed it: an unverified address from a trusted provider linked into
 * a widget-identified account. J23 was revised on 2026-10-08 by the user's
 * decision and the fork reverts that part of #572: identify leaves the
 * address unverified (pinned in `identify-external-id.test.ts`), and this
 * suite pins that the path is closed for such an account.
 *
 * How this is asked: the app's real `createAuth()` runs with its edges
 * stubbed, and the `account` options it hands Better Auth are captured. Those
 * options, verbatim, then drive a real Better Auth instance on the in-memory
 * adapter, whose own `handleOAuthUserInfo` decides each sign-in. So a change
 * to the fork's linking options or to the library's linking rule fails here.
 *
 * What this suite does not claim: an account whose address was verified by
 * some other means (an email link) is still linked into by a trusted provider
 * on an unverified incoming address. That is Better Auth's rule for trusted
 * providers and the fork's recorded "observed, not enforced" decision in
 * `provider-trust.ts`; it is outside what a widget identify can cause.
 *
 * Trust boundary (OWASP A07, identification and authentication failures): the
 * incoming identity is the provider's assertion, and the local mark is ours.
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
 * J23 A signed identify does not mark the person's email address as verified; the widget secret vouches for who the host's user is, not for ownership of the address. No sign-in path links a different credential to an account merely because its address is marked verified. (Revised 2026-10-08 by the user's decision: #572 marked it verified, which let a trusted provider that never verified the address link into the account.)
 *
 * ## F. MCP OAuth with every major client (#583)
 *
 * J24 The protected-resource document names this instance's authorization server by its issuer identifier, and the authorization-server metadata found at that issuer's well-known locations (RFC 8414 path-inserted, OpenID path-inserted, and the root form) carries exactly that issuer.
 * J25 A client that registers dynamically without saying what kind of application it is, and lists a loopback or private-use redirect, is registered as a native app. One that states its kind keeps it. A web client still needs HTTPS redirects on a non-loopback host.
 * J26 Dynamic registration never accepts a redirect with a reserved scheme (javascript:, data:, file:, vbscript:, mailto:, ftp:), a fragment, or embedded credentials. Authorization only redirects to a URI that matches one registered for that client exactly, except that on the loopback hosts localhost, 127.0.0.1 and [::1] the port may differ, as RFC 8252 §7.3 requires for native apps. A native client may use plain http only on those exact loopback hosts; an untyped client turned native does not admit http on any other host. (Port clause revised 2026-10-08 by the user's decision.)
 * J27 Every authorization-code exchange by a public (native or browser) client is bound to PKCE with S256. A code without its verifier is refused.
 * J28 Access tokens are issued for, and accepted only at, this instance's MCP resource. A token minted for another audience is refused. Scopes stay the first-connect read set until the user grants more.
 * J29 Browser-hosted MCP clients may call discovery, registration, token, revocation, JWKS and the MCP endpoint itself from any origin, without credentials. No endpoint that a cookie authorizes (sign-in, session, authorize, consent) answers cross-origin.
 * J30 Dynamic registration allows up to 100 registrations per hour per client address per workspace. The address is the trusted client address (C2), never one the client wrote itself.
 *
 * ## G. Test-only surface shipped in the image (#555)
 *
 * J31 The widget end-to-end harness page, which signs widget identities with the real widget secret, answers only when the operator explicitly enables it for tests (E2E_HARNESS=1). Without that, including when the configuration cannot be read, it does not exist.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

if (!process.env.BASE_URL?.startsWith('http')) process.env.BASE_URL = 'http://localhost:3000'
process.env.SECRET_KEY ??= 'test-secret-key-with-at-least-32-characters'

type AccountOptions = { accountLinking?: Record<string, unknown> }

const hoisted = vi.hoisted(() => ({
  options: null as null | { account?: AccountOptions },
}))

vi.mock('better-auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('better-auth')>()),
  betterAuth: vi.fn((options: typeof hoisted.options) => {
    hoisted.options = options
    return { api: {}, handler: vi.fn() }
  }),
}))
vi.mock('../build-oauth-configs', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../build-oauth-configs')>()),
  // One configured OIDC provider, so the trusted list is the one a real
  // workspace with single sign-on builds.
  buildGenericOAuthConfigs: vi.fn(async () => [{ providerId: 'oidc_acme' }]),
}))
vi.mock('@/lib/server/domains/settings/identity-providers.service', () => ({
  listIdentityProviders: vi.fn(async () => [
    { id: 'idp_acme', registrationId: 'oidc_acme', domains: [] },
  ]),
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
vi.mock('../ensure-mcp-oauth-resource', () => ({
  ensureMcpOauthResource: vi.fn(async () => undefined),
}))
vi.mock('../hooks', () => ({ hooksBefore: vi.fn(), hooksAfter: vi.fn() }))

const { getAuth, resetAuth } = await import('../index')
const { betterAuth: realBetterAuth } =
  await vi.importActual<typeof import('better-auth')>('better-auth')
const { memoryAdapter } = await import('better-auth/adapters/memory')
const { handleOAuthUserInfo } = await import('better-auth/oauth2')

/** The `account` options the app's own instance is built with. */
async function appAccountOptions(): Promise<AccountOptions> {
  resetAuth()
  hoisted.options = null
  await getAuth()
  // Read through a widened type: TypeScript keeps the `null` assigned above
  // and cannot see the mock writing the field during getAuth().
  const captured = hoisted.options as null | { account?: AccountOptions }
  const account = captured?.account
  if (!account) throw new Error('createAuth passed no account options')
  return account
}

const LOCAL_EMAIL = 'ada@example.com'

/**
 * A real Better Auth instance on the app's linking options, holding one
 * account whose address is `localVerified`.
 */
async function instanceWithLocalAccount(localVerified: boolean) {
  const db = {
    user: [
      {
        id: 'user_local',
        email: LOCAL_EMAIL,
        name: 'Ada',
        emailVerified: localVerified,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ],
    account: [
      {
        id: 'acc_password',
        userId: 'user_local',
        providerId: 'credential',
        accountId: 'user_local',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ],
    session: [] as unknown[],
    verification: [] as unknown[],
  }
  const auth = realBetterAuth({
    baseURL: 'https://feedback.example.com',
    secret: 'test-secret-not-used-for-anything-real',
    database: memoryAdapter(db),
    account: await appAccountOptions(),
  })
  return { auth, db }
}

/** A sign-in from `providerId` asserting LOCAL_EMAIL, verified or not. */
async function signInFrom(
  instance: Awaited<ReturnType<typeof instanceWithLocalAccount>>,
  providerId: string,
  incomingVerified: boolean
) {
  const context = await instance.auth.$context
  const result = await handleOAuthUserInfo(
    { context } as never,
    {
      userInfo: {
        id: 'idp-subject-1',
        email: LOCAL_EMAIL,
        emailVerified: incomingVerified,
        name: 'Ada',
      },
      account: { providerId, accountId: 'idp-subject-1' },
      callbackURL: '/',
    } as never
  ).catch((error: unknown) => ({ error, data: null }))
  const linked = instance.db.account.some(
    (row) => row.providerId === providerId && row.userId === 'user_local'
  )
  return { result, linked }
}

beforeEach(() => {
  hoisted.options = null
})

describe("the app's linking options (J23)", () => {
  it('keep implicit linking behind a verified local address (J23)', async () => {
    const linking = (await appAccountOptions()).accountLinking ?? {}

    // Better Auth's default is to require it; the app must not switch it off.
    expect(linking.requireLocalEmailVerified).not.toBe(false)
    expect(linking.enabled).toBe(true)
  })

  it('trust only the providers the workspace configured, by their ids (J23)', async () => {
    const linking = (await appAccountOptions()).accountLinking ?? {}

    expect(linking.trustedProviders).toEqual(['oidc_acme'])
  })
})

describe('a sign-in from a provider the app does not trust (J23)', () => {
  it('does not link into a verified account when it does not vouch for the address itself (J23)', async () => {
    const instance = await instanceWithLocalAccount(true)

    const { result, linked } = await signInFrom(instance, 'stranger', false)

    expect(linked).toBe(false)
    expect(result).toMatchObject({ error: 'account not linked' })
  })

  it('links when the provider vouches for the address too, so the refusal above is about that (J23)', async () => {
    const instance = await instanceWithLocalAccount(true)

    const { linked } = await signInFrom(instance, 'stranger', true)

    expect(linked).toBe(true)
  })
})

describe('an account a signed widget identify created (J23)', () => {
  it('is not linked into by a trusted provider that did not verify the address (J23)', async () => {
    // identify writes emailVerified = false (J23, revised), so this is the
    // account it leaves behind. Before the revision the same sign-in linked.
    const instance = await instanceWithLocalAccount(false)

    const { result, linked } = await signInFrom(instance, 'oidc_acme', false)

    expect(linked).toBe(false)
    expect(result).toMatchObject({ error: 'account not linked' })
  })
})

describe('an account whose address is not verified (J23)', () => {
  it.each([
    ['a trusted provider', 'oidc_acme'],
    ['an untrusted provider', 'stranger'],
  ])(
    'is not linked into by %s even with a verified incoming address (J23)',
    async (_label, provider) => {
      const instance = await instanceWithLocalAccount(false)

      const { linked } = await signInFrom(instance, provider, true)

      expect(linked).toBe(false)
    }
  )
})
