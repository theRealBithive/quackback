/**
 * The profile REST route refuses a widget session (J6).
 *
 * `PATCH /api/user/profile` renames the account and `DELETE` removes its
 * avatar. Both read the session cookie or Bearer; a widget session, whoever
 * holds it, must not change the account behind it. The handlers run for
 * real; the session, database and storage are stubbed so a test sees whether
 * a write was attempted.
 *
 * Trust boundary (OWASP A01, broken access control): the session the request
 * carries.
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

const hoisted = vi.hoisted(() => ({
  getSession: vi.fn(),
  findUser: vi.fn(),
  updateSet: vi.fn(),
  deleteObject: vi.fn(),
  syncPrincipalProfile: vi.fn(),
}))

vi.mock('@/lib/server/auth/session', () => ({ getSession: hoisted.getSession }))
vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: {
    query: { user: { findFirst: hoisted.findUser } },
    update: () => ({
      set: (values: unknown) => {
        hoisted.updateSet(values)
        return { where: () => ({ returning: async () => [{ id: 'user_1', name: 'New' }] }) }
      },
    }),
  },
}))
vi.mock('@/lib/server/storage/s3', () => ({ deleteObject: hoisted.deleteObject }))
vi.mock('@/lib/server/domains/principals/principal.service', () => ({
  syncPrincipalProfile: hoisted.syncPrincipalProfile,
}))

type Handler = (args: { request: Request }) => Promise<Response>

async function handlers(): Promise<{ PATCH: Handler; DELETE: Handler }> {
  const { Route } = await import('../profile')
  return (Route.options as unknown as { server: { handlers: { PATCH: Handler; DELETE: Handler } } })
    .server.handlers
}

function signedInOn(scope: 'widget' | 'portal' | 'dashboard') {
  hoisted.getSession.mockResolvedValue({ user: { id: 'user_1' }, session: { scope } })
}

function renameRequest(): Request {
  return new Request('http://localhost:3000/api/user/profile', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'New' }),
  })
}

function deleteAvatarRequest(): Request {
  return new Request('http://localhost:3000/api/user/profile', { method: 'DELETE' })
}

beforeEach(() => {
  vi.clearAllMocks()
  hoisted.findUser.mockResolvedValue({ id: 'user_1', imageKey: 'avatars/user_1.png' })
})

describe('PATCH /api/user/profile (J6)', () => {
  it('refuses a widget session and renames nothing (J6)', async () => {
    signedInOn('widget')

    const response = await (await handlers()).PATCH({ request: renameRequest() })

    expect(response.status).toBe(403)
    expect(hoisted.updateSet).not.toHaveBeenCalled()
  })

  it('renames the account on a portal session, so the refusal above is about the audience (J6)', async () => {
    signedInOn('portal')

    const response = await (await handlers()).PATCH({ request: renameRequest() })

    expect(response.status).toBe(200)
    expect(hoisted.updateSet).toHaveBeenCalledWith(expect.objectContaining({ name: 'New' }))
  })
})

describe('DELETE /api/user/profile (J6)', () => {
  it('refuses a widget session and removes no avatar (J6)', async () => {
    signedInOn('widget')

    const response = await (await handlers()).DELETE({ request: deleteAvatarRequest() })

    expect(response.status).toBe(403)
    expect(hoisted.updateSet).not.toHaveBeenCalled()
    expect(hoisted.deleteObject).not.toHaveBeenCalled()
  })

  it('removes the avatar on a dashboard session (J6)', async () => {
    signedInOn('dashboard')

    const response = await (await handlers()).DELETE({ request: deleteAvatarRequest() })

    expect(response.status).toBe(200)
    expect(hoisted.deleteObject).toHaveBeenCalledWith('avatars/user_1.png')
    expect(hoisted.updateSet).toHaveBeenCalledWith({ imageKey: null })
  })
})
