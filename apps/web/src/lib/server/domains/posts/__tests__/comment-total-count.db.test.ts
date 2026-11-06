/**
 * Real-DB coverage for the comment heading's total.
 *
 * Root comments are paginated (DEFAULT_COMMENT_PAGE_SIZE), so a heading that
 * counts the loaded tree under-reports as soon as a thread has more than one
 * page. The server therefore reports how many comments the viewer can read.
 *
 * Contract (confirmed 2026-11-06):
 *
 * C1 The heading names how many comments the viewer can read on this post,
 *    replies included — however many of them are loaded on the page so far.
 * C2 It counts exactly what the viewer may see: a team member counts internal
 *    comments, a visitor does not; a person's own comment awaiting moderation
 *    counts for that person, other people's pending comments do not.
 * C3 A deleted comment does not count, even when it stays visible as a
 *    placeholder because it has replies; its replies do count.
 * C4 Comments on posts merged into this one count under the same visibility
 *    rules, as far as they appear in this thread.
 * C5 Loading more comments never changes the number.
 * C6 Writing a comment or a reply raises the number by one immediately; if the
 *    server rejects it, the number goes back.
 * C7 The portal post page, the admin post modal and the roadmap modal show the
 *    same number to the same viewer for the same post.
 *
 * C6 and the heading itself are covered in the client suites
 * (comments-section-total.test.tsx, comment-total-optimistic.test.tsx).
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fc from 'fast-check'
import {
  createId,
  type BoardId,
  type PostCommentId,
  type PostId,
  type PrincipalId,
  type UserId,
} from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { boards, eq, postComments, posts, principal, user } from '@/lib/server/db'
import { DEFAULT_BOARD_ACCESS, type BoardAccess } from '@/lib/shared/db-types'
import { ANONYMOUS_ACTOR, type Actor } from '@/lib/server/policy'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

import { getPublicPostDetail } from '../post.public.detail'
import { getPaginatedCommentsWithReplies } from '../post.query'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: postComments.id }).from(postComments).limit(0)
  },
})

const suffix = () => `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`

async function seedPrincipal(role: 'admin' | 'user'): Promise<PrincipalId> {
  const userId = createId('user') as UserId
  const principalId = createId('principal') as PrincipalId
  await testDb.insert(user).values({ id: userId, name: `Person ${suffix()}` })
  await testDb.insert(principal).values({
    id: principalId,
    userId,
    role,
    type: 'user',
    displayName: `Person ${suffix()}`,
    createdAt: new Date(),
  })
  return principalId
}

function teamActor(principalId: PrincipalId): Actor {
  return {
    principalId,
    role: 'admin',
    principalType: 'user',
    segmentIds: new Set(),
  }
}

function signedInActor(principalId: PrincipalId): Actor {
  return {
    principalId,
    role: 'user',
    principalType: 'user',
    segmentIds: new Set(),
  }
}

async function seedBoard(access: BoardAccess = DEFAULT_BOARD_ACCESS): Promise<BoardId> {
  const [board] = await testDb
    .insert(boards)
    .values({ slug: `count-${suffix()}`, name: 'Count board', access })
    .returning()
  return board.id
}

async function seedPost(boardId: BoardId, authorId: PrincipalId): Promise<PostId> {
  const [post] = await testDb
    .insert(posts)
    .values({ boardId, title: `Post ${suffix()}`, content: '', principalId: authorId })
    .returning()
  return post.id
}

interface CommentOptions {
  parentId?: PostCommentId
  isPrivate?: boolean
  moderationState?: 'published' | 'pending'
  deleted?: boolean
  createdAt?: Date
}

async function seedComment(
  postId: PostId,
  authorId: PrincipalId,
  options: CommentOptions = {}
): Promise<PostCommentId> {
  const [comment] = await testDb
    .insert(postComments)
    .values({
      postId,
      principalId: authorId,
      content: 'A comment',
      parentId: options.parentId ?? null,
      isTeamMember: false,
      isPrivate: options.isPrivate ?? false,
      moderationState: options.moderationState ?? 'published',
      deletedAt: options.deleted ? new Date() : null,
      ...(options.createdAt && { createdAt: options.createdAt }),
    })
    .returning()
  return comment.id
}

async function totalFor(postId: PostId, actor: Actor, limit?: number): Promise<number> {
  const detail = await getPublicPostDetail(postId, actor, { limit })
  if (!detail) throw new Error('post not visible to this actor')
  return detail.commentsTotalCount
}

interface CountedNode {
  deletedAt: Date | null
  replies: CountedNode[]
}

function countLiveInTree(nodes: CountedNode[]): number {
  let total = 0
  for (const node of nodes) {
    if (!node.deletedAt) total += 1
    total += countLiveInTree(node.replies)
  }
  return total
}

/** Walks every page of the portal thread and counts the live comments shown. */
async function countShownAcrossAllPages(postId: PostId, actor: Actor, limit: number) {
  let cursor: string | null = null
  let shown = 0
  const totalsSeen: number[] = []
  for (let page = 0; page < 100; page += 1) {
    const detail = await getPublicPostDetail(postId, actor, { limit, cursor })
    if (!detail) throw new Error('post not visible to this actor')
    shown += countLiveInTree(detail.comments as unknown as CountedNode[])
    totalsSeen.push(detail.commentsTotalCount)
    if (!detail.commentsHasMore) break
    cursor = detail.commentsNextCursor
  }
  return { shown, totalsSeen }
}

