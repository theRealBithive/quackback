// @vitest-environment happy-dom
/**
 * Leaving the widget for the portal, and the widget's own writes on the way
 * (J11, J12, J8).
 *
 * Two widget surfaces send a visitor to the portal: the shell's "Go to
 * portal" control and the post detail's "View on portal" title. An identified
 * customer goes through the handoff route with a one-time token, so they
 * arrive signed in (J11); a teammate is never handed a token, because a portal
 * session must never be installed for them (J12) — they go to the site
 * unsigned. The same surfaces also post comments and show the visitor's stats;
 * those go to the widget's endpoints with its Bearer identity (J8).
 *
 * Rendered under the German catalogue; labels are read from `de.json`.
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
import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderInGerman } from '@/test/render-with-intl'
import de from '@/locales/de.json'

const { auth, sendToHost, generateOneTimeToken, siteCalls } = vi.hoisted(() => ({
  auth: {
    user: null as null | { name: string; email: string; avatarUrl: string | null },
    isIdentified: false,
    canPortalHandoff: true,
    hmacRequired: true,
  },
  sendToHost: vi.fn(),
  generateOneTimeToken: vi.fn(async (): Promise<string | null> => 'ott-1'),
  siteCalls: [] as string[],
}))

const WIDGET_HEADERS = { Authorization: 'Bearer widget-session-token' }
const PORTAL_ORIGIN = 'https://feedback.example.com'

vi.mock('../widget-auth-provider', () => ({
  useWidgetAuth: () => ({
    user: auth.user,
    isIdentified: auth.isIdentified,
    hmacRequired: auth.hmacRequired,
    canPortalHandoff: auth.canPortalHandoff,
    closeWidget: vi.fn(),
    sessionVersion: 1,
    ensureSessionThen: async (cb: () => void | Promise<void>) => cb(),
    emitEvent: vi.fn(),
  }),
}))
vi.mock('../use-messenger-unread', () => ({ useMessengerUnread: () => 0 }))
vi.mock('../use-changelog-unread', () => ({
  useChangelogUnread: () => ({ unread: 0, markSeen: vi.fn() }),
}))
vi.mock('../use-ticket-stage-badge', () => ({
  useTicketStageBadge: () => ({ unread: 0, hasTickets: false }),
}))
vi.mock('@/lib/client/widget-bridge', () => ({ sendToHost }))
vi.mock('@/lib/client/widget-auth', () => ({
  getWidgetAuthHeaders: () => ({ Authorization: 'Bearer widget-session-token' }),
  generateOneTimeToken,
}))

const widgetGetUserStatsFn = vi.fn(async () => ({ ideas: 3, votes: 17, comments: 8 }))
vi.mock('@/lib/server/functions/widget/user', () => ({
  widgetGetUserStatsFn: (...args: unknown[]) => widgetGetUserStatsFn(...(args as [])),
}))
vi.mock('@/lib/server/functions/user', () => ({
  getUserStatsFn: vi.fn(async () => {
    siteCalls.push('getUserStatsFn')
    throw new Error('site endpoint reached from the widget')
  }),
}))

// Post detail: everything but the title, the comment form and the server
// calls is reduced to nothing.
vi.mock('../use-widget-image-upload', () => ({
  useWidgetImageUpload: () => ({ upload: vi.fn() }),
  // The post detail uploads through the media hook since batch H (#46).
  useWidgetMediaUpload: () => ({ upload: vi.fn() }),
}))
vi.mock('../widget-vote-button', () => ({ WidgetVoteButton: () => null }))
vi.mock('../widget-comment-list', () => ({ WidgetCommentList: () => null }))
vi.mock('../widget-comment-form', () => ({
  WidgetCommentForm: ({ onSubmit }: { onSubmit: (c: string, j: null) => Promise<void> }) => (
    <button type="button" onClick={() => void onSubmit('Gute Idee', null)}>
      submit-comment
    </button>
  ),
}))
vi.mock('../widget-skeletons', () => ({
  WidgetPostDetailSkeleton: () => <div data-testid="skeleton" />,
}))
vi.mock('@/components/public/post-content', () => ({ PostContent: () => null }))
vi.mock('@/lib/client/mutations/load-more-comments', () => ({
  useLoadMoreWidgetComments: () => ({ loadMore: vi.fn(), isLoading: false, hasMore: false }),
}))
const widgetFetchPublicPostDetailFn = vi.fn()
vi.mock('@/lib/server/functions/widget/posts', () => ({
  widgetFetchPublicPostDetailFn: (...args: unknown[]) =>
    widgetFetchPublicPostDetailFn(...(args as [])),
}))
const widgetCreateCommentFn = vi.fn(async () => ({ comment: { id: 'comment_9' } }))
vi.mock('@/lib/server/functions/widget/comments', () => ({
  widgetCreateCommentFn: (...args: unknown[]) => widgetCreateCommentFn(...(args as [])),
}))

import { WidgetShell } from '../widget-shell'
import { WidgetPostDetail } from '../widget-post-detail'

const t = de as Record<string, string>

const POST = {
  id: 'post_1',
  title: 'Dunkler Modus',
  content: '',
  contentJson: null,
  authorName: 'Ada',
  createdAt: '2026-07-30T10:00:00Z',
  voteCount: 1,
  statusId: null,
  board: { slug: 'ideas', name: 'Ideas' },
  comments: [],
  pinnedComment: null,
  pinnedCommentId: null,
  isCommentsLocked: false,
  canVote: true,
  canComment: true,
}

let queryClient: QueryClient
function render(ui: ReactNode) {
  return renderInGerman(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>)
}

function renderShell() {
  return render(
    <WidgetShell
      orgSlug="acme"
      activeTab="home"
      onTabChange={() => {}}
      enabledTabs={{ feedback: true, messages: true }}
      portalAccess={{ isPrivate: true, widgetSignIn: true }}
      portalOrigin={PORTAL_ORIGIN}
    >
      home
    </WidgetShell>
  )
}

function signInAs(kind: 'customer' | 'teammate') {
  auth.user = { name: 'Ada Example', email: 'ada@example.com', avatarUrl: null }
  auth.isIdentified = true
  auth.canPortalHandoff = kind === 'customer'
}

function navigations(): string[] {
  return sendToHost.mock.calls
    .map(([message]) => message as { type: string; url?: string })
    .filter((message) => message.type === 'quackback:navigate')
    .map((message) => message.url as string)
}

beforeEach(() => {
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  auth.user = null
  auth.isIdentified = false
  auth.canPortalHandoff = true
  auth.hmacRequired = true
  sendToHost.mockClear()
  generateOneTimeToken.mockReset().mockResolvedValue('ott-1')
  widgetGetUserStatsFn.mockClear()
  widgetCreateCommentFn.mockClear()
  widgetFetchPublicPostDetailFn.mockReset().mockResolvedValue(POST)
  siteCalls.length = 0
})
afterEach(() => {
  cleanup()
  expect(siteCalls).toEqual([])
})

describe('the shell’s portal control (J11, J12)', () => {
  it('sends an identified customer through the handoff with a one-time token (J11)', async () => {
    signInAs('customer')
    renderShell()

    fireEvent.click(screen.getByRole('button', { name: t['widget.shell.aria.goToPortal'] }))

    await waitFor(() =>
      expect(navigations()).toEqual([`${PORTAL_ORIGIN}/auth/widget-handoff?ott=ott-1`])
    )
  })

  it('sends a teammate to the site unsigned and mints no token (J12)', async () => {
    signInAs('teammate')
    renderShell()

    fireEvent.click(screen.getByRole('button', { name: t['widget.shell.aria.goToPortal'] }))

    await waitFor(() => expect(navigations()).toEqual([`${PORTAL_ORIGIN}/?auth=signin`]))
    expect(generateOneTimeToken).not.toHaveBeenCalled()
  })

  it('navigates nowhere when no token could be minted (J11)', async () => {
    signInAs('customer')
    generateOneTimeToken.mockResolvedValue(null)
    renderShell()

    fireEvent.click(screen.getByRole('button', { name: t['widget.shell.aria.goToPortal'] }))

    await waitFor(() => expect(generateOneTimeToken).toHaveBeenCalledTimes(1))
    await act(async () => {})
    expect(navigations()).toEqual([])
  })
})

describe('the shell’s user menu (J8)', () => {
  it('shows the visitor’s stats from the widget endpoint with the widget identity (J8)', async () => {
    signInAs('customer')
    renderShell()

    fireEvent.click(screen.getByRole('button', { name: t['widget.shell.aria.userMenu'] }))

    expect(await screen.findByText('17')).toBeTruthy()
    expect(widgetGetUserStatsFn).toHaveBeenCalledWith({ headers: WIDGET_HEADERS })
  })
})

describe('the post detail (J8, J11, J12)', () => {
  async function renderPost() {
    render(<WidgetPostDetail postId="post_1" statuses={[]} />)
    await screen.findByText(POST.title)
  }

  it('opens the post on the portal signed in for an identified customer (J11)', async () => {
    signInAs('customer')
    await renderPost()

    fireEvent.click(screen.getByText(POST.title))

    await waitFor(() =>
      expect(navigations()).toEqual([
        `${window.location.origin}/auth/widget-handoff?ott=ott-1&returnTo=${encodeURIComponent(
          '/b/ideas/posts/post_1'
        )}`,
      ])
    )
  })

  it('opens the post on the portal without a token for a teammate (J12)', async () => {
    signInAs('teammate')
    await renderPost()

    fireEvent.click(screen.getByText(POST.title))

    await waitFor(() =>
      expect(navigations()).toEqual([`${window.location.origin}/b/ideas/posts/post_1`])
    )
    expect(generateOneTimeToken).not.toHaveBeenCalled()
  })

  it('posts a comment at the widget endpoint with the widget identity (J8)', async () => {
    // The comment form shows where the workspace does not demand signed
    // identities; with them, an identified visitor's tier decides instead.
    auth.hmacRequired = false
    signInAs('customer')
    await renderPost()

    fireEvent.click(screen.getByRole('button', { name: 'submit-comment' }))

    await waitFor(() =>
      expect(widgetCreateCommentFn).toHaveBeenCalledWith({
        data: {
          postId: 'post_1',
          content: 'Gute Idee',
          contentJson: undefined,
          parentId: undefined,
        },
        headers: WIDGET_HEADERS,
      })
    )
  })
})
