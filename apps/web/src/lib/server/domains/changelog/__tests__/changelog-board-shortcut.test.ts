/**
 * What the product service does when there is nothing to ask the database.
 *
 * V5 With no product filter selected, the changelog shows exactly what it
 *    showed before this change.
 *
 * Both guarantees here are the "exactly" in V5. Every changelog page — filtered
 * or not, empty or not — now passes through this module, so a lookup it does
 * not need is a cost the page did not have before, and clearing an assignment
 * has no product to validate. Neither is visible in the answer, which is why
 * neither can be held by the suite against real Postgres: `testDb` is a proxy
 * onto the running transaction and cannot be spied on. A counting stub can.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { BoardId, ChangelogId } from '@quackback/ids'

const selects = vi.fn()
const deletes = vi.fn()
const inserts = vi.fn()

/** A query chain that answers with no rows however deep it is followed. */
function emptyChain(): Record<string, unknown> {
  const chain: Record<string, unknown> = {}
  const self = () => chain
  chain.from = self
  chain.innerJoin = self
  chain.where = self
  chain.orderBy = self
  chain.then = (onOk: (v: unknown) => unknown, onErr: (e: unknown) => unknown) =>
    Promise.resolve([]).then(onOk, onErr)
  return chain
}

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: {
    select: (...args: unknown[]) => {
      selects(...args)
      return emptyChain()
    },
    delete: () => ({ where: (...args: unknown[]) => deletes(...args) }),
    insert: () => ({ values: (...args: unknown[]) => inserts(...args) }),
  },
}))

import { getBoardsForEntries, setEntryBoards } from '../changelog-board.service'

const ENTRY = 'changelog_one' as ChangelogId

beforeEach(() => {
  vi.clearAllMocks()
})

describe('the product service, asked about nothing', () => {
  it('answers for an empty page without querying at all (V5)', async () => {
    const result = await getBoardsForEntries([])

    expect(result).toEqual(new Map())
    expect(selects).not.toHaveBeenCalled()
  })

  it('clears an assignment without looking a product up first (V5)', async () => {
    await setEntryBoards(ENTRY, [])

    expect(deletes).toHaveBeenCalledTimes(1)
    expect(selects).not.toHaveBeenCalled()
    expect(inserts).not.toHaveBeenCalled()
  })

  it('still drops the old links when the new assignment is empty (V5)', async () => {
    // The clearing is the whole point of the call; the shortcut above must not
    // shorten it away.
    await setEntryBoards(ENTRY, [])

    expect(deletes).toHaveBeenCalledTimes(1)
  })

  it('does look products up when it was given some', async () => {
    // The negative assertions above are only worth something if the positive
    // case reaches the query they claim is skipped.
    await setEntryBoards(ENTRY, ['board_01j0000000000000000000000' as BoardId])

    expect(selects).toHaveBeenCalledTimes(1)
  })
})
