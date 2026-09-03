/**
 * Contract — GitLab issue notes arriving as Quackback comments.
 * (The full V1-V12 list lives in
 *  apps/web/src/integrations/gitlab/server/__tests__/inbound.test.ts.)
 *
 * This file covers the ingest half against a real database:
 *
 *   V1  A note on a linked issue shows up as a comment on that post.
 *   V4  A note GitLab marks as internal never becomes visible in Quackback.
 *   V5  The same note delivered twice yields one comment.
 *   V7  The comment names the GitLab author and carries no email address.
 *   V8  The comment is attributed to the integration's service identity.
 *   V9  A note for an issue no post is linked to is ignored quietly.
 *   V11 A failure while importing a note never makes GitLab see an error, and
 *       never interferes with the status sync sharing the same webhook.
 *
 * Runs inside the fixture transaction, which is always rolled back.
 *
 * Mutation pass (manual — no Stryker in this repo): 9 mutants on the ingest
 * path, 7 killed. The two survivors are equivalent, differing only in which
 * log line is written:
 *
 *   - Dropping the unique-violation branch. The error then propagates to the
 *     orchestrator's own catch, which also swallows it: still one comment,
 *     still HTTP 200. Only the severity changes (debug -> error on every
 *     routine redelivery).
 *   - Dropping the missing-service-principal guard. createComment is then
 *     called with a null principal and the NOT NULL constraint rejects the
 *     insert, which the same catch swallows: still no comment, still HTTP 200.
 *     The guard buys an actionable message instead of a constraint error.
 *
 * Both are kept deliberately: an opaque failure in this pipeline is what made
 * the last outage take fifteen turns to find.
 */
import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest'
import { createId, type PostId, type PrincipalId } from '@quackback/ids'
import { DEFAULT_BOARD_ACCESS, type BoardAccess } from '@/lib/shared/db-types'

import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import {
  boards,
  integrations,
  postComments,
  postExternalLinks,
  posts,
  principal,
  settings,
  eq,
} from '@/lib/server/db'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

// Status branch boundary: this suite is about the comment branch, and the two
// must not interfere (V11).
vi.mock('@/lib/server/domains/posts/post.status', () => ({
  changeStatus: vi.fn().mockResolvedValue(undefined),
}))

import { handleInboundWebhook } from '../inbound-webhook-handler'
import { changeStatus } from '@/lib/server/domains/posts/post.status'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db
      .select({ id: postComments.id, externalId: postComments.externalId })
      .from(postComments)
      .limit(0)
  },
})

const suffix = () => `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
const WEBHOOK_SECRET = 'gitlab_test_secret'
const AUTHOR_EMAIL = 'private-author@internal.example'

async function seedSettings(): Promise<void> {
  await testDb
    .insert(settings)
    .values({ name: 'Test WS', slug: `test_${suffix()}`, createdAt: new Date() })
}

/** The integration's own service identity — who imported comments belong to. */
async function seedServicePrincipal(): Promise<PrincipalId> {
  const principalId = createId('principal') as PrincipalId
  await testDb
    .insert(principal)
    .values({ id: principalId, role: 'member', type: 'service', createdAt: new Date() })
  return principalId
}

async function seedGitLabIntegration(principalId: PrincipalId | null) {
  const [row] = await testDb
    .insert(integrations)
    .values({
      integrationType: 'gitlab',
      status: 'active',
      config: { channelId: '11', webhookSecret: WEBHOOK_SECRET },
      principalId,
    })
    .returning()
  return row
}

async function seedPost(access: BoardAccess = DEFAULT_BOARD_ACCESS): Promise<PostId> {
  const authorId = createId('principal') as PrincipalId
  await testDb
    .insert(principal)
    .values({ id: authorId, role: 'user', type: 'anonymous', createdAt: new Date() })
  const [board] = await testDb
    .insert(boards)
    .values({ slug: `b_${suffix()}`, name: 'Board', access })
    .returning()
  const [post] = await testDb
    .insert(posts)
    .values({ boardId: board.id, title: 'Post', content: 'Body', principalId: authorId })
    .returning()
  return post.id as PostId
}

async function linkPostToIssue(postId: PostId, issueIid: string): Promise<void> {
  await testDb.insert(postExternalLinks).values({
    postId,
    integrationType: 'gitlab',
    externalId: issueIid,
    externalDisplayId: `#${issueIid}`,
    externalUrl: `https://gitlab.example.com/g/p/-/issues/${issueIid}`,
  })
}

