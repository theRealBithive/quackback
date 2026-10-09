/**
 * The site's messenger endpoints (J8, J9, J21).
 *
 * #555 moved every visitor messenger read and write into a `run*` core that
 * the widget's own endpoints call with the widget caller, and left the site
 * endpoint a thin wrapper that reads the session. This suite drives those
 * site wrappers for real, with the session and the conversation services
 * replaced, and pins three things: a portal customer reaches the same core
 * the widget uses; a widget session is refused there outright, or counts as
 * signed out where the session is optional (J9); and a private workspace stays
 * closed to a portal visitor without access, exactly as before (J21).
 *
 * Trust boundary (OWASP A01, broken access control): the session cookie and
 * the private-portal setting. The checks sit in `requireAuth` /
 * `getOptionalAuth` (J9) and in `assertVisitorConversationAccess` and the
 * visitor gates of `conversation.ts` (J21).
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
import { ANON_EMAIL_DOMAIN } from '@/lib/shared/anonymous-email'

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
  getOptionalAuth: vi.fn(),
  hasAuthCredentials: vi.fn(),
  portalAccessGranted: true,
  activeConversation: null as null | Record<string, unknown>,
  /** Every data read or write behind the gates, as [name, ...args]. */
  calls: [] as unknown[][],
}))

function recorded(name: string, answer: unknown = undefined) {
  return async (...args: unknown[]) => {
    hoisted.calls.push([name, ...args])
    return answer
  }
}

