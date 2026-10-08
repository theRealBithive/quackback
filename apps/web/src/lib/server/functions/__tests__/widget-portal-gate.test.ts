/**
 * The private-portal gate on the widget's endpoints (J22), with J20 and J21 as
 * its neighbours, driven through the real widget BFF handlers.
 *
 * Trust boundary (OWASP A01, broken access control): the Bearer token and the
 * private-portal setting arrive with the request. The check sits in each
 * widget BFF wrapper (posts, comments, changelog) and in the visitor gates of
 * `conversation.ts` (messenger), both through `widget-portal-gate.ts`.
 *
 * What is mocked and why: the widget auth entry points hand back the context
 * each caller kind really gets (`widget-portal-gate.db.test.ts` holds that
 * against real session rows), and the portal-site resolver answers with the
 * decision the portal site would reach for that caller. The wrappers and the
 * conversation gates run for real, and so does the gate module.
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
import fc from 'fast-check'

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
  caller: null as null | Record<string, unknown>,
  resolver: vi.fn(),
  /** Every data read a served request makes, by endpoint name. */
  served: vi.fn(),
}))

vi.mock('@/lib/server/functions/widget-auth', () => ({
  getOptionalWidgetAuth: async () => hoisted.caller,
  requireWidgetAuth: async () => {
    if (!hoisted.caller) throw new Error('Authentication required')
    return hoisted.caller
  },
}))

vi.mock('@/lib/server/functions/portal-access', () => ({
  resolvePortalAccessForRequest: hoisted.resolver,
}))

// The run helpers behind the posts, comments and changelog wrappers. Reaching
// one is what "served" means for those endpoints.
function servedBy(name: string) {
  return async () => {
    hoisted.served(name)
    return { servedBy: name }
  }
}
vi.mock('@/lib/server/functions/public-posts', () => ({
  runListPublicPosts: servedBy('widgetListPublicPostsFn'),
  runCreatePublicPost: servedBy('widgetCreatePublicPostFn'),
  runToggleVote: servedBy('widgetToggleVoteFn'),
  runGetVotedPosts: servedBy('widgetGetVotedPostsFn'),
}))
vi.mock('@/lib/server/functions/portal', () => ({
  runFetchPublicPostDetail: servedBy('widgetFetchPublicPostDetailFn'),
  runFetchBoardCapabilities: servedBy('widgetFetchBoardCapabilitiesFn'),
}))
vi.mock('@/lib/server/functions/comments', () => ({
  runCreateComment: servedBy('widgetCreateCommentFn'),
  runAddReaction: servedBy('widgetAddReactionFn'),
  runRemoveReaction: servedBy('widgetRemoveReactionFn'),
}))
vi.mock('@/lib/server/functions/changelog', () => ({
  runGetPublicChangelog: servedBy('widgetGetPublicChangelogFn'),
  runListPublicChangelogs: servedBy('widgetListPublicChangelogsFn'),
}))

// The messenger's run helpers stay real; their first data read after the gate
// is what "served" means for them.
vi.mock('@/lib/server/functions/auth-helpers', () => ({
  requireAuth: vi.fn(),
  getOptionalAuth: vi.fn(),
  assertPermission: vi.fn(),
  policyActorFromAuth: vi.fn(async () => ({ role: 'user' })),
  hasAuthCredentials: vi.fn(),
  isAuthDenialError: vi.fn(() => false),
}))
vi.mock('@/lib/server/domains/settings/settings.support', () => ({
  isConversationsEnabled: async () => true,
  isSupportTicketsEnabled: async () => false,
}))
vi.mock('@/lib/server/domains/principals/blocking', () => ({
  isBlocked: async () => {
    hoisted.served('widgetSendConversationMessageFn')
    return true
  },
}))
vi.mock('@/lib/server/domains/conversation/conversation.service', () => ({
  assertConversationViewable: async () => {
    hoisted.served('widgetListConversationMessagesFn')
    throw new Error('stop after the first read')
  },
  markConversationRead: servedBy('widgetMarkConversationReadFn'),
  signalTyping: servedBy('widgetSendConversationTypingFn'),
  recordCsat: servedBy('widgetSubmitCsatFn'),
}))
vi.mock('@/lib/server/domains/conversation/conversation.query', () => ({
  // Destructured by the run helpers before their first read; never reached.
  listMessages: vi.fn(),
  enrichMessagesForAgent: vi.fn(),
  conversationToDTO: vi.fn(),
  getConversationForVisitor: async () => {
    hoisted.served('widgetGetMyConversationFn')
    return { conversation: null }
  },
  getActiveConversationForVisitor: async () => {
    hoisted.served('widgetGetMyConversationFn')
    return { conversation: null }
  },
  listConversationsForVisitor: async () => {
    hoisted.served('widgetGetMyConversationsFn')
    return []
  },
  countVisitorUnreadMessages: async () => {
    hoisted.served('widgetGetMessengerUnreadFn')
    return 3
  },
}))
// runGetMyConversation builds its greeting before the gate; these feed it.
vi.mock('@/lib/server/domains/settings/settings.widget', () => ({
  getMessengerConfig: async () => ({}),
  getWidgetConfig: async () => ({ translations: {} }),
}))
vi.mock('@/lib/server/functions/workspace', () => ({ getSettings: async () => null }))
vi.mock('@quackback/email', () => ({ isEmailConfigured: () => false }))
vi.mock('@/lib/server/realtime/stream-token', () => ({
  mintStreamToken: () => {
    hoisted.served('widgetMintConversationStreamTokenFn')
    return 'stream-token'
  },
}))

