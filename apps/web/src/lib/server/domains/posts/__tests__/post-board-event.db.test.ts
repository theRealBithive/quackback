/**
 * The event a board change raises, against real Postgres.
 *
 * Contract (domain language, confirmed before these tests were written):
 *
 *   V15 A board change causes at most one move; a redelivered report of the
 *       same change does not move a second time.
 *   V16 Someone who may not move a post to another board triggers no move in
 *       GitLab either.
 *
 * V16 is a guarantee about the caller: authorization sits in the action layer
 * above `changeBoard`, so what has to be true HERE is that the event exists
 * only when the move did. That is why the row update and the emission share one
 * transaction — a move that never happens, or that fails, leaves nothing for a
 * resolver to act on. The tests below are that property from both sides: a real
 * move writes exactly one event, and everything that is not a real move writes
 * none.
 *
 * The contract was agreed in German and is written here in English, which is
 * the language of this repository.
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { boards, posts, principal, events, eq, and } from '@/lib/server/db'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

import { changeBoard } from '../post.board'

const fixture = await createDbTestFixture({
  probe: async (db) => void (await db.select({ id: events.id }).from(events).limit(0)),
})

interface Seed {
  postId: string
  fromBoardId: string
  toBoardId: string
  actorPrincipalId: string
}

async function seed(): Promise<Seed> {
  const tag = `board-event-${Math.random().toString(36).slice(2, 8)}`

  const [from] = await testDb
    .insert(boards)
    .values({ slug: `${tag}-a`, name: 'Datenschutzkulpix' })
    .returning({ id: boards.id })
  const [to] = await testDb
    .insert(boards)
    .values({ slug: `${tag}-b`, name: 'ASBS-Kulpix' })
    .returning({ id: boards.id })

  const [author] = await testDb
    .insert(principal)
    .values({ createdAt: new Date(), displayName: 'Alex Beispiel' })
    .returning({ id: principal.id })

  const [post] = await testDb
    .insert(posts)
    .values({
      boardId: from.id as never,
      principalId: author.id as never,
      title: 'Probe',
      content: 'x',
    })
    .returning({ id: posts.id })

  return {
    postId: post.id as string,
    fromBoardId: from.id as string,
    toBoardId: to.id as string,
    actorPrincipalId: author.id as string,
  }
}

async function boardChangedEvents(postId: string) {
  return testDb
    .select({ payload: events.payload, entityId: events.entityId, actorType: events.actorType })
    .from(events)
    .where(and(eq(events.type, 'post.board_changed'), eq(events.entityId, postId)))
}

describe.skipIf(!fixture.available)('changeBoard', () => {
  beforeEach(fixture.begin)
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  it('raises exactly one event naming both boards', async () => {
    const s = await seed()

    await changeBoard(s.postId as never, s.toBoardId as never, {
      principalId: s.actorPrincipalId as never,
    })

    const raised = await boardChangedEvents(s.postId)
    expect(raised).toHaveLength(1)
    expect(raised[0].payload).toMatchObject({
      fromBoardId: s.fromBoardId,
      toBoardId: s.toBoardId,
      post: { id: s.postId, boardId: s.toBoardId },
    })
  })

  it('moves the post', async () => {
    const s = await seed()

    await changeBoard(s.postId as never, s.toBoardId as never, {
      principalId: s.actorPrincipalId as never,
    })

    const [row] = await testDb
      .select({ boardId: posts.boardId })
      .from(posts)
      .where(eq(posts.id, s.postId as never))
    expect(row.boardId).toBe(s.toBoardId)
  })

  it('raises nothing when the post is already on that board', async () => {
    // Not a move, so there is nothing to follow it — the early return has to
    // come before the emission, or a resolver fires on a change that is none.
    const s = await seed()

    await changeBoard(s.postId as never, s.fromBoardId as never, {
      principalId: s.actorPrincipalId as never,
    })

    expect(await boardChangedEvents(s.postId)).toEqual([])
  })

  it('raises nothing when the target board does not exist (V16)', async () => {
    const s = await seed()

    await expect(
      changeBoard(s.postId as never, 'board_01jqzz000000000000000000' as never, {
        principalId: s.actorPrincipalId as never,
      })
    ).rejects.toThrow()

    expect(await boardChangedEvents(s.postId)).toEqual([])
  })

  it('raises nothing when the post does not exist (V16)', async () => {
    const s = await seed()

    await expect(
      changeBoard('post_01jqzz000000000000000000' as never, s.toBoardId as never, {
        principalId: s.actorPrincipalId as never,
      })
    ).rejects.toThrow()

    expect(await boardChangedEvents(s.postId)).toEqual([])
  })

  it('names the actor on the event, so a later reaction can tell who moved it', async () => {
    const s = await seed()

    await changeBoard(s.postId as never, s.toBoardId as never, {
      principalId: s.actorPrincipalId as never,
    })

    const [raised] = await boardChangedEvents(s.postId)
    expect(raised.actorType).toBe('user')
  })
})
