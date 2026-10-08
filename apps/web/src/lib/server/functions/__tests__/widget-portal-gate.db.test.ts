/**
 * Which widget sessions count as signed (J22), read off real session rows.
 *
 * `widget-portal-gate.test.ts` drives the endpoints with the context each
 * caller kind gets; this suite is where that context comes from. The widget's
 * auth entry point reads the Bearer token, finds the session, and asks the
 * `widget_identified_session` table whether that session came from a signed
 * identify. Only Postgres can say what a real row with `hmac_verified` false,
 * true or absent does, so the global `db` is rebound to the fixture's rollback
 * transaction and everything else runs unmodified.
 *
 * No live code path writes `hmac_verified = false` any more (identify is
 * verified-only since upstream GH #300), so the unsigned kind exists only in
 * rows written before that; it is inserted directly here.
 *
 * Trust boundary (OWASP A01, broken access control): the Bearer token is the
 * caller's own input; the provenance row is the only thing that lifts the
 * private-portal gate for it.
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
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createId, type PrincipalId, type UserId } from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { principal, session, user, widgetIdentifiedSession } from '@/lib/server/db'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

const request = vi.hoisted(() => ({ headers: new Headers() }))
vi.mock('@tanstack/react-start/server', () => ({
  getRequestHeaders: () => request.headers,
}))

vi.mock('@/lib/server/functions/workspace', () => ({
  getSettings: async () => ({ id: 'workspace_1', slug: 'acme', name: 'Acme' }),
}))

import { getOptionalWidgetAuth, requireWidgetAuth } from '../widget-auth'
import { hasSignedWidgetIdentity, isPortalGateLiftedForWidget } from '../widget-portal-gate'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: session.id, scope: session.scope }).from(session).limit(0)
    await db
      .select({ verified: widgetIdentifiedSession.hmacVerified })
      .from(widgetIdentifiedSession)
      .limit(0)
  },
})

const runSuffix = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

type Provenance = 'no row' | 'unsigned row' | 'signed row'

/**
 * A person with a live session presented as the widget's Bearer token.
 * `role` is the person's role in the workspace; `scope` the audience the
 * session was minted for.
 */
async function seedBearerSession(opts: {
  role: 'user' | 'admin'
  type: 'user' | 'anonymous'
  scope: 'widget' | 'portal' | 'dashboard'
  provenance: Provenance
}): Promise<{ sessionId: string }> {
  const userId = createId('user') as UserId
  const principalId = createId('principal') as PrincipalId
  const suffix = runSuffix()
  await testDb.insert(user).values({
    id: userId,
    name: 'Widget Visitor',
    email: `widget-gate-${suffix}@example.com`,
    isAnonymous: opts.type === 'anonymous',
  })
  await testDb.insert(principal).values({
    id: principalId,
    userId,
    role: opts.role,
    type: opts.type,
    displayName: 'Widget Visitor',
    createdAt: new Date(),
  })
  const sessionId = `sess-${suffix}`
  const token = `tok-${suffix}`
  await testDb.insert(session).values({
    id: sessionId,
    token,
    userId,
    scope: opts.scope,
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    updatedAt: new Date(),
  })
  if (opts.provenance !== 'no row') {
    await testDb
      .insert(widgetIdentifiedSession)
      .values({ sessionId, hmacVerified: opts.provenance === 'signed row' })
  }
  request.headers = new Headers({ authorization: `Bearer ${token}` })
  return { sessionId }
}

describe.skipIf(!fixture.available)('the signed flag on a real widget session (J22)', () => {
  beforeEach(fixture.begin)
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  it('is false for an anonymous widget visitor, so the gate stays (J22)', async () => {
    await seedBearerSession({
      role: 'user',
      type: 'anonymous',
      scope: 'widget',
      provenance: 'no row',
    })

    const ctx = await requireWidgetAuth()

    expect(ctx.signedWidgetIdentity).toBe(false)
    expect(isPortalGateLiftedForWidget(ctx)).toBe(false)
  })

  it('is false for an unsigned (email-capture) identify, so the gate stays (J22)', async () => {
    await seedBearerSession({
      role: 'user',
      type: 'user',
      scope: 'widget',
      provenance: 'unsigned row',
    })

    const ctx = await requireWidgetAuth()

    expect(ctx.signedWidgetIdentity).toBe(false)
    expect(isPortalGateLiftedForWidget(ctx)).toBe(false)
  })

  it('is true for a signed identify, so the gate lifts (J20, J22)', async () => {
    await seedBearerSession({
      role: 'user',
      type: 'user',
      scope: 'widget',
      provenance: 'signed row',
    })

    const ctx = await requireWidgetAuth()

    expect(ctx.signedWidgetIdentity).toBe(true)
    expect(isPortalGateLiftedForWidget(ctx)).toBe(true)
  })

  it('is true for a signed teammate, who still acts as a customer (J1, J4, J22)', async () => {
    await seedBearerSession({
      role: 'admin',
      type: 'user',
      scope: 'widget',
      provenance: 'signed row',
    })

    const ctx = await requireWidgetAuth()

    expect(ctx.signedWidgetIdentity).toBe(true)
    expect(ctx.principal.role).toBe('user')
    expect(ctx.permissions).toEqual([])
  })

  it('is false for a dashboard session reused as a Bearer, which is demoted too (J5, J22)', async () => {
    await seedBearerSession({
      role: 'admin',
      type: 'user',
      scope: 'dashboard',
      provenance: 'no row',
    })

    const ctx = await requireWidgetAuth()

    expect(ctx.scope).toBe('widget')
    expect(ctx.principal.role).toBe('user')
    expect(ctx.signedWidgetIdentity).toBe(false)
    expect(isPortalGateLiftedForWidget(ctx)).toBe(false)
  })

  it('follows the signed row onto a portal session the handoff promoted (J5, J22)', async () => {
    // The handoff promotes the very session the widget identified, so its
    // provenance row comes along; presented back to the widget it is still the
    // same signed identity, acting with customer rights.
    await seedBearerSession({
      role: 'user',
      type: 'user',
      scope: 'portal',
      provenance: 'signed row',
    })

    const ctx = await requireWidgetAuth()

    expect(ctx.scope).toBe('widget')
    expect(ctx.signedWidgetIdentity).toBe(true)
  })

  it('is false when the provenance lookup fails, so an outage never lifts the gate (J22)', async () => {
    const { sessionId } = await seedBearerSession({
      role: 'user',
      type: 'user',
      scope: 'widget',
      provenance: 'signed row',
    })
    const lookup = vi
      .spyOn(testDb.query.widgetIdentifiedSession, 'findFirst')
      .mockRejectedValueOnce(new Error('connection terminated'))

    try {
      await expect(hasSignedWidgetIdentity(sessionId)).resolves.toBe(false)
    } finally {
      lookup.mockRestore()
    }
    // The same row, read once the database answers again, is signed: the
    // false above came from the failure, not from the row.
    await expect(hasSignedWidgetIdentity(sessionId)).resolves.toBe(true)
  })

  it('carries no flag at all when there is no Bearer token (J22)', async () => {
    request.headers = new Headers()

    await expect(getOptionalWidgetAuth()).resolves.toBeNull()
    expect(isPortalGateLiftedForWidget(null)).toBe(false)
  })
})