import { NotFoundError } from '@/lib/shared/errors'

// ---------------------------------------------------------------------------
// Callers
// ---------------------------------------------------------------------------

/**
 * Every kind of caller a widget endpoint meets, with the context the widget
 * auth entry points give it. Only the two signed kinds carry
 * `signedWidgetIdentity: true`.
 */
const CALLER_KINDS = [
  'no widget session',
  'anonymous widget session',
  'unsigned (email-capture) widget session',
  'dashboard session presented as a Bearer',
  'signed customer',
  'signed teammate',
] as const
type CallerKind = (typeof CALLER_KINDS)[number]

function isSigned(kind: CallerKind): boolean {
  return kind === 'signed customer' || kind === 'signed teammate'
}

function contextFor(kind: CallerKind): Record<string, unknown> | null {
  if (kind === 'no widget session') return null
  const principalType = kind === 'anonymous widget session' ? 'anonymous' : 'user'
  return {
    settings: { id: 'workspace_1', slug: 'acme', name: 'Acme', logoKey: null },
    user: { id: 'user_1', email: 'visitor@example.com', name: 'Visitor', image: null },
    // J4: whatever the role in the workspace, the widget presents a customer.
    principal: { id: 'principal_1', role: 'user', type: principalType },
    permissions: [],
    scope: 'widget',
    signedWidgetIdentity: isSigned(kind),
  }
}

// ---------------------------------------------------------------------------
// Endpoints
// ---------------------------------------------------------------------------

type Denial =
  | { kind: 'value'; value: unknown }
  | { kind: 'includes'; value: Record<string, unknown> }
  | { kind: 'throws'; error: RegExp | (abstract new (...args: never[]) => Error) }

interface GatedEndpoint {
  module: 'posts' | 'comments' | 'changelog' | 'conversation'
  name: string
  /** What the portal site's wrapper answers a caller it does not admit. */
  denial: Denial
  /**
   * The run helper returns early for a request with no session at all, before
   * the gate, so that caller is never served whatever the portal says.
   */
  needsPrincipal: boolean
}

const PORTAL_ACCESS_REQUIRED: Denial = { kind: 'throws', error: /Portal access required/ }

/**
 * The widget endpoints whose portal-site counterpart runs the private-portal
 * gate, read off the code: each one's portal twin either calls
 * `resolvePortalAccessForRequest` in its wrapper (posts, comments, changelog)
 * or reaches it through the shared visitor gate in `conversation.ts`.
 */
