/**
 * Contract (batch I, confirmed 2026-10-08). Tests name these as I-R1 ... I-R7:
 * the fork already uses R1-R13 for the session audience guarantees
 * (auth-scope.test.ts), so the batch prefix keeps the two lists apart. The
 * list itself is verbatim.
 *
 * R1 Every event a reaction listens to (a new message, a conversation or ticket status change, a CSAT answer) gets its reactions run, however the event was produced.
 * R2 The reactions are recorded in the same transaction as the event: if the event commits, its reactions will run; if it rolls back, none run.
 * R3 Each reaction runs once per event in effect. A retry or a duplicate run never pauses, resumes or settles an SLA clock twice, never reopens a pair ticket twice, never writes a second summary.
 * R4 A reaction that fails is retried, and its failure never undoes or blocks the change that caused the event, nor holds back the other reactions of the same event.
 * R5 A failing delivery to an outbound target (webhook, integration) never delays or spends the reactions.
 * R6 A close summary, which may wait on a slow AI call, never delays the SLA and reopen reactions of other events.
 * R7 Rolling back to a build without the reaction queues loses no reaction silently: the runbook in JOBS.md states how to drain or purge them, and its SQL runs against the real schema.
 *
 * Fork-owned companion to the upstream event-reactions.test.ts. That suite
 * proves the jobs exist and run; this one covers the parts of the contract it
 * leaves open: a native emit that rolls back (I-R2), one job per event and
 * queue (I-R3), a failed reaction retried through the real runner while the
 * domain write stands (I-R4), a held summary that does not hold up another
 * event's SLA reaction on the real pool (I-R6), and which events a reaction
 * answers at all (I-R1). The real reactions' own idempotency (I-R3) is proved
 * against the real reopen, recorders and summary writer in
 * event-reactions-pair-reopen.test.ts, sla.ordering.test.ts and
 * close-summary.test.ts.
 *
 * Real DB (rolled back per test), real emit(), outbox, job runner, pool and
 * handlers. Only the five reaction entry points are mocked.
 */
import { randomUUID } from 'node:crypto'
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest'
import { createId, type PrincipalId, type TicketId, type TicketStatusId } from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { events, eq, principal, sql, tickets, ticketStatuses } from '@/lib/server/db'
import { enqueueJob, type ClaimedJob } from '@/lib/server/jobs/job-queue'
import { getExecuteRows } from '@/lib/server/utils/execute-rows'
import type { EventActor, EventConversationRef, EventData, EventMessageData } from '../types'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

const reactions = vi.hoisted(() => ({
  recordSlaFromEvent: vi.fn(async (_event: unknown) => {}),
  autoReopenPairTicketFromEvent: vi.fn(async (_event: unknown) => {}),
  confirmResolutionFromCsat: vi.fn(
    async (_conversationId: unknown, _rating: unknown, _submittedAt: unknown) => {}
  ),
  summarizeConversationOnClose: vi.fn(
    async (_conversationId: unknown, _close: unknown, _opts?: unknown) => {}
  ),
  summarizeTicketOnClose: vi.fn(async (_ticketId: unknown, _close: unknown, _opts?: unknown) => {}),
}))

vi.mock('@/lib/server/domains/sla/sla.event-hooks', () => ({
  recordSlaFromEvent: reactions.recordSlaFromEvent,
}))
vi.mock('@/lib/server/domains/tickets/ticket.event-hooks', () => ({
  autoReopenPairTicketFromEvent: reactions.autoReopenPairTicketFromEvent,
}))
vi.mock('@/lib/server/domains/assistant/assistant.involvement', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('@/lib/server/domains/assistant/assistant.involvement')
  >()),
  confirmResolutionFromCsat: reactions.confirmResolutionFromCsat,
}))
vi.mock('@/lib/server/domains/assistant/conversation-summary.service', () => ({
  summarizeConversationOnClose: reactions.summarizeConversationOnClose,
}))
vi.mock('@/lib/server/domains/assistant/ticket-summary.service', () => ({
  summarizeTicketOnClose: reactions.summarizeTicketOnClose,
}))

