// @vitest-environment happy-dom
/**
 * The shared visitor thread, mounted for the widget, talks only to the
 * widget's own endpoints (J8).
 *
 * Since #555 the messenger thread, its ticket header card and the thread
 * hooks no longer import the site's server functions directly: they read a
 * visitor RPC from context. The portal leaves the default (the site's cookie
 * functions); the widget injects `widgetVisitorRpc`, its BFF functions. This
 * suite mounts the thread under an injected RPC carrying the widget's Bearer
 * headers and drives every path that reaches the server — load, reconnect
 * refetch, stream token, ticket refresh, ticket header reads, CSAT, block
 * replies, an ordinary send, older pages, read receipts and typing — and
 * asserts each one went to the injected RPC with the widget's headers, while
 * the site's own functions saw nothing.
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
import { act, cleanup, fireEvent, renderHook, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ConversationMessageDTO } from '@/lib/shared/conversation/types'
import { renderInGerman, GermanIntlWrapper } from '@/test/render-with-intl'
import de from '@/locales/de.json'

const { stream, siteCalls } = vi.hoisted(() => ({
  stream: {
    options: null as null | {
      onEvent: (event: unknown) => void
      poll: () => Promise<void>
      buildUrl: () => Promise<string | null>
    },
  },
  siteCalls: [] as string[],
}))

/** A site (cookie) function that must never be reached from the widget. */
function siteFn(name: string) {
  return vi.fn(async () => {
    siteCalls.push(name)
    throw new Error(`site endpoint ${name} reached from the widget`)
  })
}

vi.mock('@/lib/server/functions/conversation', () => ({
  getMyConversationFn: siteFn('getMyConversationFn'),
  sendConversationMessageFn: siteFn('sendConversationMessageFn'),
  listConversationMessagesFn: siteFn('listConversationMessagesFn'),
  mintConversationStreamTokenFn: siteFn('mintConversationStreamTokenFn'),
  submitCsatFn: siteFn('submitCsatFn'),
  markConversationReadFn: siteFn('markConversationReadFn'),
  sendConversationTypingFn: siteFn('sendConversationTypingFn'),
}))
vi.mock('@/lib/server/functions/tickets', () => ({
  getConversationLinkedTicketFn: siteFn('getConversationLinkedTicketFn'),
  createMyTicketFn: siteFn('createMyTicketFn'),
  getMyTicketStageLabelsFn: siteFn('getMyTicketStageLabelsFn'),
  getMyTicketFormFn: siteFn('getMyTicketFormFn'),
  getMyTicketWatchStatusFn: siteFn('getMyTicketWatchStatusFn'),
  watchMyTicketFn: siteFn('watchMyTicketFn'),
  unwatchMyTicketFn: siteFn('unwatchMyTicketFn'),
}))

/** The widget BFF functions, each a sentinel that names itself. */
function widgetFn(name: string) {
  return Object.assign(vi.fn(), { widgetName: name })
}
vi.mock('@/lib/server/functions/widget/conversation', () => ({
  widgetGetMyConversationFn: widgetFn('widgetGetMyConversationFn'),
  widgetSendConversationMessageFn: widgetFn('widgetSendConversationMessageFn'),
  widgetListConversationMessagesFn: widgetFn('widgetListConversationMessagesFn'),
  widgetMintConversationStreamTokenFn: widgetFn('widgetMintConversationStreamTokenFn'),
  widgetSubmitCsatFn: widgetFn('widgetSubmitCsatFn'),
  widgetMarkConversationReadFn: widgetFn('widgetMarkConversationReadFn'),
  widgetSendConversationTypingFn: widgetFn('widgetSendConversationTypingFn'),
}))
vi.mock('@/lib/server/functions/widget/tickets', () => ({
  widgetGetConversationLinkedTicketFn: widgetFn('widgetGetConversationLinkedTicketFn'),
  widgetCreateMyTicketFn: widgetFn('widgetCreateMyTicketFn'),
  widgetGetMyTicketStageLabelsFn: widgetFn('widgetGetMyTicketStageLabelsFn'),
  widgetGetMyTicketFormFn: widgetFn('widgetGetMyTicketFormFn'),
  widgetGetMyTicketWatchStatusFn: widgetFn('widgetGetMyTicketWatchStatusFn'),
  widgetWatchMyTicketFn: widgetFn('widgetWatchMyTicketFn'),
  widgetUnwatchMyTicketFn: widgetFn('widgetUnwatchMyTicketFn'),
}))
vi.mock('@/lib/server/functions/widget-capabilities', () => ({
  getWidgetCapabilitiesFn: vi.fn(async () => ({ chat: { mode: 'poll', pollIntervalMs: 60_000 } })),
}))
vi.mock('@/lib/client/hooks/use-conversation-stream', () => ({
  useConversationStream: (options: NonNullable<typeof stream.options>) => {
    stream.options = options
    return { connected: true }
  },
}))

