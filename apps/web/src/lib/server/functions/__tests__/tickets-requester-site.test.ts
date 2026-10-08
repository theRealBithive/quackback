/**
 * The site's requester ticket endpoints (J8, J9).
 *
 * #555 moved each requester read and write into a `run*` core that the
 * widget's own endpoints call with the widget caller, and left the site
 * endpoint as a thin wrapper around `requireAuth()`. This suite drives the
 * site wrappers for real, with `requireAuth` answering for each audience and
 * the ticket services replaced, so it pins two things: a site caller reaches
 * the same core the widget uses, and a widget session never reaches it here.
 *
 * Trust boundary (OWASP A01, broken access control): the session cookie. The
 * check sits in `requireAuth` (refusing the widget audience, J9) and in the
 * support-tickets flag each core checks before any read.
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
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => {
    const chain: Record<string, unknown> = {}
    chain.validator = () => chain
    chain.middleware = () => chain
    chain.handler = (handler: (args: { data?: unknown }) => Promise<unknown>) =>
      Object.assign((args?: { data?: unknown }) => handler(args ?? {}), chain)
    return chain
  },
  createServerOnlyFn: (fn: unknown) => fn,
}))

const hoisted = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  ticketsEnabled: true,
  /** Every service call the endpoints make, as [name, ...args]. */
  calls: [] as unknown[][],
}))

function recorded(name: string, answer: unknown = { from: name }) {
  return async (...args: unknown[]) => {
    hoisted.calls.push([name, ...args])
    return answer
  }
}

vi.mock('@/lib/server/functions/auth-helpers', () => ({
  requireAuth: hoisted.requireAuth,
  assertPermission: vi.fn(),
  policyActorFromAuth: async (ctx: { principal: { id: string; type: string; role: string } }) => ({
    principalId: ctx.principal.id,
    principalType: ctx.principal.type,
    role: ctx.principal.role,
  }),
}))
vi.mock('@/lib/server/domains/settings/settings.support', () => ({
  isSupportTicketsEnabled: async () => hoisted.ticketsEnabled,
}))
vi.mock('@/lib/server/domains/settings/settings.tickets', () => ({
  getStageLabels: recorded('getStageLabels', { open: 'Open' }),
}))
vi.mock('@/lib/server/domains/tickets/ticket-type-intake.service', () => ({
  listIntakeTypes: recorded('listIntakeTypes', [{ id: 'tickettype_1' }]),
  ticketTypeToIntakeDTO: (row: { id: string }) => ({ dto: row.id }),
  resolveIntakeCreate: recorded('resolveIntakeCreate', {
    ticketTypeId: 'tickettype_resolved',
    customAttributes: { plan: 'pro' },
  }),
}))
vi.mock('@/lib/server/domains/tickets/requester.service', () => ({
  isPlausibleContactEmail: (raw: string) => raw.includes('@') && raw.includes('.'),
  captureRequesterEmail: recorded('captureRequesterEmail'),
  getRequesterTicketForConversation: recorded('getRequesterTicketForConversation'),
  listMyTicketSummaries: recorded('listMyTicketSummaries', [{ id: 'ticket_1' }]),
  createMyTicket: recorded('createMyTicket', { id: 'ticket_new' }),
  getMyTicketWatchStatus: recorded('getMyTicketWatchStatus', { watching: true }),
  watchMyTicket: recorded('watchMyTicket'),
  unwatchMyTicket: recorded('unwatchMyTicket'),
}))

type Endpoint = (args?: { data?: unknown }) => Promise<unknown>

const PORTAL_CUSTOMER = {
  settings: { id: 'workspace_1', slug: 'acme', name: 'Acme' },
  user: { id: 'user_1', email: 'ada@example.com', name: 'Ada', image: null },
  principal: { id: 'principal_1', role: 'user', type: 'user' },
  permissions: [],
  scope: 'portal',
}

