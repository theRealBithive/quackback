/**
 * Board→project routing through the real resolver, against real Postgres.
 *
 * The pure decision is pinned in `board-issue-routing.test.ts`. This file
 * covers the part that cannot be pure: the resolver reads the post's status
 * **id** from its row, because the event payload only carries the status name.
 * A rule that matched on the name would keep working right up until someone
 * renames a status, and then stop silently.
 *
 * Contract (the plan's numbering; the same list as the pure module):
 *
 *   V1  A post creates an issue only in the GitLab project recorded for its
 *       board — in no other.
 *   V2  A board with no project recorded creates no issue. There is no
 *       catch-all project.
 *   V4  An issue is created only once the post reaches one of the triggering
 *       statuses recorded for its board. A post merely arriving creates none.
 *   V7  Renaming a status does not change which posts create an issue.
 *
 * `DATABASE_URL` points every worktree on this machine at one shared
 * `quackback_test`, and `integrations.integration_type` is globally unique — so
 * every row here is minted under a type nobody else uses and dropped again.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { fromUuid, toUuid } from '@quackback/ids'
import { testDb, testSql, closeHarness } from '@/lib/server/jobs/__tests__/harness'

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

// The mapping cache would hand one test's rows to the next.
vi.mock('@/lib/server/cache', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/cache')>()),
  cacheGet: async () => null,
  cacheSet: async () => undefined,
}))

vi.mock('../hook-context', () => ({
  buildHookContext: async () => ({ portalBaseUrl: 'https://portal.example' }),
}))

// Real encryption needs the instance key; what matters here is that the token
// reaches the target, not how it was unwrapped.
vi.mock('@/lib/server/integrations/encryption', () => ({
  decryptSecrets: (blob: string) => ({ accessToken: `token-from-${blob}` }),
}))

import { integrationResolver } from '../resolvers/integration.resolver'
import type { DomainEvent } from '../envelope'

/** Unique per run: the integrations table allows one row per type instance-wide. */
const INTEGRATION_TYPE = `routing-probe-${Math.random().toString(36).slice(2, 10)}`

interface Seed {
  integrationId: string
  boards: Record<string, string>
  statuses: Record<string, string>
  postId: (board: string, status: string) => Promise<string>
}

async function seed(): Promise<Seed> {
  const sql = testSql()
  const [integration] = await sql`
    insert into integrations (id, integration_type, status, config, secrets)
    values (gen_random_uuid(), ${INTEGRATION_TYPE}, 'active', '{}'::jsonb, 'sealed-blob')
    returning id`
  const [principal] = await sql`
    insert into principal (id, created_at) values (gen_random_uuid(), now()) returning id`

  const boards: Record<string, string> = {}
  for (const name of ['datenschutz', 'asbs', 'gwg', 'unrouted']) {
    const slug = `${INTEGRATION_TYPE}-${name}`
    const [row] = await sql`
      insert into boards (id, slug, name) values (gen_random_uuid(), ${slug}, ${name})
      returning id`
    boards[name] = fromUuid('board', row.id)
  }

  const statuses: Record<string, string> = {}
  for (const name of ['new', 'triaged']) {
    const slug = `${INTEGRATION_TYPE}-${name}`
    const [row] = await sql`
      insert into post_statuses (id, name, slug) values (gen_random_uuid(), ${name}, ${slug})
      returning id`
    statuses[name] = fromUuid('post_status', row.id)
  }

  return {
    integrationId: integration.id,
    boards,
    statuses,
    async postId(board: string, status: string) {
      const [row] = await sql`
        insert into posts (id, board_id, title, content, principal_id, status_id)
        values (gen_random_uuid(), ${toUuid(boards[board])}, 'probe', 'probe', ${principal.id},
                ${toUuid(statuses[status])})
        returning id`
      return fromUuid('post', row.id)
    },
  }
}

/** One board→project rule, exactly as the write path stores it. */
async function addRule(s: Seed, board: string, projectId: string, status: string): Promise<void> {
  await testSql()`
    insert into integration_event_mappings
      (id, integration_id, event_type, action_type, target_key, action_config, filters, enabled)
    values (gen_random_uuid(), ${s.integrationId}, 'post.status_changed', 'send_message',
            ${s.boards[board]}, ${testSql().json({ channelId: projectId })},
            ${testSql().json({ boardIds: [s.boards[board]], statusIds: [s.statuses[status]] })},
            true)`
}

function statusChangedEvent(postId: string, boardId: string, newStatus: string): DomainEvent {
  return {
    eventId: 'evt_probe' as never,
    seq: 1n,
    type: 'post.status_changed',
    entityType: 'post',
    entityId: postId,
    actorType: 'user',
    payload: { post: { id: postId, title: 'probe', boardId, boardSlug: 'probe' }, newStatus },
    context: {} as never,
    schemaVersion: 1,
    occurredAt: new Date(),
  }
}

function projectsOf(targets: { target: unknown }[]): string[] {
  return targets.map((t) => (t.target as { channelId: string }).channelId)
}

let s: Seed

beforeAll(async () => {
  s = await seed()
  await addRule(s, 'datenschutz', '111', 'triaged')
  await addRule(s, 'asbs', '222', 'triaged')
  await addRule(s, 'gwg', '333', 'triaged')
})

afterAll(async () => {
  const sql = testSql()
  await sql`delete from integrations where integration_type = ${INTEGRATION_TYPE}`
  await sql`delete from posts where board_id in (select id from boards where slug like ${INTEGRATION_TYPE + '%'})`
  await sql`delete from boards where slug like ${INTEGRATION_TYPE + '%'}`
  await sql`delete from post_statuses where slug like ${INTEGRATION_TYPE + '%'}`
  await closeHarness()
})

describe('the resolver reads the status from the post row', () => {
  it('routes a triaged post to its own board project and no other (V1)', async () => {
    const postId = await s.postId('asbs', 'triaged')

    const targets = await integrationResolver.resolve(
      statusChangedEvent(postId, s.boards.asbs, 'Triaged')
    )

    expect(projectsOf(targets)).toEqual(['222'])
  })

  it('routes nothing for a post that has not reached a triggering status (V4)', async () => {
    const postId = await s.postId('gwg', 'new')

    const targets = await integrationResolver.resolve(
      statusChangedEvent(postId, s.boards.gwg, 'New')
    )

    expect(targets).toEqual([])
  })

  it('routes nothing for a board with no rule of its own (V2)', async () => {
    const postId = await s.postId('unrouted', 'triaged')

    const targets = await integrationResolver.resolve(
      statusChangedEvent(postId, s.boards.unrouted, 'Triaged')
    )

    expect(targets).toEqual([])
  })

  it('hands the hook the decrypted access token, not the sealed blob', async () => {
    const postId = await s.postId('asbs', 'triaged')

    const targets = await integrationResolver.resolve(
      statusChangedEvent(postId, s.boards.asbs, 'Triaged')
    )

    expect(targets[0].config.accessToken).toBe('token-from-sealed-blob')
  })

  it('ignores the status name the event carries, whatever it says (V7)', async () => {
    const postId = await s.postId('datenschutz', 'triaged')

    // The row says triaged; the payload is renamed under the resolver's feet.
    // Routing must follow the row.
    for (const renamed of ['Triaged', 'In Bearbeitung', '', 'new']) {
      const targets = await integrationResolver.resolve(
        statusChangedEvent(postId, s.boards.datenschutz, renamed)
      )
      expect(projectsOf(targets), `payload said "${renamed}"`).toEqual(['111'])
    }
  })
})
