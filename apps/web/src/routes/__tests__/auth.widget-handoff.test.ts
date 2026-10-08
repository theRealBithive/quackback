/**
 * The widget-to-portal handoff (J11–J15, R6), driven through the real route
 * handler.
 *
 * This file used to test `runHandoffLoader`, a hand-kept copy of the handler
 * that predated #555 and lacked its teammate and dashboard branches. Every
 * case it held is carried over below against the handler `createServerFn` was
 * given, which the route registers and the loader calls. Two source-text
 * checks of R6 were dropped rather than carried: they read the order of two
 * strings in the route file, and the behavioural order of the same two writes
 * is asserted on the real handler both here (J15) and in
 * auth.widget-handoff-promotion.test.ts.
 *
 * What is mocked: Better Auth's verify endpoint (a `fetch`), the database
 * edges the handler reads and writes, the browser's existing session, and
 * the audit log. Every decision runs in the production code.
 *
 * Trust boundary (OWASP A01, broken access control; A07, identification and
 * authentication failures): the one-time token and `returnTo` arrive in the
 * visitor's URL, the existing session in the visitor's cookie. The handler
 * decides whether a portal session is installed in that browser, and over
 * what.
 *
 * R6, from the confirmed list in lib/server/functions/__tests__/auth-scope.test.ts:
 *
 *   R6  The one-time-token handoff promotes the session to the portal audience
 *       before the cookie is set, not after.
 *
 * Confirmed contract for this batch, verbatim:
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
import { beforeEach, describe, expect, it, vi } from 'vitest'
import fc from 'fast-check'

type HandoffResult = {
  kind: 'redirect' | 'error'
  status?: string
  to?: string
  search?: Record<string, string>
}
type HandoffHandler = (args: {
  data: { ott?: string; returnTo?: string }
}) => Promise<HandoffResult>

const hoisted = vi.hoisted(() => ({
  handler: null as HandoffHandler | null,
  /** Every write the handler makes, in order: 'promote', 'cookie', 'marker'. */
  writes: [] as string[],
  cookies: [] as unknown[],
  provenanceRow: vi.fn(),
  principalRow: vi.fn(),
  existingSession: vi.fn(),
  updateSet: vi.fn(),
  updateWhere: vi.fn(),
  insertValues: vi.fn(),
  recordAuditEvent: vi.fn(),
  requestCookie: null as string | null,
  serverFnOptions: null as unknown,
  logChild: vi.fn(),
  log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

vi.mock('@tanstack/react-start', () => ({
  createServerFn: (options: unknown) => {
    hoisted.serverFnOptions = options
    const chain: Record<string, unknown> = {}
    chain.validator = () => chain
    chain.handler = (handler: HandoffHandler) => {
      hoisted.handler = handler
      return Object.assign((args: Parameters<HandoffHandler>[0]) => handler(args), chain)
    }
    return chain
  },
  createServerOnlyFn: (fn: unknown) => fn,
}))

vi.mock('@tanstack/react-start/server', () => ({
  setResponseHeader: (name: string, value: unknown) => {
    hoisted.writes.push('cookie')
    hoisted.cookies.push({ name, value })
  },
  getRequestHeaders: () =>
    new Headers(hoisted.requestCookie ? { cookie: hoisted.requestCookie } : {}),
}))

vi.mock('@/lib/server/auth/session', () => ({
  getSession: () => hoisted.existingSession(),
}))
vi.mock('@/lib/server/config', () => ({ config: { baseUrl: 'http://localhost:3000' } }))
vi.mock('@/lib/server/audit/log', () => ({ recordAuditEvent: hoisted.recordAuditEvent }))
vi.mock('@/lib/server/logger', () => ({
  logger: {
    child: (bindings: unknown) => {
      hoisted.logChild(bindings)
      return hoisted.log
    },
  },
}))