/** The composer's editor, reduced to a textarea that reports a TipTap doc. */
vi.mock('@/components/ui/rich-text-editor', () => ({
  RichTextEditor: ({ onChange }: { onChange: (json: unknown, html: string) => void }) => (
    <textarea
      aria-label="composer"
      onChange={(e) =>
        onChange(
          {
            type: 'doc',
            content: [{ type: 'paragraph', content: [{ type: 'text', text: e.target.value }] }],
          },
          `<p>${e.target.value}</p>`
        )
      }
    />
  ),
}))

// The virtualized viewport measures real layout, which a DOM without layout
// cannot give; a plain list shows the same rows in the same order. The thread
// hooks (older pages, read receipts, typing) stay real.
vi.mock('@/components/conversation/thread', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/components/conversation/thread')>()),
  ThreadViewport: ({
    rows,
    renderRow,
  }: {
    rows: { key: string }[]
    renderRow: (row: unknown) => React.ReactNode
  }) => (
    <div data-testid="thread-viewport">
      {rows.map((row) => (
        <div key={row.key}>{renderRow(row)}</div>
      ))}
    </div>
  ),
  useThreadVirtualizer: () => ({
    getTotalSize: () => 0,
    getVirtualItems: () => [],
    scrollToIndex: vi.fn(),
    scrollToEnd: vi.fn(),
    isAtEnd: () => true,
    measureElement: () => {},
  }),
}))

import { VisitorConversationThread } from '../visitor-conversation-thread'
import { TicketHeaderCard } from '../ticket-header-card'
import { VisitorSurfaceRpcProvider, portalVisitorRpc } from '@/lib/client/visitor-surface-rpc'
import { widgetVisitorRpc } from '@/lib/client/widget-visitor-rpc'
import { useOlderMessages, useTypingSender } from '@/components/conversation/thread'
import * as widgetConversation from '@/lib/server/functions/widget/conversation'
import * as widgetTickets from '@/lib/server/functions/widget/tickets'

const t = de as Record<string, string>
const CONVERSATION_ID = 'conversation_1'
const WIDGET_HEADERS = { Authorization: 'Bearer widget-session-token' }
const getWidgetHeaders = () => WIDGET_HEADERS
const PRESENCE = { agentsOnline: true, withinOfficeHours: true, nextOpenAt: null }

const TICKET = {
  id: 'ticket_1',
  title: 'Printer on fire',
  reference: '#42',
  stage: { slot: null, closed: false },
  ticketType: { id: 'ticket_type_1', name: 'Bug' },
  customAttributes: {},
  createdAt: '2026-07-01T00:00:00.000Z',
}

function message(
  index: number,
  senderType: 'visitor' | 'agent' | 'system',
  content: string,
  extra: Partial<ConversationMessageDTO> = {}
): ConversationMessageDTO {
  return {
    id: `conversation_msg_${index}`,
    conversationId: CONVERSATION_ID,
    ticketId: null,
    senderType,
    content,
    createdAt: `2026-07-01T00:00:0${index}.000Z`,
    editedAt: null,
    author: { principalId: `principal_${index}`, displayName: 'Alex', avatarUrl: null },
    attachments: [],
    citations: [],
    isAssistant: false,
    isInternal: false,
    contentJson: null,
    viaEmail: false,
    systemEvent: null,
    ...extra,
  } as unknown as ConversationMessageDTO
}

