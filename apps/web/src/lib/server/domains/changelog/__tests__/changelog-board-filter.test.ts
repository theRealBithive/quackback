/**
 * The changelog's product (board) filter.
 *
 * Contract — the guarantees this filter makes, in domain language. Every test
 * below names its number; a test with no number was probably read off the
 * implementation, and a number with no test is a gap.
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
 * V9  The filter survives sharing: the chosen products are part of the page
 *     address, and opening that address reproduces the same list.
 * V10 Paging through a filtered changelog returns each matching entry exactly
 *     once and never returns a non-matching one.
 * V11 The RSS feed filters by the same products under the same rules as the
 *     page.
 * V12 History is preserved: on introduction, an entry that already links
 *     shipped feedback is assigned to the products those posts belong to.
 *
 * V6, V9, V10 and V11 need a database, a request or a browser and are held in
 * `changelog-board.db.test.ts` and the route suites. V12 is a statement inside
 * migration 0275 and is held in `changelog-board-backfill.db.test.ts`, which
 * runs that statement out of the file. V8 is held here as a non-interference
 * property and again against the real reader in the DB suite.
 */
import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import type { BoardId } from '@quackback/ids'
import {
  changelogEntryMatchesBoardFilter,
  resolveChangelogBoardFilter,
  type ChangelogBoardFilter,
} from '../changelog-board-filter'

/**
 * A small alphabet, so generated ids collide often enough to be interesting.
 * Written in the real `board_…` shape rather than cast, so nothing here can
 * pass on an id the rest of the system would reject.
 */
const BOARDS = ['board_a', 'board_b', 'board_c', 'board_d', 'board_e'] as const satisfies BoardId[]
const boardId: fc.Arbitrary<BoardId> = fc.constantFrom(...BOARDS)
const boardIds = fc.array(boardId, { maxLength: 5 })

/** An id no generated board ever uses — the "not visible / does not exist" case. */
const STRANGER: BoardId = 'board_stranger'

/** Reader-visible boards, plus the entries a workspace holds. */
const scenario = fc.record({
  visible: boardIds,
  requested: boardIds,
  entryBoards: boardIds,
})

describe('resolveChangelogBoardFilter', () => {
  it('asking for nothing is the unfiltered changelog (V5)', () => {
    expect(resolveChangelogBoardFilter(undefined, [BOARDS[0]])).toEqual({ filtered: false })
    expect(resolveChangelogBoardFilter([], [BOARDS[0]])).toEqual({ filtered: false })
  })

  it('asking only for boards the reader cannot see is a filter, not an absence of one (V7)', () => {
    // The distinction that matters: this is NOT { filtered: false }. Falling
    // back to the unfiltered list would answer a question about a private
    // board with that board's neighbours' content.
    expect(resolveChangelogBoardFilter([STRANGER], [BOARDS[0]])).toEqual({
      filtered: true,
      boardIds: [],
    })
  })

  it('keeps the visible half of a mixed request (V7)', () => {
    expect(
      resolveChangelogBoardFilter([BOARDS[0], STRANGER, BOARDS[1]], [BOARDS[0], BOARDS[1]])
    ).toEqual({ filtered: true, boardIds: [BOARDS[0], BOARDS[1]] })
  })

  it('repeating a board asks for it once (V1)', () => {
    expect(resolveChangelogBoardFilter([BOARDS[0], BOARDS[0], BOARDS[0]], [BOARDS[0]])).toEqual({
      filtered: true,
      boardIds: [BOARDS[0]],
    })
  })

  it('never resolves to a board the reader cannot see (V7)', () => {
    fc.assert(
      fc.property(boardIds, boardIds, (requested, visible) => {
        const filter = resolveChangelogBoardFilter(requested, visible)
        expect(filter.filtered).toBe(requested.length > 0)
        if (!filter.filtered) return
        for (const id of filter.boardIds) {
          expect(visible).toContain(id)
          expect(requested).toContain(id)
        }
      })
    )
  })

  it('resolves each board at most once (V1)', () => {
    fc.assert(
      fc.property(boardIds, boardIds, (requested, visible) => {
        const filter = resolveChangelogBoardFilter(requested, visible)
        expect(filter.filtered).toBe(requested.length > 0)
        if (!filter.filtered) return
        expect(new Set(filter.boardIds).size).toBe(filter.boardIds.length)
      })
    )
  })
})

