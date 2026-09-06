/**
 * The database side of the changelog's product (board) dimension: which
 * products an entry is assigned to, and how a resolved filter reaches SQL.
 *
 * The decision itself is in `changelog-board-filter.ts` and has no database in
 * it. This module is the part that has to agree with Postgres — and the reason
 * the predicate is built here rather than inline in the readers is that the
 * public list, the entry detail and the RSS feed must all filter identically.
 * Three copies of a `NOT EXISTS … OR EXISTS …` is three chances for one of them
 * to disagree about what an unassigned entry means.
 *
 * Authorization is checked by the callers (the server-function layer for
 * writes, `boardViewFilter` for reads), not here.
 */
import type { SQL } from 'drizzle-orm'
import {
  db,
  boards,
  changelogEntries,
  changelogEntryBoards,
  and,
  eq,
  inArray,
  isNull,
  asc,
  sql,
} from '@/lib/server/db'
import type { BoardId, ChangelogId } from '@quackback/ids'
import { boardViewFilter } from '@/lib/server/policy/boards'
import type { Actor } from '@/lib/server/policy/types'
import type { ChangelogBoardFilter } from './changelog-board-filter'
import type { ChangelogBoardSummary } from './changelog.types'

/**
 * Whether an entry is assigned to any product at all.
 *
 * Built per call rather than once at module scope: a `sql` template evaluated
 * at import time runs inside any suite that mocks `@/lib/server/db`, and a
 * throw there crashes the file during collection. Vitest then reports "no
 * tests" and a mutation runner reads zero failing tests as a survivor — it
 * under-reports in the reassuring direction (SELF-IMPROVE, 4x).
 */
function assignedToSomeBoard(): SQL {
  return sql`EXISTS (
    SELECT 1 FROM ${changelogEntryBoards}
    WHERE ${changelogEntryBoards.changelogEntryId} = ${changelogEntries.id}
  )`
}

/**
 * The products this reader is allowed to see, which is also exactly the set the
 * filter may act on and the set the UI may name.
 *
 * Reuses `boardViewFilter`, the same predicate the public board list and the
 * post readers use, so a board's audience is decided in one place — a changelog
 * filter must never become a second, weaker answer to "may you see this board".
 */
export async function visibleBoardIdsFor(actor: Actor): Promise<BoardId[]> {
  const rows = await db.select({ id: boards.id }).from(boards).where(boardViewFilter(actor))
  return rows.map((row) => row.id)
}

/**
 * The product predicate for a changelog read, or `undefined` when no product
 * was selected and the query should be left exactly as it was.
 *
 * An entry assigned to no product matches every filter — it is a cross-product
 * announcement (see the filter module). An empty `boardIds` on a filtered
 * request is therefore not "match everything": it selects the announcements and
 * nothing else, which is what a request naming only invisible products gets.
 */
export function changelogBoardFilterCondition(filter: ChangelogBoardFilter): SQL | undefined {
  if (!filter.filtered) return undefined
  const assigned = assignedToSomeBoard()
  if (filter.boardIds.length === 0) return sql`NOT ${assigned}`
  return sql`(
    NOT ${assigned}
    OR EXISTS (
      SELECT 1 FROM ${changelogEntryBoards}
      WHERE ${changelogEntryBoards.changelogEntryId} = ${changelogEntries.id}
        AND ${inArray(changelogEntryBoards.boardId, filter.boardIds)}
    )
  )`
}

/**
 * The products assigned to a set of entries, keyed by entry id, with no
 * audience filter. For the admin views, where reaching the list already
 * required the changelog permission.
 */
export async function getBoardsForEntries(
  entryIds: ChangelogId[]
): Promise<Map<ChangelogId, ChangelogBoardSummary[]>> {
  return boardsForEntries(entryIds, undefined)
}

/**
 * The same, narrowed to the products this reader may see.
 *
 * A separate name rather than an optional argument on the one above: an
 * audience filter that defaults to "off" when a caller forgets it fails open,
 * and the two call sites want genuinely different answers.
 */
export async function getVisibleBoardsForEntries(
  entryIds: ChangelogId[],
  actor: Actor
): Promise<Map<ChangelogId, ChangelogBoardSummary[]>> {
  return boardsForEntries(entryIds, actor)
}

async function boardsForEntries(
  entryIds: ChangelogId[],
  actor: Actor | undefined
): Promise<Map<ChangelogId, ChangelogBoardSummary[]>> {
  const map = new Map<ChangelogId, ChangelogBoardSummary[]>()
  if (entryIds.length === 0) return map

  const rows = await db
    .select({
      changelogEntryId: changelogEntryBoards.changelogEntryId,
      id: boards.id,
      name: boards.name,
      slug: boards.slug,
    })
    .from(changelogEntryBoards)
    .innerJoin(boards, eq(changelogEntryBoards.boardId, boards.id))
    .where(
      and(
        inArray(changelogEntryBoards.changelogEntryId, entryIds),
        ...(actor ? [boardViewFilter(actor)] : [isNull(boards.deletedAt)])
      )
    )
    .orderBy(asc(boards.name))

  for (const row of rows) {
    const existing = map.get(row.changelogEntryId) ?? []
    existing.push({ id: row.id, name: row.name, slug: row.slug })
    map.set(row.changelogEntryId, existing)
  }
  return map
}

/** The product ids assigned to one entry — what the admin editor loads. */
export async function getEntryBoardIds(entryId: ChangelogId): Promise<BoardId[]> {
  const rows = await db
    .select({ boardId: changelogEntryBoards.boardId })
    .from(changelogEntryBoards)
    .where(eq(changelogEntryBoards.changelogEntryId, entryId))
  return rows.map((row) => row.boardId)
}

/**
 * Replace the full set of products assigned to an entry.
 *
 * Unknown and soft-deleted board ids are dropped rather than raising, which is
 * how `setEntryCategories` treats an unknown category: a stale id in a form
 * that was open while someone deleted a board should not fail the save.
 */
export async function setEntryBoards(entryId: ChangelogId, boardIds: BoardId[]): Promise<void> {
  await db.delete(changelogEntryBoards).where(eq(changelogEntryBoards.changelogEntryId, entryId))

  if (boardIds.length === 0) return

  const existing = await db
    .select({ id: boards.id })
    .from(boards)
    .where(and(inArray(boards.id, boardIds), isNull(boards.deletedAt)))
  const validIds = new Set(existing.map((row) => row.id))
  const toLink = Array.from(new Set(boardIds)).filter((id) => validIds.has(id))

  if (toLink.length === 0) return

  await db
    .insert(changelogEntryBoards)
    .values(toLink.map((boardId) => ({ changelogEntryId: entryId, boardId })))
}
