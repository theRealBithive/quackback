/**
 * The number the portal shows beside a board, measured against a real
 * database.
 *
 * Contract, confirmed before the implementation:
 *
 * V1 For the same viewer, the number shown beside a board equals the number of
 *    posts the board's default portal list holds. The two never disagree.
 * V2 A post whose status is in the "complete" or "closed" category is not
 *    counted.
 * V3 A post with an "active" status, or with no status at all, is counted.
 * V4 A post that was merged into another post is not counted. The post it was
 *    merged into counts once.
 * V5 A board with nothing to count is still listed, with zero.
 * V6 Everything the count already hid stays hidden: deleted posts, posts the
 *    viewer may not see because of moderation, and boards the viewer may not
 *    see. A team member's count includes what a team member sees.
 * V7 The count reads the status the way the list does: a status that was
 *    deleted but is still attached to a post does not change whether the post
 *    counts. Only its category does.
 *
 * Every board is found by its own id in the result, never by position and
 * never through the result's length: the suites share one database and run in
 * parallel, so other boards come and go while this file runs.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fc from 'fast-check'
import {
  createId,
  type BoardId,
  type PostId,
  type PostStatusId,
  type PrincipalId,
  type UserId,
} from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { boards, posts, postStatuses, principal, user } from '@/lib/server/db'
import { DEFAULT_BOARD_ACCESS } from '@/lib/shared/db-types'
import { ANONYMOUS_ACTOR, type Actor } from '@/lib/server/policy'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

import { listPublicBoardsWithStats } from '../board.public'
import { listPublicPostsWithVotesAndAvatars } from '../../posts/post.public'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db
      .select({ statusId: posts.statusId, canonicalPostId: posts.canonicalPostId })
      .from(posts)
      .limit(0)
    await db.select({ category: postStatuses.category }).from(postStatuses).limit(0)
  },
})

type Category = 'active' | 'complete' | 'closed'

const suffix = () => `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`

async function seedPrincipal(role: 'admin' | 'user'): Promise<PrincipalId> {
  const userId = createId('user') as UserId
  const principalId = createId('principal') as PrincipalId
  await testDb.insert(user).values({ id: userId, name: `${role} ${suffix()}` })
  await testDb.insert(principal).values({
    id: principalId,
    userId,
    role,
    type: 'user',
    displayName: role,
    createdAt: new Date(),
  })
  return principalId
}

async function seedBoard(
  view: 'anonymous' | 'team' = 'anonymous'
): Promise<{ id: BoardId; slug: string }> {
  const slug = `count-${suffix()}`
  const [board] = await testDb
    .insert(boards)
    .values({ slug, name: 'Counted board', access: { ...DEFAULT_BOARD_ACCESS, view } })
    .returning()
  return { id: board.id, slug }
}

async function seedStatus(category: Category, deleted = false): Promise<PostStatusId> {
  const [status] = await testDb
    .insert(postStatuses)
    .values({
      name: `${category} ${suffix()}`,
      slug: `count-${category}-${suffix()}`,
      category,
      deletedAt: deleted ? new Date() : null,
    })
    .returning()
  return status.id
}

interface PostSeed {
  boardId: BoardId
  authorId: PrincipalId
  statusId: PostStatusId | null
  mergedInto?: PostId
  deleted?: boolean
  pending?: boolean
}

async function seedPost(seed: PostSeed): Promise<PostId> {
  const [post] = await testDb
    .insert(posts)
    .values({
      boardId: seed.boardId,
      principalId: seed.authorId,
      title: 'Counted post',
      content: '',
      statusId: seed.statusId,
      canonicalPostId: seed.mergedInto ?? null,
      deletedAt: seed.deleted ? new Date() : null,
      moderationState: seed.pending ? 'pending' : 'published',
    })
    .returning()
  return post.id
}

function teamMember(principalId: PrincipalId): Actor {
  return { principalId, role: 'admin', principalType: 'user', segmentIds: new Set() }
}

/** The number the sidebar shows beside this board, or undefined when the board is not listed at all. */
async function countShown(boardId: BoardId, viewer: Actor): Promise<number | undefined> {
  const listed = await listPublicBoardsWithStats(viewer)
  return listed.find((board) => board.id === boardId)?.postCount
}

