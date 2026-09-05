/**
 * The two reads the GitLab hook makes, against real Postgres.
 *
 * Contract (the plan's numbering):
 *
 *   V3  A post that already has an active GitLab link gets no second issue —
 *       however often it reaches the triggering state again.
 *   V4  An issue is created only once the post reaches one of the triggering
 *       statuses recorded for its board. A post merely arriving creates none.
 *
 * What is worth testing for real rather than against a stub is the join: the
 * author's name is not on the post, it is on the principal, and a post by a
 * principal with no display name still has to produce an issue rather than
 * fall out of an inner join.
 */
import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { boards, posts, principal, postExternalLinks } from '@/lib/server/db'

const { warn } = vi.hoisted(() => ({ warn: vi.fn() }))
vi.mock('@/lib/server/logger', () => ({
  logger: { child: () => ({ warn, debug: vi.fn(), info: vi.fn(), error: vi.fn() }) },
}))

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

import { loadIssueSource, hasActiveGitLabLink } from '../post-source'

const fixture = await createDbTestFixture({
  probe: async (db) =>
    void (await db.select({ id: postExternalLinks.id }).from(postExternalLinks).limit(0)),
})

interface Seed {
  boardSlug: string
  namedAuthorPost: string
  namelessAuthorPost: string
  linkedPost: string
}

async function seed(): Promise<Seed> {
  const tag = `post-source-${Math.random().toString(36).slice(2, 8)}`

  const [board] = await testDb
    .insert(boards)
    .values({ slug: tag, name: 'Probe' })
    .returning({ id: boards.id })

  // `principal.created_at` is not null and has no default in the schema.
  const [named] = await testDb
    .insert(principal)
    .values({
      createdAt: new Date(),
      displayName: 'Alex Beispiel',
      contactEmail: 'alex@example.com',
    })
    .returning({ id: principal.id })
  const [nameless] = await testDb
    .insert(principal)
    .values({ createdAt: new Date() })
    .returning({ id: principal.id })

  const post = async (principalId: string, title: string) => {
    const [row] = await testDb
      .insert(posts)
      .values({
        boardId: board.id as never,
        title,
        content: '<p>body</p>',
        principalId: principalId as never,
      })
      .returning({ id: posts.id })
    return row.id
  }

  const namedAuthorPost = await post(named.id, 'Named')
  const namelessAuthorPost = await post(nameless.id, 'Nameless')
  const linkedPost = await post(named.id, 'Linked')

  await testDb.insert(postExternalLinks).values({
    postId: linkedPost as never,
    integrationType: 'gitlab',
    externalId: '42',
    status: 'active',
    origin: 'event',
  })

  return { boardSlug: tag, namedAuthorPost, namelessAuthorPost, linkedPost }
}

describe.skipIf(!fixture.available)('the reads the GitLab hook makes', () => {
  let s: Seed

  beforeEach(async () => {
    warn.mockClear()
    await fixture.begin()
    s = await seed()
  })
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  describe('loading the post an issue is written from (V4)', () => {
    it('reads the body and the author, neither of which the event carries', async () => {
      const source = await loadIssueSource(s.namedAuthorPost)

      expect(source).toEqual({
        postId: s.namedAuthorPost,
        title: 'Named',
        content: '<p>body</p>',
        boardSlug: s.boardSlug,
        authorName: 'Alex Beispiel',
        authorEmail: 'alex@example.com',
      })
    })

    it('still reads a post whose author has no name on record', async () => {
      const source = await loadIssueSource(s.namelessAuthorPost)

      expect(source?.title).toBe('Nameless')
      expect(source?.authorName).toBeNull()
    })

    it('reads nothing for a post that is gone', async () => {
      const gone = 'post_00000000000000000000000000'

      expect(await loadIssueSource(gone)).toBeNull()
    })

    it('says in the log which post it gave up on', async () => {
      // The only trace an operator gets. Nothing fails, no issue appears, and
      // without the post id in the line there is nothing to search for.
      const gone = 'post_00000000000000000000000000'

      await loadIssueSource(gone)

      expect(warn).toHaveBeenCalledTimes(1)
      expect(warn.mock.calls[0][0]).toEqual({ post_id: gone })
      expect(warn.mock.calls[0][1]).toContain('not creating an issue')
    })
  })

  describe('finding an issue the post already has (V3)', () => {
    it('finds an active GitLab link', async () => {
      expect(await hasActiveGitLabLink(s.linkedPost)).toBe(true)
    })

    it('finds none for a post that has never been linked', async () => {
      expect(await hasActiveGitLabLink(s.namedAuthorPost)).toBe(false)
    })

    it('ignores a link that is no longer active', async () => {
      const { eq } = await import('@/lib/server/db')
      await testDb
        .update(postExternalLinks)
        .set({ status: 'archived' })
        .where(eq(postExternalLinks.postId, s.linkedPost as never))

      expect(await hasActiveGitLabLink(s.linkedPost)).toBe(false)
    })

    it('ignores a link that belongs to another tracker', async () => {
      await testDb.insert(postExternalLinks).values({
        postId: s.namedAuthorPost as never,
        integrationType: 'github',
        externalId: '99',
        status: 'active',
        origin: 'event',
      })

      expect(await hasActiveGitLabLink(s.namedAuthorPost)).toBe(false)
    })
  })
})
