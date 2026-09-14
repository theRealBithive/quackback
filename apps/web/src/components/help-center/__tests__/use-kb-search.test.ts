// @vitest-environment happy-dom
/**
 * ## W — Widget `open()` deep-links (upstream #531)
 * - W6 Help search, help categories, article detail, changelog list and detail, Ask AI and the unread badge all carry the widget identity and are keyed by session, so identify or logout refetches them and no placeholder from another identity is shown.
 * - W7 When the session changes, help search drops its results, its in-flight request and its cache; a response from an earlier session is discarded; a non-OK response yields no results.
 * - W11 Resolving a public article accepts an `article_` id, a retired `kb_article_` id or a slug; it falls back to the default locale when the requested one has no version and reports the locale it resolved to; helpfulness counters are not exposed; an article that does not exist or is not public resolves to nothing.
 *
 * This module pins W6 and W7 for `useKbSearch`.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import fc from 'fast-check'
import { useKbSearch, type KbSearchArticle } from '../use-kb-search'

const DEBOUNCE_MS = 300

/** Flush pending microtasks (the hook's doSearch awaits fetch/json). */
const flush = () => act(async () => {})

/** Advance fake timers, then let the async search settle. */
const advance = async (ms: number) => {
  act(() => {
    vi.advanceTimersByTime(ms)
  })
  await flush()
}

function fakeArticle(id: string): KbSearchArticle {
  return {
    id,
    urlId: 1,
    slug: id,
    title: id,
    content: '',
    category: { id: 'kb_category_1', slug: 'general', name: 'General' },
  }
}

function okResponse(articles: KbSearchArticle[]) {
  return { ok: true, json: async () => ({ data: { articles } }) }
}

/** A promise this test resolves on its own schedule, to land a response
 *  after the hook has already moved on to a new session. */