/** The injected visitor RPC: what the widget would hand the thread. */
function fakeRpc() {
  return {
    getMyConversation: vi.fn(),
    sendConversationMessage: vi.fn(async (args: { data: { content: string } }) => ({
      conversation: { id: CONVERSATION_ID, status: 'open' },
      message: message(9, 'visitor', args.data.content),
    })),
    listConversationMessages: vi.fn(
      async (): Promise<{ messages: ConversationMessageDTO[]; hasMore: boolean }> => ({
        messages: [],
        hasMore: false,
      })
    ),
    mintConversationStreamToken: vi.fn(async () => ({ token: 'stream token/1' })),
    submitCsat: vi.fn(async () => ({})),
    markConversationRead: vi.fn(async () => ({})),
    sendConversationTyping: vi.fn(async () => ({})),
    getConversationLinkedTicket: vi.fn(async () => TICKET),
    createMyTicket: vi.fn(),
    getMyTicketStageLabels: vi.fn(async () => null),
    getMyTicketForm: vi.fn(async () => ({ types: [] })),
    getMyTicketWatchStatus: vi.fn(async () => ({ watching: false })),
    watchMyTicket: vi.fn(async () => ({})),
    unwatchMyTicket: vi.fn(async () => ({})),
  }
}
type FakeRpc = ReturnType<typeof fakeRpc>

let rpc: FakeRpc

function providers(children: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return (
    <QueryClientProvider client={client}>
      <VisitorSurfaceRpcProvider value={rpc as never}>{children}</VisitorSurfaceRpcProvider>
    </QueryClientProvider>
  )
}

async function renderWidgetThread(opts: {
  status: 'open' | 'closed'
  messages: ConversationMessageDTO[]
}) {
  rpc.getMyConversation.mockResolvedValue({
    conversation: {
      id: CONVERSATION_ID,
      status: opts.status,
      agentLastReadAt: null,
      csatRating: null,
    },
    messages: opts.messages,
    hasMore: false,
    teamName: 'Acme',
    canEmailVisitor: false,
  })
  renderInGerman(
    providers(
      <VisitorConversationThread
        conversationTarget={CONVERSATION_ID as never}
        sessionVersion={1}
        getAuthHeaders={getWidgetHeaders}
        uploadImage={async () => 'https://example.test/image.png'}
        presence={PRESENCE}
        showHeader={false}
      />
    )
  )
  await screen.findByText(opts.messages[0].content)
}

/** Every call on the injected RPC carried the widget's Bearer headers. */
function expectEveryCallCarriedWidgetHeaders() {
  for (const [name, fn] of Object.entries(rpc)) {
    for (const [args] of fn.mock.calls as unknown as Array<[{ headers?: unknown }]>) {
      expect({ name, headers: args?.headers }).toEqual({ name, headers: WIDGET_HEADERS })
    }
  }
}

beforeEach(() => {
  rpc = fakeRpc()
  stream.options = null
  siteCalls.length = 0
})
afterEach(() => {
  cleanup()
  // Unguarded across every test: whatever path ran, the site's own functions
  // were never reached from the widget-mounted thread.
  expect(siteCalls).toEqual([])
})

describe('the widget visitor RPC (J8)', () => {
  it('maps every visitor call to the widget BFF function of the same purpose (J8)', () => {
    expect(Object.keys(widgetVisitorRpc).sort()).toEqual(Object.keys(portalVisitorRpc).sort())
    expect(widgetVisitorRpc).toEqual({
      getMyConversation: widgetConversation.widgetGetMyConversationFn,
      sendConversationMessage: widgetConversation.widgetSendConversationMessageFn,
      listConversationMessages: widgetConversation.widgetListConversationMessagesFn,
      mintConversationStreamToken: widgetConversation.widgetMintConversationStreamTokenFn,
      submitCsat: widgetConversation.widgetSubmitCsatFn,
      markConversationRead: widgetConversation.widgetMarkConversationReadFn,
      sendConversationTyping: widgetConversation.widgetSendConversationTypingFn,
      getConversationLinkedTicket: widgetTickets.widgetGetConversationLinkedTicketFn,
      createMyTicket: widgetTickets.widgetCreateMyTicketFn,
      getMyTicketStageLabels: widgetTickets.widgetGetMyTicketStageLabelsFn,
      getMyTicketForm: widgetTickets.widgetGetMyTicketFormFn,
      getMyTicketWatchStatus: widgetTickets.widgetGetMyTicketWatchStatusFn,
      watchMyTicket: widgetTickets.widgetWatchMyTicketFn,
      unwatchMyTicket: widgetTickets.widgetUnwatchMyTicketFn,
    })
    for (const fn of Object.values(widgetVisitorRpc)) {
      expect((fn as unknown as { widgetName: string }).widgetName).toMatch(/^widget/)
    }
  })
})

