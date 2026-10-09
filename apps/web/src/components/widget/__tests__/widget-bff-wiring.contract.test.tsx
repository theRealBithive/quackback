// @vitest-environment happy-dom
/**
 * The widget's own surfaces reach their data only through the widget BFF
 * endpoints, carrying the widget's Bearer identity (J8).
 *
 * #555 moved the widget's reads and writes off the site's server functions
 * (which a widget session is now refused by, J9) onto widget-specific ones:
 * the unread badge, the ticket badge and list, the conversation list, article
 * feedback, votes, the "show more comments" pager and the profile stats in the
 * user menu. Each hook or component below is driven to its server call; the
 * call must go to the widget function with the widget's headers, and the
 * site's functions for the same feature must see nothing.
 *
 * Rendered under the German catalogue where text is read; labels come from
 * `de.json`.
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
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { ReactNode } from 'react'
import { act, cleanup, fireEvent, renderHook, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderInGerman, GermanIntlWrapper } from '@/test/render-with-intl'
import de from '@/locales/de.json'

const { siteCalls } = vi.hoisted(() => ({ siteCalls: [] as string[] }))

const WIDGET_HEADERS = { Authorization: 'Bearer widget-session-token' }

vi.mock('../widget-auth-provider', () => ({
  useWidgetAuth: () => ({
    sessionVersion: 3,
    isIdentified: true,
    identityResolved: true,
    ensureSession: async () => true,
  }),
}))
vi.mock('@/lib/client/widget-auth', () => ({
  getWidgetAuthHeaders: () => ({ Authorization: 'Bearer widget-session-token' }),
  hasWidgetToken: () => true,
}))
vi.mock('@/lib/client/widget-bridge', () => ({ sendToHost: vi.fn() }))

const widgetGetMessengerUnreadFn = vi.fn(async () => ({ total: 4 }))
const widgetGetMyConversationsFn = vi.fn(async () => ({ conversations: [], linkedTickets: {} }))
const widgetGetMyTicketsFn = vi.fn(async () => ({ tickets: [] as unknown[] }))
const widgetRecordArticleFeedbackFn = vi.fn(async () => ({}))
const widgetGetVotedPostsFn = vi.fn(async () => ({ votedPostIds: ['post_1'] }))
const widgetToggleVoteFn = vi.fn(async () => ({ voted: false, voteCount: 6 }))
const widgetFetchPublicPostDetailFn = vi.fn()

vi.mock('@/lib/server/functions/widget/conversation', () => ({
  widgetGetMessengerUnreadFn: (...args: unknown[]) => widgetGetMessengerUnreadFn(...(args as [])),
  widgetGetMyConversationsFn: (...args: unknown[]) => widgetGetMyConversationsFn(...(args as [])),
}))
vi.mock('@/lib/server/functions/widget/tickets', () => ({
  widgetGetMyTicketsFn: (...args: unknown[]) => widgetGetMyTicketsFn(...(args as [])),
}))
vi.mock('@/lib/server/functions/widget/help', () => ({
  widgetRecordArticleFeedbackFn: (...args: unknown[]) =>
    widgetRecordArticleFeedbackFn(...(args as [])),
}))
vi.mock('@/lib/server/functions/widget/posts', () => ({
  widgetGetVotedPostsFn: (...args: unknown[]) => widgetGetVotedPostsFn(...(args as [])),
  widgetToggleVoteFn: (...args: unknown[]) => widgetToggleVoteFn(...(args as [])),
  widgetFetchPublicPostDetailFn: (...args: unknown[]) =>
    widgetFetchPublicPostDetailFn(...(args as [])),
}))

/** A site (cookie) function that must never be reached from the widget. */
function siteFn(name: string) {
  return vi.fn(async () => {
    siteCalls.push(name)
    throw new Error(`site endpoint ${name} reached from the widget`)
  })
}
vi.mock('@/lib/server/functions/portal', () => ({
  fetchPublicPostDetail: siteFn('fetchPublicPostDetail'),
}))
vi.mock('@/lib/server/functions/posts', () => ({
  fetchPostWithDetails: siteFn('fetchPostWithDetails'),
}))
vi.mock('@/lib/server/functions/user', () => ({
  getUserStatsFn: siteFn('getUserStatsFn'),
}))

import { useMessengerUnread } from '../use-messenger-unread'
import { useTicketStageBadge } from '../use-ticket-stage-badge'
import { WidgetMessages } from '../widget-messages'
import { WidgetTickets } from '../widget-tickets'
import { WidgetArticleFooter } from '../widget-article-footer'
import { UserStatsBar } from '@/components/shared/user-stats'
import { useWidgetVote } from '@/lib/client/hooks/use-widget-vote'
import { useLoadMoreWidgetComments } from '@/lib/client/mutations/load-more-comments'

const t = de as Record<string, string>

let queryClient: QueryClient

function Providers({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <GermanIntlWrapper>{children}</GermanIntlWrapper>
    </QueryClientProvider>
  )
}

function renderWidget(ui: ReactNode) {
  return renderInGerman(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>)
}