import {
  EVENT_REACTIONS_QUEUE,
  EVENT_SUMMARIES_QUEUE,
  REACTION_DEADLINE_MS,
} from '../event-reactions'
import { runEventReactions } from '../event-reactions-queue'
import { runEventSummaries } from '../event-summaries-queue'
import { emit } from '../emit'
import { ticketStatusChanged } from '../catalogue'
import * as dispatch from '../dispatch'
import { JOB_DEFINITIONS, __setJobDefinitionsForTests } from '@/lib/server/jobs/definitions'
import {
  awaitPool,
  createJobPool,
  dispatchPass,
  resetJobHandlers,
  runJob,
  runnerConfig,
} from '@/lib/server/jobs/runner'
import { privateReactionQueue } from './private-reaction-queue'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ owner: events.dispatchOwner }).from(events).limit(0)
    await db.select({ id: tickets.id }).from(tickets).limit(0)
  },
})
afterAll(() => fixture.close())

type ReactionName = keyof typeof reactions
const REACTION_NAMES = Object.keys(reactions) as ReactionName[]

const suffix = () => `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`

const eventRowsFor = (entityId: string) =>
  testDb.select().from(events).where(eq(events.entityId, entityId)).orderBy(events.id)

interface ReactionJobRow {
  job_id: string
  queue: string
  status: string
  attempts: number
  max_attempts: number
  last_error: string | null
}

/** Every reaction job row for one event, on the shipped queues or a private copy of them. */
async function reactionJobRows(eventId: string): Promise<ReactionJobRow[]> {
  const result = await testDb.execute(sql`
    SELECT job_id, queue, status, attempts, max_attempts, last_error FROM job_queue
    WHERE (queue LIKE ${EVENT_REACTIONS_QUEUE + '%'} OR queue LIKE ${EVENT_SUMMARIES_QUEUE + '%'})
      AND payload->>'eventId' = ${eventId}
    ORDER BY queue
  `)
  return getExecuteRows<ReactionJobRow>(result)
}

/** A claimed job for a handler called directly, as the worker would hand it over. */
function claimed(queue: string, payload: Record<string, unknown>): ClaimedJob {
  return {
    id: '1',
    jobId: createId('job'),
    queue,
    dedupeKey: null,
    payload,
    workspaceKey: null,
    attempts: 1,
    maxAttempts: 3,
    leaseToken: 'test',
    lockedUntil: new Date(),
  }
}

async function seedTicket() {
  const [open, closed] = await testDb
    .insert(ticketStatuses)
    .values([
      { name: `Open ${suffix()}`, slug: `open_${suffix()}`, category: 'open' },
      { name: `Done ${suffix()}`, slug: `done_${suffix()}`, category: 'closed' },
    ])
    .returning()
  const [service] = await testDb
    .insert(principal)
    .values({ type: 'service', role: 'member', displayName: 'Tracker', createdAt: new Date() })
    .returning()
  const [ticket] = await testDb
    .insert(tickets)
    .values({ type: 'customer', title: `Ticket ${suffix()}`, statusId: open.id as TicketStatusId })
    .returning()
  return {
    ticketId: ticket.id as TicketId,
    openStatusId: open.id as TicketStatusId,
    closedStatusId: closed.id as TicketStatusId,
    principalId: service.id as PrincipalId,
  }
}

type SeededTicket = Awaited<ReturnType<typeof seedTicket>>

/** Close the ticket and emit its status change in one transaction, as a native producer does. */
async function closeTicketNatively(seeded: SeededTicket, afterEmit?: (eventId: string) => void) {
  await testDb.transaction(async (tx) => {
    const [ticket] = await tx
      .update(tickets)
      .set({ statusId: seeded.closedStatusId })
      .where(eq(tickets.id, seeded.ticketId))
      .returning()
    const eventId = await emit(tx, ticketStatusChanged, {
      payload: {
        ticket: {
          id: ticket.id,
          number: ticket.number,
          type: ticket.type,
          priority: ticket.priority,
        },
        previousStatus: 'open',
        newStatus: 'closed',
        stage: null,
      },
      actor: { type: 'service', id: seeded.principalId },
      entityId: seeded.ticketId,
    })
    afterEmit?.(eventId)
  })
}

