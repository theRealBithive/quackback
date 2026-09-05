/**
 * The product backfill that ships with migration 0275, against real Postgres.
 *
 * V12 is the one guarantee in this contract that nothing in the application
 * holds: it is a single INSERT inside a migration file, it runs once per
 * database, and afterwards there is no code path left that could be asked
 * whether it did the right thing. Until this file existed the number was
 * carried by a sentence in the migration's own comment, which is the shape of
 * a guarantee nobody can fail.
 *
 * So this suite executes the statement out of the migration file itself,
 * against rows seeded here, rather than restating the query. A backfill this
 * suite agreed with because it was copied from the same source would prove
 * nothing.
 *
 * V2  An entry assigned to no product is a cross-product announcement — it
 *     appears under every product filter, and in the unfiltered list.
 * V12 History is preserved: on introduction, an entry that already links
 *     shipped feedback is assigned to the products those posts belong to.
 *
 * One question the contract does not answer, and the SQL decides on its own:
 * the statement skips posts with `deleted_at` set, so an entry whose only
 * linked feedback was deleted later comes out unassigned. Both readings are
 * defensible — the entry did ship that product's feedback, and a deleted post
 * is no longer evidence of anything — and the difference is visible to a reader
 * on the day the filter ships. It is deliberately not asserted here: a test
 * either way would be read off the implementation rather than off the contract.
 * Recorded so the decision is made by a person and not by an omission.
 *
 * The contract was agreed in German and is written here in English, which is
 * the language of this repository.
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import {
  boards,
  changelogEntries,
  changelogEntryBoards,
  changelogEntryPosts,
  eq,
  posts,
  principal,
  sql,
  user,
} from '@/lib/server/db'
import { generateId } from '@quackback/ids'
import type { BoardId, ChangelogId, PostId, PrincipalId, UserId } from '@quackback/ids'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

const MIGRATION_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../../../../../packages/db/drizzle/0275_changelog_entry_boards.sql'
)

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

/**
 * The backfill statement, taken out of the migration rather than retyped.
 *
 * Read inside the test rather than at module scope: a file this suite cannot
 * find has to fail as a failing test, not as a collection error, because a
 * suite that dies while being collected is reported as "nothing ran" by every
 * gate that reads it.
 */
function backfillStatement(): string {
  const migration = readFileSync(MIGRATION_PATH, 'utf8')
  const statement = migration
    .split('--> statement-breakpoint')
    .map((part) => part.trim())
    .find((part) => part.includes('INSERT INTO "changelog_entry_boards"'))
  if (!statement) {
    throw new Error(`No backfill INSERT found in ${MIGRATION_PATH}. Was the migration renamed?`)
  }
  return statement
}

async function runBackfill(): Promise<void> {
  await testDb.execute(sql.raw(backfillStatement()))
}

async function makeBoard(name: string): Promise<BoardId> {
  const [row] = await testDb
    .insert(boards)
    .values({
      slug: `${name}-${Math.random().toString(36).slice(2, 10)}`,
      name,
      access: PUBLIC_ACCESS as never,
    })
    .returning({ id: boards.id })
  return row.id
}

/** Somebody has to be the author; the FK is real. */
async function makeAuthor(): Promise<PrincipalId> {
  const userId = generateId('user') as UserId
  await testDb.insert(user).values({
    id: userId,
    name: 'Reporter',
    email: `reporter-${Math.random().toString(36).slice(2, 10)}@acme.example`,
    emailVerified: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  })
  const principalId = generateId('principal') as PrincipalId
  await testDb
    .insert(principal)
    .values({ id: principalId, userId, role: 'user', type: 'user', createdAt: new Date() })
  return principalId
}

async function makePost(
  boardId: BoardId,
  principalId: PrincipalId,
  title: string
): Promise<PostId> {
  const [row] = await testDb
    .insert(posts)
    .values({ boardId, principalId, title, content: title })
    .returning({ id: posts.id })
  return row.id
}

/** A published entry that links the given shipped feedback and nothing else. */
async function makeEntry(title: string, postIds: PostId[]): Promise<ChangelogId> {
  const [row] = await testDb
    .insert(changelogEntries)
    .values({ title, content: title, publishedAt: new Date(Date.now() - 60_000) })
    .returning({ id: changelogEntries.id })
  for (const postId of postIds) {
    await testDb.insert(changelogEntryPosts).values({ changelogEntryId: row.id, postId })
  }
  return row.id
}

