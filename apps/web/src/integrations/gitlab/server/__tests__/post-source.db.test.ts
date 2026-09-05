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
 *
 * DATABASE_URL points every worktree on this machine at one shared
 * quackback_test, so every row here is minted under a slug nobody else uses.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { fromUuid, toUuid } from '@quackback/ids'
import { testDb, testSql, closeHarness } from '@/lib/server/jobs/__tests__/harness'

const { warn } = vi.hoisted(() => ({ warn: vi.fn() }))
vi.mock('@/lib/server/logger', () => ({
  logger: { child: () => ({ warn, debug: vi.fn(), info: vi.fn(), error: vi.fn() }) },
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

import { loadIssueSource, hasActiveGitLabLink } from '../post-source'

const TAG = `post-source-${Math.random().toString(36).slice(2, 10)}`

let namedAuthorPost: string
let namelessAuthorPost: string
let linkedPost: string

beforeAll(async () => {
  const sql = testSql()
  const [board] = await sql`
    insert into boards (id, slug, name) values (gen_random_uuid(), ${TAG}, 'Probe') returning id`
  const [named] = await sql`
    insert into principal (id, created_at, display_name, contact_email)
    values (gen_random_uuid(), now(), 'Alex Beispiel', 'alex@example.com') returning id`
  const [nameless] = await sql`
    insert into principal (id, created_at) values (gen_random_uuid(), now()) returning id`

  const post = async (principalId: string, title: string) => {
    const [row] = await sql`
      insert into posts (id, board_id, title, content, principal_id)
      values (gen_random_uuid(), ${board.id}, ${title}, '<p>body</p>', ${principalId})
      returning id`
    return fromUuid('post', row.id)
  }

  namedAuthorPost = await post(named.id, 'Named')
  namelessAuthorPost = await post(nameless.id, 'Nameless')
  linkedPost = await post(named.id, 'Linked')

  await sql`
    insert into post_external_links (id, post_id, integration_type, external_id, status, origin)
    values (gen_random_uuid(), ${toUuid(linkedPost)}, 'gitlab', '42', 'active', 'event')`
})

afterAll(async () => {
  const sql = testSql()
  await sql`delete from posts where board_id in (select id from boards where slug = ${TAG})`
  await sql`delete from boards where slug = ${TAG}`
  await closeHarness()
})

describe('loading the post an issue is written from (V4)', () => {
  it('reads the body and the author, neither of which the event carries', async () => {
    const source = await loadIssueSource(namedAuthorPost)

    expect(source).toEqual({
      postId: namedAuthorPost,
      title: 'Named',
      content: '<p>body</p>',
      boardSlug: TAG,
      authorName: 'Alex Beispiel',
      authorEmail: 'alex@example.com',
    })
  })

  it('still reads a post whose author has no name on record', async () => {
    const source = await loadIssueSource(namelessAuthorPost)

    expect(source?.title).toBe('Nameless')
    expect(source?.authorName).toBeNull()
  })

  it('reads nothing for a post that is gone', async () => {
    const gone = fromUuid('post', '00000000-0000-7000-8000-000000000000')

    expect(await loadIssueSource(gone)).toBeNull()
  })

  it('says in the log which post it gave up on', async () => {
    // The only trace an operator gets. Nothing fails, no issue appears, and
    // without the post id in the line there is nothing to search for.
    warn.mockClear()
    const gone = fromUuid('post', '00000000-0000-7000-8000-000000000000')

    await loadIssueSource(gone)

    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0][0]).toEqual({ post_id: gone })
    expect(warn.mock.calls[0][1]).toContain('not creating an issue')
  })
})

describe('finding an issue the post already has (V3)', () => {
  it('finds an active GitLab link', async () => {
    expect(await hasActiveGitLabLink(linkedPost)).toBe(true)
  })

  it('finds none for a post that has never been linked', async () => {
    expect(await hasActiveGitLabLink(namedAuthorPost)).toBe(false)
  })

  it('ignores a link that is no longer active', async () => {
    const sql = testSql()
    await sql`update post_external_links set status = 'archived'
              where post_id = ${toUuid(linkedPost)}`

    expect(await hasActiveGitLabLink(linkedPost)).toBe(false)

    await sql`update post_external_links set status = 'active'
              where post_id = ${toUuid(linkedPost)}`
  })

  it('ignores a link that belongs to another tracker', async () => {
    const sql = testSql()
    await sql`
      insert into post_external_links (id, post_id, integration_type, external_id, status, origin)
      values (gen_random_uuid(), ${toUuid(namedAuthorPost)}, 'github', '99', 'active', 'event')`

    expect(await hasActiveGitLabLink(namedAuthorPost)).toBe(false)
  })
})
