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
import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest'
import { fromUuid, toUuid } from '@quackback/ids'
import { testDb, testSql, closeHarness } from '@/lib/server/jobs/__tests__/harness'

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

vi.mock('@/lib/server/cache', () => ({
  cacheDel: async () => undefined,
  CACHE_KEYS: { INTEGRATION_MAPPINGS: 'integration-mappings' },
}))

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: new Proxy(
    {},
    {
      get(_t, prop) {
        const handle = testDb()
        const value = Reflect.get(handle as object, prop, handle)
        return typeof value === 'function' ? value.bind(handle) : value
      },
    }
  ),
}))

import {
  saveBoardRoutingRuleFn,
  removeBoardRoutingRuleFn,
  fetchBoardRoutingRulesFn,
} from '../integrations'

const INTEGRATION_TYPE = `routing-write-${Math.random().toString(36).slice(2, 10)}`

let integrationId: string

/** Every stored mapping row for the integration under test. */
async function storedRows(): Promise<
  { eventType: string; targetKey: string; actionConfig: unknown; filters: unknown }[]
> {
  const rows = await testSql()`
    select event_type, target_key, action_config, filters
    from integration_event_mappings
    where integration_id = ${toUuid(integrationId)}
    order by target_key, event_type`
  return rows.map((r) => ({
    eventType: r.event_type,
    targetKey: r.target_key,
    actionConfig: r.action_config,
    filters: r.filters,
  }))
}

/** The row every instance has before per-board routing: no filter, no target. */
async function insertLegacyCatchAll(): Promise<void> {
  await testSql()`
    insert into integration_event_mappings
      (id, integration_id, event_type, action_type, target_key, action_config, filters, enabled)
    values (gen_random_uuid(), ${toUuid(integrationId)}, 'post.created', 'send_message',
            'default', '{}'::jsonb, null, true)`
}

beforeEach(async () => {
  const sql = testSql()
  await sql`delete from integrations where integration_type = ${INTEGRATION_TYPE}`
  const [row] = await sql`
    insert into integrations (id, integration_type, status, config)
    values (gen_random_uuid(), ${INTEGRATION_TYPE}, 'active',
            ${JSON.stringify({ channelId: '999' })}::jsonb)
    returning id`
  integrationId = fromUuid('integration', row.id)
})

afterAll(async () => {
  await testSql()`delete from integrations where integration_type = ${INTEGRATION_TYPE}`
  await closeHarness()
})

const save = (boardId: string, projectId: string, triggerStatusIds: string[]) =>
  (saveBoardRoutingRuleFn as unknown as (a: unknown) => Promise<unknown>)({
    data: { integrationId, boardId, projectId, triggerStatusIds },
  })

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

    const rows = await storedRows()
    for (const row of rows) {
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

    await (removeBoardRoutingRuleFn as unknown as (a: unknown) => Promise<unknown>)({
      data: { integrationId, boardId: 'board_asbs' },
    })

    const rows = await storedRows()
    expect(rows.map((r) => r.targetKey)).toEqual(['board_gwg'])
  })
})

describe('reading the rules back', () => {
  it('reads exactly what was saved (V6)', async () => {
    await insertLegacyCatchAll()
    await save('board_asbs', '222', ['status_triaged'])
    await save('board_gwg', '333', ['status_planned', 'status_triaged'])

    const rules = await (fetchBoardRoutingRulesFn as unknown as (a: unknown) => Promise<unknown[]>)(
      { data: { integrationId } }
    )

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
    const sql = testSql()
    const before = await sql`select count(*)::int as n from events`
    await insertLegacyCatchAll()

    await save('board_asbs', '222', ['status_triaged'])

    const after = await sql`select count(*)::int as n from events`
    expect(after[0].n).toBe(before[0].n)
  })
})
