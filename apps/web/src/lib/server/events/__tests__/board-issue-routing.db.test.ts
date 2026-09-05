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
 */
import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { boards, posts, postStatuses, principal, integrations } from '@/lib/server/db'
import { integrationEventMappings } from '@/lib/server/db'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
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

const fixture = await createDbTestFixture({
  probe: async (db) => void (await db.select({ id: posts.statusId }).from(posts).limit(0)),
})

const TRIAGED = 'triaged'

interface Seed {
  boards: Record<string, string>
  statuses: Record<string, string>
  post: (board: string, status: string) => Promise<string>
}

async function seed(): Promise<Seed> {
  const tag = `routing-${Math.random().toString(36).slice(2, 8)}`

  const [integration] = await testDb
    .insert(integrations)
    .values({ integrationType: tag, status: 'active', config: {}, secrets: 'sealed-blob' })
    .returning({ id: integrations.id })

  // `principal.created_at` is not null and has no default in the schema.
  const [author] = await testDb
    .insert(principal)
    .values({ createdAt: new Date() })
    .returning({ id: principal.id })

  const boardIds: Record<string, string> = {}
  for (const name of ['datenschutz', 'asbs', 'gwg', 'unrouted']) {
    const [row] = await testDb
      .insert(boards)
      .values({ slug: `${tag}-${name}`, name })
      .returning({ id: boards.id })
    boardIds[name] = row.id
  }

  const statusIds: Record<string, string> = {}
  for (const name of ['new', TRIAGED]) {
    const [row] = await testDb
      .insert(postStatuses)
      .values({ name, slug: `${tag}-${name}` })
      .returning({ id: postStatuses.id })
    statusIds[name] = row.id
  }

  for (const [board, projectId] of [
    ['datenschutz', '111'],
    ['asbs', '222'],
    ['gwg', '333'],
  ] as const) {
    await testDb.insert(integrationEventMappings).values({
      integrationId: integration.id,
      eventType: 'post.status_changed',
      actionType: 'send_message',
      targetKey: boardIds[board],
      actionConfig: { channelId: projectId },
      filters: { boardIds: [boardIds[board]], statusIds: [statusIds[TRIAGED]] },
      enabled: true,
    })
  }

  return {
    boards: boardIds,
    statuses: statusIds,
    async post(board: string, status: string) {
      const [row] = await testDb
        .insert(posts)
        .values({
          boardId: boardIds[board] as never,
          title: 'probe',
          content: 'probe',
          principalId: author.id as never,
          statusId: statusIds[status] as never,
        })
        .returning({ id: posts.id })
      return row.id
    },
  }
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

describe.skipIf(!fixture.available)('the resolver reads the status from the post row', () => {
  let s: Seed

  beforeEach(async () => {
    await fixture.begin()
    s = await seed()
  })
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  it('routes a triaged post to its own board project and no other (V1)', async () => {
    const postId = await s.post('asbs', TRIAGED)

    const targets = await integrationResolver.resolve(
      statusChangedEvent(postId, s.boards.asbs, 'Triaged')
    )

    expect(projectsOf(targets)).toEqual(['222'])
  })

  it('routes nothing for a post that has not reached a triggering status (V4)', async () => {
    const postId = await s.post('gwg', 'new')

    const targets = await integrationResolver.resolve(
      statusChangedEvent(postId, s.boards.gwg, 'New')
    )

    expect(targets).toEqual([])
  })

  it('routes nothing for a board with no rule of its own (V2)', async () => {
    const postId = await s.post('unrouted', TRIAGED)

    const targets = await integrationResolver.resolve(
      statusChangedEvent(postId, s.boards.unrouted, 'Triaged')
    )

    expect(targets).toEqual([])
  })

  it('hands the hook the decrypted access token, not the sealed blob', async () => {
    const postId = await s.post('asbs', TRIAGED)

    const targets = await integrationResolver.resolve(
      statusChangedEvent(postId, s.boards.asbs, 'Triaged')
    )

    expect(targets[0].config.accessToken).toBe('token-from-sealed-blob')
  })

  it('ignores the status name the event carries, whatever it says (V7)', async () => {
    const postId = await s.post('datenschutz', TRIAGED)

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