const PORTAL_ANONYMOUS = {
  ...PORTAL_CUSTOMER,
  user: { id: 'user_anon', email: 'anon-123@anon.invalid', name: 'Visitor', image: null },
  principal: { id: 'principal_anon', role: 'user', type: 'anonymous' },
}

const CUSTOMER_ACTOR = { principalId: 'principal_1', principalType: 'user', role: 'user' }

/** What requireAuth does for a widget Bearer since #555 (J9). */
function signedInThroughTheWidget() {
  hoisted.requireAuth.mockRejectedValue(
    new Error('Access denied: Widget sessions cannot access this resource')
  )
}

async function endpoints() {
  const tickets = await import('../tickets')
  const table: Array<{
    name: string
    call: Endpoint
    data: unknown
    service: string
    serviceArgs: unknown[]
  }> = [
    {
      name: 'getMyTicketStageLabelsFn',
      call: tickets.getMyTicketStageLabelsFn as unknown as Endpoint,
      data: undefined,
      service: 'getStageLabels',
      serviceArgs: [],
    },
    {
      name: 'getMyTicketFormFn',
      call: tickets.getMyTicketFormFn as unknown as Endpoint,
      data: undefined,
      service: 'listIntakeTypes',
      serviceArgs: [],
    },
    {
      name: 'getMyTicketWatchStatusFn',
      call: tickets.getMyTicketWatchStatusFn as unknown as Endpoint,
      data: { ticketId: 'ticket_1' },
      service: 'getMyTicketWatchStatus',
      serviceArgs: [CUSTOMER_ACTOR, 'ticket_1'],
    },
    {
      name: 'getConversationLinkedTicketFn',
      call: tickets.getConversationLinkedTicketFn as unknown as Endpoint,
      data: { conversationId: 'conversation_1' },
      service: 'getRequesterTicketForConversation',
      serviceArgs: ['conversation_1', 'principal_1'],
    },
    {
      name: 'getMyTicketsFn',
      call: tickets.getMyTicketsFn as unknown as Endpoint,
      data: undefined,
      service: 'listMyTicketSummaries',
      serviceArgs: ['principal_1'],
    },
    {
      name: 'createMyTicketFn',
      call: tickets.createMyTicketFn as unknown as Endpoint,
      data: { title: 'Printer on fire' },
      service: 'createMyTicket',
      serviceArgs: [
        CUSTOMER_ACTOR,
        {
          title: 'Printer on fire',
          description: undefined,
          descriptionJson: null,
          attachments: undefined,
          ticketTypeId: 'tickettype_resolved',
          customAttributes: { plan: 'pro' },
        },
      ],
    },
    {
      name: 'watchMyTicketFn',
      call: tickets.watchMyTicketFn as unknown as Endpoint,
      data: { ticketId: 'ticket_1' },
      service: 'watchMyTicket',
      serviceArgs: [CUSTOMER_ACTOR, 'ticket_1'],
    },
    {
      name: 'unwatchMyTicketFn',
      call: tickets.unwatchMyTicketFn as unknown as Endpoint,
      data: { ticketId: 'ticket_1' },
      service: 'unwatchMyTicket',
      serviceArgs: [CUSTOMER_ACTOR, 'ticket_1'],
    },
  ]
  return table
}

function serviceCalls(): string[] {
  return hoisted.calls.map((call) => String(call[0]))
}

beforeEach(() => {
  hoisted.requireAuth.mockReset().mockResolvedValue(PORTAL_CUSTOMER)
  hoisted.ticketsEnabled = true
  hoisted.calls.length = 0
})

