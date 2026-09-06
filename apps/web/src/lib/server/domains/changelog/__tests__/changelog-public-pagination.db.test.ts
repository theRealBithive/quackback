/**
 * Paging the public changelog, against real Postgres.
 *
 * This exists because "Load more" on `/changelog` threw on the second page and
 * nothing said so. The cursor compares against `effectiveDisplayDate`, a raw
 * `coalesce(display_date, published_at)` expression rather than a column, so
 * drizzle had no column mapper for the value on the other side and handed
 * postgres.js a `Date` it cannot encode. The first page never touches that
 * branch, which is why every test and every manual look at the page was green.
 *
 * P1 A reader can page through the whole published changelog.
 * P2 Paging returns each entry exactly once, in the order the first page
 *    started, and never returns an unpublished or deleted one.
 * P3 An entry whose display date was moved pages by that date, not by the date
 *    it happened to be published on — the same order the first page shows.
 *
 * These are guarantees about the reader, not about the encoding: a test that
 * asserted "no Date reaches the driver" would pass again the moment someone
 * reintroduced the fault through a different call.
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { changelogEntries } from '@/lib/server/db'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

import { listPublicChangelogs } from '../changelog.public'

const fixture = await createDbTestFixture({
  probe: async (db) =>
    void (await db.select({ id: changelogEntries.id }).from(changelogEntries).limit(0)),
})

/** Published `minutesAgo` in the past, so ordering is deterministic. */
async function publish(title: string, minutesAgo: number, displayDate?: Date) {
  await testDb.insert(changelogEntries).values({
    title,
    content: title,
    publishedAt: new Date(Date.now() - minutesAgo * 60_000),
    ...(displayDate ? { displayDate } : {}),
  })
}

/** Walk every page, returning the titles in the order they arrived. */
async function pageThrough(limit: number): Promise<string[]> {
  const seen: string[] = []
  let cursor: string | undefined
  let guard = 0
  do {
    const page = await listPublicChangelogs({ limit, ...(cursor ? { cursor } : {}) })
    seen.push(...page.items.map((entry) => entry.title))
    cursor = page.nextCursor ?? undefined
    if (++guard > 50) throw new Error('pagination did not terminate')
  } while (cursor)
  return seen
}

describe.skipIf(!fixture.available)('public changelog pagination', () => {
  beforeEach(fixture.begin)
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  it('reaches the second page at all (P1)', async () => {
    await publish('first', 1)
    await publish('second', 2)
    await publish('third', 3)

    const firstPage = await listPublicChangelogs({ limit: 2 })
    expect(firstPage.hasMore).toBe(true)
    expect(firstPage.nextCursor).not.toBeNull()

    const secondPage = await listPublicChangelogs({ limit: 2, cursor: firstPage.nextCursor! })
    expect(secondPage.items.map((e) => e.title)).toEqual(['third'])
  })

  it('returns every entry exactly once, newest first (P2)', async () => {
    const titles = ['a', 'b', 'c', 'd', 'e', 'f', 'g']
    for (const [index, title] of titles.entries()) await publish(title, index + 1)

    const seen = await pageThrough(2)
    expect(seen).toEqual(titles)
    expect(new Set(seen).size).toBe(seen.length)
  })

  it('does not page into drafts, scheduled entries or deleted ones (P2)', async () => {
    await publish('live one', 1)
    await publish('live two', 2)
    await testDb
      .insert(changelogEntries)
      .values({ title: 'draft', content: 'draft', publishedAt: null })
    await testDb.insert(changelogEntries).values({
      title: 'scheduled',
      content: 'scheduled',
      publishedAt: new Date(Date.now() + 60 * 60_000),
    })
    await testDb.insert(changelogEntries).values({
      title: 'deleted',
      content: 'deleted',
      publishedAt: new Date(Date.now() - 3 * 60_000),
      deletedAt: new Date(),
    })

    expect(await pageThrough(1)).toEqual(['live one', 'live two'])
  })

  it('pages by the display date when one was set (P3)', async () => {
    // Published last, but dated first — a backdated entry belongs where its
    // display date puts it on page one, and has to stay there across pages.
    await publish('published recently, dated old', 1, new Date(Date.now() - 90 * 60_000))
    await publish('published earlier, undated', 30)

    expect(await pageThrough(1)).toEqual([
      'published earlier, undated',
      'published recently, dated old',
    ])
  })
})