async function ticketStatusOf(ticketId: TicketId) {
  const [row] = await testDb
    .select({ statusId: tickets.statusId })
    .from(tickets)
    .where(eq(tickets.id, ticketId))
  return row.statusId
}

const actor = (): EventActor => ({
  type: 'user',
  principalId: createId('principal'),
  userId: createId('user'),
  email: 'agent@example.com',
  displayName: 'Agent Smith',
})
const convRef = (): EventConversationRef => ({
  id: createId('conversation'),
  status: 'open',
  channel: 'messenger',
  priority: 'medium',
  assignedTeamId: null,
})
const visitorMessage = (conversation: EventConversationRef): EventMessageData => ({
  id: createId('conversation_message'),
  conversationId: conversation.id,
  senderType: 'visitor',
  authorPrincipalId: createId('principal'),
  authorName: 'visitor',
  authorEmail: 'visitor@example.com',
  content: 'From the visitor',
  createdAt: new Date().toISOString(),
})

/** The conversation a recorded SLA call was about, if any. */
function conversationIdOf(event: unknown): string | undefined {
  const data = (event as EventData).data as { conversation?: { id: string } }
  return data.conversation?.id
}

describe.skipIf(!fixture.available)('event reactions contract (real DB, rolled back)', () => {
  beforeEach(() => {
    for (const name of REACTION_NAMES) reactions[name].mockReset()
    resetJobHandlers()
    return fixture.begin()
  })
  afterEach(async () => {
    __setJobDefinitionsForTests(null)
    resetJobHandlers()
    await fixture.rollback()
  })

  it('a natively emitted close that rolls back leaves no event, no reaction job and no status change (I-R2)', async () => {
    const seeded = await seedTicket()
    let emittedId = ''

    await expect(
      closeTicketNatively(seeded, (eventId) => {
        emittedId = eventId
        throw new Error('the domain write failed after the emit')
      })
    ).rejects.toThrow('the domain write failed after the emit')

    expect(emittedId).not.toBe('')
    expect(await eventRowsFor(seeded.ticketId)).toEqual([])
    expect(await ticketStatusOf(seeded.ticketId)).toBe(seeded.openStatusId)
    expect(await reactionJobRows(emittedId)).toEqual([])
  })

  it('a natively emitted close that commits has exactly one job per reaction queue, and a second enqueue adds none (I-R2, I-R3)', async () => {
    const seeded = await seedTicket()
    await closeTicketNatively(seeded)
    const [row] = await eventRowsFor(seeded.ticketId)

    expect(await ticketStatusOf(seeded.ticketId)).toBe(seeded.closedStatusId)
    const before = await reactionJobRows(row.eventId)
    expect(before.map((job) => job.queue)).toEqual([EVENT_REACTIONS_QUEUE, EVENT_SUMMARIES_QUEUE])

    // A producer or a replay that queues the same event again finds the job already there.
    for (const queue of [EVENT_REACTIONS_QUEUE, EVENT_SUMMARIES_QUEUE]) {
      const again = await enqueueJob({
        queue,
        payload: { eventId: row.eventId },
        dedupeKey: `${queue}:${row.eventId}`,
        maxAttempts: 3,
        executor: testDb,
      })
      expect(again.inserted, queue).toBe(false)
    }
    expect(await reactionJobRows(row.eventId)).toEqual(before)
  })

  it('a failing reaction is retried by the real runner, and the close it reacts to stands (I-R4)', async () => {
    const seeded = await seedTicket()
    await closeTicketNatively(seeded)
    const [row] = await eventRowsFor(seeded.ticketId)
    reactions.recordSlaFromEvent.mockRejectedValueOnce(new Error('sla store down'))

    const queue = privateReactionQueue()
    try {
      await queue.adopt([row.eventId])
      expect(await queue.drain()).toMatchObject({ claimed: 1, retrying: 1 })

      // The failure is on the job, not on the close.
      expect(await ticketStatusOf(seeded.ticketId)).toBe(seeded.closedStatusId)
      expect(await eventRowsFor(seeded.ticketId)).toHaveLength(1)
      const [failed, summaries] = await reactionJobRows(row.eventId)
      expect(failed).toMatchObject({ queue: queue.name, status: 'pending', attempts: 1 })
      expect(failed.last_error).toMatch(/sla store down/)
      // The same event's summary sits on its own queue, untouched by the failure.
      expect(summaries).toMatchObject({
        queue: EVENT_SUMMARIES_QUEUE,
        status: 'pending',
        attempts: 0,
      })

      await queue.due(row.eventId)
      expect(await queue.drain()).toMatchObject({ claimed: 1, succeeded: 1 })
    } finally {
      queue.release()
    }

    expect(reactions.recordSlaFromEvent).toHaveBeenCalledTimes(2)
    for (const [event] of reactions.recordSlaFromEvent.mock.calls) {
      expect(event).toMatchObject({ type: 'ticket.status_changed', id: row.eventId })
    }
  })

  it("a summary held on a slow AI call does not hold up another event's SLA reaction on the real pool (I-R6)", async () => {
    const closed = convRef()
    const other = convRef()
    await dispatch.dispatchConversationStatusChanged(actor(), closed, 'open', 'closed')
    await dispatch.dispatchMessageCreated(actor(), visitorMessage(other), other, true)
    const [closeRow] = await eventRowsFor(closed.id)
    const [messageRow] = await eventRowsFor(other.id)

    let releaseSummary = () => {}
    const summaryHeld = new Promise<void>((resolve) => {
      releaseSummary = resolve
    })
    reactions.summarizeConversationOnClose.mockImplementation(() => summaryHeld)

    // Both shipped definitions under names no other suite uses, so the pool
    // claims only this test's two jobs.
    const shippedReactions = JOB_DEFINITIONS.find((def) => def.name === EVENT_REACTIONS_QUEUE)
    const shippedSummaries = JOB_DEFINITIONS.find((def) => def.name === EVENT_SUMMARIES_QUEUE)
    if (!shippedReactions || !shippedSummaries) throw new Error('a reaction queue is not shipped')
    const reactionsName = `${EVENT_REACTIONS_QUEUE}-test-${randomUUID()}`
    const summariesName = `${EVENT_SUMMARIES_QUEUE}-test-${randomUUID()}`
    __setJobDefinitionsForTests([
      { ...shippedReactions, name: reactionsName },
      { ...shippedSummaries, name: summariesName },
    ])
    await testDb.execute(sql`
      UPDATE job_queue SET queue = ${summariesName}
      WHERE queue = ${EVENT_SUMMARIES_QUEUE} AND payload->>'eventId' = ${closeRow.eventId}
    `)
    await testDb.execute(sql`
      UPDATE job_queue SET queue = ${reactionsName}
      WHERE queue = ${EVENT_REACTIONS_QUEUE} AND payload->>'eventId' = ${messageRow.eventId}
    `)

    const settledQueues: string[] = []
    let reactionSettled = () => {}
    const reactionDone = new Promise<void>((resolve) => {
      reactionSettled = resolve
    })
    const pool = createJobPool()
    try {
      const pass = await dispatchPass({
        pool,
        config: { ...runnerConfig(), batchSize: 5 },
        run: runJob,
        onSettled: (queue, outcome) => {
          settledQueues.push(`${queue === reactionsName ? 'reactions' : 'summaries'} ${outcome}`)
          if (queue === reactionsName) reactionSettled()
        },
      })
      expect(pass.claimed).toBe(2)

      await reactionDone
      // The other event's SLA reaction finished while the summary is still waiting.
      expect(reactions.summarizeConversationOnClose).toHaveBeenCalledTimes(1)
      expect(settledQueues).toEqual(['reactions succeeded'])
      expect(
        reactions.recordSlaFromEvent.mock.calls.map(([event]) => conversationIdOf(event))
      ).toEqual([other.id])
    } finally {
      releaseSummary()
      await awaitPool(pool)
    }
    expect(settledQueues).toEqual(['reactions succeeded', 'summaries succeeded'])
  })

  it('a reaction past its deadline is the only one the failure names; the others on its job finished (I-R4)', async () => {
    const conversation = convRef()
    await dispatch.dispatchMessageCreated(actor(), visitorMessage(conversation), conversation, true)
    const [row] = await eventRowsFor(conversation.id)
    reactions.recordSlaFromEvent.mockImplementation(() => new Promise(() => {}))

    const deadline = REACTION_DEADLINE_MS[EVENT_REACTIONS_QUEUE]
    REACTION_DEADLINE_MS[EVENT_REACTIONS_QUEUE] = 50
    try {
      const job = claimed(EVENT_REACTIONS_QUEUE, { eventId: row.eventId })
      await expect(runEventReactions(job)).rejects.toThrow(
        /^event reactions passed their 50ms deadline: sla$/
      )
    } finally {
      REACTION_DEADLINE_MS[EVENT_REACTIONS_QUEUE] = deadline
    }
    expect(reactions.autoReopenPairTicketFromEvent).toHaveBeenCalledTimes(1)
  })

  it('a reaction job that names no event runs nothing (I-R2)', async () => {
    await expect(runEventReactions(claimed(EVENT_REACTIONS_QUEUE, {}))).resolves.toBeUndefined()
    await expect(
      runEventSummaries(claimed(EVENT_SUMMARIES_QUEUE, { eventId: 42 }))
    ).resolves.toBeUndefined()
    for (const name of REACTION_NAMES) expect(reactions[name], name).not.toHaveBeenCalled()
  })

  it('a CSAT answer whose submission time cannot be read is confirmed at the time of its event (I-R1)', async () => {
    const conversation = convRef()
    await dispatch.dispatchConversationCsatSubmitted(actor(), conversation, 4, null, 'not a date')
    const [row] = await eventRowsFor(conversation.id)

    await runEventReactions(claimed(EVENT_REACTIONS_QUEUE, { eventId: row.eventId }))

    expect(reactions.confirmResolutionFromCsat).toHaveBeenCalledTimes(1)
    expect(reactions.confirmResolutionFromCsat).toHaveBeenCalledWith(
      conversation.id,
      4,
      row.occurredAt
    )
  })

  it('a status change that is not a close settles the SLA clock and writes no summary (I-R1)', async () => {
    const conversation = convRef()
    await dispatch.dispatchConversationStatusChanged(actor(), conversation, 'open', 'snoozed')
    const ticketId = createId('ticket')
    await dispatch.dispatchTicketStatusChanged(
      actor(),
      { id: ticketId, number: 7, type: 'customer', priority: 'high' },
      'open',
      'pending',
      null,
      null,
      null,
      'A ticket'
    )
    const conversationRows = await eventRowsFor(conversation.id)
    const ticketRows = await eventRowsFor(ticketId)

    for (const row of [...conversationRows, ...ticketRows]) {
      const jobs = await reactionJobRows(row.eventId)
      // Its type has a summary reaction, so the job exists; the summary itself declines.
      expect(
        jobs.map((job) => job.queue),
        row.type
      ).toEqual([EVENT_REACTIONS_QUEUE, EVENT_SUMMARIES_QUEUE])
      await runEventReactions(claimed(EVENT_REACTIONS_QUEUE, { eventId: row.eventId }))
      await runEventSummaries(claimed(EVENT_SUMMARIES_QUEUE, { eventId: row.eventId }))
    }

    expect(reactions.recordSlaFromEvent).toHaveBeenCalledTimes(2)
    expect(reactions.summarizeConversationOnClose).not.toHaveBeenCalled()
    expect(reactions.summarizeTicketOnClose).not.toHaveBeenCalled()
  })
})