function noteBody(
  overrides: { issueIid?: number; noteId?: number; note?: string; internal?: boolean } = {}
): string {
  return JSON.stringify({
    object_kind: 'note',
    user: { id: 2, name: 'Maximilian Kindshofer', email: AUTHOR_EMAIL },
    object_attributes: {
      id: overrides.noteId ?? 24694,
      note: overrides.note ?? 'Wont fix',
      noteable_type: 'Issue',
      system: false,
      internal: overrides.internal ?? false,
      action: 'create',
    },
    issue: { id: 1164, iid: overrides.issueIid ?? 686, confidential: false },
  })
}

function gitlabRequest(body: string, token = WEBHOOK_SECRET): Request {
  return new Request('http://localhost/api/integrations/gitlab/webhook', {
    method: 'POST',
    headers: { 'X-Gitlab-Token': token, 'Content-Type': 'application/json' },
    body,
  })
}

async function commentsOn(postId: PostId) {
  return testDb
    .select({
      content: postComments.content,
      isPrivate: postComments.isPrivate,
      principalId: postComments.principalId,
      externalId: postComments.externalId,
      externalIntegrationType: postComments.externalIntegrationType,
      moderationState: postComments.moderationState,
    })
    .from(postComments)
    .where(eq(postComments.postId, postId))
}

