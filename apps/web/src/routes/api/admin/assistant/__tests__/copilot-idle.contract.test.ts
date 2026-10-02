// @vitest-environment node
/**
 * A copilot turn that goes quiet while a model or tool step runs.
 *
 * Contract for batch F, upstream #600 (`c5690f2aa`, the assistant half: "keep
 * copilot and transform streams open while a turn is quiet"). The item this
 * file serves, verbatim:
 *
 *   F19 An open chat or inbox stream with no events is not cut by the server's
 *       idle timeout.
 *
 * The copilot stream is the assistant's counterpart of the chat stream, so the
 * same law is stated for it: the server (Bun) closes a connection with no byte
 * for 10 seconds, and a turn can be silent for longer than that. The 10 seconds
 * are a plain number here, not read off a constant of ours.
 *
 * Also pinned: a turn that fails after a long silence tells the client
 * `TURN_FAILED` rather than the error's own message, so what the model or a
 * tool threw never reaches the browser.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const mockRequireAuth = vi.fn()
const mockPolicyActorFromAuth = vi.fn()
vi.mock('@/lib/server/functions/auth-helpers', () => ({
  requireAuth: (...args: unknown[]) => mockRequireAuth(...args),
  policyActorFromAuth: (...args: unknown[]) => mockPolicyActorFromAuth(...args),
}))
// The gate's 403-vs-500 split discriminates on isAuthDenialError, which the
// gate imports from the pure leaf module auth-errors.ts — left unmocked here
// so the denial tests below run against the REAL vocabulary matcher.

const mockIsAssistantConfigured = vi.fn()
const mockStreamAssistantTurn = vi.fn()
const mockEnsureAssistantPrincipal = vi.fn()
vi.mock('@/lib/server/domains/assistant', () => ({
  isAssistantConfigured: (...args: unknown[]) => mockIsAssistantConfigured(...args),
  streamAssistantTurn: (...args: unknown[]) => mockStreamAssistantTurn(...args),
  ensureAssistantPrincipal: (...args: unknown[]) => mockEnsureAssistantPrincipal(...args),
}))

const mockIsFeatureEnabled = vi.fn()
const mockIsCopilotCapabilityEnabled = vi.fn()
vi.mock('@/lib/server/domains/settings/settings.service', () => ({
  isFeatureEnabled: (...args: unknown[]) => mockIsFeatureEnabled(...args),
  isCopilotCapabilityEnabled: (...args: unknown[]) => mockIsCopilotCapabilityEnabled(...args),
}))

const mockAssertConversationViewable = vi.fn()
vi.mock('@/lib/server/domains/conversation/conversation.service', () => ({
  assertConversationViewable: (...args: unknown[]) => mockAssertConversationViewable(...args),
}))

const mockEnforceAiTokenBudget = vi.fn()
vi.mock('@/lib/server/domains/settings/tier-enforce', () => ({
  enforceAiTokenBudget: (...args: unknown[]) => mockEnforceAiTokenBudget(...args),
}))

// `assertTicketViewable` (copilot-gate.ts) is real here, not mocked as a
// module — it's called from WITHIN gateCopilotAguiRequest in the same file, so
// a module-level mock override would never be seen by that internal call (ESM
// self-reference). Instead, fake the one thing it touches: the `db.select`
// chain, mirroring assistant.runtime.test.ts's conversation-lookup mock.
const mockTicketLookup = vi.fn()
vi.mock('@/lib/server/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/server/db')>()
  return {
    ...actual,
    db: {
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            limit: (...args: unknown[]) => mockTicketLookup(...args),
          })),
        })),
      })),
    },
  }
})

import { handleCopilot } from '../copilot'
import type { StreamAssistantTurnOptions } from '@/lib/server/domains/assistant/assistant.runtime'
import { generateId } from '@quackback/ids'

const CONVERSATION_ID = generateId('conversation')

/** Bun closes a connection that carries no bytes for this long. */
const SERVER_IDLE_TIMEOUT_MS = 10_000

const QUIET_FOR_MS = 45_000

beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllMocks()
  mockRequireAuth.mockResolvedValue({ principal: { id: 'principal_1' } })
  mockPolicyActorFromAuth.mockResolvedValue({ principalId: 'principal_1' })
  mockIsFeatureEnabled.mockResolvedValue(true)
  mockIsCopilotCapabilityEnabled.mockResolvedValue(true)
  mockIsAssistantConfigured.mockReturnValue(true)
  mockEnforceAiTokenBudget.mockResolvedValue(undefined)
  mockAssertConversationViewable.mockResolvedValue({ id: CONVERSATION_ID })
  mockEnsureAssistantPrincipal.mockResolvedValue({ id: 'principal_assistant' })
})

afterEach(() => {
  vi.useRealTimers()
})

function copilotRequest(): Request {
  return new Request('http://localhost/api/admin/assistant/copilot', {
    method: 'POST',
    body: JSON.stringify({
      threadId: 'thread-test',
      runId: 'run-test',
      messages: [{ id: 'q', role: 'user', content: 'What is the refund policy?' }],
      tools: [],
      context: [],
      state: {},
      forwardedProps: { conversationId: CONVERSATION_ID },
    }),
  })
}

/** A turn that says nothing for `QUIET_FOR_MS`, then ends the way `ending` says. */
function quietTurn(ending: 'finishes' | 'fails') {
  mockStreamAssistantTurn.mockImplementation((options: StreamAssistantTurnOptions) =>
    (async function* () {
      yield { type: 'RUN_STARTED', ...options.wire }
      await new Promise((resolve) => setTimeout(resolve, QUIET_FOR_MS))
      if (ending === 'fails') {
        const mapError = options.mapError
        if (!mapError) throw new Error('the copilot route passes no mapError to the turn')
        const { code, message } = mapError(new Error('provider key sk-secret rejected'))
        yield { type: 'RUN_ERROR', ...options.wire, code, message }
        return
      }
      yield { type: 'RUN_FINISHED', ...options.wire, finishReason: 'stop' }
    })()
  )
}

/** Reads like the server does and hangs up after ten silent seconds. */
async function readWhileWatchingTheClock(response: Response) {
  const reader = response.body!.getReader()
  const decoder = new TextDecoder()
  const arrivals: number[] = []
  const openedAt = Date.now()
  let received = ''
  let cutByIdleTimeout = false
  const finished = (async () => {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) return
      arrivals.push(Date.now())
      received += decoder.decode(value)
    }
  })()
  const watchdog = setInterval(() => {
    const lastByteAt = arrivals.at(-1) ?? openedAt
    if (Date.now() - lastByteAt >= SERVER_IDLE_TIMEOUT_MS) {
      cutByIdleTimeout = true
      void reader.cancel()
    }
  }, 1_000)

  for (let elapsed = 0; elapsed < QUIET_FOR_MS + 5_000; elapsed += 1_000) {
    await vi.advanceTimersByTimeAsync(1_000)
  }
  clearInterval(watchdog)
  await Promise.race([finished, vi.advanceTimersByTimeAsync(1_000)])
  return { received, cutByIdleTimeout, arrivals, openedAt }
}

describe('a copilot turn that goes quiet (F19)', () => {
  it('(F19) is not cut by the idle timeout and still delivers its end', async () => {
    quietTurn('finishes')
    const response = await handleCopilot({ request: copilotRequest() })

    const outcome = await readWhileWatchingTheClock(response)

    expect(outcome.cutByIdleTimeout).toBe(false)
    expect(outcome.received).toContain('RUN_STARTED')
    expect(outcome.received).toContain('RUN_FINISHED')
  })

  it('(F19) a turn that fails after a long silence reports a generic failure, not its own message', async () => {
    quietTurn('fails')
    const response = await handleCopilot({ request: copilotRequest() })

    const outcome = await readWhileWatchingTheClock(response)

    expect(outcome.cutByIdleTimeout).toBe(false)
    expect(outcome.received).toContain('TURN_FAILED')
    expect(outcome.received).not.toContain('sk-secret')
  })
})
