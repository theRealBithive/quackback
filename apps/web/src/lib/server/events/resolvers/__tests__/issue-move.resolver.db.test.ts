/**
 * The board change resolved into a move target, against real Postgres.
 *
 * Contract (domain language, confirmed before these tests were written):
 *
 *   V11 A post that moves to a board with a different project takes its issue
 *       with it, and the link afterwards points at the issue in the new
 *       project.
 *   V12 A post that moves to a board with the same project leaves the issue
 *       untouched.
 *   V14 A post that moves to a board with no project leaves the issue where it
 *       is, and the link stays valid.
 *
 * The decision itself is pinned without a database in
 * `issue-move-policy.test.ts`. What is worth a real database here is the pair
 * of reads in front of it: which project the destination board is registered
 * for — a routing rule row, not a column — and which links the post has. Both
 * are places where a wrong query returns an empty set, and an empty set looks
 * exactly like "nothing to move".
 *
 * The contract was agreed in German and is written here in English, which is
 * the language of this repository.
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import {
  boards,
  posts,
  principal,
  integrations,
  integrationEventMappings,
  postExternalLinks,
  eq,
} from '@/lib/server/db'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

import { issueMoveResolver } from '../issue-move.resolver'

const fixture = await createDbTestFixture({
  probe: async (db) =>
    void (await db
      .select({ id: integrationEventMappings.id })
      .from(integrationEventMappings)
      .limit(0)),
})

const DATENSCHUTZ_PROJECT = '101'
const ASBS_PROJECT = '202'

interface World {
  postId: string
  datenschutzBoardId: string
  asbsBoardId: string
  ruleFreeBoardId: string
  integrationId: string
}

/** Two boards with a project each, one deliberately without, one linked post. */
async function world(opts: { linkScope?: string | null } = {}): Promise<World> {
  const tag = `move-resolver-${Math.random().toString(36).slice(2, 8)}`

  const board = async (slug: string, name: string) => {
    const [row] = await testDb
      .insert(boards)
      .values({ slug: `${tag}-${slug}`, name })
      .returning({ id: boards.id })
    return row.id as string
  }
  const datenschutz = await board('ds', 'Datenschutzkulpix')
  const asbs = await board('asbs', 'ASBS-Kulpix')
  const ruleFree = await board('gwg', 'GWG-Kulpix')

  const [author] = await testDb
    .insert(principal)
    .values({ createdAt: new Date(), displayName: 'Alex Beispiel' })
    .returning({ id: principal.id })

  const [post] = await testDb
    .insert(posts)
    .values({
      boardId: datenschutz as never,
      principalId: author.id as never,
      title: 'Probe',
      content: 'x',
    })
    .returning({ id: posts.id })

  const [integration] = await testDb
    .insert(integrations)
    .values({ integrationType: 'gitlab', status: 'active', config: {} })
    .returning({ id: integrations.id })

  const rule = async (boardId: string, projectId: string) => {
    await testDb.insert(integrationEventMappings).values({
      integrationId: integration.id as never,
      actionType: 'send_message',
      eventType: 'post.status_changed',
      targetKey: boardId,
      enabled: true,
      actionConfig: { channelId: projectId },
      filters: { boardIds: [boardId], statusIds: ['status_planned'] },
    })
  }
  await rule(datenschutz, DATENSCHUTZ_PROJECT)
  await rule(asbs, ASBS_PROJECT)

  await testDb.insert(postExternalLinks).values({
    postId: post.id as never,
    integrationId: integration.id as never,
    integrationType: 'gitlab',
    externalId: '42',
    externalScope: opts.linkScope === undefined ? DATENSCHUTZ_PROJECT : opts.linkScope,
    externalUrl: 'https://gitlab.example.com/group/datenschutz/-/issues/42',
    status: 'active',
  })

  return {
    postId: post.id as string,
    datenschutzBoardId: datenschutz,
    asbsBoardId: asbs,
    ruleFreeBoardId: ruleFree,
    integrationId: integration.id as string,
  }
}

function boardChangedEvent(w: World, toBoardId: string) {
  return {
    eventId: 'evt_probe',
    seq: 1n,
    type: 'post.board_changed',
    entityType: 'post',
    entityId: w.postId,
    actorType: 'user' as const,
    payload: {
      post: { id: w.postId, title: 'Probe', boardId: toBoardId, boardSlug: 'x' },
      fromBoardId: w.datenschutzBoardId,
      toBoardId,
    },
    context: { depth: 0 },
    schemaVersion: 1,
    occurredAt: new Date(),
  }
}

