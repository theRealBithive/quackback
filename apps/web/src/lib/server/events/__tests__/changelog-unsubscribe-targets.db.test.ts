/**
 * Real-DB coverage for the changelog opt-out reaching the linked-post source.
 *
 * Changelog email goes to the union of `changelog_subscriptions` and the
 * subscribers of posts linked to the entry. Someone who only follows a linked
 * post has no `changelog_subscriptions` row, so unsubscribing from changelog
 * email has to create one (with `unsubscribedAt` set) for the opt-out to
 * reach them; stamping an existing row alone left them on the list.
 *
 * Contract (upstream #687), verbatim:
 *
 *   U1 Opening an unsubscribe link never unsubscribes anyone. It shows what would happen and asks for confirmation.
 *   U2 The unsubscribe happens only on an explicit confirmation, or on a one-click request from the mail provider.
 *   U3 A malformed, unknown, used or expired token shows the expired-link page, never a server error.
 *   U4 A one-click request in the RFC 8058 form is answered with success for every token, whether live, used, unknown or malformed. A request without the one-click body is refused. A body larger than 1 KB is refused after reading no more than that.
 *   U5 A token is spent only once the opt-out has actually happened. If the opt-out fails, the link keeps working and a retry succeeds exactly once.
 *   U6 Unsubscribing from the changelog also stops the changelog mail that reaches a person through posts they follow, even if they never subscribed to the changelog.
 *   U7 Every notification email that has an unsubscribe link carries List-Unsubscribe. It offers one-click only when the link is HTTPS. An email without a link carries neither header.
 *   U8 The unsubscribe page is in the language the rest of the site resolved for the request, in all nine languages, and the German addresses the reader formally.
 *   U9 The unsubscribe page's strings are not loaded into the portal or the widget.
 *
 * This module holds U6.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createId,
  type BoardId,
  type ChangelogId,
  type PostId,
  type PrincipalId,
  type UserId,
} from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import {
  boards,
  changelogEntries,
  changelogEntryPosts,
  changelogSubscriptions,
  eq,
  postSubscriptions,
  posts,
  principal,
  unsubscribeTokens,
  user,
} from '@/lib/server/db'
import { DEFAULT_BOARD_ACCESS } from '@/lib/shared/db-types'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))
vi.mock('@/lib/server/domains/settings/settings.changelog', () => ({
  getChangelogSettings: vi.fn().mockResolvedValue({
    audience: 'public',
    showInNav: true,
    allowComments: true,
    autoSubscribe: false,
    emailsDisabled: false,
  }),
}))
vi.mock('@/lib/server/domains/channel-accounts/channel-account.service', () => ({
  resolveSendingAddress: vi.fn().mockResolvedValue(null),
}))

import { getChangelogSubscriberTargets } from '../targets'
import { unsubscribeChangelog } from '@/lib/server/domains/changelog/changelog-subscription.service'
import { processUnsubscribeToken } from '@/lib/server/domains/subscriptions/subscription.service'
import type { EventData } from '../types'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: changelogSubscriptions.id }).from(changelogSubscriptions).limit(0)
  },
})

const suffix = () => `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`

async function seedPrincipal(email: string): Promise<PrincipalId> {
  const userId = createId('user') as UserId
  const principalId = createId('principal') as PrincipalId
  await testDb.insert(user).values({ id: userId, name: 'Follower', email })
  await testDb.insert(principal).values({
    id: principalId,
    userId,
    role: 'user',
    type: 'user',
    displayName: 'Follower',
    createdAt: new Date(),
  })
  return principalId
}

/** An entry linked to one post that `follower` subscribes to. */
async function seedLinkedEntry(follower: PrincipalId): Promise<ChangelogId> {
  const [board] = await testDb
    .insert(boards)
    .values({ slug: `cl-${suffix()}`, name: 'Board', access: DEFAULT_BOARD_ACCESS })
    .returning()
  const [post] = await testDb
    .insert(posts)
    .values({
      boardId: board.id as BoardId,
      title: 'Dark mode',
      content: '',
      principalId: follower,
    })
    .returning()
  await testDb
    .insert(postSubscriptions)
    .values({ postId: post.id as PostId, principalId: follower, reason: 'vote' })
  const [entry] = await testDb
    .insert(changelogEntries)
    .values({ title: 'Dark mode shipped', content: 'body' })
    .returning()
  await testDb
    .insert(changelogEntryPosts)
    .values({ changelogEntryId: entry.id as ChangelogId, postId: post.id as PostId })
  return entry.id as ChangelogId
}

async function emailedAddresses(changelogId: ChangelogId): Promise<string[]> {
  const event = {
    type: 'changelog.published',
    actor: { type: 'service', displayName: 'Publisher' },
    data: {
      changelog: {
        id: changelogId,
        title: 'Dark mode shipped',
        contentPreview: 'body',
        contentHtml: '<p>body</p>',
        publishedAt: new Date().toISOString(),
        linkedPostCount: 1,
      },
    },
  } as unknown as EventData
  const targets = await getChangelogSubscriberTargets(event, {
    workspaceName: 'Acme',
    portalBaseUrl: 'https://acme.test',
    logoUrl: null,
  })
  return targets.filter((t) => t.type === 'email').map((t) => (t.target as { email: string }).email)
}

describe.skipIf(!fixture.available)(
  'changelog unsubscribe vs linked-post subscribers (real DB)',
  () => {
    beforeEach(fixture.begin)
    afterEach(fixture.rollback)
    afterAll(fixture.close)

    it('(U6) stops changelog email for someone who only follows a linked post', async () => {
      const email = `follower-${suffix()}@example.com`
      const follower = await seedPrincipal(email)
      const entryId = await seedLinkedEntry(follower)

      expect(await emailedAddresses(entryId)).toContain(email)

      await unsubscribeChangelog(follower)

      expect(await emailedAddresses(entryId)).not.toContain(email)
    })

    it('(U6) stamps an existing subscription without rewriting how it began', async () => {
      const follower = await seedPrincipal(`csv-${suffix()}@example.com`)
      await testDb
        .insert(changelogSubscriptions)
        .values({ principalId: follower, source: 'csv_import' })

      await unsubscribeChangelog(follower)

      const rows = await testDb
        .select({
          source: changelogSubscriptions.source,
          unsubscribedAt: changelogSubscriptions.unsubscribedAt,
        })
        .from(changelogSubscriptions)
        .where(eq(changelogSubscriptions.principalId, follower))
      expect(rows).toHaveLength(1)
      expect(rows[0].source).toBe('csv_import')
      expect(rows[0].unsubscribedAt).not.toBeNull()
    })

    it('(U6) the emailed changelog link reaches the linked-post source too', async () => {
      const email = `link-${suffix()}@example.com`
      const follower = await seedPrincipal(email)
      const entryId = await seedLinkedEntry(follower)
      const token = crypto.randomUUID()
      await testDb.insert(unsubscribeTokens).values({
        token,
        principalId: follower,
        postId: null,
        action: 'unsubscribe_changelog',
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      })
      expect(await emailedAddresses(entryId)).toContain(email)

      const result = await processUnsubscribeToken(token)

      expect(result).toMatchObject({ action: 'unsubscribe_changelog', principalId: follower })
      expect(await emailedAddresses(entryId)).not.toContain(email)
      const rows = await testDb
        .select({ source: changelogSubscriptions.source })
        .from(changelogSubscriptions)
        .where(eq(changelogSubscriptions.principalId, follower))
      expect(rows).toEqual([{ source: 'self_serve' }])
    })
  }
)
