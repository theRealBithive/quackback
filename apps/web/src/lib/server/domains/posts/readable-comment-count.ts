import type { SQL } from 'drizzle-orm'
import { db, sql, postComments } from '@/lib/server/db'
import { getExecuteRows } from '@/lib/server/utils'

/**
 * How many comments of a thread a reader can see, replies included — the
 * number the comment heading shows.
 *
 * A comment is readable when it passes the page's visibility filter and so
 * does every comment above it: the thread drops a reply whose parent is not
 * shown, so the walk starts at the visible roots and descends only through
 * visible comments. A deleted comment stays in the walk, because its replies
 * are still shown under a placeholder, but is not counted itself.
 *
 * `postIdInList` is the comma-joined list of post ids whose comments form the
 * thread (a post and the posts merged into it). `visibilityFilter` is a
 * fragment of `AND …` conditions on the alias `c`, the same one the page
 * query applies.
 */
export async function countReadableComments(
  postIdInList: SQL,
  visibilityFilter: SQL
): Promise<number> {
  const result = await db.execute<{ count: string | number }>(sql`
    WITH RECURSIVE readable AS (
      SELECT c.id, c.deleted_at
      FROM ${postComments} c
      WHERE c.post_id IN (${postIdInList})
        AND c.parent_id IS NULL
        ${visibilityFilter}
      UNION ALL
      SELECT c.id, c.deleted_at
      FROM ${postComments} c
      INNER JOIN readable r ON c.parent_id = r.id
      WHERE c.post_id IN (${postIdInList})
        ${visibilityFilter}
    )
    SELECT COUNT(*)::int as count FROM readable WHERE deleted_at IS NULL
  `)
  const rows = getExecuteRows<{ count: string | number }>(result)
  return Number(rows[0]?.count ?? 0)
}