describe('changelogEntryMatchesBoardFilter', () => {
  it('shows everything when no product is selected (V5)', () => {
    fc.assert(
      fc.property(boardIds, (entryBoards) => {
        expect(changelogEntryMatchesBoardFilter(entryBoards, { filtered: false })).toBe(true)
      })
    )
  })

  it('shows an entry with no product under every filter (V2)', () => {
    fc.assert(
      fc.property(boardIds, boardIds, (requested, visible) => {
        const filter = resolveChangelogBoardFilter(requested, visible)
        expect(filter.filtered).toBe(requested.length > 0)
        expect(changelogEntryMatchesBoardFilter([], filter)).toBe(true)
      })
    )
  })

  it('shows a product-specific entry only under its own products (V3)', () => {
    fc.assert(
      fc.property(scenario, ({ visible, requested, entryBoards }) => {
        fc.pre(entryBoards.length > 0)
        const filter = resolveChangelogBoardFilter(requested, visible)
        expect(filter.filtered).toBe(requested.length > 0)
        if (!filter.filtered) return
        const shares = entryBoards.some((id) => filter.boardIds.includes(id))
        expect(changelogEntryMatchesBoardFilter(entryBoards, filter)).toBe(shares)
      })
    )
  })

  it('several products are a union of the single-product answers (V4)', () => {
    fc.assert(
      fc.property(boardIds, boardIds, boardIds, (entryBoards, visible, requested) => {
        const combined = resolveChangelogBoardFilter(requested, visible)
        expect(combined.filtered).toBe(requested.length > 0)
        if (!combined.filtered || combined.boardIds.length === 0) return
        const anySingleMatches = combined.boardIds.some((id) =>
          changelogEntryMatchesBoardFilter(entryBoards, { filtered: true, boardIds: [id] })
        )
        expect(changelogEntryMatchesBoardFilter(entryBoards, combined)).toBe(anySingleMatches)
      })
    )
  })

  it('an invisible product changes no answer for any entry (V7, V8)', () => {
    // Non-interference: the strongest statement of "contributes nothing".
    // Asserted over every entry shape, not only the one that shares a board,
    // so it also holds the line for V8 — the presence of a board a reader
    // cannot see never makes an entry more or less readable.
    fc.assert(
      fc.property(scenario, fc.integer({ min: 0, max: 5 }), (s, at) => {
        fc.pre(s.requested.length > 0)
        const withStranger = [...s.requested]
        withStranger.splice(Math.min(at, withStranger.length), 0, STRANGER)

        const before = resolveChangelogBoardFilter(s.requested, s.visible)
        const after = resolveChangelogBoardFilter(withStranger, s.visible)

        expect(changelogEntryMatchesBoardFilter(s.entryBoards, after)).toBe(
          changelogEntryMatchesBoardFilter(s.entryBoards, before)
        )
      })
    )
  })

  it('a filter that resolved to no visible product shows announcements and nothing else (V2, V7)', () => {
    const filter: ChangelogBoardFilter = { filtered: true, boardIds: [] }
    expect(changelogEntryMatchesBoardFilter([], filter)).toBe(true)
    expect(changelogEntryMatchesBoardFilter([BOARDS[0]], filter)).toBe(false)
  })

  it('widening the selection never hides an entry (V4)', () => {
    // The conservation law that holds across every branch, asserted without a
    // guard: selecting more products is monotone. It is what stops the union
    // in V4 from being read as an intersection anywhere.
    fc.assert(
      fc.property(boardIds, boardIds, boardId, (entryBoards, selected, extra) => {
        const narrow: ChangelogBoardFilter = { filtered: true, boardIds: selected }
        const wide: ChangelogBoardFilter = { filtered: true, boardIds: [...selected, extra] }
        const inNarrow = changelogEntryMatchesBoardFilter(entryBoards, narrow)
        const inWide = changelogEntryMatchesBoardFilter(entryBoards, wide)
        expect(inWide || !inNarrow).toBe(true)
      })
    )
  })

  it('a product-specific entry is never shown by a filter that excludes it (V3)', () => {
    fc.assert(
      fc.property(boardIds, boardIds, (entryBoards, selected) => {
        fc.pre(entryBoards.length > 0)
        fc.pre(!entryBoards.some((id) => selected.includes(id)))
        expect(
          changelogEntryMatchesBoardFilter(entryBoards, { filtered: true, boardIds: selected })
        ).toBe(false)
      })
    )
  })
})