vi.mock('@/lib/server/db', () => ({
  db: {
    query: {
      widgetIdentifiedSession: { findFirst: (query: unknown) => hoisted.provenanceRow(query) },
      principal: { findFirst: (query: unknown) => hoisted.principalRow(query) },
    },
    update: () => ({
      set: (values: unknown) => {
        hoisted.updateSet(values)
        return {
          where: (condition: unknown) => {
            hoisted.writes.push('promote')
            return hoisted.updateWhere(condition)
          },
        }
      },
    }),
    insert: () => ({
      values: (row: unknown) => {
        hoisted.writes.push('marker')
        hoisted.insertValues(row)
        return { onConflictDoNothing: () => Promise.resolve(undefined) }
      },
    }),
  },
  session: { id: 'session.id' },
  principal: { userId: 'principal.user_id' },
  widgetIdentifiedSession: { sessionId: 'widget_identified_session.session_id' },
  widgetOriginSession: { sessionId: 'widget_origin_session.session_id' },
  eq: (column: unknown, value: unknown) => ({ column, value }),
}))

import { isHandoffPrincipalTeammate, isWidgetSessionHmacVerified } from '../auth.widget-handoff'

const TOKEN_SESSION = 'sess_from_the_token'
const TOKEN_USER = 'user_from_the_token'

/** Better Auth's answer to a token it accepted. */
function verifiedToken(): Response {
  const headers = new Headers()
  headers.append('set-cookie', 'better-auth.session_token=abc; Path=/; HttpOnly')
  return {
    ok: true,
    status: 200,
    headers,
    json: async () => ({
      session: { id: TOKEN_SESSION, userId: TOKEN_USER },
      user: { id: TOKEN_USER },
    }),
  } as unknown as Response
}

function refusedToken(status: number): Response {
  return { ok: false, status, headers: new Headers() } as unknown as Response
}

async function handoff(data: { ott?: string; returnTo?: string }): Promise<HandoffResult> {
  await import('../auth.widget-handoff')
  if (!hoisted.handler) throw new Error('the route registered no server-fn handler')
  return hoisted.handler({ data })
}

/** The browser already holds a session with this audience. */
function browserHolds(scope: 'dashboard' | 'portal' | 'widget') {
  hoisted.existingSession.mockResolvedValue({ user: { id: 'user_in_browser' }, session: { scope } })
}

function auditReasons(): unknown[] {
  return hoisted.recordAuditEvent.mock.calls.map(([event]) => event?.metadata?.reason)
}

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  hoisted.writes.length = 0
  hoisted.cookies.length = 0
  hoisted.requestCookie = null
  hoisted.provenanceRow.mockReset().mockResolvedValue({ hmacVerified: true })
  hoisted.principalRow.mockReset().mockResolvedValue({ role: 'user' })
  hoisted.existingSession.mockReset().mockResolvedValue(null)
  hoisted.updateSet.mockReset()
  hoisted.updateWhere.mockReset().mockResolvedValue(undefined)
  hoisted.insertValues.mockReset()
  hoisted.recordAuditEvent.mockReset().mockResolvedValue(undefined)
  hoisted.logChild.mockReset()
  for (const level of Object.values(hoisted.log)) level.mockReset()
  fetchMock = vi.fn(async () => verifiedToken())
  vi.stubGlobal('fetch', fetchMock)
})

// ---------------------------------------------------------------------------
// J11 — an identified customer arrives signed in; an anonymous one does not
// ---------------------------------------------------------------------------

