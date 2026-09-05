/**
 * Saving a board→project rule, against real Postgres.
 *
 * Contract (domain language, confirmed before these tests were written; the
 * numbering is the plan's):
 *
 *   V2  A board with no project recorded creates no issue. There is no
 *       catch-all project.
 *   V5  When a board's mapping is changed, the new mapping applies to the next
 *       post, without a restart and without a wait.
 *   V6  Several boards may point at the same project; a board points at at
 *       most one project. Changing one board's rule never changes another's.
 *   V17 Setting up or changing a rule creates no issues for posts that already
 *       exist. A rule applies from the next status change, never backwards.
 *
 * The row that has to disappear is the one every instance already has: one
 * filterless mapping on `post.created` with no action config. It is easy to
 * leave behind, because per-board rules can be added beside it and the
 * settings page then looks correct — while the resolver keeps matching it
 * first, independently, and every post fans out twice.
 *
 * The generic `updateIntegration` upsert writes `targetKey` at its `'default'`
 * default, so one flip of an event switch re-creates that row. Removing the
 * switch from the GitLab settings page is the fix; this file is what keeps it
 * fixed when someone adds a switch back.
 */
import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { integrations, integrationEventMappings, events, eq } from '@/lib/server/db'

vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => {
    const chain = {
      validator: () => chain,
      handler: (fn: (args: unknown) => unknown) => fn,
    }
    return chain
  },
}))

vi.mock('@/lib/server/functions/auth-helpers', () => ({
  requireAuth: async () => ({ principalId: 'prn_test' }),
}))

vi.mock('@/lib/server/cache', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/cache')>()),
  cacheDel: async () => undefined,
}))

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

import {
  saveBoardRoutingRuleFn,
  removeBoardRoutingRuleFn,
  fetchBoardRoutingRulesFn,
} from '../integrations'

const fixture = await createDbTestFixture({
  probe: async (db) =>
    void (await db
      .select({ id: integrationEventMappings.targetKey })
      .from(integrationEventMappings)
      .limit(0)),
})

let integrationId: string

async function storedRows() {
  return testDb
    .select({
      eventType: integrationEventMappings.eventType,
      targetKey: integrationEventMappings.targetKey,
      actionConfig: integrationEventMappings.actionConfig,
      filters: integrationEventMappings.filters,
    })
    .from(integrationEventMappings)
    .where(eq(integrationEventMappings.integrationId, integrationId as never))
    .orderBy(integrationEventMappings.targetKey, integrationEventMappings.eventType)
}

/** The row every instance has before per-board routing: no filter, no target. */
async function insertLegacyCatchAll(): Promise<void> {
  await testDb.insert(integrationEventMappings).values({
    integrationId: integrationId as never,
    eventType: 'post.created',
    actionType: 'send_message',
    targetKey: 'default',
    actionConfig: {},
    filters: null,
    enabled: true,
  })
}

const call = <T>(fn: unknown, data: unknown) =>
  (fn as (a: unknown) => Promise<T>)({ data }) as Promise<T>

const save = (boardId: string, projectId: string, triggerStatusIds: string[]) =>
  call(saveBoardRoutingRuleFn, { integrationId, boardId, projectId, triggerStatusIds })