const GATED_ENDPOINTS: GatedEndpoint[] = [
  {
    module: 'posts',
    name: 'widgetListPublicPostsFn',
    denial: { kind: 'value', value: { items: [], hasMore: false, total: 0 } },
    needsPrincipal: false,
  },
  {
    module: 'posts',
    name: 'widgetFetchPublicPostDetailFn',
    denial: { kind: 'value', value: null },
    needsPrincipal: false,
  },
  {
    module: 'posts',
    name: 'widgetFetchBoardCapabilitiesFn',
    denial: { kind: 'value', value: { permissions: {}, boards: [] } },
    needsPrincipal: false,
  },
  {
    module: 'posts',
    name: 'widgetCreatePublicPostFn',
    denial: PORTAL_ACCESS_REQUIRED,
    needsPrincipal: true,
  },
  {
    module: 'posts',
    name: 'widgetToggleVoteFn',
    denial: PORTAL_ACCESS_REQUIRED,
    needsPrincipal: true,
  },
  {
    module: 'comments',
    name: 'widgetCreateCommentFn',
    denial: PORTAL_ACCESS_REQUIRED,
    needsPrincipal: true,
  },
  {
    module: 'comments',
    name: 'widgetAddReactionFn',
    denial: PORTAL_ACCESS_REQUIRED,
    needsPrincipal: true,
  },
  {
    module: 'comments',
    name: 'widgetRemoveReactionFn',
    denial: PORTAL_ACCESS_REQUIRED,
    needsPrincipal: true,
  },
  {
    module: 'changelog',
    name: 'widgetGetPublicChangelogFn',
    denial: { kind: 'throws', error: NotFoundError },
    needsPrincipal: false,
  },
  {
    module: 'changelog',
    name: 'widgetListPublicChangelogsFn',
    denial: { kind: 'value', value: { items: [], nextCursor: null, hasMore: false } },
    needsPrincipal: false,
  },
  {
    module: 'conversation',
    name: 'widgetSendConversationMessageFn',
    denial: PORTAL_ACCESS_REQUIRED,
    needsPrincipal: true,
  },
  {
    module: 'conversation',
    name: 'widgetListConversationMessagesFn',
    denial: PORTAL_ACCESS_REQUIRED,
    needsPrincipal: true,
  },
  {
    module: 'conversation',
    name: 'widgetMarkConversationReadFn',
    denial: PORTAL_ACCESS_REQUIRED,
    needsPrincipal: true,
  },
  {
    module: 'conversation',
    name: 'widgetSendConversationTypingFn',
    denial: PORTAL_ACCESS_REQUIRED,
    needsPrincipal: true,
  },
  {
    module: 'conversation',
    name: 'widgetSubmitCsatFn',
    denial: PORTAL_ACCESS_REQUIRED,
    needsPrincipal: true,
  },
  {
    module: 'conversation',
    name: 'widgetMintConversationStreamTokenFn',
    denial: PORTAL_ACCESS_REQUIRED,
    needsPrincipal: true,
  },
  {
    module: 'conversation',
    name: 'widgetGetMyConversationFn',
    // The greeting-only bootstrap: config, no thread.
    denial: { kind: 'includes', value: { conversation: null, messages: [], hasMore: false } },
    needsPrincipal: true,
  },
  {
    module: 'conversation',
    name: 'widgetGetMyConversationsFn',
    denial: { kind: 'value', value: { conversations: [], linkedTickets: {} } },
    needsPrincipal: true,
  },
  {
    module: 'conversation',
    name: 'widgetGetMessengerUnreadFn',
    denial: { kind: 'value', value: { conversations: 0, total: 0 } },
    needsPrincipal: true,
  },
]

/**
 * Widget endpoints that carry no private-portal gate, each with the reason.
 * Every one of them matches its portal-site twin, which has none either.
 */
const UNGATED_ENDPOINTS: Record<string, string> = {
  widgetGetVotedPostsFn: "only the caller's own vote ids; getVotedPostsFn has no portal gate",
  widgetGetConversationPresenceFn: 'team availability for the launcher; no portal gate on the site',
  widgetGetTeamAvatarsFn: 'team avatars for the launcher; no portal gate on the site',
  widgetGetMyTicketsFn: "the caller's own tickets; getMyTicketsFn has no portal gate",
  widgetGetMyTicketStageLabelsFn: 'stage labels; no portal gate on the site',
  widgetGetMyTicketFormFn: 'ticket form; no portal gate on the site',
  widgetGetMyTicketWatchStatusFn: "the caller's own ticket; no portal gate on the site",
  widgetGetConversationLinkedTicketFn: "the caller's own ticket; no portal gate on the site",
  widgetCreateMyTicketFn: 'createMyTicketFn has no portal gate',
  widgetWatchMyTicketFn: "the caller's own ticket; no portal gate on the site",
  widgetUnwatchMyTicketFn: "the caller's own ticket; no portal gate on the site",
  widgetGetUserStatsFn: "the caller's own counts; getUserStatsFn has no portal gate",
  widgetListPublicCategoriesFn: 'help center; the site applies no private-portal gate to it',
  widgetListPublicArticlesForCategoryFn: 'help center; no private-portal gate on the site',
  widgetResolvePublicArticleRefFn: 'help center; no private-portal gate on the site',
  widgetRecordArticleFeedbackFn: 'help center; no private-portal gate on the site',
  widgetListPublicArticlesFn: 'help center; no private-portal gate on the site',
}

