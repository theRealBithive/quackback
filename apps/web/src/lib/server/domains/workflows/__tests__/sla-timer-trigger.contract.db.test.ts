/**
 * SLA timer triggers fire once their event is safely enqueued, not before.
 *
 * Contract for upstream batch F (#596, `7124936ff`) — the confirmed list for
 * this area:
 *
 *   F13 An SLA timer trigger whose event could not be written fires on a later
 *       sweep; it counts as fired only once its event was enqueued.
 *   F14 An SLA timer trigger whose event was enqueued fires exactly once.
 *
 * The real dispatch pipeline runs (`dispatch.ts` -> `process.ts`); only the
 * durable outbox write is replaced, so a rejection there is a genuine enqueue
 * failure. The scan is a stand-in for the SLA domain: it keeps handing back the
 * candidate until its fire-once marker has been claimed, which is what the
 * real scan does. Each of the four trigger passes (conversation and ticket,
 * approaching and breached) is held to the same law.
 *
 * Generator: a count of failed ticks (0..4) before the first tick on which the
 * outbox accepts the write, so the property reaches "fails never", "fails
 * once" and "fails repeatedly, then recovers".
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest'
import fc from 'fast-check'

import { createDbTestFixture } from '@/lib/server/__tests__/db-test-fixture'
import { workflows } from '@/lib/server/db'
import type { ConversationId, SlaPolicyId, TicketId } from '@quackback/ids'
import type { WorkflowGraph } from '../graph'
import type { EventConversationRef } from '@/lib/server/events/types'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

vi.mock('@/lib/server/logger', () => ({
  logger: {
    child: () => ({
      error: vi.fn(),
      warn: vi.fn(),
      info: vi.fn(),
      debug: vi.fn(),
    }),
  },
}))

const outbox = vi.hoisted(() => ({
  write: vi.fn(),
}))
vi.mock('@/lib/server/events/outbox-dispatch', () => ({
  writeEventToOutbox: (...args: unknown[]) => outbox.write(...args),
}))

const sla = vi.hoisted(() => ({
  sweepApproachingSlaBreaches: vi.fn(),
  sweepSlaBreachTriggers: vi.fn(),
  claimSlaTimerTriggerMarker: vi.fn(),
  sweepApproachingTicketSlaBreaches: vi.fn(),
  sweepTicketSlaBreachTriggers: vi.fn(),
  claimTicketSlaTimerTriggerMarker: vi.fn(),
}))
vi.mock('@/lib/server/domains/sla/sla.sweep', () => ({
  sweepApproachingSlaBreaches: sla.sweepApproachingSlaBreaches,
  sweepSlaBreachTriggers: sla.sweepSlaBreachTriggers,
  claimSlaTimerTriggerMarker: sla.claimSlaTimerTriggerMarker,
}))
vi.mock('@/lib/server/domains/sla/ticket-sla.sweep', () => ({
  sweepApproachingTicketSlaBreaches: sla.sweepApproachingTicketSlaBreaches,
  sweepTicketSlaBreachTriggers: sla.sweepTicketSlaBreachTriggers,
  claimTicketSlaTimerTriggerMarker: sla.claimTicketSlaTimerTriggerMarker,
}))

import { createWorkflow, setWorkflowStatus } from '../workflow.service'
import { sweepSlaTimerTriggers } from '../workflow-sweep'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: workflows.id }).from(workflows).limit(0)
  },
})

const emptyGraph: WorkflowGraph = { nodes: [], edges: [] }

const conversationRef: EventConversationRef = {
  id: 'conv_1',
  status: 'open',
  channel: 'messenger',
  priority: 'none',
  assignedTeamId: null,
}

const conversationCandidate = {
  conversationId: 'conv_1' as ConversationId,
  conversation: conversationRef,
  policyId: 'sla_policy_1' as SlaPolicyId,
  clock: 'first_response' as const,
  dueAt: '2026-01-05T12:00:00.000Z',
  appliedAt: '2026-01-05T10:00:00.000Z',
}

const ticketCandidate = {
  ...conversationCandidate,
  ticketId: 'ticket_1' as TicketId,
  ticket: { id: 'ticket_1' },
}

interface TriggerPass {
  name: string
  triggerType: 'sla.approaching_breach' | 'sla.breached'
  candidate: Record<string, unknown>
  scan: ReturnType<typeof vi.fn>
  claim: ReturnType<typeof vi.fn>
}

const passes: TriggerPass[] = [
  {
    name: 'approaching breach, conversation clock',
    triggerType: 'sla.approaching_breach',
    candidate: conversationCandidate,
    scan: sla.sweepApproachingSlaBreaches,
    claim: sla.claimSlaTimerTriggerMarker,
  },
  {
    name: 'approaching breach, ticket clock',
    triggerType: 'sla.approaching_breach',
    candidate: ticketCandidate,
    scan: sla.sweepApproachingTicketSlaBreaches,
    claim: sla.claimTicketSlaTimerTriggerMarker,
  },
  {
    name: 'breached, conversation clock',
    triggerType: 'sla.breached',
    candidate: conversationCandidate,
    scan: sla.sweepSlaBreachTriggers,
    claim: sla.claimSlaTimerTriggerMarker,
  },
  {
    name: 'breached, ticket clock',
    triggerType: 'sla.breached',
    candidate: ticketCandidate,
    scan: sla.sweepTicketSlaBreachTriggers,
    claim: sla.claimTicketSlaTimerTriggerMarker,
  },
]

const allScans = [
  sla.sweepApproachingSlaBreaches,
  sla.sweepSlaBreachTriggers,
  sla.sweepApproachingTicketSlaBreaches,
  sla.sweepTicketSlaBreachTriggers,
]
const allClaims = [sla.claimSlaTimerTriggerMarker, sla.claimTicketSlaTimerTriggerMarker]

/** The scan under test returns its candidate until the marker was claimed. */
function scanReturnsCandidateUntilClaimed(pass: TriggerPass): void {
  let claimed = false
  pass.claim.mockImplementation(async () => {
    claimed = true
    return true
  })
  pass.scan.mockImplementation(async () => (claimed ? [] : [pass.candidate]))
}