describe.skipIf(!fixture.available)('inbound webhook comment branch (real DB, rolled back)', () => {
  beforeEach(async () => {
    await fixture.begin()
    vi.mocked(changeStatus).mockClear()
  })
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  it('turns a GitLab note on a linked issue into a comment on the post (V1)', async () => {
    await seedSettings()
    const servicePrincipalId = await seedServicePrincipal()
    await seedGitLabIntegration(servicePrincipalId)
    const postId = await seedPost()
    await linkPostToIssue(postId, '686')

    const response = await handleInboundWebhook(gitlabRequest(noteBody()), 'gitlab')
    expect(response.status).toBe(200)

    const comments = await commentsOn(postId)
    expect(comments).toHaveLength(1)
    expect(comments[0].content).toContain('Wont fix')
  })

  it('lands team-only, never on the public portal (V1)', async () => {
    await seedSettings()
    const servicePrincipalId = await seedServicePrincipal()
    await seedGitLabIntegration(servicePrincipalId)
    const postId = await seedPost()
    await linkPostToIssue(postId, '686')

    await handleInboundWebhook(gitlabRequest(noteBody()), 'gitlab')

    const comments = await commentsOn(postId)
    expect(comments[0].isPrivate).toBe(true)
  })

  it('names the GitLab author and leaks no email address (V7)', async () => {
    await seedSettings()
    const servicePrincipalId = await seedServicePrincipal()
    await seedGitLabIntegration(servicePrincipalId)
    const postId = await seedPost()
    await linkPostToIssue(postId, '686')

    await handleInboundWebhook(gitlabRequest(noteBody()), 'gitlab')

    const comments = await commentsOn(postId)
    expect(comments[0].content).toContain('Maximilian Kindshofer')
    expect(comments[0].content).not.toContain(AUTHOR_EMAIL)
  })

  it('attributes the comment to the integration service identity (V8)', async () => {
    await seedSettings()
    const servicePrincipalId = await seedServicePrincipal()
    await seedGitLabIntegration(servicePrincipalId)
    const postId = await seedPost()
    await linkPostToIssue(postId, '686')

    await handleInboundWebhook(gitlabRequest(noteBody()), 'gitlab')

    const comments = await commentsOn(postId)
    expect(comments[0].principalId).toBe(servicePrincipalId)
  })

  it('stamps the source so the note can be recognised again (V5)', async () => {
    await seedSettings()
    const servicePrincipalId = await seedServicePrincipal()
    await seedGitLabIntegration(servicePrincipalId)
    const postId = await seedPost()
    await linkPostToIssue(postId, '686')

    await handleInboundWebhook(gitlabRequest(noteBody({ noteId: 24694 })), 'gitlab')

    const comments = await commentsOn(postId)
    expect(comments[0].externalIntegrationType).toBe('gitlab')
    expect(comments[0].externalId).toBe('24694')
  })

  it('yields one comment when the same note is delivered twice (V5)', async () => {
    await seedSettings()
    const servicePrincipalId = await seedServicePrincipal()
    await seedGitLabIntegration(servicePrincipalId)
    const postId = await seedPost()
    await linkPostToIssue(postId, '686')

    const first = await handleInboundWebhook(gitlabRequest(noteBody()), 'gitlab')
    const second = await handleInboundWebhook(gitlabRequest(noteBody()), 'gitlab')

    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
    expect(await commentsOn(postId)).toHaveLength(1)
  })

  it('keeps two different notes apart (V5)', async () => {
    await seedSettings()
    const servicePrincipalId = await seedServicePrincipal()
    await seedGitLabIntegration(servicePrincipalId)
    const postId = await seedPost()
    await linkPostToIssue(postId, '686')

    await handleInboundWebhook(gitlabRequest(noteBody({ noteId: 1, note: 'first' })), 'gitlab')
    await handleInboundWebhook(gitlabRequest(noteBody({ noteId: 2, note: 'second' })), 'gitlab')

    expect(await commentsOn(postId)).toHaveLength(2)
  })

  it('drops an internal GitLab note end to end (V4)', async () => {
    await seedSettings()
    const servicePrincipalId = await seedServicePrincipal()
    await seedGitLabIntegration(servicePrincipalId)
    const postId = await seedPost()
    await linkPostToIssue(postId, '686')

    const response = await handleInboundWebhook(
      gitlabRequest(noteBody({ internal: true })),
      'gitlab'
    )

    expect(response.status).toBe(200)
    expect(await commentsOn(postId)).toHaveLength(0)
  })

  it('imports onto a board only signed-in users may comment on (V1)', async () => {
    // The integration acts with a team role, so board comment tiers do not
    // shut it out. A public board would let a role-less actor through and
    // hide that.
    await seedSettings()
    const servicePrincipalId = await seedServicePrincipal()
    await seedGitLabIntegration(servicePrincipalId)
    const postId = await seedPost({ ...DEFAULT_BOARD_ACCESS, comment: 'authenticated' })
    await linkPostToIssue(postId, '686')

    const response = await handleInboundWebhook(gitlabRequest(noteBody()), 'gitlab')

    expect(response.status).toBe(200)
    expect(await commentsOn(postId)).toHaveLength(1)
  })

  it('is never held for review, even where the board holds comments (V1)', async () => {
    await seedSettings()
    const servicePrincipalId = await seedServicePrincipal()
    await seedGitLabIntegration(servicePrincipalId)
    const postId = await seedPost({
      ...DEFAULT_BOARD_ACCESS,
      moderation: { ...DEFAULT_BOARD_ACCESS.moderation, comments: 'on' },
    })
    await linkPostToIssue(postId, '686')

    await handleInboundWebhook(gitlabRequest(noteBody()), 'gitlab')

    const comments = await commentsOn(postId)
    expect(comments).toHaveLength(1)
    expect(comments[0].moderationState).toBe('published')
  })

  it('ignores a note for an issue no post is linked to (V9)', async () => {
    await seedSettings()
    const servicePrincipalId = await seedServicePrincipal()
    await seedGitLabIntegration(servicePrincipalId)
    const postId = await seedPost()
    await linkPostToIssue(postId, '686')

    const response = await handleInboundWebhook(
      gitlabRequest(noteBody({ issueIid: 999 })),
      'gitlab'
    )

    expect(response.status).toBe(200)
    expect(await commentsOn(postId)).toHaveLength(0)
  })

  it('still answers 200 when the integration has no service identity (V11)', async () => {
    await seedSettings()
    await seedGitLabIntegration(null)
    const postId = await seedPost()
    await linkPostToIssue(postId, '686')

    const response = await handleInboundWebhook(gitlabRequest(noteBody()), 'gitlab')

    expect(response.status).toBe(200)
    expect(await commentsOn(postId)).toHaveLength(0)
  })

  it('rejects a note whose token does not match, before any comment is written (V11)', async () => {
    await seedSettings()
    const servicePrincipalId = await seedServicePrincipal()
    await seedGitLabIntegration(servicePrincipalId)
    const postId = await seedPost()
    await linkPostToIssue(postId, '686')

    const response = await handleInboundWebhook(gitlabRequest(noteBody(), 'wrong'), 'gitlab')

    expect(response.status).toBe(401)
    expect(await commentsOn(postId)).toHaveLength(0)
  })

  it('leaves the status branch untouched for a note event (V11)', async () => {
    await seedSettings()
    const servicePrincipalId = await seedServicePrincipal()
    await seedGitLabIntegration(servicePrincipalId)
    const postId = await seedPost()
    await linkPostToIssue(postId, '686')

    await handleInboundWebhook(gitlabRequest(noteBody()), 'gitlab')

    expect(changeStatus).not.toHaveBeenCalled()
  })
})