/** How many posts the board's default portal list holds for this viewer. */
async function postsListed(boardSlug: string, viewer: Actor): Promise<number> {
  const result = await listPublicPostsWithVotesAndAvatars({ actor: viewer, boardSlug, limit: 100 })
  return result.items.length
}

describe.skipIf(!fixture.available)('portal board count (real DB)', () => {
  beforeEach(fixture.begin)
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  it('counts active and unstatused posts and leaves complete and closed ones out (V2, V3, V1)', async () => {
    const author = await seedPrincipal('user')
    const board = await seedBoard()
    const active = await seedStatus('active')
    const complete = await seedStatus('complete')
    const closed = await seedStatus('closed')
    await seedPost({ boardId: board.id, authorId: author, statusId: active })
    await seedPost({ boardId: board.id, authorId: author, statusId: null })
    await seedPost({ boardId: board.id, authorId: author, statusId: complete })
    await seedPost({ boardId: board.id, authorId: author, statusId: closed })

    expect(await countShown(board.id, ANONYMOUS_ACTOR)).toBe(2)
    expect(await postsListed(board.slug, ANONYMOUS_ACTOR)).toBe(2)
  })

  it('does not count a post merged into another, and counts the target once (V4, V1)', async () => {
    const author = await seedPrincipal('user')
    const board = await seedBoard()
    const active = await seedStatus('active')
    const target = await seedPost({ boardId: board.id, authorId: author, statusId: active })
    await seedPost({ boardId: board.id, authorId: author, statusId: active, mergedInto: target })
    await seedPost({ boardId: board.id, authorId: author, statusId: null, mergedInto: target })

    expect(await countShown(board.id, ANONYMOUS_ACTOR)).toBe(1)
    expect(await postsListed(board.slug, ANONYMOUS_ACTOR)).toBe(1)
  })

  it('lists a board with no posts, and one whose posts are all closed, with zero (V5)', async () => {
    const author = await seedPrincipal('user')
    const empty = await seedBoard()
    const allClosed = await seedBoard()
    const closed = await seedStatus('closed')
    await seedPost({ boardId: allClosed.id, authorId: author, statusId: closed })
    await seedPost({ boardId: allClosed.id, authorId: author, statusId: closed })

    expect(await countShown(empty.id, ANONYMOUS_ACTOR)).toBe(0)
    expect(await countShown(allClosed.id, ANONYMOUS_ACTOR)).toBe(0)
  })

  it('keeps deleted and pending posts out for a visitor, and pending ones in for a team member (V6, V1)', async () => {
    const author = await seedPrincipal('user')
    const admin = await seedPrincipal('admin')
    const board = await seedBoard()
    const active = await seedStatus('active')
    await seedPost({ boardId: board.id, authorId: author, statusId: active })
    await seedPost({ boardId: board.id, authorId: author, statusId: active, deleted: true })
    await seedPost({ boardId: board.id, authorId: author, statusId: active, pending: true })

    expect(await countShown(board.id, ANONYMOUS_ACTOR)).toBe(1)
    expect(await postsListed(board.slug, ANONYMOUS_ACTOR)).toBe(1)
    expect(await countShown(board.id, teamMember(admin))).toBe(2)
    expect(await postsListed(board.slug, teamMember(admin))).toBe(2)
  })

  it('does not list a team-only board to a visitor at all (V6)', async () => {
    const author = await seedPrincipal('user')
    const admin = await seedPrincipal('admin')
    const board = await seedBoard('team')
    await seedPost({ boardId: board.id, authorId: author, statusId: null })

    expect(await countShown(board.id, ANONYMOUS_ACTOR)).toBeUndefined()
    expect(await countShown(board.id, teamMember(admin))).toBe(1)
  })

  it('decides by the status category even when the status itself was deleted (V7, V1)', async () => {
    const author = await seedPrincipal('user')
    const board = await seedBoard()
    const deletedActive = await seedStatus('active', true)
    const deletedComplete = await seedStatus('complete', true)
    await seedPost({ boardId: board.id, authorId: author, statusId: deletedActive })
    await seedPost({ boardId: board.id, authorId: author, statusId: deletedComplete })

    expect(await countShown(board.id, ANONYMOUS_ACTOR)).toBe(1)
    expect(await postsListed(board.slug, ANONYMOUS_ACTOR)).toBe(1)
  })

  interface GeneratedPost {
    category: 'none' | Category
    statusDeleted: boolean
    merged: boolean
    deleted: boolean
    pending: boolean
  }

  /** What the contract says should be counted, computed from the seed alone. */
  function isOpen(post: GeneratedPost): boolean {
    if (post.deleted || post.merged) return false
    return post.category === 'none' || post.category === 'active'
  }

  /**
   * Contract: V1, with V2–V4, V6 and V7 as the states the generator reaches.
   *
   * Each run seeds a fresh board with one anchor post (active, published,
   * unmerged: it is what the merged posts are merged into) and up to ten
   * generated posts, each with a status category (none, active, complete,
   * closed), a live or a deleted status row, merged or not, deleted or not,
   * pending moderation or not. Two viewers look at the board: an anonymous
   * visitor and a team member.
   *
   * Two assertions per viewer, and both are needed. The count is compared
   * against the default portal list, which is V1 as stated. It is also
   * compared against a number computed here from the seed alone, because the
   * list and the count now share their status predicate, and two users of one
   * helper agree with each other even when both are wrong.
   */
  it('shows beside a board exactly the number of posts its default list holds, for any mix of posts (V1)', async () => {
    const author = await seedPrincipal('user')
    const admin = await seedPrincipal('admin')
    const statusIds: Record<Category, { live: PostStatusId; deleted: PostStatusId }> = {
      active: { live: await seedStatus('active'), deleted: await seedStatus('active', true) },
      complete: { live: await seedStatus('complete'), deleted: await seedStatus('complete', true) },
      closed: { live: await seedStatus('closed'), deleted: await seedStatus('closed', true) },
    }

    const generatedPost: fc.Arbitrary<GeneratedPost> = fc.record({
      category: fc.constantFrom<'none' | Category>('none', 'active', 'complete', 'closed'),
      statusDeleted: fc.boolean(),
      merged: fc.boolean(),
      deleted: fc.boolean(),
      pending: fc.boolean(),
    })

    await fc.assert(
      fc.asyncProperty(fc.array(generatedPost, { maxLength: 10 }), async (generated) => {
        const board = await seedBoard()
        const anchor = await seedPost({
          boardId: board.id,
          authorId: author,
          statusId: statusIds.active.live,
        })
        for (const spec of generated) {
          let statusId: PostStatusId | null = null
          if (spec.category !== 'none') {
            statusId = statusIds[spec.category][spec.statusDeleted ? 'deleted' : 'live']
          }
          await seedPost({
            boardId: board.id,
            authorId: author,
            statusId,
            mergedInto: spec.merged ? anchor : undefined,
            deleted: spec.deleted,
            pending: spec.pending,
          })
        }

        const openPosts = generated.filter(isOpen)
        const expectedForVisitor = 1 + openPosts.filter((post) => !post.pending).length
        const expectedForTeam = 1 + openPosts.length

        expect(await countShown(board.id, ANONYMOUS_ACTOR)).toBe(expectedForVisitor)
        expect(await postsListed(board.slug, ANONYMOUS_ACTOR)).toBe(expectedForVisitor)
        expect(await countShown(board.id, teamMember(admin))).toBe(expectedForTeam)
        expect(await postsListed(board.slug, teamMember(admin))).toBe(expectedForTeam)
      })
    )
  }, 60_000)
})