describe('an identified customer following "View on portal" (J11, J15, R6)', () => {
  it('arrives signed in on the destination, through a portal session (J11)', async () => {
    const result = await handoff({ ott: 'tok', returnTo: '/posts/123' })

    expect(result).toEqual({ kind: 'redirect', to: '/posts/123' })
    expect(hoisted.cookies).toEqual([
      { name: 'Set-Cookie', value: ['better-auth.session_token=abc; Path=/; HttpOnly'] },
    ])
    expect(hoisted.updateSet).toHaveBeenCalledWith({ scope: 'portal' })
  })

  it('promotes the session before the cookie is set, then marks its widget origin (J15, R6)', async () => {
    await handoff({ ott: 'tok' })

    expect(hoisted.writes).toEqual(['promote', 'cookie', 'marker'])
    expect(hoisted.updateWhere).toHaveBeenCalledWith(
      expect.objectContaining({ value: TOKEN_SESSION })
    )
    expect(hoisted.insertValues).toHaveBeenCalledWith({
      sessionId: TOKEN_SESSION,
      userId: TOKEN_USER,
    })
  })

  it('records the consumed audit event (J11)', async () => {
    await handoff({ ott: 'tok' })

    expect(hoisted.recordAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'portal.widget_handshake.consumed', outcome: 'success' })
    )
  })

  it('lands on / when no destination is given (J11)', async () => {
    await expect(handoff({ ott: 'tok' })).resolves.toEqual({ kind: 'redirect', to: '/' })
  })

  it('never redirects off-site: an absolute returnTo falls back to / (J11)', async () => {
    const result = await handoff({ ott: 'tok', returnTo: 'https://evil.example.com' })

    expect(result).toEqual({ kind: 'redirect', to: '/' })
  })

  it('forwards the browser cookie to the verify call, and the token in the body (J11)', async () => {
    hoisted.requestCookie = 'better-auth.session_token=old'

    await handoff({ ott: 'tok' })

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('http://localhost:3000/api/auth/one-time-token/verify')
    expect(init.headers).toEqual({
      'content-type': 'application/json',
      cookie: 'better-auth.session_token=old',
    })
    expect(JSON.parse(String(init.body))).toEqual({ token: 'tok' })
  })

  it('sends no cookie header to verify when the browser has none (J11)', async () => {
    await handoff({ ott: 'tok' })

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(init.headers).toEqual({ 'content-type': 'application/json' })
  })

  it('still installs the cookie when the response exposes no getSetCookie (J11)', async () => {
    const headers = new Headers()
    headers.append('set-cookie', 'a=1; Path=/')
    headers.append('set-cookie', 'b=2; Path=/')
    Object.defineProperty(headers, 'getSetCookie', { value: undefined })
    fetchMock.mockResolvedValue({
      ...verifiedToken(),
      ok: true,
      status: 200,
      headers,
      json: async () => ({ session: { id: TOKEN_SESSION }, user: { id: TOKEN_USER } }),
    })

    await handoff({ ott: 'tok' })

    expect(hoisted.cookies).toEqual([{ name: 'Set-Cookie', value: ['a=1; Path=/', 'b=2; Path=/'] }])
  })

  it('takes the user from the session when the answer names no user (J11)', async () => {
    fetchMock.mockResolvedValue({
      ...verifiedToken(),
      ok: true,
      status: 200,
      headers: verifiedToken().headers,
      json: async () => ({ session: { id: TOKEN_SESSION, userId: TOKEN_USER } }),
    })

    await handoff({ ott: 'tok' })

    expect(hoisted.insertValues).toHaveBeenCalledWith({
      sessionId: TOKEN_SESSION,
      userId: TOKEN_USER,
    })
  })

  it('still reaches the portal when the origin marker cannot be written (J11)', async () => {
    hoisted.insertValues.mockImplementation(() => {
      throw new Error('connection refused')
    })

    await expect(handoff({ ott: 'tok' })).resolves.toEqual({ kind: 'redirect', to: '/' })
    expect(hoisted.writes).toEqual(['promote', 'cookie', 'marker'])
  })
})

