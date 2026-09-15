import { describe, expect, it, vi } from 'vitest'
import type { AnyColumn, SQL } from 'drizzle-orm'
import type { PgTable } from 'drizzle-orm/pg-core'

/**
 * ## T — Taxonomy names, colours, slugs, positions
 * - T6 A newly created ordered entity lands one position after the current
 *   last one, and at position 0 in an empty (or filtered-empty) list.
 */

const { mockWhere, mockFrom, mockSelect } = vi.hoisted(() => {
  const mockWhere = vi.fn()
  const mockFrom = vi.fn()
  const mockSelect = vi.fn(() => ({ from: mockFrom }))
  return { mockWhere, mockFrom, mockSelect }
})

vi.mock('@/lib/server/db', () => ({
  db: { select: mockSelect },
}))

import { nextPosition } from '../next-position'

/**
 * `db.select(...).from(table)` has to work BOTH as an awaitable (no `where`
 * clause) and as a chain exposing `.where(...)` (a `where` clause given) —
 * the production code branches on that at the call site. This chain supports
 * both without special-casing which path a test takes.
 */
function fromChain(defaultResult: Array<{ max: number }>) {
  return {
    where: mockWhere,
    then: (resolve: (v: Array<{ max: number }>) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve(defaultResult).then(resolve, reject),
  }
}

const table = {} as PgTable
const column = {} as AnyColumn
const where = { fake: 'condition' } as unknown as SQL

describe('nextPosition', () => {
  it('returns one past the current max row, with no where clause (T6)', async () => {
    mockFrom.mockReturnValue(fromChain([{ max: 4 }]))

    const result = await nextPosition(table, column)

    expect(result).toBe(5)
    expect(mockWhere).not.toHaveBeenCalled()
  })

  it('returns 0 for an empty (or filtered-empty) table — coalesce(max, -1) + 1 (T6)', async () => {
    mockFrom.mockReturnValue(fromChain([{ max: -1 }]))

    const result = await nextPosition(table, column)

    expect(result).toBe(0)
  })

  it('applies a given where filter and derives the position from ITS result (T6)', async () => {
    mockFrom.mockReturnValue(fromChain([{ max: 999 }])) // must be ignored — the where path wins
    mockWhere.mockResolvedValue([{ max: 2 }])

    const result = await nextPosition(table, column, where)

    expect(result).toBe(3)
    expect(mockWhere).toHaveBeenCalledWith(where)
  })

  it('returns 0 when the where-filtered result is empty (T6)', async () => {
    mockFrom.mockReturnValue(fromChain([{ max: 999 }]))
    mockWhere.mockResolvedValue([])

    const result = await nextPosition(table, column, where)

    expect(result).toBe(0)
  })
})
