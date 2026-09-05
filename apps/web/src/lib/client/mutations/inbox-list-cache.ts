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
  if (!cached || !Array.isArray(cached.pages)) return cached
  return {
    ...cached,
    pages: cached.pages.map((page) => ({ ...page, items: patchRows(page.items) })),
  }
}
