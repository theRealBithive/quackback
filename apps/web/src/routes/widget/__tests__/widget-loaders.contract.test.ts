/**
 * The widget's route loaders: who may be handed off to the portal, and where
 * the first paint's messenger data comes from (J12, J8).
 *
 * `/widget` decides once, from the request's own session, whether the widget
 * may send this browser through the portal handoff: a teammate signed into
 * the site may not (J12), a customer or an anonymous visitor may. `/widget/`
 * seeds the messenger's presence, the team avatars and the visitor's
 * conversation summary for the first paint; since #555 those reads go to the
 * widget's own endpoints (J8), never the site's.
 *
 * Both loaders run for real against a stubbed request; the server functions
 * they call are replaced by recorders.
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
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { QueryClient } from '@tanstack/react-query'

const hoisted = vi.hoisted(() => ({
  widgetGetConversationPresenceFn: vi.fn(),
  widgetGetTeamAvatarsFn: vi.fn(),
  widgetGetMyConversationFn: vi.fn(),
  getOptionalWidgetAuth: vi.fn(async () => null),
  runGetConversationPresence: vi.fn(),
  runGetWidgetTeamAvatars: vi.fn(),
  runGetMyConversation: vi.fn(),
  siteCalls: [] as string[],
}))

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
vi.mock('@tanstack/react-start/server', () => ({
  setResponseHeader: vi.fn(),
  getRequestHeaders: () => new Headers({ cookie: 'better-auth.session_token=signed' }),
}))
vi.mock('@/lib/server/functions/portal-session-token', () => ({
  extractSessionTokenFromCookie: () => 'signed-session-token',
}))
vi.mock('@/lib/server/functions/portal', () => ({
  fetchUserAvatar: vi.fn(async () => ({ avatarUrl: null })),
}))
vi.mock('@/lib/shared/i18n', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/shared/i18n')>()),
  loadWidgetMessages: vi.fn(async () => ({})),
}))

vi.mock('@/lib/server/functions/widget/conversation', () => ({
  widgetGetConversationPresenceFn: hoisted.widgetGetConversationPresenceFn,
  widgetGetTeamAvatarsFn: hoisted.widgetGetTeamAvatarsFn,
  widgetGetMyConversationFn: hoisted.widgetGetMyConversationFn,
}))
// Measured on vitest 4.1: when one module dynamically imports a mocked module
// several times at once, only the first import receives the mock; the others
// load the real module. The index loader does exactly that (presence, team
// avatars and the conversation summary). So the real widget endpoints may
// serve the later branches, and what they reach is mocked one level down: the
// widget auth entry point and the shared conversation core. The site's own
// endpoints in that module are recorders that must stay silent.
vi.mock('@/lib/server/functions/widget-auth', () => ({
  getOptionalWidgetAuth: hoisted.getOptionalWidgetAuth,
}))
vi.mock('@/lib/server/functions/conversation', () => {
  const site = (name: string) =>
    vi.fn(async () => {
      hoisted.siteCalls.push(name)
      throw new Error(`site endpoint ${name} reached from the widget`)
    })
  return {
    runGetConversationPresence: hoisted.runGetConversationPresence,
    runGetWidgetTeamAvatars: hoisted.runGetWidgetTeamAvatars,
    runGetMyConversation: hoisted.runGetMyConversation,
    getConversationPresenceFn: site('getConversationPresenceFn'),
    getWidgetTeamAvatarsFn: site('getWidgetTeamAvatarsFn'),
    getMyConversationFn: site('getMyConversationFn'),
  }
})
vi.mock('@/lib/server/functions/widget/posts', () => ({
  widgetFetchBoardCapabilitiesFn: vi.fn(),
}))
vi.mock('@/lib/server/functions/widget/help', () => ({
  widgetListPublicArticlesFn: vi.fn(async () => ({ items: [] })),
}))
vi.mock('@/lib/server/functions/powered-by', () => ({
  getShowPoweredByFn: vi.fn(async () => false),
}))
vi.mock('@/lib/server/config', () => ({
  getBaseUrl: () => 'https://feedback.example.com',
}))
vi.mock('@/lib/client/queries/portal', () => ({
  portalQueries: {
    portalData: () => ({
      queryKey: ['portal-data-test'],
      queryFn: async () => ({
        boards: [],
        posts: { items: [], hasMore: false },
        statuses: [],
        votedPostIds: [],
        boardPermissions: {},
      }),
    }),
  },
}))

type Loader = (args: { context: unknown; location: { search: unknown } }) => Promise<unknown>

async function layoutLoader(): Promise<Loader> {
  const { Route } = await import('../../widget')
  return (Route.options as unknown as { loader: Loader }).loader
}

async function indexLoader(): Promise<Loader> {
  const { Route } = await import('../index')
  return (Route.options as unknown as { loader: Loader }).loader
}

const SETTINGS = {
  settings: { id: 'workspace_1', slug: 'acme', name: 'Acme' },
  brandingConfig: {},
  publicWidgetConfig: { hmacRequired: true },
}

function sessionOf(principalType: 'user' | 'anonymous') {
  return {
    user: {
      id: 'user_1',
      name: 'Ada',
      email: 'ada@example.com',
      image: null,
      principalType,
    },
  }
}

const PRESENCE = { agentsOnline: true, withinOfficeHours: true, nextOpenAt: null }
const TEAM = [{ name: 'Grace', avatarUrl: null }]
const SUMMARY = { conversation: null, teamName: 'Acme' }

beforeEach(() => {
  // The widget endpoint and the core it delegates to answer alike, so the
  // outcome does not depend on which of the two served a branch.
  hoisted.widgetGetConversationPresenceFn.mockReset().mockResolvedValue(PRESENCE)
  hoisted.runGetConversationPresence.mockReset().mockResolvedValue(PRESENCE)
  hoisted.widgetGetTeamAvatarsFn.mockReset().mockResolvedValue(TEAM)
  hoisted.runGetWidgetTeamAvatars.mockReset().mockResolvedValue(TEAM)
  hoisted.widgetGetMyConversationFn.mockReset().mockResolvedValue(SUMMARY)
  hoisted.runGetMyConversation.mockReset().mockResolvedValue(SUMMARY)
  hoisted.getOptionalWidgetAuth.mockClear()
  hoisted.siteCalls.length = 0
})

describe('the /widget layout loader (J12)', () => {
  it.each([
    ['an admin', 'admin', false],
    ['a member', 'member', false],
    ['a customer', 'user', true],
    ['an anonymous visitor', null, true],
  ] as const)(
    'lets the widget hand %s off to the portal only when they are not a teammate (J12)',
    async (_label, userRole, expected) => {
      const loader = await layoutLoader()

      const data = (await loader({
        context: {
          settings: SETTINGS,
          session: userRole ? sessionOf('user') : null,
          userRole,
        },
        location: { search: {} },
      })) as { canPortalHandoff: boolean; portalSessionToken: string | null }

      expect(data.canPortalHandoff).toBe(expected)
    },
    // A cold import of the widget route tree dominates the first case.
    60_000
  )
})

describe('the /widget/ index loader (J8)', () => {
  async function runIndexLoader(settings: {
    messenger: boolean
    teamAvatars: boolean
  }): Promise<{ data: { team: unknown; messengerEnabled: boolean }; queryClient: QueryClient }> {
    const loader = await indexLoader()
    const queryClient = new QueryClient()
    const data = (await loader({
      context: {
        queryClient,
        session: null,
        settings: {
          slug: 'acme',
          name: 'Acme',
          featureFlags: {
            supportInbox: settings.messenger,
            feedback: true,
            changelog: false,
            helpCenter: false,
          },
          publicWidgetConfig: {
            tabs: { messenger: true },
            home: { showTeamAvatars: settings.teamAvatars },
          },
          publicPortalConfig: {},
        },
      },
      location: { search: {} },
    })) as { team: unknown; messengerEnabled: boolean }
    return { data, queryClient }
  }

  it('seeds the team avatars from the widget endpoint (J8)', async () => {
    const { data } = await runIndexLoader({ messenger: false, teamAvatars: true })

    expect(hoisted.widgetGetTeamAvatarsFn).toHaveBeenCalledTimes(1)
    expect(data.team).toEqual(TEAM)
    expect(hoisted.siteCalls).toEqual([])
  }, 60_000)

  it('seeds presence and the conversation summary through the widget endpoints, never the site’s (J8)', async () => {
    const { data, queryClient } = await runIndexLoader({ messenger: true, teamAvatars: false })

    const { CONVERSATION_PRESENCE_QUERY_KEY } =
      await import('@/components/widget/use-messenger-presence')
    const { conversationSummaryKey } = await import('@/components/widget/use-messenger-summary')
    const { INITIAL_SESSION_VERSION } = await import('@/lib/client/hooks/use-widget-vote')
    expect(data.messengerEnabled).toBe(true)
    expect(queryClient.getQueryData(CONVERSATION_PRESENCE_QUERY_KEY)).toEqual(PRESENCE)
    expect(queryClient.getQueryData(conversationSummaryKey(INITIAL_SESSION_VERSION))).toEqual(
      SUMMARY
    )
    // The summary was read as the widget reads it: either the widget endpoint
    // itself answered, or the real one did and asked the widget auth entry
    // point for its caller — exactly once between them.
    expect(
      hoisted.widgetGetMyConversationFn.mock.calls.length +
        hoisted.getOptionalWidgetAuth.mock.calls.length
    ).toBe(1)
    expect(hoisted.siteCalls).toEqual([])
  }, 60_000)

  it('asks none of them when the messenger and the avatar cluster are off (J8)', async () => {
    const loader = await indexLoader()

    await loader({
      context: {
        queryClient: new QueryClient(),
        session: null,
        settings: {
          slug: 'acme',
          name: 'Acme',
          featureFlags: { supportInbox: false, feedback: true },
          publicWidgetConfig: { tabs: { messenger: true }, home: { showTeamAvatars: false } },
          publicPortalConfig: {},
        },
      },
      location: { search: {} },
    })

    expect(hoisted.widgetGetConversationPresenceFn).not.toHaveBeenCalled()
    expect(hoisted.widgetGetTeamAvatarsFn).not.toHaveBeenCalled()
    expect(hoisted.widgetGetMyConversationFn).not.toHaveBeenCalled()
    expect(hoisted.runGetConversationPresence).not.toHaveBeenCalled()
    expect(hoisted.runGetWidgetTeamAvatars).not.toHaveBeenCalled()
    expect(hoisted.runGetMyConversation).not.toHaveBeenCalled()
  }, 60_000)
})
