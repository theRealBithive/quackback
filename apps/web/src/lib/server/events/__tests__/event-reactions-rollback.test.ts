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
 * Rolling back to a build that predates the `event-reactions` and
 * `event-summaries` queues (JOBS.md §10, "Rolling back to a build that
 * predates the reaction queues"). A worker without their definitions never
 * claims their rows, so they wait, pending, for the runbook's drain check and
 * purge. This pins that premise against the real runner, and runs the
 * runbook's own SQL, read from JOBS.md, against the real schema: the drain
 * check, the purge, and the step that strips the SLA stamp keys an older
 * build neither writes nor clears. Each
 * statement is narrowed to this test's event so it never touches rows other
 * suites left in the shared database.
 *
 * Real DB (rolled back), real legacy dispatch, outbox and job runner.
 */
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest'
import { createId } from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { conversations, events, eq, principal, sql, tickets, ticketStatuses } from '@/lib/server/db'
import { getExecuteRows } from '@/lib/server/utils/execute-rows'
import type { SQL } from 'drizzle-orm'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

import * as dispatch from '../dispatch'
import { EVENT_REACTIONS_QUEUE, EVENT_SUMMARIES_QUEUE } from '../event-reactions'
import { __setJobDefinitionsForTests, type JobDefinition } from '@/lib/server/jobs/definitions'
import { drainOnce, runnerConfig, resetJobHandlers } from '@/lib/server/jobs/runner'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ owner: events.dispatchOwner }).from(events).limit(0)
  },
})
afterAll(() => fixture.close())

/** The runbook's drain check and purge, as JOBS.md states them. */
const runbook = (() => {
  const doc = readFileSync(path.resolve(__dirname, '../../jobs/JOBS.md'), 'utf8')
  const start = doc.indexOf('**Rolling back to a build that predates the reaction queues.**')
  const section = doc.slice(start, doc.indexOf('\n## ', start))
  const [check, purge, strip] = [...section.matchAll(/```sql\n([\s\S]*?)```/g)].map((match) =>
    match[1].trim().replace(/;$/, '')
  )
  // Step 5 is two statements, one per table that carries an SLA stamp.
  const [stripConversations, stripTickets] = strip.split(';').map((statement) => statement.trim())
  return { check, purge, stripConversations, stripTickets }
})()

/** A runbook statement, narrowed by `condition` to the row this test seeded. */
const narrowedTo = (statement: string, condition: SQL) =>
  sql`${sql.raw(statement)} AND ${condition}`

/** A runbook statement, narrowed to one event's jobs. */
const forEvent = (statement: string, eventId: string) =>
  sql`${sql.raw(statement)} AND payload->>'eventId' = ${eventId}`

/**
 * The queue set of a worker built before the reaction queues existed. Its one
 * queue is named for this run, so the drain below can claim no other suite's
 * rows.
 */
const OLDER_BUILD: JobDefinition[] = [
  { name: `queue-of-an-older-build-${randomUUID()}`, handler: async () => async () => {} },
]

/** A conversation closed through the legacy dispatch: one job on each reaction queue. */
async function closeConversation(): Promise<string> {
  const conversationId = createId('conversation')
  await dispatch.dispatchConversationStatusChanged(
    { type: 'user', principalId: createId('principal') },
    {
      id: conversationId,
      status: 'closed',
      channel: 'messenger',
      priority: 'medium',
      assignedTeamId: null,
    },
    'open',
    'closed'
  )
  const [row] = await testDb.select().from(events).where(eq(events.entityId, conversationId))
  return row.eventId
}

async function reactionJobs(eventId: string) {
  return getExecuteRows<{ queue: string; status: string; attempts: number }>(
    await testDb.execute(sql`
      SELECT queue, status, attempts FROM job_queue
      WHERE queue IN (${EVENT_REACTIONS_QUEUE}, ${EVENT_SUMMARIES_QUEUE})
        AND payload->>'eventId' = ${eventId}
      ORDER BY queue
    `)
  )
}

describe.skipIf(!fixture.available)('rolling back past the reaction queues', () => {
  beforeEach(() => {
    resetJobHandlers()
    return fixture.begin()
  })
  afterEach(async () => {
    __setJobDefinitionsForTests(null)
    resetJobHandlers()
    await fixture.rollback()
  })

  it('a worker without the reaction queues never claims their jobs (I-R7)', async () => {
    const eventId = await closeConversation()

    __setJobDefinitionsForTests(OLDER_BUILD)
    for (let pass = 0; pass < 3; pass++) await drainOnce({ ...runnerConfig(), batchSize: 5 })

    expect(await reactionJobs(eventId)).toEqual([
      { queue: EVENT_REACTIONS_QUEUE, status: 'pending', attempts: 0 },
      { queue: EVENT_SUMMARIES_QUEUE, status: 'pending', attempts: 0 },
    ])
  })

  it("the runbook's drain check counts those jobs and its purge removes them (I-R7)", async () => {
    const eventId = await closeConversation()
    const count = async () =>
      Number(
        getExecuteRows<{ count: string | number }>(
          await testDb.execute(forEvent(runbook.check, eventId))
        )[0].count
      )

    expect(await count()).toBe(2)
    await testDb.execute(forEvent(runbook.purge, eventId))

    expect(await count()).toBe(0)
    expect(await reactionJobs(eventId)).toEqual([])
  })

  it("the runbook's strip step removes the newer build's stamp keys and keeps the rest (I-R7)", async () => {
    const [visitor] = await testDb
      .insert(principal)
      .values({ type: 'service', role: 'member', displayName: 'Visitor', createdAt: new Date() })
      .returning()
    const [status] = await testDb
      .insert(ticketStatuses)
      .values({ name: `Open ${randomUUID()}`, slug: `open_${randomUUID()}`, category: 'open' })
      .returning()
    // What an older build wrote and still reads, next to what only the newer build writes.
    const olderBuildKeys = { appliedAt: '2026-01-05T09:00:00.000Z', pausedAt: null }
    const newerBuildKeys = {
      nextResponseCycleAt: '2026-01-05T09:30:00.000Z',
      pausedSpans: [{ start: '2026-01-05T09:40:00.000Z', end: '2026-01-05T09:50:00.000Z' }],
      pauseRevision: 2,
    }
    const [conversation] = await testDb
      .insert(conversations)
      .values({
        visitorPrincipalId: visitor.id,
        channel: 'messenger',
        slaApplied: { ...olderBuildKeys, ...newerBuildKeys },
      })
      .returning()
    const [ticket] = await testDb
      .insert(tickets)
      .values({
        title: `Ticket ${randomUUID()}`,
        statusId: status.id,
        slaApplied: { ...olderBuildKeys, ...newerBuildKeys },
      })
      .returning()

    await testDb.execute(
      narrowedTo(runbook.stripConversations, eq(conversations.id, conversation.id))
    )
    await testDb.execute(narrowedTo(runbook.stripTickets, eq(tickets.id, ticket.id)))

    const [conversationAfter] = await testDb
      .select({ slaApplied: conversations.slaApplied })
      .from(conversations)
      .where(eq(conversations.id, conversation.id))
    const [ticketAfter] = await testDb
      .select({ slaApplied: tickets.slaApplied })
      .from(tickets)
      .where(eq(tickets.id, ticket.id))
    expect(conversationAfter.slaApplied).toEqual(olderBuildKeys)
    // Tickets have no next-response clock, so the runbook leaves that key to the conversations.
    expect(ticketAfter.slaApplied).toEqual({
      ...olderBuildKeys,
      nextResponseCycleAt: newerBuildKeys.nextResponseCycleAt,
    })
  })
})