describe('the thread under the widget RPC (J8)', () => {
  it('loads, refetches after a reconnect and mints its stream token through the widget RPC (J8)', async () => {
    await renderWidgetThread({ status: 'open', messages: [message(1, 'agent', 'Hallo!')] })

    rpc.listConversationMessages.mockResolvedValueOnce({
      messages: [message(1, 'agent', 'Hallo!'), message(2, 'agent', 'Noch da?')],
      hasMore: false,
    })
    await act(async () => {
      await stream.options!.poll()
    })
    expect(await screen.findByText('Noch da?')).toBeTruthy()
    expect(rpc.listConversationMessages).toHaveBeenCalledWith({
      data: { conversationId: CONVERSATION_ID },
      headers: WIDGET_HEADERS,
    })

    const url = await stream.options!.buildUrl()
    expect(url).toBe(
      `/api/chat/stream?conversationId=${CONVERSATION_ID}&token=${encodeURIComponent('stream token/1')}`
    )
    expect(rpc.getMyConversation).toHaveBeenCalled()
    expectEveryCallCarriedWidgetHeaders()
  })

  it('keeps the thread when the reconnect refetch fails, and opens no stream without a token (J8)', async () => {
    await renderWidgetThread({ status: 'open', messages: [message(1, 'agent', 'Hallo!')] })

    rpc.listConversationMessages.mockRejectedValueOnce(new Error('offline'))
    await act(async () => {
      await stream.options!.poll()
    })
    expect(screen.getByText('Hallo!')).toBeTruthy()

    rpc.mintConversationStreamToken.mockResolvedValueOnce({ token: null } as never)
    await expect(stream.options!.buildUrl()).resolves.toBeNull()
    rpc.mintConversationStreamToken.mockRejectedValueOnce(new Error('refused'))
    await expect(stream.options!.buildUrl()).resolves.toBeNull()
    expectEveryCallCarriedWidgetHeaders()
  })

  it('re-reads the linked ticket through the widget RPC when a ticket event lands, and its header card reads and watches through it too (J8)', async () => {
    await renderWidgetThread({ status: 'open', messages: [message(1, 'agent', 'Hallo!')] })

    act(() =>
      stream.options!.onEvent({
        kind: 'message',
        message: message(2, 'system', 'Ticket #42 created', {
          systemEvent: { kind: 'ticket_created', ticketReference: '#42' },
        } as never),
      })
    )

    expect(await screen.findByText('Printer on fire')).toBeTruthy()
    expect(rpc.getConversationLinkedTicket).toHaveBeenCalledWith({
      data: { conversationId: CONVERSATION_ID },
      headers: WIDGET_HEADERS,
    })
    await waitFor(() => expect(rpc.getMyTicketStageLabels).toHaveBeenCalled())
    await waitFor(() =>
      expect(rpc.getMyTicketWatchStatus).toHaveBeenCalledWith({
        data: { ticketId: 'ticket_1' },
        headers: WIDGET_HEADERS,
      })
    )

    fireEvent.click(
      screen.getByRole('button', { name: new RegExp(t['portal.tickets.details.toggle']) })
    )
    await waitFor(() => expect(rpc.getMyTicketForm).toHaveBeenCalled())

    fireEvent.click(screen.getByRole('button', { name: t['portal.tickets.watch.watch'] }))
    await waitFor(() =>
      expect(rpc.watchMyTicket).toHaveBeenCalledWith({
        data: { ticketId: 'ticket_1' },
        headers: WIDGET_HEADERS,
      })
    )
    expectEveryCallCarriedWidgetHeaders()
  })

  it('records a closed thread rating and its comment through the widget RPC (J8)', async () => {
    await renderWidgetThread({ status: 'closed', messages: [message(1, 'agent', 'Erledigt.')] })

    const rateFour = t['widget.messenger.csat.rateAria'].replace('{n}', '4')
    fireEvent.click(await screen.findByRole('button', { name: rateFour }))
    await waitFor(() =>
      expect(rpc.submitCsat).toHaveBeenCalledWith({
        data: { conversationId: CONVERSATION_ID, rating: 4 },
        headers: WIDGET_HEADERS,
      })
    )

    fireEvent.change(screen.getByLabelText(t['widget.messenger.csat.commentPlaceholder']), {
      target: { value: '  schneller bitte  ' },
    })
    fireEvent.click(screen.getByRole('button', { name: t['widget.messenger.csat.send'] }))
    await waitFor(() =>
      expect(rpc.submitCsat).toHaveBeenLastCalledWith({
        data: { conversationId: CONVERSATION_ID, rating: 4, comment: 'schneller bitte' },
        headers: WIDGET_HEADERS,
      })
    )
    expect(await screen.findByText(t['widget.messenger.csat.thanks'])).toBeTruthy()
    expectEveryCallCarriedWidgetHeaders()
  })

  it('offers the stars again when recording the rating fails (J8)', async () => {
    rpc.submitCsat.mockRejectedValueOnce(new Error('offline'))
    await renderWidgetThread({ status: 'closed', messages: [message(1, 'agent', 'Erledigt.')] })

    const rateTwo = t['widget.messenger.csat.rateAria'].replace('{n}', '2')
    fireEvent.click(await screen.findByRole('button', { name: rateTwo }))

    await waitFor(() => expect(rpc.submitCsat).toHaveBeenCalledTimes(1))
    expect(await screen.findByRole('button', { name: rateTwo })).toBeTruthy()
    expect(screen.queryByLabelText(t['widget.messenger.csat.commentPlaceholder'])).toBeNull()
  })

  it('reopens the comment box when sending the comment fails (J8)', async () => {
    await renderWidgetThread({ status: 'closed', messages: [message(1, 'agent', 'Erledigt.')] })

    const rateFive = t['widget.messenger.csat.rateAria'].replace('{n}', '5')
    fireEvent.click(await screen.findByRole('button', { name: rateFive }))
    rpc.submitCsat.mockRejectedValueOnce(new Error('offline'))
    fireEvent.click(await screen.findByRole('button', { name: t['widget.messenger.csat.send'] }))

    await waitFor(() => expect(rpc.submitCsat).toHaveBeenCalledTimes(2))
    expect(await screen.findByLabelText(t['widget.messenger.csat.commentPlaceholder'])).toBeTruthy()
  })

  it('answers a workflow button and a rating block through the widget RPC (J8)', async () => {
    await renderWidgetThread({
      status: 'open',
      messages: [
        message(1, 'agent', 'Worum geht es?', {
          block: {
            v: 1,
            runId: 'run_1',
            nodeId: 'node_1',
            waiting: true,
            kind: 'buttons',
            options: [{ key: 'billing', label: 'Rechnung' }],
            allowTyping: false,
          },
        } as never),
      ],
    })

    fireEvent.click(screen.getByRole('button', { name: 'Rechnung' }))
    await waitFor(() =>
      expect(rpc.sendConversationMessage).toHaveBeenCalledWith({
        data: {
          conversationId: CONVERSATION_ID,
          content: 'Rechnung',
          blockReply: {
            kind: 'buttons',
            inReplyToMessageId: 'conversation_msg_1',
            buttonKey: 'billing',
          },
        },
        headers: WIDGET_HEADERS,
      })
    )
    expectEveryCallCarriedWidgetHeaders()
  })

  it('sends the comment on a rating block through the widget RPC (J8)', async () => {
    await renderWidgetThread({
      status: 'open',
      messages: [
        message(1, 'agent', 'Wie war es?', {
          block: {
            v: 1,
            runId: 'run_1',
            nodeId: 'node_2',
            waiting: true,
            kind: 'csat',
            allowTypingInterrupt: false,
            commentPrompt: '',
          },
        } as never),
      ],
    })

    fireEvent.click(screen.getByRole('button', { name: '3 of 5' }))
    fireEvent.change(await screen.findByLabelText(t['widget.messenger.csat.commentPlaceholder']), {
      target: { value: 'gut' },
    })
    fireEvent.click(screen.getByRole('button', { name: t['widget.messenger.csat.send'] }))

    await waitFor(() =>
      expect(rpc.submitCsat).toHaveBeenCalledWith({
        data: { conversationId: CONVERSATION_ID, rating: 3, comment: 'gut' },
        headers: WIDGET_HEADERS,
      })
    )
    expect(rpc.sendConversationMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          blockReply: { kind: 'csat', inReplyToMessageId: 'conversation_msg_1', rating: 3 },
        }),
        headers: WIDGET_HEADERS,
      })
    )
    expectEveryCallCarriedWidgetHeaders()
  })

  it('sends an ordinary message through the widget RPC (J8)', async () => {
    await renderWidgetThread({ status: 'open', messages: [message(1, 'agent', 'Hallo!')] })

    fireEvent.change(screen.getByLabelText('composer'), {
      target: { value: 'Mein Drucker brennt' },
    })
    fireEvent.click(screen.getByRole('button', { name: t['widget.messenger.send'] }))

    expect(await screen.findByText('Mein Drucker brennt')).toBeTruthy()
    expect(rpc.sendConversationMessage).toHaveBeenCalledWith({
      data: expect.objectContaining({
        conversationId: CONVERSATION_ID,
        content: 'Mein Drucker brennt',
      }),
      headers: WIDGET_HEADERS,
    })
    expectEveryCallCarriedWidgetHeaders()
  })
})