describe('the requester ticket endpoints on the site (J8, J9)', () => {
  it('serve a signed-in portal customer through the shared core, with their own identity (J8)', async () => {
    for (const endpoint of await endpoints()) {
      hoisted.calls.length = 0

      await endpoint.call({ data: endpoint.data })

      const call = hoisted.calls.find(([name]) => name === endpoint.service)
      expect({ endpoint: endpoint.name, call }).toEqual({
        endpoint: endpoint.name,
        call: [endpoint.service, ...endpoint.serviceArgs],
      })
    }
  }, 60_000)

  it('refuse a widget session before any read or write (J9)', async () => {
    signedInThroughTheWidget()

    for (const endpoint of await endpoints()) {
      await expect(endpoint.call({ data: endpoint.data }), endpoint.name).rejects.toThrow(
        /Widget sessions cannot access/
      )
    }
    // Unguarded across every endpoint: nothing behind the gate was touched.
    expect(serviceCalls()).toEqual([])
  }, 60_000)

  it('answers the stage labels and the intake form a signed-in requester sees (J8)', async () => {
    const tickets = await import('../tickets')

    await expect((tickets.getMyTicketStageLabelsFn as unknown as Endpoint)()).resolves.toEqual({
      open: 'Open',
    })
    await expect((tickets.getMyTicketFormFn as unknown as Endpoint)()).resolves.toEqual({
      types: [{ dto: 'tickettype_1' }],
    })
    await expect((tickets.getMyTicketsFn as unknown as Endpoint)()).resolves.toEqual({
      tickets: [{ id: 'ticket_1' }],
    })
  })
})

describe('when support tickets are switched off (J8)', () => {
  it('refuses every requester write and the requester reads that need the feature (J8)', async () => {
    hoisted.ticketsEnabled = false
    const gated = (await endpoints()).filter(
      (endpoint) =>
        endpoint.name !== 'getMyTicketStageLabelsFn' &&
        endpoint.name !== 'getConversationLinkedTicketFn'
    )

    for (const endpoint of gated) {
      await expect(endpoint.call({ data: endpoint.data }), endpoint.name).rejects.toThrow(
        /Tickets are not available/
      )
    }
    expect(serviceCalls()).toEqual([])
  })

  it('answers no linked ticket rather than an error, so the thread header just disappears (J8)', async () => {
    hoisted.ticketsEnabled = false
    const tickets = await import('../tickets')

    await expect(
      (tickets.getConversationLinkedTicketFn as unknown as Endpoint)({
        data: { conversationId: 'conversation_1' },
      })
    ).resolves.toBeNull()
    expect(serviceCalls()).toEqual([])
  })
})

describe('an anonymous requester opening a ticket (J8)', () => {
  async function createAs(ctx: unknown, data: Record<string, unknown>) {
    hoisted.requireAuth.mockResolvedValue(ctx)
    const tickets = await import('../tickets')
    return (tickets.createMyTicketFn as unknown as Endpoint)({ data })
  }

  it('captures a plausible contact address before the ticket is created (J8)', async () => {
    await createAs(PORTAL_ANONYMOUS, { title: 'Help', email: 'ada@example.com' })

    expect(serviceCalls()).toEqual([
      'captureRequesterEmail',
      'resolveIntakeCreate',
      'createMyTicket',
    ])
    expect(hoisted.calls[0]).toEqual(['captureRequesterEmail', 'principal_anon', 'ada@example.com'])
  })

  it('captures nothing for an address that is not plausible, and still asks the service (J8)', async () => {
    await createAs(PORTAL_ANONYMOUS, { title: 'Help', email: 'not-an-address' })

    expect(serviceCalls()).toEqual(['resolveIntakeCreate', 'createMyTicket'])
  })

  it('never captures an address for a signed-in customer, who already has one (J8)', async () => {
    await createAs(PORTAL_CUSTOMER, { title: 'Help', email: 'other@example.com' })

    expect(serviceCalls()).toEqual(['resolveIntakeCreate', 'createMyTicket'])
  })

  it('resolves the type and answers against the submitted type and field values (J8)', async () => {
    await createAs(PORTAL_CUSTOMER, {
      title: 'Help',
      ticketTypeId: 'tickettype_2',
      fieldValues: { plan: 'pro' },
    })

    expect(hoisted.calls[0]).toEqual(['resolveIntakeCreate', 'tickettype_2', { plan: 'pro' }])
  })
})