/** The products the backfill gave one entry, sorted so assertions are stable. */
async function productsOf(entryId: ChangelogId): Promise<BoardId[]> {
  const rows = await testDb
    .select({ boardId: changelogEntryBoards.boardId })
    .from(changelogEntryBoards)
    .where(eq(changelogEntryBoards.changelogEntryId, entryId))
  return rows.map((row) => row.boardId).sort()
}

describe.skipIf(!fixture.available)('the product backfill in migration 0275', () => {
  beforeEach(fixture.begin)
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  it('gives an entry the products of the feedback it shipped (V12)', async () => {
    const author = await makeAuthor()
    const alpha = await makeBoard('alpha')
    const beta = await makeBoard('beta')
    // A third product with feedback of its own that this entry did not ship.
    // "The products those posts belong to" is a claim about which products are
    // left out as much as about which are named.
    const gamma = await makeBoard('gamma')
    await makePost(gamma, author, 'Gamma request')
    const entry = await makeEntry('Release', [
      await makePost(alpha, author, 'Alpha request'),
      await makePost(beta, author, 'Beta request'),
    ])

    await runBackfill()

    expect(await productsOf(entry)).toEqual([alpha, beta].sort())
  })

  it('leaves an entry that shipped no feedback unassigned (V12, V2)', async () => {
    const author = await makeAuthor()
    const alpha = await makeBoard('alpha')
    await makePost(alpha, author, 'Unrelated request')
    const announcement = await makeEntry('We moved office', [])

    await runBackfill()

    expect(await productsOf(announcement)).toEqual([])
  })

  it('names a product once, however much of its feedback an entry shipped (V12)', async () => {
    // The `DISTINCT` in the statement is not what holds this: measured by
    // removing it, all six tests here stay green, because `ON CONFLICT DO
    // NOTHING` absorbs the duplicate rows within the same INSERT. The
    // guarantee survives either spelling, which is the reason to assert it
    // on the result rather than on the query.
    const author = await makeAuthor()
    const alpha = await makeBoard('alpha')
    const entry = await makeEntry('Release', [
      await makePost(alpha, author, 'First request'),
      await makePost(alpha, author, 'Second request'),
      await makePost(alpha, author, 'Third request'),
    ])

    await runBackfill()

    expect(await productsOf(entry)).toEqual([alpha])
  })

  it('gives each entry its own products and not its neighbour’s (V12)', async () => {
    const author = await makeAuthor()
    const alpha = await makeBoard('alpha')
    const beta = await makeBoard('beta')
    const alphaEntry = await makeEntry('Alpha release', [
      await makePost(alpha, author, 'Alpha request'),
    ])
    const betaEntry = await makeEntry('Beta release', [
      await makePost(beta, author, 'Beta request'),
    ])

    await runBackfill()

    expect(await productsOf(alphaEntry)).toEqual([alpha])
    expect(await productsOf(betaEntry)).toEqual([beta])
  })

  it('is a no-op the second time, so a fleet replay changes nothing', async () => {
    const author = await makeAuthor()
    const alpha = await makeBoard('alpha')
    const entry = await makeEntry('Release', [await makePost(alpha, author, 'Alpha request')])

    await runBackfill()
    const afterFirst = await productsOf(entry)
    await runBackfill()

    expect(await productsOf(entry)).toEqual(afterFirst)
    expect(afterFirst).toEqual([alpha])
  })

  it('never overwrites a product an editor assigned by hand (V12)', async () => {
    // The backfill exists to give history a starting point, not to become the
    // authority on it. An entry someone has already curated must survive a
    // replay of the migration unchanged, including a product whose feedback
    // the entry never linked.
    const author = await makeAuthor()
    const alpha = await makeBoard('alpha')
    const beta = await makeBoard('beta')
    const entry = await makeEntry('Release', [await makePost(alpha, author, 'Alpha request')])
    await testDb.insert(changelogEntryBoards).values({ changelogEntryId: entry, boardId: beta })

    await runBackfill()

    expect(await productsOf(entry)).toEqual([alpha, beta].sort())
  })
})