const TEAM_ONLY_ACCESS: BoardAccess = {
  ...DEFAULT_BOARD_ACCESS,
  view: 'team',
  vote: 'team',
  submit: 'team',
  comment: 'team',
}

describe.skipIf(!fixture.available)('comment heading total (real DB)', () => {
  beforeEach(fixture.begin)
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  it('counts every root and reply, not only the first page (C1)', async () => {
    const author = await seedPrincipal('user')
    const postId = await seedPost(await seedBoard(), author)
    const firstRoot = await seedComment(postId, author)
    await seedComment(postId, author, { parentId: firstRoot })
    await seedComment(postId, author)
    await seedComment(postId, author)

    expect(await totalFor(postId, ANONYMOUS_ACTOR, 1)).toBe(4)
    expect(await totalFor(postId, ANONYMOUS_ACTOR)).toBe(4)
  })

  it('counts internal comments for the team only (C2)', async () => {
    const author = await seedPrincipal('user')
    const teammate = await seedPrincipal('admin')
    const postId = await seedPost(await seedBoard(), author)
    const root = await seedComment(postId, author)
    await seedComment(postId, teammate, { isPrivate: true })
    await seedComment(postId, teammate, { parentId: root, isPrivate: true })

    expect(await totalFor(postId, ANONYMOUS_ACTOR)).toBe(1)
    expect(await totalFor(postId, signedInActor(author))).toBe(1)
    expect(await totalFor(postId, teamActor(teammate))).toBe(3)
  })

  it('counts a pending comment for its author and nobody else outside the team (C2)', async () => {
    const author = await seedPrincipal('user')
    const otherPerson = await seedPrincipal('user')
    const teammate = await seedPrincipal('admin')
    const postId = await seedPost(await seedBoard(), author)
    const root = await seedComment(postId, otherPerson)
    await seedComment(postId, author, { moderationState: 'pending' })
    await seedComment(postId, author, { parentId: root, moderationState: 'pending' })

    expect(await totalFor(postId, signedInActor(author))).toBe(3)
    expect(await totalFor(postId, signedInActor(otherPerson))).toBe(1)
    expect(await totalFor(postId, ANONYMOUS_ACTOR)).toBe(1)
    expect(await totalFor(postId, teamActor(teammate))).toBe(3)
  })

  it('does not count a reply the viewer cannot reach through its parent (C2)', async () => {
    const author = await seedPrincipal('user')
    const teammate = await seedPrincipal('admin')
    const postId = await seedPost(await seedBoard(), author)
    const internalRoot = await seedComment(postId, teammate, { isPrivate: true })
    await seedComment(postId, author, { parentId: internalRoot })

    expect(await totalFor(postId, ANONYMOUS_ACTOR)).toBe(0)
    expect(await totalFor(postId, teamActor(teammate))).toBe(2)
  })

  it('skips a deleted comment but keeps counting its replies (C3)', async () => {
    const author = await seedPrincipal('user')
    const teammate = await seedPrincipal('admin')
    const postId = await seedPost(await seedBoard(), author)
    const deletedRoot = await seedComment(postId, author, { deleted: true })
    await seedComment(postId, author, { parentId: deletedRoot })
    await seedComment(postId, author, { deleted: true })

    expect(await totalFor(postId, ANONYMOUS_ACTOR)).toBe(1)
    expect(await totalFor(postId, teamActor(teammate))).toBe(1)
  })

  it('counts merged comments only where the viewer may see the merged post (C4)', async () => {
    const author = await seedPrincipal('user')
    const teammate = await seedPrincipal('admin')
    const canonicalId = await seedPost(await seedBoard(), author)
    const publicSourceId = await seedPost(await seedBoard(), author)
    const teamSourceId = await seedPost(await seedBoard(TEAM_ONLY_ACCESS), author)
    for (const sourceId of [publicSourceId, teamSourceId]) {
      await testDb
        .update(posts)
        .set({ canonicalPostId: canonicalId, mergedAt: new Date() })
        .where(eq(posts.id, sourceId))
    }
    await seedComment(canonicalId, author)
    await seedComment(publicSourceId, author)
    await seedComment(teamSourceId, author)

    expect(await totalFor(canonicalId, ANONYMOUS_ACTOR)).toBe(2)
    expect(await totalFor(canonicalId, teamActor(teammate))).toBe(3)
  })

  it('reports the same total on every page (C5)', async () => {
    const author = await seedPrincipal('user')
    const postId = await seedPost(await seedBoard(), author)
    for (let index = 0; index < 5; index += 1) {
      const root = await seedComment(postId, author, {
        createdAt: new Date(Date.UTC(2026, 0, 1, 0, index)),
      })
      await seedComment(postId, author, { parentId: root })
    }

    const { shown, totalsSeen } = await countShownAcrossAllPages(postId, ANONYMOUS_ACTOR, 2)

    expect(totalsSeen).toHaveLength(3)
    expect(new Set(totalsSeen)).toEqual(new Set([10]))
    expect(shown).toBe(10)
  })

  it('gives the admin thread the same total the team sees in the portal (C7)', async () => {
    const author = await seedPrincipal('user')
    const teammate = await seedPrincipal('admin')
    const postId = await seedPost(await seedBoard(), author)
    const root = await seedComment(postId, author)
    await seedComment(postId, teammate, { parentId: root, isPrivate: true })
    await seedComment(postId, author, { moderationState: 'pending' })
    const deletedRoot = await seedComment(postId, author, { deleted: true })
    await seedComment(postId, author, { parentId: deletedRoot })

    const adminPage = await getPaginatedCommentsWithReplies(postId, {
      principalId: teammate,
      limit: 1,
    })

    expect(adminPage.totalCount).toBe(4)
    expect(adminPage.totalCount).toBe(await totalFor(postId, teamActor(teammate), 1))
  })

  it('gives an empty admin thread the same zero the portal shows (C7)', async () => {
    const author = await seedPrincipal('user')
    const teammate = await seedPrincipal('admin')
    const postId = await seedPost(await seedBoard(), author)

    const adminPage = await getPaginatedCommentsWithReplies(postId, { principalId: teammate })

    expect(adminPage.totalCount).toBe(0)
    expect(adminPage.totalCount).toBe(await totalFor(postId, teamActor(teammate)))
  })

  /**
   * Conservation law across every branch of the visibility rules: for any
   * thread and any viewer, the reported total equals the live comments the
   * viewer is shown once every page is loaded. The generator builds real
   * trees — replies under earlier comments, internal, pending by the viewer
   * or by someone else, deleted — so placeholders, unreachable replies and
   * multi-page threads are all reached.
   */
  it('equals the live comments shown across all pages, for any thread and viewer (C1, C2, C3, C5)', async () => {
    const viewerKinds = ['anonymous', 'author', 'other', 'team'] as const
    const commentArbitrary = fc.record({
      parentChoice: fc.option(fc.nat(), { nil: undefined }),
      writtenBy: fc.constantFrom('author', 'other', 'team'),
      isPrivate: fc.boolean(),
      pending: fc.boolean(),
      deleted: fc.boolean(),
    })

    await fc.assert(
      fc.asyncProperty(
        fc.array(commentArbitrary, { minLength: 0, maxLength: 12 }),
        fc.constantFrom(...viewerKinds),
        fc.integer({ min: 1, max: 4 }),
        async (thread, viewerKind, pageSize) => {
          const author = await seedPrincipal('user')
          const other = await seedPrincipal('user')
          const teammate = await seedPrincipal('admin')
          const postId = await seedPost(await seedBoard(), author)
          const writers = { author, other, team: teammate }

          const seeded: PostCommentId[] = []
          for (const [index, comment] of thread.entries()) {
            let parentId: PostCommentId | undefined
            if (comment.parentChoice !== undefined && seeded.length > 0) {
              parentId = seeded[comment.parentChoice % seeded.length]
            }
            const id = await seedComment(postId, writers[comment.writtenBy], {
              parentId,
              isPrivate: comment.isPrivate,
              moderationState: comment.pending ? 'pending' : 'published',
              deleted: comment.deleted,
              createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, index)),
            })
            seeded.push(id)
          }

          const viewers: Record<(typeof viewerKinds)[number], Actor> = {
            anonymous: ANONYMOUS_ACTOR,
            author: signedInActor(author),
            other: signedInActor(other),
            team: teamActor(teammate),
          }
          const viewer = viewers[viewerKind]
          const { shown, totalsSeen } = await countShownAcrossAllPages(postId, viewer, pageSize)

          for (const total of totalsSeen) {
            expect(total).toBe(shown)
          }
        }
      ),
      { numRuns: 40 }
    )
  })
})