describe.skipIf(!fixture.available)('board routing write path', () => {
  beforeEach(async () => {
    await fixture.begin()
    const [row] = await testDb
      .insert(integrations)
      .values({
        integrationType: `routing-write-${Math.random().toString(36).slice(2, 8)}`,
        status: 'active',
        config: { channelId: '999' },
      })
      .returning({ id: integrations.id })
    integrationId = row.id
  })
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  describe('saving the first rule', () => {
    it('retires the filterless row that would still catch every board (V2)', async () => {
      await insertLegacyCatchAll()

      await save('board_asbs', '222', ['status_triaged'])

      const rows = await storedRows()
      expect(rows.map((r) => r.targetKey)).toEqual(['board_asbs'])
      expect(rows[0].eventType).toBe('post.status_changed')
    })

    it('records the project and the triggering statuses on the board key (V6)', async () => {
      await save('board_asbs', '222', ['status_triaged', 'status_planned'])

      const [row] = await storedRows()
      expect(row.actionConfig).toEqual({ channelId: '222' })
      expect(row.filters).toEqual({
        boardIds: ['board_asbs'],
        statusIds: ['status_triaged', 'status_planned'],
      })
    })

    it('leaves the instance-wide project in the integration config unused (V2)', async () => {
      // Deleting it is not this function's business, and it stays readable for
      // whoever migrates. What matters is that no mapping row can reach it any
      // more — the fallback is only consulted for a mapping that already matched.
      await insertLegacyCatchAll()

      await save('board_asbs', '222', ['status_triaged'])

      for (const row of await storedRows()) {
        expect(row.actionConfig).not.toEqual({})
      }
    })
  })

  describe('several boards', () => {
    it('lets two boards point at the same project (V6)', async () => {
      await save('board_asbs', '777', ['status_triaged'])
      await save('board_gwg', '777', ['status_triaged'])

      const rows = await storedRows()
      expect(rows.map((r) => r.targetKey)).toEqual(['board_asbs', 'board_gwg'])
      expect(rows.map((r) => r.actionConfig)).toEqual([{ channelId: '777' }, { channelId: '777' }])
    })

    it("changing one board's rule leaves the other's exactly as it was (V6)", async () => {
      await save('board_asbs', '222', ['status_triaged'])
      await save('board_gwg', '333', ['status_planned'])

      const before = (await storedRows()).find((r) => r.targetKey === 'board_asbs')
      await save('board_gwg', '444', ['status_triaged', 'status_planned'])
      const after = (await storedRows()).find((r) => r.targetKey === 'board_asbs')

      expect(after).toEqual(before)
    })

    it('replaces a board rule rather than adding a second one (V6)', async () => {
      await save('board_asbs', '222', ['status_triaged'])
      await save('board_asbs', '333', ['status_planned'])

      const rows = await storedRows()
      expect(rows).toHaveLength(1)
      expect(rows[0].actionConfig).toEqual({ channelId: '333' })
    })
  })

  describe('removing a rule', () => {
    it('leaves the board with no project, and no catch-all in its place (V2)', async () => {
      await save('board_asbs', '222', ['status_triaged'])
      await save('board_gwg', '333', ['status_triaged'])

      await call(removeBoardRoutingRuleFn, { integrationId, boardId: 'board_asbs' })

      const rows = await storedRows()
      expect(rows.map((r) => r.targetKey)).toEqual(['board_gwg'])
    })
  })

  describe('reading the rules back', () => {
    it('reads exactly what was saved (V6)', async () => {
      await insertLegacyCatchAll()
      await save('board_asbs', '222', ['status_triaged'])
      await save('board_gwg', '333', ['status_planned', 'status_triaged'])

      const rules = await call<unknown[]>(fetchBoardRoutingRulesFn, { integrationId })

      expect(rules).toEqual([
        { boardId: 'board_asbs', projectId: '222', triggerStatusIds: ['status_triaged'] },
        {
          boardId: 'board_gwg',
          projectId: '333',
          triggerStatusIds: ['status_planned', 'status_triaged'],
        },
      ])
    })
  })

  describe('what saving a rule must not do (V17)', () => {
    it('writes nothing but mapping rows — no post is touched, no event is emitted', async () => {
      // A rule that reached back over existing posts would open an issue for
      // every already-triaged post at once, in a tracker where undoing that is
      // not one click. The reversible choice is to do nothing: whoever wants an
      // issue for an old post sets its status again.
      const before = await testDb.select({ id: events.id }).from(events)
      await insertLegacyCatchAll()

      await save('board_asbs', '222', ['status_triaged'])

      const after = await testDb.select({ id: events.id }).from(events)
      expect(after).toHaveLength(before.length)
    })
  })
})
