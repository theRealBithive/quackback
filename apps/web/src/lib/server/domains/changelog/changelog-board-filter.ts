/**
 * Which changelog entries a product (board) filter selects.
 *
 * Boards are how a workspace models its products, and the roadmap already lets
 * a reader narrow to one. This is the same dimension for the changelog. The
 * whole decision lives here, with no database and no request in sight, because
 * three of its rules are easy to get subtly wrong and expensive to notice:
 *
 * - **An entry with no product is a cross-product announcement.** It is not an
 *   unassigned entry waiting to be tagged, and it stays visible under every
 *   product filter. An admin says "this is only about product X" by tagging it;
 *   saying nothing means "this is about all of them".
 * - **A product the reader may not see contributes nothing.** It cannot widen
 *   the result, it cannot narrow it to an error, and the reader cannot tell it
 *   apart from a product that simply has no entries. That is what keeps a
 *   private board's existence out of a public URL.
 * - **Several products are a union.** Asking for X and Y means "anything about
 *   X or about Y", not "things about both".
 *
 * Nothing here is an access control. A product assignment never changes who may
 * read an entry — that stays with the category segment gate — it only changes
 * which filtered lists the entry turns up in.
 */
import type { BoardId } from '@quackback/ids'

/**
 * A resolved product filter.
 *
 * `filtered: false` is the unfiltered changelog, byte for byte what it was
 * before this feature existed. `filtered: true` carries only the boards the
 * reader is actually allowed to see, and an empty list is a real state: it is
 * what a reader asking exclusively for boards they may not see gets, and it
 * selects the cross-product announcements and nothing else.
 */
export type ChangelogBoardFilter = { filtered: false } | { filtered: true; boardIds: BoardId[] }

/**
 * Turn the board ids a reader asked for into the ones that may act on the
 * query, given the boards that reader is allowed to see.
 *
 * Requesting nothing is not the same as requesting nothing visible: the first
 * is the unfiltered list, the second selects cross-product entries only.
 *
 * @param requested - Board ids from the request, in the order given
 * @param visibleBoardIds - Board ids this reader may see (from `boardViewFilter`)
 */
export function resolveChangelogBoardFilter(
  requested: readonly string[] | undefined,
  visibleBoardIds: readonly BoardId[]
): ChangelogBoardFilter {
  if (!requested || requested.length === 0) return { filtered: false }

  const visible = new Set<string>(visibleBoardIds)
  const boardIds: BoardId[] = []
  for (const id of requested) {
    if (!visible.has(id)) continue
    if (boardIds.includes(id as BoardId)) continue
    boardIds.push(id as BoardId)
  }
  return { filtered: true, boardIds }
}

/**
 * Whether an entry belongs in a filtered list, given the products it is
 * assigned to.
 *
 * The SQL predicate in `changelog-board.service.ts` says the same thing to
 * Postgres; this is the readable statement of it, and the one the tests hold.
 *
 * @param entryBoardIds - The products this entry is assigned to ([] = all)
 * @param filter - A resolved filter from {@link resolveChangelogBoardFilter}
 */
export function changelogEntryMatchesBoardFilter(
  entryBoardIds: readonly string[],
  filter: ChangelogBoardFilter
): boolean {
  if (!filter.filtered) return true
  if (entryBoardIds.length === 0) return true
  return entryBoardIds.some((id) => filter.boardIds.includes(id as BoardId))
}