const WIDGET_MODULES = {
  posts: () => import('../widget/posts'),
  comments: () => import('../widget/comments'),
  changelog: () => import('../widget/changelog'),
  conversation: () => import('../widget/conversation'),
  tickets: () => import('../widget/tickets'),
  help: () => import('../widget/help'),
  user: () => import('../widget/user'),
} as const

type Endpoint = (args?: { data?: unknown }) => Promise<unknown>

async function endpointFor(spec: GatedEndpoint): Promise<Endpoint> {
  const mod = (await WIDGET_MODULES[spec.module]()) as unknown as Record<string, Endpoint>
  return mod[spec.name]
}

/** Input that every endpoint above accepts once its validator is out of the way. */
const ANY_INPUT = {
  data: {
    id: 'changelog_1',
    postId: 'post_1',
    commentId: 'comment_1',
    emoji: '👍',
    boardId: 'board_1',
    title: 'Title',
    content: 'Body',
    conversationId: 'conversation_1',
    rating: 5,
    limit: 10,
    sort: 'top',
  },
}

/** Call an endpoint and report what came back, without letting a throw escape. */
async function call(
  endpoint: Endpoint
): Promise<{ ok: true; value: unknown } | { ok: false; error: unknown }> {
  try {
    return { ok: true, value: await endpoint(ANY_INPUT) }
  } catch (error) {
    return { ok: false, error }
  }
}

function setCaller(kind: CallerKind) {
  hoisted.caller = contextFor(kind)
}

/** What the portal site would answer this caller: admitted or not. */
function setPortalSiteDecision(admits: boolean) {
  hoisted.resolver.mockResolvedValue(
    admits ? { granted: true, reason: 'public' } : { granted: false, reason: 'unauthenticated' }
  )
}

beforeEach(() => {
  hoisted.caller = null
  hoisted.resolver.mockReset()
  hoisted.served.mockReset()
})

// ---------------------------------------------------------------------------
// The matrix
// ---------------------------------------------------------------------------

describe('the private-portal gate on the widget endpoints (J20, J22)', () => {
  it('serves a caller exactly when the identity was signed or the portal site would admit it (J20, J22)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(...CALLER_KINDS),
        fc.constantFrom(...GATED_ENDPOINTS),
        fc.constantFrom('public workspace', 'private workspace'),
        fc.boolean(),
        async (kind, spec, workspace, privatePortalAdmitsCaller) => {
          hoisted.served.mockReset()
          hoisted.resolver.mockReset()
          setCaller(kind)
          // A public workspace admits everybody; on a private one the portal
          // site admits a caller only through an allowlisted domain, an
          // invite, a segment or the handoff marker — any of which the
          // generator may or may not give this caller.
          const portalSiteAdmits = workspace === 'public workspace' || privatePortalAdmitsCaller
          setPortalSiteDecision(portalSiteAdmits)

          const outcome = await call(await endpointFor(spec))

          const hasSession = kind !== 'no widget session'
          const reachesGate = hasSession || !spec.needsPrincipal
          const shouldServe = reachesGate && (isSigned(kind) || portalSiteAdmits)

          // Unguarded, across every branch: the data is read exactly when the
          // contract says so, and only ever on behalf of this endpoint.
          expect(hoisted.served.mock.calls.length > 0).toBe(shouldServe)
          for (const [servedName] of hoisted.served.mock.calls) {
            expect(servedName).toBe(spec.name)
          }
          // A signed identity never pays for (or depends on) the portal-site
          // resolver; everyone else who reaches the gate is asked about.
          const resolverAsked = hoisted.resolver.mock.calls.length > 0
          expect(resolverAsked).toBe(reachesGate && !isSigned(kind))

          if (shouldServe || !reachesGate) return
          // Refused: the same answer the portal site gives a denied caller.
          if (spec.denial.kind === 'value') {
            expect(outcome).toEqual({ ok: true, value: spec.denial.value })
          } else if (spec.denial.kind === 'includes') {
            expect(outcome.ok).toBe(true)
            expect((outcome as { value: unknown }).value).toMatchObject(spec.denial.value)
          } else if (spec.denial.error instanceof RegExp) {
            expect(outcome.ok).toBe(false)
            expect(String((outcome as { error: Error }).error.message)).toMatch(spec.denial.error)
          } else {
            expect(outcome.ok).toBe(false)
            expect((outcome as { error: unknown }).error).toBeInstanceOf(spec.denial.error)
          }
        }
      ),
      { numRuns: 400 }
    )
  })

  it.each(GATED_ENDPOINTS.map((spec) => [spec.name, spec] as const))(
    'keeps a private workspace closed to an anonymous widget visitor on %s (J22)',
    async (_name, spec) => {
      setCaller('anonymous widget session')
      setPortalSiteDecision(false)

      await call(await endpointFor(spec))

      expect(hoisted.served).not.toHaveBeenCalled()
    }
  )

  it.each(GATED_ENDPOINTS.map((spec) => [spec.name, spec] as const))(
    'keeps a private workspace closed to an unsigned identity on %s (J22)',
    async (_name, spec) => {
      setCaller('unsigned (email-capture) widget session')
      setPortalSiteDecision(false)

      await call(await endpointFor(spec))

      expect(hoisted.served).not.toHaveBeenCalled()
    }
  )

  it.each(GATED_ENDPOINTS.map((spec) => [spec.name, spec] as const))(
    'opens a private workspace to a signed identity without portal access on %s (J20)',
    async (_name, spec) => {
      setCaller('signed customer')
      setPortalSiteDecision(false)

      await call(await endpointFor(spec))

      expect(hoisted.served).toHaveBeenCalledWith(spec.name)
      expect(hoisted.resolver).not.toHaveBeenCalled()
    }
  )
})

