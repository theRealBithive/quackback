/**
 * Patching the cached inbox post lists.
 *
 * `inboxKeys.lists()` is the key PREFIX `['inbox','list']`, and it is not the
 * post lists' alone: the filter-facet counts hang below it on purpose
 * (`['inbox','list','facet-counts',filters]`) so that invalidating the lists
 * also refreshes the counts. `setQueriesData` matches by prefix, so every
 * optimistic list patch is handed the counts cache as well — and a counts
 * payload has no `pages`.
 *
 * Reaching into it threw a TypeError inside `onMutate`, which aborted the
 * mutation before it reached the server: changing a post's assignee, status or
 * tags from the detail sidebar failed with "Cannot read properties of undefined
 * (reading 'map')" and never left the browser. So the shape is checked rather
 * than assumed, and anything that is not an inbox post list is handed back
 * exactly as it came in.
 *
 * The check descends into the pages, which upstream's own fix (615e4da2b) does
 * and this one originally did not: an entry carrying a `pages` array of
 * something other than post pages passed the outer test and threw one line
 * further in, on `page.items`.
 */
import type { InfiniteData } from '@tanstack/react-query'
import type { InboxPostListResult, PostListItem } from '@/lib/shared/db-types'

/** Rewrite one page's rows. */
export type InboxRowsPatch = (items: PostListItem[]) => PostListItem[]

/**
 * Apply `patchRows` to every page of one cached inbox list.
 *
 * The parameter type is what `setQueriesData` promises, not what it delivers —
 * see the note above — so `cached` is shape-checked at runtime. A cache that is
 * not a post list is returned unchanged and by identity, which is also what
 * keeps it from re-rendering its readers.
 */
export function patchInboxListCache(
  cached: InfiniteData<InboxPostListResult> | undefined,
  patchRows: InboxRowsPatch
): InfiniteData<InboxPostListResult> | undefined {
  // The negative branch types `cached` as `undefined`, which is the declared
  // parameter type being honest about itself: anything else reaching here is a
  // cache `setQueriesData` promised would be a post list and was not.
  if (!isInboxPostList(cached)) return cached
  return {
    ...cached,
    pages: cached.pages.map((page) => ({ ...page, items: patchRows(page.items) })),
  }
}

/** True for `{ pages: [...] }` where every page carries a row array. */
function isInboxPostList(cached: unknown): cached is InfiniteData<InboxPostListResult> {
  if (!cached || typeof cached !== 'object') return false
  const pages = (cached as { pages?: unknown }).pages
  if (!Array.isArray(pages)) return false
  return pages.every((page) => holdsRows(page))
}

/** True for one page of an inbox list: an object with an `items` array. */
function holdsRows(page: unknown): boolean {
  if (!page || typeof page !== 'object') return false
  return Array.isArray((page as { items?: unknown }).items)
}
