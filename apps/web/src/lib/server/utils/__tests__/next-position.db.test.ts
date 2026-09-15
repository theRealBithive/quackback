/**
 * `nextPosition` against real Postgres.
 *
 * The mock-based `next-position.test.ts` drives `db.select` through a hand-built
 * chain and can't see whether the SQL fragment itself is right — a mutant that
 * blanks out `coalesce(max(${column}), -1)` (or the `{ max: ... }` selection
 * shape) still satisfies that mock, because the mock never inspects the SQL it
 * was called with. This file runs the real query against a table with a
 * `position` column, using the transactional DB fixture (see
 * `db-test-fixture.ts` / its README) so every test rolls back.
 *
 * ## T — Taxonomy names, colours, slugs, positions
 * - T6 A newly created ordered entity lands one position after the current
 *   last one, and at position 0 in an empty (or filtered-empty) list.
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { changelogCategories } from '@/lib/server/db'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

import { nextPosition } from '../next-position'

const fixture = await createDbTestFixture({
  probe: async (db) =>
    void (await db.select({ id: changelogCategories.id }).from(changelogCategories).limit(0)),
})

/** A changelog category, named so a failure message says which one. */
async function makeCategory(name: string, color: string, position: number): Promise<void> {
  await testDb.insert(changelogCategories).values({ name, color, position })
}

describe.skipIf(!fixture.available)('nextPosition — against real Postgres', () => {
  beforeEach(fixture.begin)
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  it('returns 0 for an empty table (T6)', async () => {
    const position = await nextPosition(changelogCategories, changelogCategories.position)

    expect(position).toBe(0)
  })

  it('returns one past the current max position across all rows (T6)', async () => {
    await makeCategory('Bugfixes', '#111111', 0)
    await makeCategory('Features', '#222222', 1)
    await makeCategory('Breaking changes', '#333333', 4)

    const position = await nextPosition(changelogCategories, changelogCategories.position)

    expect(position).toBe(5)
  })

  it('derives the position from only the rows a where filter matches (T6)', async () => {
    // Two categories share a colour; a third, with a higher position, does
    // not. The filtered position must come from the matching pair's max (3),
    // not the table-wide max (10) — otherwise the where clause did nothing.
    await makeCategory('Grey one', '#111111', 0)
    await makeCategory('Grey two', '#111111', 3)
    await makeCategory('Unrelated', '#999999', 10)

    const position = await nextPosition(
      changelogCategories,
      changelogCategories.position,
      eq(changelogCategories.color, '#111111')
    )

    expect(position).toBe(4)
  })

  it('returns 0 when the where filter matches no row, even though other rows exist (T6)', async () => {
    await makeCategory('Grey one', '#111111', 0)
    await makeCategory('Grey two', '#111111', 3)

    const position = await nextPosition(
      changelogCategories,
      changelogCategories.position,
      eq(changelogCategories.color, '#00ff00')
    )

    expect(position).toBe(0)
  })
})
