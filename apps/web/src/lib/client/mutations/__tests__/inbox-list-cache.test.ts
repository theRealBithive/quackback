/**
 * patchInboxListCache — the one place that decides what an optimistic inbox
 * list patch is allowed to touch.
 *
 * Contract (the confirmed list; V1 and V5 are held by the mutations that call
 * this, in inbox-list-cache-collision.test.tsx):
 *
 *   V2 An optimistic patch of the inbox post lists changes post rows only.
 *      Every other cache the inbox holds under the same key prefix — the
 *      filter-facet counts above all — comes out of the patch unchanged.
 *   V3 A post that appears in several list caches at once (one per filter
 *      combination) is patched in all of them.
 *   V4 A patch does not create a list cache that held nothing.
 */
import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import type { InfiniteData } from '@tanstack/react-query'
import type { InboxPostListResult, PostListItem } from '@/lib/shared/db-types'
import { patchInboxListCache } from '../inbox-list-cache'

function rows(...ids: string[]): PostListItem[] {
  return ids.map((id) => ({ id, title: id, commentCount: 0 })) as unknown as PostListItem[]
}

/** A patch that must never run: it asserts the cache was not treated as a list. */
function refuse(): PostListItem[] {
  throw new Error('the rows of a non-list cache were read')
}

const anyRows = fc.array(fc.string({ minLength: 1 })).map((ids) => rows(...ids))

const anyListCache = fc
  .array(
    fc.record({
      items: anyRows,
      nextCursor: fc.option(fc.string(), { nil: null }),
      hasMore: fc.boolean(),
    }),
    { minLength: 1, maxLength: 4 }
  )
  .map((pages): InfiniteData<InboxPostListResult> => ({
    pages,
    pageParams: pages.map((_, index) => (index === 0 ? undefined : `cursor_${index}`)),
  }))

describe('a cache that is not a post list (V2, V4)', () => {
  it('hands the facet counts back by identity, without reading their rows', () => {
    const counts = { boards: [{ id: 'board_1', count: 4 }], statuses: [], tags: [] }

    const result = patchInboxListCache(
      counts as unknown as InfiniteData<InboxPostListResult>,
      refuse
    )

    expect(result).toBe(counts)
  })

  it('hands an empty cache back as empty', () => {
    expect(patchInboxListCache(undefined, refuse)).toBeUndefined()
  })

  it('leaves any payload without pages untouched, whatever it holds', () => {
    fc.assert(
      fc.property(
        fc.dictionary(
          fc.string().filter((key) => key !== 'pages'),
          fc.jsonValue()
        ),
        (payload) => {
          const result = patchInboxListCache(
            payload as unknown as InfiniteData<InboxPostListResult>,
            refuse
          )
          expect(result).toBe(payload)
        }
      )
    )
  })

  it('refuses a payload whose pages are not pages', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.string(),
          fc.integer(),
          fc.constant(null),
          fc.dictionary(fc.string(), fc.nat())
        ),
        (notPages) => {
          const payload = { pages: notPages }
          const result = patchInboxListCache(
            payload as unknown as InfiniteData<InboxPostListResult>,
            refuse
          )
          expect(result).toBe(payload)
        }
      )
    )
  })
})

describe('a cached post list (V3)', () => {
  it('patches the rows of every page', () => {
    const cached: InfiniteData<InboxPostListResult> = {
      pages: [
        { items: rows('post_a', 'post_b'), nextCursor: 'c1', hasMore: true },
        { items: rows('post_c'), nextCursor: null, hasMore: false },
      ],
      pageParams: [undefined, 'c1'],
    }

    const result = patchInboxListCache(cached, (items) =>
      items.filter((post) => post.id !== 'post_b')
    )

    expect(result?.pages.map((page) => page.items.map((post) => post.id))).toEqual([
      ['post_a'],
      ['post_c'],
    ])
  })

  it('carries every field that is not a row through unchanged', () => {
    fc.assert(
      fc.property(anyListCache, (cached) => {
        const result = patchInboxListCache(cached, (items) => items)

        // Unguarded across both branches of the patch: a list keeps its shape,
        // its paging cursors and its page count no matter what the rows do.
        expect(result?.pages.length).toBe(cached.pages.length)
        expect(result?.pageParams).toEqual(cached.pageParams)
        expect(result?.pages.map((page) => page.nextCursor)).toEqual(
          cached.pages.map((page) => page.nextCursor)
        )
        expect(result?.pages.map((page) => page.hasMore)).toEqual(
          cached.pages.map((page) => page.hasMore)
        )
      })
    )
  })

  it('applies the patch to each page in full', () => {
    fc.assert(
      fc.property(anyListCache, fc.string({ minLength: 1 }), (cached, marker) => {
        const result = patchInboxListCache(cached, (items) => [...items, ...rows(marker)])

        expect(result?.pages.map((page) => page.items.map((post) => post.id))).toEqual(
          cached.pages.map((page) => [...page.items.map((post) => post.id), marker])
        )
      })
    )
  })

  it('never writes into the cache it was handed', () => {
    fc.assert(
      fc.property(anyListCache, (cached) => {
        const before = structuredClone(cached)

        patchInboxListCache(cached, () => rows('post_replaced'))

        expect(cached).toEqual(before)
      })
    )
  })
})
