/**
 * The changelog's product filter against real Postgres.
 *
 * The pure decision is held in `changelog-board-filter.test.ts`, which carries
 * the full V1–V12 contract. This file holds the half that only a database can
 * answer: whether the SQL predicate says the same thing the decision does, and
 * whether the reader's own board visibility really bounds it.
 *
 * V1  A changelog entry can be assigned to any number of products: none, one,
 *     or several.
 * V2  An entry assigned to no product is a cross-product announcement — it
 *     appears under every product filter, and in the unfiltered list.
 * V3  An entry assigned to at least one product appears under a product filter
 *     only if the filter names one of its products.
 * V4  Filtering by several products shows every entry belonging to at least one
 *     of them (union, not intersection).
 * V5  With no product filter selected, the changelog shows exactly what it
 *     showed before this change.
 * V6  A reader is only ever offered products they are allowed to see; a product
 *     they may not see is never named in the filter options.
 * V7  A product that does not exist, is deleted, or that the reader may not see
 *     contributes nothing to the filter and cannot be told apart from a product
 *     with no entries: it never widens the result and never raises an error.
 * V8  Assigning a product to an entry never changes who may read that entry.
 *     Product assignment is editorial metadata, not an access control.
 * V10 Paging through a filtered changelog returns each matching entry exactly
 *     once and never returns a non-matching one.
 *
 * The contract was agreed in German and is written here in English, which is
 * the language of this repository.
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { boards, changelogEntries, changelogEntryBoards, eq } from '@/lib/server/db'
import { generateId } from '@quackback/ids'
import type { BoardId, ChangelogId, PrincipalId, SegmentId } from '@quackback/ids'
import { ANONYMOUS_ACTOR, type Actor } from '@/lib/server/policy/types'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

import { listPublicChangelogs } from '../changelog.public'
import {
  getBoardsForEntries,
  getEntryBoardIds,
  setEntryBoards,
  visibleBoardIdsFor,
} from '../changelog-board.service'

const fixture = await createDbTestFixture({
  probe: async (db) =>
    void (await db
      .select({ id: changelogEntryBoards.boardId })
      .from(changelogEntryBoards)
      .limit(0)),
})

const PUBLIC_ACCESS = {
  view: 'anonymous',
  vote: 'anonymous',
  comment: 'anonymous',
  create: 'anonymous',
} as const

const TEAM_ONLY_ACCESS = { ...PUBLIC_ACCESS, view: 'team' } as const

function teamActor(): Actor {
  return {
    principalId: generateId('principal') as PrincipalId,
    role: 'admin',
    principalType: 'user',
    segmentIds: new Set<SegmentId>(),
  }
}

/** A board, named so a failure message says which one. */
async function makeBoard(name: string, access: object = PUBLIC_ACCESS): Promise<BoardId> {
  const [row] = await testDb
    .insert(boards)
    .values({
      slug: `${name}-${Math.random().toString(36).slice(2, 10)}`,
      name,
      access: access as never,
    })
    .returning({ id: boards.id })
  return row.id
}

/** A published entry, optionally assigned to products. */
async function makeEntry(title: string, boardIds: BoardId[] = []): Promise<ChangelogId> {
  const [row] = await testDb
    .insert(changelogEntries)
    .values({
      title,
      content: title,
      publishedAt: new Date(Date.now() - 60_000),
    })
    .returning({ id: changelogEntries.id })
  if (boardIds.length > 0) await setEntryBoards(row.id, boardIds)
  return row.id
}

/** Titles of the entries a filter returns, so assertions read as prose. */
async function titlesFor(boardIds?: string[], actor: Actor = ANONYMOUS_ACTOR): Promise<string[]> {
  const result = await listPublicChangelogs({ limit: 50, ...(boardIds ? { boardIds } : {}) }, actor)
  return result.items.map((entry) => entry.title)
}

