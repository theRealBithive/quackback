/**
 * Moving a linked GitLab issue when its post moves to another product's board.
 *
 * Contract (domain language, confirmed before these tests were written):
 *
 *   V11 A post that moves to a board with a different project takes its issue
 *       with it, and the link afterwards points at the issue in the new
 *       project.
 *   V13 A post that had exactly one active GitLab link before the move has
 *       exactly one after it — never none, never two. That holds when the move
 *       fails as well.
 *   V15 A board change causes at most one move; a redelivered report of the
 *       same change does not move a second time.
 *
 * V13 is a conservation law, so every case below ends in the SAME unguarded
 * count — no `if` decides which assertion runs. That is the assertion that
 * would catch a handler deleting the old row before the new number is
 * confirmed, which is why the rewrite is one UPDATE and not a delete plus an
 * insert.
 *
 * ONE HONEST LIMIT. `gitlabFetch` is mocked, so what is proven here is the
 * request we send and what we do with an answer of a given shape. The response
 * fixture is built from GitLab's *documented* move response — `iid`,
 * `project_id`, `web_url` — and NOT from a delivery anyone has seen, unlike
 * `inbound.test.ts`, whose payload is a real 19.3 note hook. Until the request
 * in `sends the documented move request (V11)` has been run against the real
 * instance once, this suite proves the code, not the endpoint.
 *
 * The contract was agreed in German and is written here in English, which is
 * the language of this repository.
 */
import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import {
  boards,
  posts,
  principal,
  integrations,
  postExternalLinks,
  postActivity,
  eq,
} from '@/lib/server/db'

const { gitlabFetch } = vi.hoisted(() => ({ gitlabFetch: vi.fn() }))
vi.mock('../fetch', () => ({ gitlabFetch }))

const { getValidAccessToken } = vi.hoisted(() => ({
  getValidAccessToken: vi.fn(async () => 'a-token'),
}))
vi.mock('@/lib/server/integrations/token-refresh', () => ({ getValidAccessToken }))

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

import { gitlabIssueMoveHook } from '../issue-move'

const fixture = await createDbTestFixture({
  probe: async (db) =>
    void (await db.select({ id: postExternalLinks.id }).from(postExternalLinks).limit(0)),
})

/** GitLab's documented move response: the issue as it now exists in the target. */
function movedIssue(overrides: Record<string, unknown> = {}) {
  return {
    ok: true,
    status: 201,
    json: async () => ({
      id: 9001,
      iid: 7,
      project_id: 202,
      web_url: 'https://gitlab.example.com/group/asbs/-/issues/7',
      ...overrides,
    }),
  }
}

afterAll(fixture.close)

interface Seed {
  postId: string
  linkId: string
  integrationId: string
}

async function seed(): Promise<Seed> {
  const tag = `issue-move-${Math.random().toString(36).slice(2, 8)}`

  const [board] = await testDb
    .insert(boards)
    .values({ slug: tag, name: 'Probe' })
    .returning({ id: boards.id })

  // `principal.created_at` is not null and has no default; `posts.principal_id`
  // is not null, so the author has to exist before the post does.
  const [author] = await testDb
    .insert(principal)
    .values({ createdAt: new Date(), displayName: 'Alex Beispiel' })
    .returning({ id: principal.id })

  const [post] = await testDb
    .insert(posts)
    .values({
      boardId: board.id as never,
      principalId: author.id as never,
      title: 'Probe',
      content: 'x',
    })
    .returning({ id: posts.id })

  const [integration] = await testDb
    .insert(integrations)
    .values({
      integrationType: 'gitlab',
      status: 'connected',
      config: { instanceUrl: 'https://gitlab.example.com' },
    })
    .returning({ id: integrations.id })

  const [link] = await testDb
    .insert(postExternalLinks)
    .values({
      postId: post.id as never,
      integrationId: integration.id as never,
      integrationType: 'gitlab',
      externalId: '42',
      externalScope: '101',
      externalUrl: 'https://gitlab.example.com/group/datenschutz/-/issues/42',
      status: 'active',
    })
    .returning({ id: postExternalLinks.id })

  return {
    postId: post.id as string,
    linkId: link.id as string,
    integrationId: integration.id as string,
  }
}

async function activeLinksOf(postId: string) {
  return testDb
    .select({
      id: postExternalLinks.id,
      externalId: postExternalLinks.externalId,
      externalScope: postExternalLinks.externalScope,
      externalUrl: postExternalLinks.externalUrl,
    })
    .from(postExternalLinks)
    .where(eq(postExternalLinks.postId, postId as never))
}

function runMove(s: Seed, target: Partial<Record<string, string>> = {}) {
  return gitlabIssueMoveHook.run(
    { id: 'evt', type: 'post.board_changed', timestamp: '', actor: { type: 'system' } } as never,
    {
      linkId: s.linkId,
      externalId: '42',
      fromProjectId: '101',
      toProjectId: '202',
      ...target,
    },
    { integrationId: s.integrationId }
  )
}