describe('the shared thread hooks under the widget RPC (J8)', () => {
  function hookWrapper({ children }: { children: ReactNode }) {
    return <GermanIntlWrapper>{providers(children)}</GermanIntlWrapper>
  }

  it('loads an older page through the widget RPC, before the oldest loaded message (J8)', async () => {
    const onPage = vi.fn()
    const page = { messages: [message(0, 'agent', 'Früher')], hasMore: false }
    rpc.listConversationMessages.mockResolvedValueOnce(page)
    const { result } = renderHook(
      () =>
        useOlderMessages({
          conversationId: CONVERSATION_ID as never,
          messages: [message(1, 'agent', 'Hallo!')],
          getHeaders: getWidgetHeaders,
          onPage,
        }),
      { wrapper: hookWrapper }
    )

    await act(async () => {
      await result.current.loadOlder()
    })

    expect(rpc.listConversationMessages).toHaveBeenCalledWith({
      data: { conversationId: CONVERSATION_ID, before: 'conversation_msg_1' },
      headers: WIDGET_HEADERS,
    })
    expect(onPage).toHaveBeenCalledWith(page)
  })

  it('reports typing through the widget RPC (J8)', async () => {
    const { result } = renderHook(
      () => useTypingSender(CONVERSATION_ID as never, getWidgetHeaders),
      { wrapper: hookWrapper }
    )

    act(() => result.current())

    await waitFor(() =>
      expect(rpc.sendConversationTyping).toHaveBeenCalledWith({
        data: { conversationId: CONVERSATION_ID },
        headers: WIDGET_HEADERS,
      })
    )
  })
})

describe('the ticket header card on its own (J8)', () => {
  it('reads through the injected RPC, never the site functions (J8)', async () => {
    renderInGerman(
      providers(<TicketHeaderCard ticket={TICKET as never} getAuthHeaders={getWidgetHeaders} />)
    )

    expect(await screen.findByText('Printer on fire')).toBeTruthy()
    await waitFor(() =>
      expect(rpc.getMyTicketStageLabels).toHaveBeenCalledWith({ headers: WIDGET_HEADERS })
    )
  })
})