beforeEach(() => {
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  siteCalls.length = 0
  for (const fn of [
    widgetGetMessengerUnreadFn,
    widgetGetMyConversationsFn,
    widgetGetMyTicketsFn,
    widgetRecordArticleFeedbackFn,
    widgetGetVotedPostsFn,
    widgetToggleVoteFn,
    widgetFetchPublicPostDetailFn,
  ]) {
    fn.mockClear()
  }
})
afterEach(() => {
  cleanup()
  // Unguarded across every test: no widget surface reached a site function.
  expect(siteCalls).toEqual([])
})

describe('widget badges and lists (J8)', () => {
  it('reads the messenger unread total from the widget endpoint with the widget identity (J8)', async () => {
    const { result } = renderHook(() => useMessengerUnread(true), { wrapper: Providers })

    await waitFor(() => expect(result.current).toBe(4))
    expect(widgetGetMessengerUnreadFn).toHaveBeenCalledWith({ headers: WIDGET_HEADERS })
  })

  it('reads the ticket badge from the widget endpoint with the widget identity (J8)', async () => {
    widgetGetMyTicketsFn.mockResolvedValueOnce({ tickets: [] })
    const { result } = renderHook(() => useTicketStageBadge(true), { wrapper: Providers })

    await waitFor(() => expect(result.current.hasTickets).toBe(false))
    expect(widgetGetMyTicketsFn).toHaveBeenCalledWith({ headers: WIDGET_HEADERS })
  })

  it('lists the visitor’s conversations from the widget endpoint (J8)', async () => {
    renderWidget(<WidgetMessages teamName="Acme" assistant={null} onOpenMessenger={() => {}} />)

    await waitFor(() =>
      expect(widgetGetMyConversationsFn).toHaveBeenCalledWith({ headers: WIDGET_HEADERS })
    )
  })

  it('lists the visitor’s tickets from the widget endpoint (J8)', async () => {
    renderWidget(<WidgetTickets onOpenTicket={() => {}} />)

    await waitFor(() =>
      expect(widgetGetMyTicketsFn).toHaveBeenCalledWith({ headers: WIDGET_HEADERS })
    )
  })
})

describe('widget writes (J8)', () => {
  it('records article feedback at the widget endpoint and thanks the visitor (J8)', async () => {
    renderWidget(<WidgetArticleFooter articleId="article_1" />)

    fireEvent.click(screen.getByRole('button', { name: t['widget.help.article.helpful.yes'] }))

    expect(await screen.findByText(t['widget.help.article.helpful.thanks'])).toBeTruthy()
    expect(widgetRecordArticleFeedbackFn).toHaveBeenCalledWith({
      data: { articleId: 'article_1', helpful: true },
      headers: WIDGET_HEADERS,
    })
  })

  it('reads voted posts and toggles a vote at the widget endpoints (J8)', async () => {
    const { result } = renderHook(
      () => useWidgetVote({ postId: 'post_1' as never, voteCount: 7, sessionVersion: 3 }),
      { wrapper: Providers }
    )

    await waitFor(() => expect(result.current.hasVoted).toBe(true))
    expect(widgetGetVotedPostsFn).toHaveBeenCalledWith({ headers: WIDGET_HEADERS })

    act(() => result.current.handleVote())

    await waitFor(() => expect(result.current.voteCount).toBe(6))
    expect(widgetToggleVoteFn).toHaveBeenCalledWith({
      data: { postId: 'post_1' },
      headers: WIDGET_HEADERS,
    })
    expect(result.current.hasVoted).toBe(false)
  })

  it('fetches the next comment page from the widget endpoint and appends it (J8)', async () => {
    const key = ['widget', 'post', 'post_1', 3]
    queryClient.setQueryData(key, {
      id: 'post_1',
      comments: [{ id: 'comment_1' }],
      commentsHasMore: true,
      commentsNextCursor: 'cursor_1',
    })
    widgetFetchPublicPostDetailFn.mockResolvedValueOnce({
      comments: [{ id: 'comment_2' }],
      commentsHasMore: false,
      commentsNextCursor: null,
    })
    const { result } = renderHook(() => useLoadMoreWidgetComments('post_1' as never, key, 15), {
      wrapper: Providers,
    })

    await act(async () => {
      await result.current.loadMore()
    })

    expect(widgetFetchPublicPostDetailFn).toHaveBeenCalledWith({
      data: { postId: 'post_1', commentsCursor: 'cursor_1', commentsLimit: 15 },
      headers: WIDGET_HEADERS,
    })
    expect(
      (queryClient.getQueryData(key) as { comments: { id: string }[] }).comments.map((c) => c.id)
    ).toEqual(['comment_1', 'comment_2'])
  })
})

describe('profile stats (J8)', () => {
  it('uses the stats source the widget hands it instead of the site function (J8)', async () => {
    const fetchStats = vi.fn(async () => ({ ideas: 2, votes: 11, comments: 5 }))
    renderWidget(<UserStatsBar fetchStats={fetchStats} />)

    expect(await screen.findByText('11')).toBeTruthy()
    expect(fetchStats).toHaveBeenCalledTimes(1)
  })
})