function deferredResponse() {
  let resolve!: (value: unknown) => void
  const promise = new Promise((res) => {
    resolve = res
  })
  return { promise, resolve }
}

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.useFakeTimers()
  fetchMock = vi.fn().mockResolvedValue(okResponse([]))
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('useKbSearch', () => {
  it('carries the widget identity headers on every search request (W6)', async () => {
    const getHeaders = () => ({ Authorization: 'Bearer widget-token' })
    renderHook(() => useKbSearch({ query: 'refund', limit: 5, sessionVersion: 1, getHeaders }))

    await advance(DEBOUNCE_MS)

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/widget/kb-search'),
      expect.objectContaining({ headers: { Authorization: 'Bearer widget-token' } })
    )
  })

  it('a non-OK response yields no results (W7)', async () => {
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({}) })

    const { result } = renderHook(() =>
      useKbSearch({ query: 'refund', limit: 5, sessionVersion: 1 })
    )
    await advance(DEBOUNCE_MS)

    expect(result.current.results).toEqual([])
    expect(result.current.isSearching).toBe(false)
  })

  it('discards a response that arrives after the session has already moved on (W7)', async () => {
    const stale = deferredResponse()
    fetchMock.mockReturnValueOnce(stale.promise)

    const { result, rerender } = renderHook(
      ({ sessionVersion }: { sessionVersion: number }) =>
        useKbSearch({ query: 'refund', limit: 5, sessionVersion }),
      { initialProps: { sessionVersion: 1 } }
    )

    // Debounce fires the search under session 1; the fetch is left pending.
    await advance(DEBOUNCE_MS)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    // The session changes before the pending fetch resolves.
    rerender({ sessionVersion: 2 })

    // The stale response for session 1 now lands.
    stale.resolve(okResponse([fakeArticle('article_stale')]))
    await flush()

    // Session 1's answer must never appear once session 2 is current.
    expect(result.current.results).toEqual([])
  })

  it('drops results, the in-flight request, and the cache when the session changes (W6, W7)', async () => {
    fetchMock.mockResolvedValue(okResponse([fakeArticle('article_1')]))

    const { result, rerender } = renderHook(
      ({ sessionVersion, limit }: { sessionVersion: number; limit: number }) =>
        useKbSearch({ query: 'refund', limit, sessionVersion }),
      { initialProps: { sessionVersion: 1, limit: 5 } }
    )
    await advance(DEBOUNCE_MS)
    expect(result.current.results).toEqual([fakeArticle('article_1')])

    // A second identical (session, locale, query) is a cache hit — no second
    // network call. `limit` is not part of the cache key, so toggling it is
    // only there to force the debounce effect to re-run (it depends on the
    // `doSearch` callback, itself memoized on `limit`) without changing the
    // triple the cache is keyed on — otherwise this render would be a no-op
    // and the assertion below would hold for the wrong reason (the effect
    // never re-firing at all, rather than an actual cache hit).
    rerender({ sessionVersion: 1, limit: 6 })
    await advance(DEBOUNCE_MS)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(result.current.results).toEqual([fakeArticle('article_1')])

    // The session changes: the cached result is dropped immediately (before
    // the next debounced search even fires), not merely replaced later.
    const abortSpy = vi.spyOn(AbortController.prototype, 'abort')
    rerender({ sessionVersion: 2, limit: 6 })
    expect(result.current.results).toEqual([])
    expect(result.current.isSearching).toBe(false)
    expect(abortSpy).toHaveBeenCalled()

    // The old session's cache entry is gone too: searching the same query
    // again under the new session is a fresh network call, not a cache hit.
    fetchMock.mockResolvedValue(okResponse([fakeArticle('article_2')]))
    await advance(DEBOUNCE_MS)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(result.current.results).toEqual([fakeArticle('article_2')])
  })

  it('property: identical (session, locale, query) is served from cache; changing any one of them is not (W6, W7)', async () => {
    // Generator reaches the interesting states directly: small alphabets for
    // session/locale/query so the property explores "same triple → cache
    // hit" against "any one field differs → cache miss" without the
    // combinatorics (or debounce/fake-timer wall-clock cost) of a large
    // random space. numRuns is capped up front, as a design choice for an
    // async-per-run property, not in reaction to a failure.
    const versionArb = fc.constantFrom(1, 2)
    const localeArb = fc.constantFrom('en', 'de')
    const queryArb = fc.constantFrom('refund', 'billing')

    await fc.assert(
      fc.asyncProperty(
        versionArb,
        localeArb,
        queryArb,
        versionArb,
        localeArb,
        queryArb,
        async (v1, l1, q1, v2, l2, q2) => {
          fetchMock.mockClear()
          fetchMock.mockResolvedValue(okResponse([fakeArticle('article_x')]))

          const { rerender, unmount } = renderHook(
            (props: { sessionVersion: number; locale: string; query: string; limit: number }) =>
              useKbSearch({
                query: props.query,
                limit: props.limit,
                locale: props.locale,
                sessionVersion: props.sessionVersion,
              }),
            { initialProps: { sessionVersion: v1, locale: l1, query: q1, limit: 5 } }
          )
          await advance(DEBOUNCE_MS)
          const callsAfterFirst = fetchMock.mock.calls.length

          // limit toggles on every run (5 -> 6) so the debounce effect always
          // re-fires, even when (session, locale, query) repeats exactly —
          // otherwise a "same triple" run would report no new fetch for the
          // wrong reason (the effect never re-running) rather than because
          // the cache was actually consulted and hit.
          rerender({ sessionVersion: v2, locale: l2, query: q2, limit: 6 })
          await advance(DEBOUNCE_MS)
          const callsAfterSecond = fetchMock.mock.calls.length

          const sameTriple = v1 === v2 && l1 === l2 && q1 === q2
          if (sameTriple) {
            expect(callsAfterSecond).toBe(callsAfterFirst)
          } else {
            expect(callsAfterSecond).toBeGreaterThan(callsAfterFirst)
          }

          unmount()
        }
      ),
      { numRuns: 12 }
    )
  })
})
