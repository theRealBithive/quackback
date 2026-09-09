import type { SQL } from 'drizzle-orm'
import { db, eq, inArray, isNull, or, posts, postStatuses } from '@/lib/server/db'

/**
 * The portal's default notion of an open post: it has no status, or its
 * status is in the `active` category. Complete and closed posts fall out of
 * the default portal list, and therefore also out of the number the portal
 * shows beside a board.
 *
 * Both the list (`post.public.ts`) and the board count (`board.public.ts`)
 * take their predicate from here so the two cannot drift apart again. They
 * did once: the count included closed posts the list never showed, so a board
 * read "3" over two visible posts.
 *
 * Only the status's category is consulted. A status that was soft-deleted but
 * is still attached to a post keeps deciding by its category, exactly as the
 * list has always read it.
 *
 * Built on every call rather than once at module scope: a query builder
 * evaluated at import time turns every mutant inside it into a
 * suite-collection crash, which Stryker reports as survived (SELF-IMPROVE.md).
 */
export function portalDefaultStatusFilter(): SQL {
  const activeStatusIds = db
    .select({ id: postStatuses.id })
    .from(postStatuses)
    .where(eq(postStatuses.category, 'active'))
  return or(isNull(posts.statusId), inArray(posts.statusId, activeStatusIds))!
}
