// @vitest-environment node
/**
 * The chat and inbox stream route under the server's idle timeout: an open
 * stream with nothing to say stays open, and an agent who keeps their inbox
 * open is neither taken offline nor stripped of their conversations.
 *
 * Contract for batch F, upstream #600 (`c5690f2aa`, "keep live and assistant
 * streams open through the server's idle timeout"). Items owned by this file,
 * verbatim:
 *
 *   F19 An open chat or inbox stream with no events is not cut by the server's
 *       idle timeout.
 *   F21 An agent whose inbox stays open is not taken offline and keeps their
 *       assigned conversations.
 *
 * (F20, the writer-level detection of a reader that has gone, is in
 * lib/server/utils/__tests__/sse-idle-timeout.contract.test.ts; the control
 * below shows the route still tears down for a reader that really left.)
 *
 * The server is Bun, which closes a connection that carries no bytes for 10
 * seconds. `connect` below plays that server: it reads the response, watches
 * the clock, and cancels the body the moment ten seconds pass without a byte.
 * Cancelling is what a real disconnect does, and it runs the offline teardown
 * that unassigns an agent's unanswered conversations. The 10 seconds are stated
 * here as a plain number, not read off any constant of ours.
 */
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import fc from 'fast-check'

const mockVerifyStreamToken = vi.fn()
const mockGetSession = vi.fn()
const mockPrincipalFindFirst = vi.fn()
const mockConversationFindFirst = vi.fn()
const mockTicketSelect = vi.fn()
const mockSubscribe = vi.fn()
const mockCanView = vi.fn()
const mockTicketFilter = vi.fn()
const mockConversationsEnabled = vi.fn()
const mockPortalAccess = vi.fn()
const mockMarkPresent = vi.fn()
const mockRefreshPresence = vi.fn()
const mockClearPresence = vi.fn()

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: vi.fn(() => (opts: unknown) => ({ options: opts })),
}))
vi.mock('@/lib/server/db', async (importOriginal) => ({
  // Spread the real db module so tables/operators stay current; override only what this suite drives.
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: {
    query: {
      principal: { findFirst: (...a: unknown[]) => mockPrincipalFindFirst(...a) },
      conversations: { findFirst: (...a: unknown[]) => mockConversationFindFirst(...a) },
    },
    // Chainable stub for the ticketId scope's existence+visibility query
    // (db.select({...}).from(tickets).where(...).limit(1)) — the resolved rows
    // are driven per-test via mockTicketSelect.
    select: () => ({ from: () => ({ where: () => ({ limit: () => mockTicketSelect() }) }) }),
  },
  eq: vi.fn(),
  and: vi.fn(),
  or: vi.fn(),
  gt: vi.fn(),
  isNull: vi.fn(),
}))
vi.mock('@/lib/server/auth', () => ({
  auth: { api: { getSession: (...a: unknown[]) => mockGetSession(...a) } },
}))
vi.mock('@/lib/server/realtime/stream-token', () => ({
  verifyStreamToken: (...a: unknown[]) => mockVerifyStreamToken(...a),
}))
vi.mock('@/lib/server/realtime/conversation-channels', () => ({
  conversationChannel: (id: string) => `conversation:${id}`,
  CONVERSATION_INBOX_CHANNEL: 'conversation:inbox',
  ticketChannel: (id: string) => `ticket:${id}`,
  parseConversationFrame: (message: string) => {
    try {
      return JSON.parse(message)
    } catch {
      return null
    }
  },
  isOwnTyping: () => false,
}))
vi.mock('@/lib/server/policy/tickets', () => ({
  ticketFilter: (...a: unknown[]) => mockTicketFilter(...a),
}))
const mockReadActivitySnapshot = vi.fn()
vi.mock('@/lib/server/domains/assistant/assistant-activity-snapshot', () => ({
  readActivitySnapshot: (...a: unknown[]) => mockReadActivitySnapshot(...a),
}))
vi.mock('@/lib/server/realtime/pubsub', () => ({
  subscribe: (...a: unknown[]) => mockSubscribe(...a),
}))
vi.mock('@/lib/server/realtime/presence', () => ({
  markPresent: (...a: unknown[]) => mockMarkPresent(...a),
  refreshPresence: (...a: unknown[]) => mockRefreshPresence(...a),
  clearPresence: (...a: unknown[]) => mockClearPresence(...a),
}))
vi.mock('@/lib/server/policy/conversation', () => ({
  canViewConversation: (...a: unknown[]) => mockCanView(...a),
}))
vi.mock('@/lib/server/domains/conversation/conversation.query', () => ({
  loadAuthors: vi.fn(async () => new Map()),
  toMessageDTO: vi.fn(),
  fallbackAuthor: vi.fn(),
  findBackfillCursor: vi.fn(),
}))
vi.mock('@/lib/server/functions/auth-helpers', () => ({
  normalizePrincipalType: (t: string) => t,
}))
const mockSupportTicketsEnabled = vi.fn()
vi.mock('@/lib/server/domains/settings/settings.support', () => ({
  isConversationsEnabled: (...a: unknown[]) => mockConversationsEnabled(...a),
  isSupportTicketsEnabled: (...a: unknown[]) => mockSupportTicketsEnabled(...a),
}))
vi.mock('@/lib/server/functions/portal-access', () => ({
  resolvePortalAccessForRequest: (...a: unknown[]) => mockPortalAccess(...a),
}))
vi.mock('@/lib/server/domains/conversation/conversation.service', () => ({
  requeueUnansweredOnAgentOffline: vi.fn(),
}))
const mockAcquireSlot = vi.fn()
vi.mock('@/lib/server/realtime/stream-connection-limit', () => ({
  streamLimiter: { acquire: (...a: unknown[]) => mockAcquireSlot(...a) },
}))
vi.mock('@/lib/server/domains/api/rate-limit', () => ({
  getClientIp: () => '203.0.113.7',
}))
vi.mock('@/lib/server/logger', () => ({
  logger: { child: () => ({ warn: vi.fn(), info: vi.fn(), error: vi.fn() }) },
}))