describe.skipIf(!fixture.available)('issueMoveResolver', () => {
  beforeEach(fixture.begin)
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  it('is interested in a board change and in nothing else', () => {
    expect(issueMoveResolver.interestedIn('post.board_changed')).toBe(true)
    expect(issueMoveResolver.interestedIn('post.status_changed')).toBe(false)
    expect(issueMoveResolver.interestedIn('post.created')).toBe(false)
  })

  it('targets the project of the board the post moved to (V11)', async () => {
    const w = await world()

    const targets = await issueMoveResolver.resolve(boardChangedEvent(w, w.asbsBoardId) as never)

    expect(targets).toHaveLength(1)
    expect(targets[0].target).toMatchObject({
      externalId: '42',
      fromProjectId: DATENSCHUTZ_PROJECT,
      toProjectId: ASBS_PROJECT,
    })
    expect(targets[0].config).toEqual({ integrationId: w.integrationId })
  })

  it('produces nothing when the destination board has no project (V14)', async () => {
    const w = await world()

    const targets = await issueMoveResolver.resolve(
      boardChangedEvent(w, w.ruleFreeBoardId) as never
    )

    expect(targets).toEqual([])
  })

  it('produces nothing when the destination is the project the issue is in (V12)', async () => {
    const w = await world()

    const targets = await issueMoveResolver.resolve(
      boardChangedEvent(w, w.datenschutzBoardId) as never
    )

    expect(targets).toEqual([])
  })

  it('produces nothing for a link whose project is unknown (V14)', async () => {
    const w = await world({ linkScope: null })

    const targets = await issueMoveResolver.resolve(boardChangedEvent(w, w.asbsBoardId) as never)

    expect(targets).toEqual([])
  })

  it('produces nothing for a post with no links', async () => {
    const w = await world()
    await testDb.delete(postExternalLinks)

    const targets = await issueMoveResolver.resolve(boardChangedEvent(w, w.asbsBoardId) as never)

    expect(targets).toEqual([])
  })

  it('produces nothing for an event with no payload at all', async () => {
    const w = await world()
    const event = boardChangedEvent(w, w.asbsBoardId)
    const withoutPayload = { ...event, payload: undefined }

    expect(await issueMoveResolver.resolve(withoutPayload as never)).toEqual([])
  })

  it('reads the rule of the board that was moved to, not another one (V11)', async () => {
    // The lookup is by target key. Reading whichever rule came back first
    // would move the issue into another product's project.
    const w = await world()

    const targets = await issueMoveResolver.resolve(boardChangedEvent(w, w.asbsBoardId) as never)

    expect((targets[0].target as { toProjectId: string }).toProjectId).toBe(ASBS_PROJECT)
  })

  it('ignores a disabled rule (V14)', async () => {
    const w = await world()
    await testDb
      .update(integrationEventMappings)
      .set({ enabled: false })
      .where(eq(integrationEventMappings.targetKey, w.asbsBoardId))

    const targets = await issueMoveResolver.resolve(boardChangedEvent(w, w.asbsBoardId) as never)

    expect(targets).toEqual([])
  })

  it('ignores a rule whose integration is no longer active (V14)', async () => {
    const w = await world()
    await testDb
      .update(integrations)
      .set({ status: 'error' })
      .where(eq(integrations.id, w.integrationId as never))

    const targets = await issueMoveResolver.resolve(boardChangedEvent(w, w.asbsBoardId) as never)

    expect(targets).toEqual([])
  })

  it('ignores a link that is no longer active (V14)', async () => {
    const w = await world()
    await testDb.update(postExternalLinks).set({ status: 'removed' })

    const targets = await issueMoveResolver.resolve(boardChangedEvent(w, w.asbsBoardId) as never)

    expect(targets).toEqual([])
  })

  it('produces nothing when the event names no destination board', async () => {
    const w = await world()
    const event = boardChangedEvent(w, w.asbsBoardId)
    const withoutBoard = { ...event, payload: { ...event.payload, toBoardId: undefined } }

    expect(await issueMoveResolver.resolve(withoutBoard as never)).toEqual([])
  })
})