describe.skipIf(!fixture.available)('changelog product filter, against Postgres', () => {
  beforeEach(fixture.begin)
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  it('assigns an entry to none, one, or several products (V1)', async () => {
    const alpha = await makeBoard('Alpha')
    const beta = await makeBoard('Beta')

    const none = await makeEntry('none')
    const one = await makeEntry('one', [alpha])
    const several = await makeEntry('several', [alpha, beta])

    expect(await getEntryBoardIds(none)).toEqual([])
    expect(await getEntryBoardIds(one)).toEqual([alpha])
    expect((await getEntryBoardIds(several)).sort()).toEqual([alpha, beta].sort())
  })

  it('replaces the whole set on write, so a product can be taken away again (V1)', async () => {
    const alpha = await makeBoard('Alpha')
    const beta = await makeBoard('Beta')
    const entry = await makeEntry('shifting', [alpha])

    await setEntryBoards(entry, [beta])
    expect(await getEntryBoardIds(entry)).toEqual([beta])

    await setEntryBoards(entry, [])
    expect(await getEntryBoardIds(entry)).toEqual([])
  })

  it('drops an id that names no board rather than failing the save (V7)', async () => {
    const alpha = await makeBoard('Alpha')
    const entry = await makeEntry('tolerant')

    await setEntryBoards(entry, [alpha, generateId('board')])
    expect(await getEntryBoardIds(entry)).toEqual([alpha])
  })

  it('saves an entry whose every product was deleted meanwhile, rather than failing (V7)', async () => {
    // The editor had the form open while someone retired the product. Losing
    // the assignment is the documented outcome; losing the entry is not.
    const entry = await makeEntry('stale form')

    await setEntryBoards(entry, [generateId('board') as BoardId])

    expect(await getEntryBoardIds(entry)).toEqual([])
  })

  it('stops naming a product once it is deleted, in the admin view too (V1)', async () => {
    // The admin view has no audience filter, which is not the same as no
    // filter: a retired product is gone for everyone, not merely hidden.
    const alpha = await makeBoard('Alpha')
    const retired = await makeBoard('Retired')
    const entry = await makeEntry('two products', [alpha, retired])

    await testDb.update(boards).set({ deletedAt: new Date() }).where(eq(boards.id, retired))

    const named = (await getBoardsForEntries([entry])).get(entry) ?? []
    expect(named.map((board) => board.name)).toEqual(['Alpha'])
  })

  it('shows an unassigned entry under every product filter (V2)', async () => {
    const alpha = await makeBoard('Alpha')
    const beta = await makeBoard('Beta')
    await makeEntry('announcement')

    expect(await titlesFor([alpha])).toContain('announcement')
    expect(await titlesFor([beta])).toContain('announcement')
    expect(await titlesFor()).toContain('announcement')
  })

  it('shows a product-specific entry only under its own product (V3)', async () => {
    const alpha = await makeBoard('Alpha')
    const beta = await makeBoard('Beta')
    await makeEntry('about alpha', [alpha])

    expect(await titlesFor([alpha])).toContain('about alpha')
    expect(await titlesFor([beta])).not.toContain('about alpha')
  })

  it('treats several products as a union (V4)', async () => {
    const alpha = await makeBoard('Alpha')
    const beta = await makeBoard('Beta')
    const gamma = await makeBoard('Gamma')
    await makeEntry('about alpha', [alpha])
    await makeEntry('about beta', [beta])
    await makeEntry('about gamma', [gamma])

    const both = await titlesFor([alpha, beta])
    expect(both).toContain('about alpha')
    expect(both).toContain('about beta')
    expect(both).not.toContain('about gamma')
  })

  it('leaves the unfiltered list exactly as it was (V5)', async () => {
    const alpha = await makeBoard('Alpha')
    await makeEntry('assigned', [alpha])
    await makeEntry('unassigned')

    const unfiltered = await titlesFor()
    expect(unfiltered).toContain('assigned')
    expect(unfiltered).toContain('unassigned')
  })

  it('offers a reader only the products they may see (V6)', async () => {
    const open = await makeBoard('Open')
    const closed = await makeBoard('Closed', TEAM_ONLY_ACCESS)

    const anonymous = await visibleBoardIdsFor(ANONYMOUS_ACTOR)
    expect(anonymous).toContain(open)
    expect(anonymous).not.toContain(closed)

    const team = await visibleBoardIdsFor(teamActor())
    expect(team).toContain(open)
    expect(team).toContain(closed)
  })

  it('never widens the result with a product the reader may not see (V7)', async () => {
    const open = await makeBoard('Open')
    const closed = await makeBoard('Closed', TEAM_ONLY_ACCESS)
    await makeEntry('about open', [open])
    await makeEntry('about closed', [closed])
    await makeEntry('announcement')

    // Non-interference, the same statement the pure property makes: adding the
    // invisible board to a request changes nothing about what comes back.
    expect(await titlesFor([open, closed])).toEqual(await titlesFor([open]))
  })

  it('answers a request for only invisible products with announcements, not everything (V7)', async () => {
    const closed = await makeBoard('Closed', TEAM_ONLY_ACCESS)
    await makeEntry('about closed', [closed])
    await makeEntry('announcement')

    const titles = await titlesFor([closed])
    expect(titles).toContain('announcement')
    expect(titles).not.toContain('about closed')
  })

  it('does not raise on an id that names nothing at all (V7)', async () => {
    await makeEntry('announcement')
    await expect(titlesFor([generateId('board')])).resolves.toContain('announcement')
  })

  it('never names a product the reader may not see on an entry they can read (V6, V8)', async () => {
    const open = await makeBoard('Open')
    const closed = await makeBoard('Closed', TEAM_ONLY_ACCESS)
    await makeEntry('spans both', [open, closed])

    const [entry] = (await listPublicChangelogs({ limit: 50 }, ANONYMOUS_ACTOR)).items
    expect(entry.title).toBe('spans both')
    expect(entry.boards.map((b) => b.id)).toEqual([open])
  })

  it('an entry assigned only to a private product is still readable (V8)', async () => {
    // The guarantee that keeps this feature editorial: assignment narrows
    // filters, it never gates access. An entry tagged with a board the reader
    // cannot see must still appear in the unfiltered changelog.
    const closed = await makeBoard('Closed', TEAM_ONLY_ACCESS)
    await makeEntry('tagged private', [closed])

    expect(await titlesFor()).toContain('tagged private')
  })

  it('pages a filtered changelog without dropping or repeating an entry (V10)', async () => {
    const alpha = await makeBoard('Alpha')
    const beta = await makeBoard('Beta')

    // Interleaved, so a filter applied after pagination would produce short
    // pages and lose matches at every boundary — the reason the predicate is
    // in SQL rather than over the fetched page.
    const expected: string[] = []
    for (let i = 0; i < 6; i++) {
      await makeEntry(`alpha ${i}`, [alpha])
      await makeEntry(`beta ${i}`, [beta])
      expected.push(`alpha ${i}`)
    }

    const seen: string[] = []
    let cursor: string | undefined
    do {
      const page = await listPublicChangelogs(
        { limit: 2, boardIds: [alpha], ...(cursor ? { cursor } : {}) },
        ANONYMOUS_ACTOR
      )
      seen.push(...page.items.map((entry) => entry.title))
      cursor = page.nextCursor ?? undefined
    } while (cursor)

    expect(seen.filter((t) => t.startsWith('alpha')).sort()).toEqual(expected.sort())
    expect(seen.filter((t) => t.startsWith('beta'))).toEqual([])
    expect(new Set(seen).size).toBe(seen.length)
  })

  it('projects products on entries in one lookup, keyed by entry (V1)', async () => {
    const alpha = await makeBoard('Alpha')
    const beta = await makeBoard('Beta')
    const first = await makeEntry('first', [alpha])
    const second = await makeEntry('second', [alpha, beta])
    const third = await makeEntry('third')

    const map = await getBoardsForEntries([first, second, third])
    expect(map.get(first)?.map((b) => b.name)).toEqual(['Alpha'])
    expect(map.get(second)?.map((b) => b.name)).toEqual(['Alpha', 'Beta'])
    expect(map.get(third)).toBeUndefined()
  })

  it('forgets an entry’s products when the entry is deleted', async () => {
    const alpha = await makeBoard('Alpha')
    const entry = await makeEntry('doomed', [alpha])

    await testDb.delete(changelogEntries).where(eq(changelogEntries.id, entry))
    expect(await getEntryBoardIds(entry)).toEqual([])
  })
})