import { Route } from '../stream'
import { requeueUnansweredOnAgentOffline } from '@/lib/server/domains/conversation/conversation.service'

type RouteOpts = { server: { handlers: { GET: (a: { request: Request }) => Promise<Response> } } }
const GET = (Route as unknown as { options: RouteOpts }).options.server.handlers.GET

const req = (qs: string) => new Request(`http://test/api/chat/stream${qs}`)

/** Bun closes a connection that carries no bytes for this long. */
const SERVER_IDLE_TIMEOUT_MS = 10_000

beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllMocks()
  mockConversationsEnabled.mockResolvedValue(true)
  mockSupportTicketsEnabled.mockResolvedValue(true)
  mockVerifyStreamToken.mockReturnValue(null)
  mockGetSession.mockResolvedValue(null)
  mockPrincipalFindFirst.mockResolvedValue(undefined)
  mockConversationFindFirst.mockResolvedValue(undefined)
  mockTicketSelect.mockResolvedValue([])
  mockTicketFilter.mockReturnValue('MOCK_TICKET_FILTER_SQL')
  mockSubscribe.mockResolvedValue(async () => {})
  mockMarkPresent.mockResolvedValue(undefined)
  mockRefreshPresence.mockResolvedValue(undefined)
  // The agent's only stream: closing it means the agent has gone offline.
  mockClearPresence.mockResolvedValue(true)
  mockCanView.mockReturnValue({ allowed: true })
  mockPortalAccess.mockResolvedValue({ granted: true })
  mockAcquireSlot.mockReturnValue({ ok: true, release: vi.fn() })
  mockReadActivitySnapshot.mockResolvedValue(null)
})

afterEach(() => {
  vi.useRealTimers()
})

function openInboxAsAgent() {
  mockGetSession.mockResolvedValue({
    session: { id: 'sess_1', scope: 'dashboard' },
    user: { id: 'user_1' },
  })
  mockPrincipalFindFirst.mockResolvedValue({ id: 'principal_agent', role: 'admin', type: 'user' })
  return GET({ request: req('?scope=inbox') })
}

function openConversationAsVisitor() {
  mockVerifyStreamToken.mockReturnValue({ principalId: 'principal_tok', scope: 'dashboard' })
  mockPrincipalFindFirst.mockResolvedValue({ id: 'principal_tok', role: 'user', type: 'anonymous' })
  mockConversationFindFirst.mockResolvedValue({
    id: 'conversation_1',
    visitorPrincipalId: 'principal_tok',
  })
  return GET({ request: req('?conversationId=conversation_1&token=t') })
}