describe('a visitor whose token did not come from a signed identify (J11)', () => {
  it.each([
    ['an anonymous widget visitor (no provenance row)', undefined],
    ['an unsigned identify', { hmacVerified: false }],
  ])('arrives signed out and keeps the session the browser had: %s (J11)', async (_label, row) => {
    hoisted.provenanceRow.mockResolvedValue(row)
    browserHolds('portal')

    const result = await handoff({ ott: 'tok', returnTo: '/posts/1' })

    expect(result).toEqual({ kind: 'error', status: 'invalid' })
    expect(hoisted.writes).toEqual([])
    expect(auditReasons()).toEqual(['unverified_provenance'])
  })

  it('fails closed when the provenance lookup itself fails (J11)', async () => {
    hoisted.provenanceRow.mockRejectedValue(new Error('connection refused'))

    await expect(handoff({ ott: 'tok' })).resolves.toEqual({ kind: 'error', status: 'invalid' })
    expect(hoisted.writes).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// J12–J14 — teammates and dashboard sessions
// ---------------------------------------------------------------------------

describe('a teammate following the handoff (J12, J14)', () => {
  it.each(['admin', 'member'])(
    'never receives a portal session as %s, and lands on sign-in when not signed in (J12)',
    async (role) => {
      hoisted.principalRow.mockResolvedValue({ role })

      const result = await handoff({ ott: 'tok', returnTo: '/posts/abc' })

      expect(result).toEqual({
        kind: 'redirect',
        to: '/',
        search: { auth: 'signin', callbackUrl: '/posts/abc' },
      })
      expect(hoisted.writes).toEqual([])
      expect(auditReasons()).toEqual(['teammate_identity'])
    }
  )

  it('lands on the destination with the dashboard session intact when already signed in (J12, J13)', async () => {
    hoisted.principalRow.mockResolvedValue({ role: 'admin' })
    browserHolds('dashboard')

    const result = await handoff({ ott: 'tok', returnTo: '/posts/abc' })

    expect(result).toEqual({ kind: 'redirect', to: '/posts/abc' })
    expect(hoisted.writes).toEqual([])
    expect(auditReasons()).toEqual(['teammate_identity'])
  })

  it('is treated as a teammate when the lookup fails, and nothing is installed (J14)', async () => {
    hoisted.principalRow.mockRejectedValue(new Error('connection refused'))

    const result = await handoff({ ott: 'tok', returnTo: '/posts/abc' })

    expect(result.kind).toBe('redirect')
    expect(hoisted.writes).toEqual([])
    expect(auditReasons()).toEqual(['teammate_identity'])
  })
})

describe('a dashboard session already in the browser (J13)', () => {
  it('is never replaced by a customer token (J13)', async () => {
    browserHolds('dashboard')

    const result = await handoff({ ott: 'tok', returnTo: '/posts/abc' })

    expect(result).toEqual({ kind: 'redirect', to: '/posts/abc' })
    expect(hoisted.writes).toEqual([])
    expect(auditReasons()).toEqual(['dashboard_session_present'])
  })

  it('is never replaced when the browser session cannot be read, either (J13)', async () => {
    // The handler cannot tell whether a dashboard session is there, so it
    // must not install a portal session that might land on top of one.
    hoisted.existingSession.mockRejectedValue(new Error('connection refused'))

    const result = await handoff({ ott: 'tok', returnTo: '/posts/abc' })

    expect(result).toEqual({ kind: 'redirect', to: '/posts/abc' })
    expect(hoisted.writes).toEqual([])
    expect(auditReasons()).toEqual(['existing_session_unknown'])
  })

  it.each(['portal', 'widget'] as const)(
    'does not stop a customer whose browser holds a %s session (J11, J13)',
    async (scope) => {
      browserHolds(scope)

      await expect(handoff({ ott: 'tok' })).resolves.toEqual({ kind: 'redirect', to: '/' })
      expect(hoisted.writes).toEqual(['promote', 'cookie', 'marker'])
    }
  )
})

describe('the handoff over every combination (J11–J15)', () => {
  it('installs a portal session exactly for a signed customer over no dashboard session, promoted first (J11–J15)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom('signed', 'unsigned', 'no row', 'lookup fails'),
        fc.constantFrom('user', 'admin', 'member', 'no principal', 'lookup fails'),
        fc.constantFrom('none', 'dashboard', 'portal', 'widget', 'lookup fails'),
        async (provenance, role, browser) => {
          hoisted.writes.length = 0
          hoisted.recordAuditEvent.mockClear()
          if (provenance === 'signed')
            hoisted.provenanceRow.mockResolvedValue({ hmacVerified: true })
          if (provenance === 'unsigned')
            hoisted.provenanceRow.mockResolvedValue({ hmacVerified: false })
          if (provenance === 'no row') hoisted.provenanceRow.mockResolvedValue(undefined)
          if (provenance === 'lookup fails') hoisted.provenanceRow.mockRejectedValue(new Error('x'))
          if (role === 'no principal') hoisted.principalRow.mockResolvedValue(undefined)
          else if (role === 'lookup fails') hoisted.principalRow.mockRejectedValue(new Error('x'))
          else hoisted.principalRow.mockResolvedValue({ role })
          if (browser === 'none') hoisted.existingSession.mockResolvedValue(null)
          else if (browser === 'lookup fails')
            hoisted.existingSession.mockRejectedValue(new Error('x'))
          else browserHolds(browser)

          await handoff({ ott: 'tok', returnTo: '/posts/1' })

          const customer = role === 'user' || role === 'no principal'
          const shouldInstall =
            provenance === 'signed' &&
            customer &&
            (browser === 'none' || browser === 'portal' || browser === 'widget')
          // Unguarded, across every branch: either all three writes happen in
          // this order, or none does.
          expect(hoisted.writes).toEqual(shouldInstall ? ['promote', 'cookie', 'marker'] : [])
          // Every refusal leaves an audit trail; success leaves exactly one.
          expect(hoisted.recordAuditEvent).toHaveBeenCalledTimes(1)
        }
      ),
      { numRuns: 200 }
    )
  })
})

// ---------------------------------------------------------------------------
// Tokens Better Auth does not accept
// ---------------------------------------------------------------------------

describe('a token Better Auth refuses (J11)', () => {
  it('reports a missing token as invalid and audits it (J11)', async () => {
    const result = await handoff({})

    expect(result).toEqual({ kind: 'error', status: 'invalid' })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(auditReasons()).toEqual(['missing_ott'])
  })

  it('reports an expired or replayed token as invalid (J11)', async () => {
    fetchMock.mockResolvedValue(refusedToken(400))

    await expect(handoff({ ott: 'bad' })).resolves.toEqual({ kind: 'error', status: 'invalid' })
    expect(auditReasons()).toEqual(['ba_status_400'])
    expect(hoisted.writes).toEqual([])
  })

  it('reports any other refusal as an error (J11)', async () => {
    fetchMock.mockResolvedValue(refusedToken(500))

    await expect(handoff({ ott: 'bad' })).resolves.toEqual({ kind: 'error', status: 'error' })
    expect(auditReasons()).toEqual(['ba_status_500'])
  })

  it('reports an unreachable verify endpoint as an error (J11)', async () => {
    fetchMock.mockRejectedValue(new Error('Network error'))

    await expect(handoff({ ott: 'tok' })).resolves.toEqual({ kind: 'error', status: 'error' })
    expect(auditReasons()).toEqual(['fetch_error'])
  })

  it('refuses an answer that names no session, before any write (J11)', async () => {
    fetchMock.mockResolvedValue({
      ...verifiedToken(),
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => ({}),
    })

    await expect(handoff({ ott: 'tok' })).resolves.toEqual({ kind: 'error', status: 'invalid' })
    expect(auditReasons()).toEqual(['missing_session_info'])
    expect(hoisted.writes).toEqual([])
  })

  it('refuses an answer whose body cannot be read (J11)', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => {
        throw new SyntaxError('Unexpected token')
      },
    })

    await expect(handoff({ ott: 'tok' })).resolves.toEqual({ kind: 'error', status: 'invalid' })
    expect(hoisted.writes).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// The two lookups, read directly
// ---------------------------------------------------------------------------

describe('the route loader (J11)', () => {
  type Loader = (args: { location: { search: unknown } }) => Promise<unknown>

  async function routeLoader(): Promise<Loader> {
    const { Route } = await import('../auth.widget-handoff')
    return (Route.options as unknown as { loader: Loader }).loader
  }

  it('sends a signed-in customer on to the destination by throwing the redirect (J11)', async () => {
    const loader = await routeLoader()

    await expect(
      loader({ location: { search: { ott: 'tok', returnTo: '/posts/123' } } })
    ).rejects.toMatchObject({ options: { to: '/posts/123' } })
  })

  it('renders the error page for a token the server refused, with nothing installed (J11)', async () => {
    fetchMock.mockResolvedValue(refusedToken(500))
    const loader = await routeLoader()

    await expect(loader({ location: { search: { ott: 'bad' } } })).resolves.toEqual({
      status: 'error',
    })
    expect(hoisted.cookies).toEqual([])
  })
})

describe('isHandoffPrincipalTeammate (J12, J14)', () => {
  it('is true for admin and member, false for a customer or no principal (J12)', async () => {
    hoisted.principalRow.mockResolvedValueOnce({ role: 'admin' })
    expect(await isHandoffPrincipalTeammate('user_admin')).toBe(true)
    hoisted.principalRow.mockResolvedValueOnce({ role: 'member' })
    expect(await isHandoffPrincipalTeammate('user_member')).toBe(true)
    hoisted.principalRow.mockResolvedValueOnce({ role: 'user' })
    expect(await isHandoffPrincipalTeammate('user_customer')).toBe(false)
    hoisted.principalRow.mockResolvedValueOnce(undefined)
    expect(await isHandoffPrincipalTeammate('user_unknown')).toBe(false)
  })

  it('answers teammate when the lookup fails (J14)', async () => {
    hoisted.principalRow.mockRejectedValueOnce(new Error('connection refused'))

    expect(await isHandoffPrincipalTeammate('user_x')).toBe(true)
  })
})

describe('isWidgetSessionHmacVerified (J11)', () => {
  it('is true only for a row that says hmac_verified (J11)', async () => {
    hoisted.provenanceRow.mockResolvedValueOnce({ hmacVerified: true })
    expect(await isWidgetSessionHmacVerified('s')).toBe(true)
    hoisted.provenanceRow.mockResolvedValueOnce({ hmacVerified: false })
    expect(await isWidgetSessionHmacVerified('s')).toBe(false)
    hoisted.provenanceRow.mockResolvedValueOnce(undefined)
    expect(await isWidgetSessionHmacVerified('s')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// What the handoff records, asks and forwards (J11-J15; OWASP A09 for the
// audit trail)
// ---------------------------------------------------------------------------

/** A verify answer Better Auth accepted, with this body and these headers. */
function acceptedWith(body: () => Promise<unknown>, headers = new Headers()): Response {
  return { ok: true, status: 200, headers, json: body } as unknown as Response
}

const REFUSED = 'portal.widget_handshake.invalid'

function auditEvents(): unknown[] {
  return hoisted.recordAuditEvent.mock.calls.map(([event]) => event)
}

describe('the audit trail of a handoff (J11, J12, J13)', () => {
  it('records a request without a token, naming no one (J11)', async () => {
    await handoff({})

    expect(auditEvents()).toEqual([
      { event: REFUSED, outcome: 'failure', actor: {}, metadata: { reason: 'missing_ott' } },
    ])
  })

  it('records an unreachable verify endpoint and logs the cause (J11)', async () => {
    const cause = new Error('Network error')
    fetchMock.mockRejectedValue(cause)

    await handoff({ ott: 'tok' })

    expect(auditEvents()).toEqual([
      { event: REFUSED, outcome: 'failure', actor: {}, metadata: { reason: 'fetch_error' } },
    ])
    expect(hoisted.log.error).toHaveBeenCalledWith({ err: cause }, 'ott verify fetch failed')
  })

  it('records a token Better Auth refused with its status (J11)', async () => {
    fetchMock.mockResolvedValue(refusedToken(400))

    await expect(handoff({ ott: 'bad' })).resolves.toEqual({ kind: 'error', status: 'invalid' })
    expect(auditEvents()).toEqual([
      { event: REFUSED, outcome: 'failure', actor: {}, metadata: { reason: 'ba_status_400' } },
    ])
  })

  it('records a session that was not signed, naming the user and the session (J11)', async () => {
    hoisted.provenanceRow.mockResolvedValue({ hmacVerified: false })

    await handoff({ ott: 'tok' })

    expect(auditEvents()).toEqual([
      {
        event: REFUSED,
        outcome: 'failure',
        actor: { userId: TOKEN_USER },
        target: { type: 'session', id: TOKEN_SESSION },
        metadata: { reason: 'unverified_provenance' },
      },
    ])
  })

  it('records a teammate refused a portal session, naming the user and the session (J12)', async () => {
    hoisted.principalRow.mockResolvedValue({ role: 'admin' })

    await handoff({ ott: 'tok' })

    expect(auditEvents()).toEqual([
      {
        event: REFUSED,
        outcome: 'failure',
        actor: { userId: TOKEN_USER },
        target: { type: 'session', id: TOKEN_SESSION },
        metadata: { reason: 'teammate_identity' },
      },
    ])
  })

  it('records a completed handoff as a success for that user and session (J11)', async () => {
    await handoff({ ott: 'tok' })

    expect(auditEvents()).toEqual([
      {
        event: 'portal.widget_handshake.consumed',
        outcome: 'success',
        actor: { userId: TOKEN_USER },
        target: { type: 'session', id: TOKEN_SESSION },
      },
    ])
  })

  it('logs under its own component name (J11)', async () => {
    await handoff({ ott: 'tok' })

    expect(hoisted.logChild).toHaveBeenCalledWith({ component: 'widget-handoff' })
  })
})

describe('a verify answer that does not name both a session and its user (J11, J15)', () => {
  it.each([
    ['a session but no user', { session: { id: TOKEN_SESSION } }],
    ['a user but no session', { user: { id: TOKEN_USER } }],
    ['a user and a session without an id', { session: { userId: TOKEN_USER }, user: {} }],
  ])('is refused when it names %s, before anything is installed (J11)', async (_label, body) => {
    fetchMock.mockResolvedValue(acceptedWith(async () => body, verifiedToken().headers))

    await expect(handoff({ ott: 'tok' })).resolves.toEqual({ kind: 'error', status: 'invalid' })
    expect(hoisted.writes).toEqual([])
    expect(auditEvents()).toEqual([
      {
        event: REFUSED,
        outcome: 'failure',
        actor: {},
        metadata: { reason: 'missing_session_info' },
      },
    ])
    expect(hoisted.log.warn).toHaveBeenCalledWith(
      'session/user id missing from verify response, handoff rejected'
    )
  })

  it.each([
    ['an empty body', null],
    ['an object without session or user', {}],
    ['a user object without an id', { user: {} }],
  ])('reads %s as naming nobody, not as an unreadable answer (J11)', async (_label, body) => {
    fetchMock.mockResolvedValue(acceptedWith(async () => body))

    await expect(handoff({ ott: 'tok' })).resolves.toEqual({ kind: 'error', status: 'invalid' })
    expect(hoisted.log.warn).not.toHaveBeenCalledWith('could not parse verify response body')
    expect(auditReasons()).toEqual(['missing_session_info'])
  })

  it('warns about an answer whose body cannot be read, and refuses it (J11)', async () => {
    fetchMock.mockResolvedValue(
      acceptedWith(async () => {
        throw new SyntaxError('Unexpected token')
      })
    )

    await expect(handoff({ ott: 'tok' })).resolves.toEqual({ kind: 'error', status: 'invalid' })
    expect(hoisted.log.warn).toHaveBeenCalledWith('could not parse verify response body')
  })
})

describe('what the handoff forwards to the browser (J11, J15)', () => {
  it('forwards no cookie when Better Auth set none, and never another header as one (J15)', async () => {
    const headers = new Headers({ 'content-type': 'application/json', 'x-request-id': 'r1' })
    fetchMock.mockResolvedValue(
      acceptedWith(
        async () => ({ session: { id: TOKEN_SESSION }, user: { id: TOKEN_USER } }),
        headers
      )
    )

    await expect(handoff({ ott: 'tok' })).resolves.toEqual({ kind: 'redirect', to: '/' })
    expect(hoisted.cookies).toEqual([])
    expect(hoisted.writes).toEqual(['promote', 'marker'])
  })

  it('asks Better Auth to verify the token by POST, with the browser cookie alongside (J11)', async () => {
    hoisted.requestCookie = 'better-auth.session_token=old'

    await handoff({ ott: 'tok' })

    expect(fetchMock).toHaveBeenCalledWith('http://localhost:3000/api/auth/one-time-token/verify', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: 'better-auth.session_token=old' },
      body: JSON.stringify({ token: 'tok' }),
    })
  })

  it('consumes the token only through a POST server function, never a prefetchable GET (J11)', async () => {
    await import('../auth.widget-handoff')

    expect(hoisted.serverFnOptions).toEqual({ method: 'POST' })
  })

  it('keeps the token and the destination when it reads the address (J11)', async () => {
    const { Route } = await import('../auth.widget-handoff')
    const validateSearch = (
      Route.options as unknown as { validateSearch: (raw: unknown) => unknown }
    ).validateSearch

    expect(validateSearch({ ott: 'tok', returnTo: '/posts/1', other: 'x' })).toEqual({
      ott: 'tok',
      returnTo: '/posts/1',
    })
  })
})

describe('a write that fails after the checks passed (J15)', () => {
  it('logs a failed promotion and still installs nothing more than Better Auth set (J15)', async () => {
    const cause = new Error('deadlock')
    hoisted.updateWhere.mockRejectedValue(cause)

    await expect(handoff({ ott: 'tok' })).resolves.toEqual({ kind: 'redirect', to: '/' })
    expect(hoisted.log.error).toHaveBeenCalledWith(
      { err: cause },
      'failed to promote handoff session to portal scope'
    )
  })

  it('logs a failed origin marker and still lands the visitor on the destination (J11)', async () => {
    const cause = new Error('unique violation')
    hoisted.insertValues.mockImplementation(() => {
      throw cause
    })

    await expect(handoff({ ott: 'tok', returnTo: '/posts/1' })).resolves.toEqual({
      kind: 'redirect',
      to: '/posts/1',
    })
    expect(hoisted.log.error).toHaveBeenCalledWith(
      { err: cause },
      'failed to insert widget_origin_session marker'
    )
  })
})

describe('the two lookups behind the handoff (J11, J12, J14)', () => {
  it("asks for the role of the token's own user (J12)", async () => {
    await isHandoffPrincipalTeammate('user_42')

    expect(hoisted.principalRow).toHaveBeenCalledWith({
      where: { column: 'principal.user_id', value: 'user_42' },
      columns: { role: true },
    })
  })

  it("asks whether the token's own session was signed (J11)", async () => {
    await isWidgetSessionHmacVerified('sess_42')

    expect(hoisted.provenanceRow).toHaveBeenCalledWith({
      where: { column: 'widget_identified_session.session_id', value: 'sess_42' },
      columns: { hmacVerified: true },
    })
  })

  it('logs a failed teammate lookup, which then counts as a teammate (J14)', async () => {
    const cause = new Error('connection refused')
    hoisted.principalRow.mockRejectedValueOnce(cause)

    expect(await isHandoffPrincipalTeammate('user_x')).toBe(true)
    expect(hoisted.logChild).toHaveBeenCalledWith({ component: 'widget-handoff' })
    expect(hoisted.log.error).toHaveBeenCalledWith(
      { err: cause },
      'teammate lookup failed; skipping portal cookie'
    )
  })

  it('logs a failed provenance lookup, which then counts as unsigned (J11)', async () => {
    const cause = new Error('connection refused')
    hoisted.provenanceRow.mockRejectedValueOnce(cause)

    expect(await isWidgetSessionHmacVerified('s')).toBe(false)
    expect(hoisted.logChild).toHaveBeenCalledWith({ component: 'widget-handoff' })
    expect(hoisted.log.error).toHaveBeenCalledWith({ err: cause }, 'provenance lookup failed')
  })

  it('reads a session without a provenance row as unsigned, without calling it an outage (J11)', async () => {
    hoisted.provenanceRow.mockResolvedValueOnce(undefined)

    expect(await isWidgetSessionHmacVerified('s')).toBe(false)
    expect(hoisted.log.error).not.toHaveBeenCalled()
  })
})
