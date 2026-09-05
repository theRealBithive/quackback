/**
 * Assigning products to a changelog entry, against real Postgres.
 *
 * `changelog-board.db.test.ts` holds the reading end — which entries a product
 * filter returns. This file holds the writing end: what an editor's choice in
 * the changelog editor actually does to the entry, and what the admin list
 * shows them afterwards. The two halves are separate files because this one
 * has to silence event dispatch and job scheduling, and that silence has no
 * business reaching the read tests.
 *
 * V1  A changelog entry can be assigned to any number of products: none, one,
 *     or several.
 * V2  An entry assigned to no product is a cross-product announcement — it
 *     appears under every product filter, and in the unfiltered list.
 * V8  Assigning a product to an entry never changes who may read that entry.
 *     Product assignment is editorial metadata, not an access control.
 *
 * The contract was agreed in German and is written here in English, which is
 * the language of this repository.
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { boards, changelogEntryBoards, principal, user } from '@/lib/server/db'
import { generateId } from '@quackback/ids'
import type { BoardId, ChangelogId, PrincipalId, UserId } from '@quackback/ids'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))
vi.mock('@/lib/server/events/dispatch', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/events/dispatch')>()),
  dispatchChangelogPublished: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/lib/server/events/scheduler', () => ({
  scheduleDispatch: vi.fn(),
  cancelScheduledDispatch: vi.fn(),
}))
vi.mock('@/lib/server/content/rehost-images', () => ({
  rehostExternalImages: vi.fn(async (json: unknown) => json),
}))

import { createChangelog, updateChangelog } from '../changelog.service'
import { listChangelogs } from '../changelog.query'
import { getEntryBoardIds } from '../changelog-board.service'

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

/** A board, named so a failure message says which one. */
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
async function makeAuthor(): Promise<{ principalId: PrincipalId; name: string }> {
  const userId = generateId('user') as UserId
  await testDb.insert(user).values({
    id: userId,
    name: 'Editor',
    email: `editor-${Math.random().toString(36).slice(2, 10)}@acme.example`,
    emailVerified: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  })
  const principalId = generateId('principal') as PrincipalId
  await testDb
    .insert(principal)
    .values({ id: principalId, userId, role: 'admin', type: 'user', createdAt: new Date() })
  return { principalId, name: 'Editor' }
}

async function publishEntry(
  author: { principalId: PrincipalId; name: string },
  boardIds?: BoardId[]
): Promise<ChangelogId> {
  const entry = await createChangelog(
    {
      title: 'Release',
      content: 'Body',
      publishState: { type: 'published' },
      ...(boardIds ? { boardIds } : {}),
    },
    author
  )
  return entry.id
}

describe.skipIf(!fixture.available)('assigning products in the changelog editor', () => {
  beforeEach(fixture.begin)
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  it('keeps the products chosen while writing the entry (V1)', async () => {
    const author = await makeAuthor()
    const alpha = await makeBoard('alpha')
    const beta = await makeBoard('beta')

    const id = await publishEntry(author, [alpha, beta])

    expect((await getEntryBoardIds(id)).sort()).toEqual([alpha, beta].sort())
  })

  it('leaves an entry saved without a product unassigned rather than guessing (V2)', async () => {
    const author = await makeAuthor()
    await makeBoard('alpha')

    const id = await publishEntry(author)

    expect(await getEntryBoardIds(id)).toEqual([])
  })

  it('replaces the whole assignment on update, so a product can be swapped (V1)', async () => {
    const author = await makeAuthor()
    const alpha = await makeBoard('alpha')
    const beta = await makeBoard('beta')
    const id = await publishEntry(author, [alpha])

    await updateChangelog(id, { boardIds: [beta] })

    expect(await getEntryBoardIds(id)).toEqual([beta])
  })

  it('takes an entry off every product when the editor clears the picker (V2)', async () => {
    // An empty list on update is the editor saying "this is for everyone", and
    // has to differ from not touching the field at all.
    const author = await makeAuthor()
    const alpha = await makeBoard('alpha')
    const id = await publishEntry(author, [alpha])

    await updateChangelog(id, { boardIds: [] })

    expect(await getEntryBoardIds(id)).toEqual([])
  })

  it('leaves the assignment alone when the update does not mention products (V1)', async () => {
    const author = await makeAuthor()
    const alpha = await makeBoard('alpha')
    const id = await publishEntry(author, [alpha])

    await updateChangelog(id, { title: 'Renamed' })

    expect(await getEntryBoardIds(id)).toEqual([alpha])
  })

  it('shows the editor every product an entry carries, in the admin list (V1)', async () => {
    const author = await makeAuthor()
    const alpha = await makeBoard('Datenschutzkulpix')
    const beta = await makeBoard('ASBS-Kulpix')
    const assigned = await publishEntry(author, [alpha, beta])
    const announcement = await publishEntry(author)

    const list = await listChangelogs({ status: 'all', limit: 50 })
    const byId = new Map(list.items.map((entry) => [entry.id, entry]))

    expect(
      byId
        .get(assigned)!
        .boards.map((b) => b.name)
        .sort()
    ).toEqual(['ASBS-Kulpix', 'Datenschutzkulpix'])
    expect(byId.get(announcement)!.boards).toEqual([])
  })

  it('shows a product the reader of the portal may not see, because this is the admin list (V8)', async () => {
    // The admin list has no audience filter on purpose: reaching it already
    // required the changelog permission, and an editor who cannot see the
    // product they assigned would be unable to correct it.
    const author = await makeAuthor()
    const [row] = await testDb
      .insert(boards)
      .values({
        slug: `internal-${Math.random().toString(36).slice(2, 10)}`,
        name: 'Kulpix intern',
        access: { ...PUBLIC_ACCESS, view: 'team' } as never,
      })
      .returning({ id: boards.id })
    const id = await publishEntry(author, [row.id])

    const list = await listChangelogs({ status: 'all', limit: 50 })
    const entry = list.items.find((item) => item.id === id)!

    expect(entry.boards.map((b) => b.name)).toEqual(['Kulpix intern'])
  })
})