// ---------------------------------------------------------------------------
// Completeness: no widget endpoint escapes the classification
// ---------------------------------------------------------------------------

describe('every widget endpoint is classified (J22)', () => {
  it('names each export of functions/widget as gated or as ungated with a reason (J22)', async () => {
    const exported: string[] = []
    for (const load of Object.values(WIDGET_MODULES)) {
      exported.push(...Object.keys(await load()))
    }
    const gated = GATED_ENDPOINTS.map((spec) => spec.name)
    const ungated = Object.keys(UNGATED_ENDPOINTS)

    expect([...gated, ...ungated].sort()).toEqual([...exported].sort())
    expect(gated.filter((name) => ungated.includes(name))).toEqual([])
    for (const reason of Object.values(UNGATED_ENDPOINTS)) {
      expect(reason.trim().length).toBeGreaterThan(10)
    }
  })
})

// ---------------------------------------------------------------------------
// The decision itself
// ---------------------------------------------------------------------------

describe('isPortalGateLiftedForWidget (J21, J22)', () => {
  it('lifts the gate for a widget session with a signed identity only (J22)', async () => {
    const { isPortalGateLiftedForWidget } = await import('../widget-portal-gate')

    fc.assert(
      fc.property(
        fc.constantFrom('widget', 'portal', 'dashboard') as fc.Arbitrary<
          'widget' | 'portal' | 'dashboard'
        >,
        fc.option(fc.boolean(), { nil: undefined }),
        (scope, signedWidgetIdentity) => {
          const lifted = isPortalGateLiftedForWidget({ scope, signedWidgetIdentity })

          expect(lifted).toBe(scope === 'widget' && signedWidgetIdentity === true)
        }
      )
    )
  })

  it('never lifts it for a request without a session (J22)', async () => {
    const { isPortalGateLiftedForWidget } = await import('../widget-portal-gate')

    expect(isPortalGateLiftedForWidget(null)).toBe(false)
  })

  it('never lifts it for a portal-site context, which carries no widget flag (J21)', async () => {
    // Contexts from requireAuth / getOptionalAuth never set the flag; a portal
    // session that somehow claimed it is still not a widget session.
    const { isPortalGateLiftedForWidget } = await import('../widget-portal-gate')

    expect(isPortalGateLiftedForWidget({ scope: 'portal' })).toBe(false)
    expect(isPortalGateLiftedForWidget({ scope: 'portal', signedWidgetIdentity: true })).toBe(false)
  })
})

describe('resolveWidgetPortalAccess (J21, J22)', () => {
  it('answers with the portal-site decision for an unsigned caller, unchanged (J21, J22)', async () => {
    const { resolveWidgetPortalAccess } = await import('../widget-portal-gate')
    hoisted.resolver.mockResolvedValue({ granted: false, reason: 'unauthorized' })

    await expect(
      resolveWidgetPortalAccess({ scope: 'widget', signedWidgetIdentity: false })
    ).resolves.toEqual({ granted: false, reason: 'unauthorized' })
  })

  it('grants a signed identity as a widget grant without asking the resolver (J20)', async () => {
    const { resolveWidgetPortalAccess } = await import('../widget-portal-gate')

    await expect(
      resolveWidgetPortalAccess({ scope: 'widget', signedWidgetIdentity: true })
    ).resolves.toEqual({ granted: true, reason: 'widget' })
    expect(hoisted.resolver).not.toHaveBeenCalled()
  })
})