vi.mock('@/lib/server/functions/auth-helpers', () => ({
  requireAuth: hoisted.requireAuth,
  getOptionalAuth: hoisted.getOptionalAuth,
  hasAuthCredentials: hoisted.hasAuthCredentials,
  assertPermission: vi.fn(),
  isAuthDenialError: () => false,
  policyActorFromAuth: async (ctx: { principal: { id: string; role: string } }) => ({
    principalId: ctx.principal.id,
    role: ctx.principal.role,
  }),
}))
vi.mock('@/lib/server/functions/portal-access', () => ({
  resolvePortalAccessForRequest: async () => ({ granted: hoisted.portalAccessGranted }),
}))
vi.mock('@/lib/server/domains/settings/settings.support', () => ({
  isConversationsEnabled: async () => true,
  isSupportTicketsEnabled: async () => true,
}))
vi.mock('@/lib/server/domains/settings/settings.widget', () => ({
  getMessengerConfig: async () => ({ welcomeMessage: 'Hi there', teamName: 'Support' }),
  getWidgetConfig: async () => ({ translations: {} }),
}))
vi.mock('@/lib/server/functions/workspace', () => ({
  getSettings: async () => ({ name: 'Acme', assistantConfig: null }),
}))
vi.mock('@quackback/email', () => ({ isEmailConfigured: () => true }))
vi.mock('@/lib/server/domains/settings/settings.office-hours', () => ({
  getOfficeHoursSchedule: async () => null,
}))
vi.mock('@/lib/server/realtime/presence', () => ({
  isAnyAgentAvailable: async () => true,
}))
vi.mock('@/lib/server/domains/principals/principal.service', () => ({
  listTeamAvatars: async (limit: number) => [{ name: `first ${limit}`, avatarUrl: null }],
}))
vi.mock('@/lib/server/domains/tickets/requester.service', () => ({
  getRequesterTicketForConversation: recorded('getRequesterTicketForConversation', {
    id: 'ticket_1',
  }),
  getRequesterTicketSummaries: async () => new Map(),
}))
vi.mock('@/lib/server/domains/conversation/conversation.service', () => ({
  assertConversationViewable: recorded('assertConversationViewable'),
  markConversationRead: recorded('markConversationRead'),
  signalTyping: recorded('signalTyping'),
  recordCsat: recorded('recordCsat'),
  deleteConversationMessage: recorded('deleteConversationMessage'),
}))
vi.mock('@/lib/server/domains/conversation/conversation.query', () => ({
  listMessages: async (...args: unknown[]) => {
    hoisted.calls.push(['listMessages', ...args])
    return { messages: [{ id: 'message_1' }], hasMore: true }
  },
  enrichMessagesForAgent: vi.fn(),
  conversationToDTO: async (conversation: { id: string }, audience: string) => ({
    dto: conversation.id,
    audience,
  }),
  getConversationForVisitor: async (...args: unknown[]) => {
    hoisted.calls.push(['getConversationForVisitor', ...args])
    return { conversation: hoisted.activeConversation, isReadOnly: true }
  },
  getActiveConversationForVisitor: async (...args: unknown[]) => {
    hoisted.calls.push(['getActiveConversationForVisitor', ...args])
    return { conversation: hoisted.activeConversation, isReadOnly: false }
  },
  listConversationsForVisitor: async (...args: unknown[]) => {
    hoisted.calls.push(['listConversationsForVisitor', ...args])
    return []
  },
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
  user: { id: 'user_anon', email: `visitor-1@${ANON_EMAIL_DOMAIN}`, name: 'Visitor', image: null },
  principal: { id: 'principal_anon', role: 'user', type: 'anonymous' },
}

const CUSTOMER_ACTOR = { principalId: 'principal_1', role: 'user' }

function callNames(): string[] {
  return hoisted.calls.map((call) => String(call[0]))
}

/** The site endpoints that need a session, with the service each one reaches. */
async function requiredSessionEndpoints() {
  const conversation = await import('../conversation')
  return [
    {
      name: 'listConversationMessagesFn',
      call: conversation.listConversationMessagesFn as unknown as Endpoint,
      data: { conversationId: 'conversation_1' },
      reaches: ['assertConversationViewable', 'conversation_1', CUSTOMER_ACTOR],
    },
    {
      name: 'markConversationReadFn',
      call: conversation.markConversationReadFn as unknown as Endpoint,
      data: { conversationId: 'conversation_1' },
      reaches: ['markConversationRead', 'conversation_1', CUSTOMER_ACTOR],
    },
    {
      name: 'sendConversationTypingFn',
      call: conversation.sendConversationTypingFn as unknown as Endpoint,
      data: { conversationId: 'conversation_1' },
      reaches: ['signalTyping', 'conversation_1', CUSTOMER_ACTOR],
    },
    {
      name: 'submitCsatFn',
      call: conversation.submitCsatFn as unknown as Endpoint,
      data: { conversationId: 'conversation_1', rating: 5, comment: 'Great' },
      reaches: ['recordCsat', 'conversation_1', 5, 'Great', CUSTOMER_ACTOR],
    },
    {
      name: 'deleteConversationMessageFn',
      call: conversation.deleteConversationMessageFn as unknown as Endpoint,
      data: { messageId: 'message_1' },
      reaches: ['deleteConversationMessage', 'message_1', CUSTOMER_ACTOR],
    },
  ]
}

beforeEach(() => {
  hoisted.requireAuth.mockReset().mockResolvedValue(PORTAL_CUSTOMER)
  hoisted.getOptionalAuth.mockReset().mockResolvedValue(PORTAL_CUSTOMER)
  hoisted.hasAuthCredentials.mockReset().mockReturnValue(true)
  hoisted.portalAccessGranted = true
  hoisted.activeConversation = null
  hoisted.calls.length = 0
})

describe('the messenger endpoints that need a session, on the site (J8, J9, J21)', () => {
  it('serve a portal customer through the shared core, as themselves (J8)', async () => {
    for (const endpoint of await requiredSessionEndpoints()) {
      hoisted.calls.length = 0

      await endpoint.call({ data: endpoint.data })

      expect({ endpoint: endpoint.name, first: hoisted.calls[0] }).toEqual({
        endpoint: endpoint.name,
        first: endpoint.reaches,
      })
    }
  }, 60_000)

  it('refuse a widget session before any read or write (J9)', async () => {
    hoisted.requireAuth.mockRejectedValue(
      new Error('Access denied: Widget sessions cannot access this resource')
    )

    for (const endpoint of await requiredSessionEndpoints()) {
      await expect(endpoint.call({ data: endpoint.data }), endpoint.name).rejects.toThrow(
        /Widget sessions cannot access/
      )
    }
    expect(callNames()).toEqual([])
  }, 60_000)

  it('keep a private workspace closed to a portal customer without portal access (J21)', async () => {
    hoisted.portalAccessGranted = false

    for (const endpoint of await requiredSessionEndpoints()) {
      await expect(endpoint.call({ data: endpoint.data }), endpoint.name).rejects.toThrow(
        /Portal access required/
      )
    }
    expect(callNames()).toEqual([])
  }, 60_000)
})

describe("the visitor's conversation and history on the site (J8, J9, J21)", () => {
  async function getMyConversation(data: unknown) {
    const { getMyConversationFn } = await import('../conversation')
    return (await (getMyConversationFn as unknown as Endpoint)({ data })) as Record<string, unknown>
  }

  async function getMyConversations() {
    const { getMyConversationsFn } = await import('../conversation')
    return (await (getMyConversationsFn as unknown as Endpoint)()) as Record<string, unknown>
  }

  it('answers only the greeting to a request with no credentials, without reading the session (J9)', async () => {
    hoisted.hasAuthCredentials.mockReturnValue(false)

    const thread = await getMyConversation({})
    const history = await getMyConversations()

    expect(thread).toMatchObject({ welcomeMessage: 'Hi there', conversation: null, messages: [] })
    expect(history).toEqual({ conversations: [], linkedTickets: {} })
    expect(hoisted.getOptionalAuth).not.toHaveBeenCalled()
    expect(callNames()).toEqual([])
  })

  it('treats a widget session, which the optional read answers as signed out, the same way (J9)', async () => {
    hoisted.getOptionalAuth.mockResolvedValue(null)

    const thread = await getMyConversation({})
    const history = await getMyConversations()

    expect(thread).toMatchObject({ conversation: null, messages: [], hasMore: false })
    expect(history).toEqual({ conversations: [], linkedTickets: {} })
    expect(callNames()).toEqual([])
  })

  it('shows a portal customer without access to a private workspace only the greeting (J21)', async () => {
    hoisted.portalAccessGranted = false
    hoisted.activeConversation = { id: 'conversation_1', visitorEmail: null }

    const thread = await getMyConversation({})
    const history = await getMyConversations()

    expect(thread).toMatchObject({ conversation: null, messages: [] })
    expect(history).toEqual({ conversations: [], linkedTickets: {} })
    expect(callNames()).toEqual([])
  })

  it("loads a portal customer's active thread with its messages and linked ticket (J8)", async () => {
    hoisted.activeConversation = { id: 'conversation_1', visitorEmail: null }

    const thread = await getMyConversation({})

    expect(thread).toMatchObject({
      conversation: { dto: 'conversation_1', audience: 'visitor' },
      messages: [{ id: 'message_1' }],
      hasMore: true,
      isReadOnly: false,
      linkedTicket: { id: 'ticket_1' },
      visitorHasEmail: true,
      canEmailVisitor: true,
    })
    expect(hoisted.calls[0]).toEqual(['getActiveConversationForVisitor', 'principal_1'])
  })

  it('opens a specific thread when one is asked for, read-only as the query says (J8)', async () => {
    hoisted.activeConversation = { id: 'conversation_2', visitorEmail: null }

    const thread = await getMyConversation({ conversationId: 'conversation_2' })

    expect(thread).toMatchObject({ conversation: { dto: 'conversation_2' }, isReadOnly: true })
    expect(hoisted.calls[0]).toEqual(['getConversationForVisitor', 'conversation_2', 'principal_1'])
  })

  it('answers an empty thread when the visitor has no conversation yet (J8)', async () => {
    const thread = await getMyConversation({})

    expect(thread).toMatchObject({ conversation: null, messages: [], visitorHasEmail: true })
    expect(callNames()).toEqual(['getActiveConversationForVisitor'])
  })

  it('counts an address the visitor left on the conversation as a way to reach them (J8)', async () => {
    hoisted.getOptionalAuth.mockResolvedValue(PORTAL_ANONYMOUS)
    hoisted.activeConversation = { id: 'conversation_1', visitorEmail: 'left@example.com' }

    const thread = await getMyConversation({})

    expect(thread).toMatchObject({ visitorHasEmail: true, canEmailVisitor: true })
  })

  it('never counts the placeholder address of an anonymous visitor as reachable (J8)', async () => {
    hoisted.getOptionalAuth.mockResolvedValue(PORTAL_ANONYMOUS)
    hoisted.activeConversation = { id: 'conversation_1', visitorEmail: null }

    const thread = await getMyConversation({})

    expect(thread).toMatchObject({ visitorHasEmail: false, canEmailVisitor: false })
  })

  it('starts a new conversation with the greeting and no thread read (J8)', async () => {
    const forCustomer = await getMyConversation({ conversationId: null })
    hoisted.getOptionalAuth.mockResolvedValue(PORTAL_ANONYMOUS)
    const forAnonymous = await getMyConversation({ conversationId: null })

    expect(forCustomer).toMatchObject({
      conversation: null,
      visitorHasEmail: true,
      canEmailVisitor: true,
    })
    expect(forAnonymous).toMatchObject({
      conversation: null,
      visitorHasEmail: false,
      canEmailVisitor: false,
    })
    expect(callNames()).toEqual([])
  })

  it("lists a portal customer's own conversations (J8)", async () => {
    await getMyConversations()

    expect(hoisted.calls).toEqual([['listConversationsForVisitor', 'principal_1', 50, 'visitor']])
  })
})

describe('the public messenger reads on the site (J8)', () => {
  it('answer team presence and avatars without reading any session (J8)', async () => {
    const { getConversationPresenceFn, getWidgetTeamAvatarsFn } = await import('../conversation')

    await expect((getConversationPresenceFn as unknown as Endpoint)()).resolves.toEqual({
      agentsOnline: true,
      withinOfficeHours: null,
      nextOpenAt: null,
    })
    await expect((getWidgetTeamAvatarsFn as unknown as Endpoint)()).resolves.toEqual([
      { name: 'first 3', avatarUrl: null },
    ])
    expect(hoisted.requireAuth).not.toHaveBeenCalled()
    expect(hoisted.getOptionalAuth).not.toHaveBeenCalled()
  })
})