beforeEach(() => {
  for (const scan of allScans) scan.mockReset().mockResolvedValue([])
  for (const claim of allClaims) claim.mockReset().mockResolvedValue(true)
  outbox.write.mockReset().mockResolvedValue(true)
})

describe.skipIf(!fixture.available)('SLA timer triggers fire once enqueued (F13, F14)', () => {
  beforeEach(fixture.begin)
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  async function seedLiveWorkflow(triggerType: string): Promise<void> {
    const draft = await createWorkflow({
      name: `sla contract ${triggerType} ${Math.random().toString(36).slice(2, 8)}`,
      class: 'background',
      triggerType,
      triggerSettings: {},
      graph: emptyGraph,
    })
    await setWorkflowStatus(draft.id, 'live')
  }

  describe.each(passes)('$name', (pass) => {
    it('(F13) counts as fired only once its event was enqueued, and fires on a later sweep', async () => {
      await seedLiveWorkflow(pass.triggerType)

      await fc.assert(
        fc.asyncProperty(fc.integer({ min: 0, max: 4 }), async (failedTicks) => {
          outbox.write.mockReset()
          pass.claim.mockReset()
          scanReturnsCandidateUntilClaimed(pass)
          const outboxError = new Error('outbox write failed (simulated)')
          for (let tick = 0; tick < failedTicks; tick++) {
            outbox.write.mockRejectedValueOnce(outboxError)
          }
          outbox.write.mockResolvedValue(true)
          let totalFired = 0

          for (let tick = 0; tick < failedTicks; tick++) {
            const firedOnFailedTick = await sweepSlaTimerTriggers(new Date())
            expect(firedOnFailedTick).toBe(0)
            expect(pass.claim).not.toHaveBeenCalled()
            totalFired += firedOnFailedTick
          }

          const firedOnRecoveredTick = await sweepSlaTimerTriggers(new Date())
          totalFired += firedOnRecoveredTick

          expect(firedOnRecoveredTick).toBe(1)
          expect(pass.claim).toHaveBeenCalledTimes(1)
          // Unguarded conservation: fired count equals enqueued events.
          expect(totalFired).toBe(1)
          expect(outbox.write).toHaveBeenCalledTimes(failedTicks + 1)
        }),
        { numRuns: 25 }
      )
    })

    it('(F14) fires exactly once when its event was enqueued, however often the sweep runs', async () => {
      await seedLiveWorkflow(pass.triggerType)

      await fc.assert(
        fc.asyncProperty(fc.integer({ min: 1, max: 5 }), async (extraSweeps) => {
          outbox.write.mockReset().mockResolvedValue(true)
          pass.claim.mockReset()
          scanReturnsCandidateUntilClaimed(pass)

          let totalFired = 0
          for (let sweep = 0; sweep < 1 + extraSweeps; sweep++) {
            totalFired += await sweepSlaTimerTriggers(new Date())
          }

          expect(totalFired).toBe(1)
          expect(pass.claim).toHaveBeenCalledTimes(1)
          expect(outbox.write).toHaveBeenCalledTimes(1)
        }),
        { numRuns: 15 }
      )
    })

    it('(F14) retries under the same event id, so a retried enqueue cannot duplicate the event', async () => {
      await seedLiveWorkflow(pass.triggerType)
      scanReturnsCandidateUntilClaimed(pass)
      outbox.write.mockRejectedValueOnce(new Error('outbox write failed (simulated)'))
      outbox.write.mockResolvedValue(true)

      await sweepSlaTimerTriggers(new Date())
      await sweepSlaTimerTriggers(new Date())

      const eventIds = outbox.write.mock.calls.map((call) => (call[0] as { id: string }).id)
      expect(eventIds).toHaveLength(2)
      expect(eventIds[0]).toBe(eventIds[1])
    })
  })
})