describe.skipIf(!fixture.available)('gitlabIssueMoveHook', () => {
  beforeEach(async () => {
    gitlabFetch.mockReset()
    getValidAccessToken.mockClear()
    getValidAccessToken.mockResolvedValue('a-token')
    await fixture.begin()
  })

  afterEach(fixture.rollback)

  it('sends the documented move request (V11)', async () => {
    const s = await seed()
    gitlabFetch.mockResolvedValue(movedIssue())

    await runMove(s)

    expect(gitlabFetch).toHaveBeenCalledTimes(1)
    const [url, init] = gitlabFetch.mock.calls[0]
    expect(url).toBe('https://gitlab.example.com/api/v4/projects/101/issues/42/move')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body)).toEqual({ to_project_id: '202' })
    expect(init.headers.Authorization).toBe('Bearer a-token')
  })

  it('rewrites the link onto the issue in the new project (V11)', async () => {
    const s = await seed()
    gitlabFetch.mockResolvedValue(movedIssue())

    const result = await runMove(s)

    expect(result.success).toBe(true)
    const [link] = await activeLinksOf(s.postId)
    expect(link).toEqual({
      id: s.linkId,
      externalId: '7',
      externalScope: '202',
      externalUrl: 'https://gitlab.example.com/group/asbs/-/issues/7',
    })
  })

  it('records where the issue went (V11)', async () => {
    const s = await seed()
    gitlabFetch.mockResolvedValue(movedIssue())

    await runMove(s)

    const rows = await testDb
      .select({ type: postActivity.type, metadata: postActivity.metadata })
      .from(postActivity)
      .where(eq(postActivity.postId, s.postId as never))
    expect(rows).toHaveLength(1)
    expect(rows[0].type).toBe('external.issue_moved')
    expect(rows[0].metadata).toMatchObject({
      integrationType: 'gitlab',
      fromProjectId: '101',
      toProjectId: '202',
      externalId: '7',
      externalUrl: 'https://gitlab.example.com/group/asbs/-/issues/7',
    })
  })

  it('reports a refused move and asks to be retried', async () => {
    const s = await seed()
    gitlabFetch.mockResolvedValue({
      ok: false,
      status: 503,
      text: async () => 'upstream is having a day',
    })

    const result = await runMove(s)

    expect(result.success).toBe(false)
    expect(result.shouldRetry).toBe(true)
    expect(result.error).toContain('503')
  })

  it('does not ask to be retried when GitLab rejects the move itself', async () => {
    // 400 is what GitLab answers for an issue it will not move — already moved,
    // or the target project does not take issues. Retrying cannot change that.
    const s = await seed()
    gitlabFetch.mockResolvedValue({
      ok: false,
      status: 400,
      text: async () => '{"message":"Cannot move issue"}',
    })

    const result = await runMove(s)

    expect(result.success).toBe(false)
    expect(result.shouldRetry).toBeFalsy()
  })

  it('reports an expired token so the worker can refresh it once', async () => {
    const s = await seed()
    gitlabFetch.mockResolvedValue({ ok: false, status: 401, text: async () => 'unauthorized' })

    const result = await runMove(s)

    expect(result.success).toBe(false)
    expect(result.authExpired).toBe(true)
  })

  it('fails without moving anything when there is no token', async () => {
    const s = await seed()
    getValidAccessToken.mockResolvedValue(null)

    const result = await runMove(s)

    expect(result.success).toBe(false)
    expect(gitlabFetch).not.toHaveBeenCalled()
  })

  it('fails when the answer carries no issue number to point at', async () => {
    // Without an iid there is nothing to rewrite the link to, and writing a
    // half-move is worse than reporting a failure.
    const s = await seed()
    gitlabFetch.mockResolvedValue(movedIssue({ iid: undefined }))

    const result = await runMove(s)

    expect(result.success).toBe(false)
  })

  it('needs an integration to move with', async () => {
    const s = await seed()

    const result = await gitlabIssueMoveHook.run(
      { id: 'evt', type: 'post.board_changed', timestamp: '', actor: { type: 'system' } } as never,
      { linkId: s.linkId, externalId: '42', fromProjectId: '101', toProjectId: '202' },
      {}
    )

    expect(result.success).toBe(false)
    expect(gitlabFetch).not.toHaveBeenCalled()
  })
})

describe.skipIf(!fixture.available)(
  'the link count is conserved across every outcome (V13)',
  () => {
    beforeEach(async () => {
      gitlabFetch.mockReset()
      getValidAccessToken.mockClear()
      getValidAccessToken.mockResolvedValue('a-token')
      await fixture.begin()
    })

    afterEach(fixture.rollback)

    const outcomes: Array<[string, () => void]> = [
      ['the move succeeds', () => gitlabFetch.mockResolvedValue(movedIssue())],
      [
        'GitLab refuses the move',
        () => gitlabFetch.mockResolvedValue({ ok: false, status: 400, text: async () => 'no' }),
      ],
      [
        'the issue is gone',
        () => gitlabFetch.mockResolvedValue({ ok: false, status: 404, text: async () => 'gone' }),
      ],
      [
        'the token expired',
        () => gitlabFetch.mockResolvedValue({ ok: false, status: 401, text: async () => 'nope' }),
      ],
      ['the network drops', () => gitlabFetch.mockRejectedValue(new Error('ECONNRESET'))],
      ['there is no token', () => getValidAccessToken.mockResolvedValue(null)],
      [
        'the answer has no issue number',
        () => gitlabFetch.mockResolvedValue(movedIssue({ iid: undefined })),
      ],
    ]

    it.each(outcomes)('leaves exactly one link when %s', async (_name, arrange) => {
      const s = await seed()
      expect(await activeLinksOf(s.postId)).toHaveLength(1)

      arrange()
      await runMove(s)

      // Unguarded: the same assertion for every outcome, success included.
      expect(await activeLinksOf(s.postId)).toHaveLength(1)
    })

    it('leaves exactly one link when the same move is delivered twice (V15)', async () => {
      const s = await seed()
      gitlabFetch.mockResolvedValue(movedIssue())

      await runMove(s)
      await runMove(s)

      expect(await activeLinksOf(s.postId)).toHaveLength(1)
    })
  }
)