/**
 * A connection as the server sees it: it reads the body as long as
 * `chunkLimit` allows, notes when each byte arrived, and hangs up when the
 * idle timeout passes with no byte.
 */
function connect(response: Response, chunkLimit = Infinity) {
  const reader = response.body!.getReader()
  const connection = { arrivals: [] as number[], cutByIdleTimeout: false, openedAt: Date.now() }
  void (async () => {
    while (connection.arrivals.length < chunkLimit) {
      const { done } = await reader.read()
      if (done) return
      connection.arrivals.push(Date.now())
    }
  })()
  const watchdog = setInterval(() => {
    const lastByteAt = connection.arrivals.at(-1) ?? connection.openedAt
    if (Date.now() - lastByteAt >= SERVER_IDLE_TIMEOUT_MS && !connection.cutByIdleTimeout) {
      connection.cutByIdleTimeout = true
      void reader.cancel()
    }
  }, 1_000)
  return { connection, stopWatching: () => clearInterval(watchdog), reader }
}

async function runFor(totalMs: number) {
  for (let elapsed = 0; elapsed < totalMs; elapsed += 1_000) {
    await vi.advanceTimersByTimeAsync(1_000)
  }
}

function longestSilence(arrivals: number[], openedAt: number, closedAt: number): number {
  const marks = [openedAt, ...arrivals, closedAt]
  let longest = 0
  for (let i = 1; i < marks.length; i++) longest = Math.max(longest, marks[i] - marks[i - 1])
  return longest
}

const idleSeconds = fc.integer({ min: 30, max: 240 })

describe('an open stream with no events (F19)', () => {
  it.each([
    ['the agent inbox', openInboxAsAgent],
    ['a visitor conversation', openConversationAsVisitor],
  ])('(F19) %s is not cut by the idle timeout', async (_name, open) => {
    await fc.assert(
      fc.asyncProperty(idleSeconds, async (seconds) => {
        const response = await open()
        expect(response.status).toBe(200)
        const { connection, stopWatching, reader } = connect(response)

        await runFor(seconds * 1_000)

        expect(connection.cutByIdleTimeout).toBe(false)
        expect(longestSilence(connection.arrivals, connection.openedAt, Date.now())).toBeLessThan(
          SERVER_IDLE_TIMEOUT_MS
        )

        stopWatching()
        await reader.cancel().catch(() => {})
      }),
      { numRuns: 5 }
    )
  })
})

describe('an agent whose inbox stays open (F21)', () => {
  it('(F21) is not taken offline and keeps their conversations while the inbox is open', async () => {
    await fc.assert(
      fc.asyncProperty(idleSeconds, async (seconds) => {
        vi.clearAllMocks()
        mockClearPresence.mockResolvedValue(true)
        mockMarkPresent.mockResolvedValue(undefined)
        mockRefreshPresence.mockResolvedValue(undefined)
        mockSubscribe.mockResolvedValue(async () => {})
        mockAcquireSlot.mockReturnValue({ ok: true, release: vi.fn() })
        const response = await openInboxAsAgent()
        const { connection, stopWatching, reader } = connect(response)

        await runFor(seconds * 1_000)

        expect(connection.cutByIdleTimeout).toBe(false)
        expect(mockClearPresence).not.toHaveBeenCalled()
        expect(requeueUnansweredOnAgentOffline).not.toHaveBeenCalled()
        // And the agent is still being counted as present.
        expect(mockRefreshPresence).toHaveBeenCalled()

        stopWatching()
        await reader.cancel().catch(() => {})
        await vi.advanceTimersByTimeAsync(0)
      }),
      { numRuns: 5 }
    )
  })

  it('(F21) control: an agent whose inbox is really gone is taken offline and their conversations return to the queue', async () => {
    const response = await openInboxAsAgent()
    // The client reads the connect frames and then disappears without a close.
    const { stopWatching } = connect(response, 2)

    await runFor(90_000)

    expect(mockClearPresence).toHaveBeenCalled()
    expect(requeueUnansweredOnAgentOffline).toHaveBeenCalledWith('principal_agent')
    stopWatching()
  })
})
