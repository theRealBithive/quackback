/**
 * reconcileCachedThread — the inbox's rule for what a live event is allowed to
 * do to a thread cache it did not open.
 *
 * Upstream ships five example tests beside the module
 * (`../reconcile-cached-thread.test.ts`). They pin the five paths one at a
 * time and name no contract; this suite states the law those paths are
 * instances of, so a change that keeps all five green and still loses an event
 * is caught.
 *
 * Contract for the batch E pick (upstream #553, `f8062929a`) — the confirmed
 * list; E1, E6–E11 are held elsewhere and named where they are:
 *
 *   E2 A thread that was hover-prefetched, or opened earlier and still
 *      cached, stays in step with the live stream: a message, read receipt,
 *      reaction or deletion that arrives after the prefetch is reflected when
 *      the row is finally selected.
 *   E3 A prefetch nobody is waiting on is abandoned when a live event makes
 *      it stale. A fetch the open pane is waiting on is never abandoned,
 *      because nothing would restart it and the pane would stay on its
 *      skeleton.
 *   E4 A response already in flight when a live event arrives never wins over
 *      that event: whichever lands last, the thread ends up reflecting the
 *      event.
 *   E5 No cache is created for a conversation nobody has looked at.
 *
 * The property below reads those four sentences as one table. For each
 * situation a row can be in when the event arrives, the contract already says
 * whether the reader must end up seeing the event:
 *
 *   never fetched          — E5, nobody looked, so nothing to see
 *   cached, idle           — E2, the row was opened before
 *   cached, refetching     — E2 and E4, the response must not win
 *   cached, refetching,
 *     with the pane open   — E2 and E4, likewise
 *   prefetched, unwatched  — E3 first half, the prefetch is abandoned
 *   first fetch, pane open — E3 second half, abandoning it strands the pane
 *
 * and the assertion is three-valued on purpose: a cache holding the event is
 * not the same as a cache holding the in-flight response, and neither is the
 * same as no cache. Collapsing those to a boolean is how "the event was lost"
 * reads as a pass.
 */
import { describe, expect, it, vi } from 'vitest'
import fc from 'fast-check'
import { QueryClient, QueryObserver } from '@tanstack/react-query'
import { reconcileCachedThread } from '../reconcile-cached-thread'

const key = ['admin', 'inbox', 'thread', 'conversation_1'] as const

/** `patched` marks a value the live event produced; a server response has none. */
type Row = { n: number; patched?: true }

/** What the cache is holding once everything in flight has landed. */
type Outcome = 'holds-the-event' | 'holds-the-response' | 'holds-nothing'

function outcomeOf(data: Row | undefined): Outcome {
  if (data === undefined) return 'holds-nothing'
  return data.patched === true ? 'holds-the-event' : 'holds-the-response'
}

/** The live event: one more message on the thread, whatever was there before. */
function applyEvent(prev: Row | undefined): Row {
  return { n: (prev?.n ?? 0) + 1, patched: true }
}

interface Situation {
  /** Domain-language name, as the contract sentences describe it. */
  readonly name: string
  /** Does the contract promise the reader ends up seeing the event? */
  readonly readerSeesTheEvent: boolean
  readonly build: (queryClient: QueryClient, response: Promise<Row>) => () => void
}

/**
 * Each builder puts one query into the state its name describes and returns a
 * teardown. `response` is the fetch that is already in flight; the test
 * decides when it lands.
 */
const SITUATIONS: readonly Situation[] = [
  {
    name: 'never fetched',
    readerSeesTheEvent: false,
    build: () => () => {},
  },
  {
    name: 'cached, idle',
    readerSeesTheEvent: true,
    build: (queryClient) => {
      queryClient.setQueryData<Row>(key, { n: 1 })
      return () => {}
    },
  },
  {
    name: 'cached, refetching',
    readerSeesTheEvent: true,
    build: (queryClient, response) => {
      queryClient.setQueryData<Row>(key, { n: 1 })
      void queryClient.fetchQuery({ queryKey: key, queryFn: () => response }).catch(() => {})
      return () => {}
    },
  },
  {
    name: 'cached, refetching, with the pane open',
    readerSeesTheEvent: true,
    build: (queryClient, response) => {
      queryClient.setQueryData<Row>(key, { n: 1 })
      const observer = new QueryObserver<Row>(queryClient, {
        queryKey: key,
        queryFn: () => response,
      })
      return observer.subscribe(() => {})
    },
  },
  {
    name: 'prefetched, unwatched',
    readerSeesTheEvent: false,
    build: (queryClient, response) => {
      void queryClient.prefetchQuery({ queryKey: key, queryFn: () => response })
      return () => {}
    },
  },
  {
    name: 'first fetch, pane open',
    readerSeesTheEvent: true,
    build: (queryClient, response) => {
      const observer = new QueryObserver<Row>(queryClient, {
        queryKey: key,
        queryFn: () => response,
      })
      return observer.subscribe(() => {})
    },
  },
]

function makeClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } })
}

/** Let every queued continuation of the settled fetch run before asserting. */
async function drain(): Promise<void> {
  for (let turn = 0; turn < 8; turn++) await Promise.resolve()
  await new Promise((resolve) => setTimeout(resolve, 0))
}

describe('reconcileCachedThread (E2, E3, E4, E5)', () => {
  it('leaves the cache holding the event, or nothing at all — never the response it raced', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(...SITUATIONS),
        fc.integer({ min: -1000, max: 1000 }),
        fc.integer({ min: 1, max: 3 }),
        async (situation, responseValue, eventCount) => {
          const queryClient = makeClient()
          let land!: (row: Row) => void
          const response = new Promise<Row>((resolve) => {
            land = resolve
          })
          const teardown = situation.build(queryClient, response)

          for (let event = 0; event < eventCount; event++) {
            reconcileCachedThread<Row>(queryClient, key, applyEvent)
          }
          land({ n: responseValue })
          await drain()

          const outcome = outcomeOf(queryClient.getQueryData<Row>(key))
          expect(outcome).toBe(situation.readerSeesTheEvent ? 'holds-the-event' : 'holds-nothing')

          teardown()
          queryClient.clear()
        }
      ),
      { numRuns: 120 }
    )
  })

  it('never invents a cache for a row nobody opened (E5)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.string({ minLength: 1 }), { minLength: 1 }),
        async (segments) => {
          const queryClient = makeClient()
          const apply = vi.fn(applyEvent)

          reconcileCachedThread<Row>(queryClient, segments, apply)
          await drain()

          expect(queryClient.getQueryCache().find({ queryKey: segments })).toBeUndefined()
          expect(apply).not.toHaveBeenCalled()
          queryClient.clear()
        }
      ),
      { numRuns: 60 }
    )
  })

  it('looks at the row it was told about, not at a neighbour of it (E5)', () => {
    const queryClient = makeClient()
    const neighbour = [...key, 'page-2']
    queryClient.setQueryData<Row>(neighbour, { n: 1 })

    reconcileCachedThread<Row>(queryClient, key, applyEvent)

    // Nothing was opened at this key, so nothing may appear at it — and the
    // row that WAS cached is not this row's business either.
    expect(queryClient.getQueryData(key)).toBeUndefined()
    expect(queryClient.getQueryData(neighbour)).toEqual({ n: 1 })
    queryClient.clear()
  })

  it('patches a settled thread in place instead of putting it back on the network (E2)', async () => {
    const queryClient = makeClient()
    const askServer = vi.fn(async () => ({ n: 1 }) as Row)
    await queryClient.fetchQuery({ queryKey: key, queryFn: askServer })
    expect(askServer).toHaveBeenCalledTimes(1)

    reconcileCachedThread<Row>(queryClient, key, applyEvent)
    await drain()

    // A thread nothing is fetching is already as current as the event; asking
    // again would cost a request per event per cached row.
    expect(askServer).toHaveBeenCalledTimes(1)
    expect(outcomeOf(queryClient.getQueryData<Row>(key))).toBe('holds-the-event')
    queryClient.clear()
  })

  it('abandons the one prefetch it came for, and no other (E3)', async () => {
    const queryClient = makeClient()
    const pending = () => new Promise<Row>(() => {})
    const neighbour = [...key, 'page-2']
    const elsewhere = ['admin', 'inbox', 'list'] as const

    void queryClient.prefetchQuery({ queryKey: key, queryFn: pending })
    void queryClient.prefetchQuery({ queryKey: neighbour, queryFn: pending })
    void queryClient.prefetchQuery({ queryKey: elsewhere, queryFn: pending })

    reconcileCachedThread<Row>(queryClient, key, applyEvent)
    await drain()

    const cache = queryClient.getQueryCache()
    expect(cache.find({ queryKey: key, exact: true })?.state.fetchStatus).not.toBe('fetching')
    // The rest of the inbox's work is not this event's to cancel.
    expect(cache.find({ queryKey: neighbour, exact: true })?.state.fetchStatus).toBe('fetching')
    expect(cache.find({ queryKey: elsewhere, exact: true })?.state.fetchStatus).toBe('fetching')
    queryClient.clear()
  })

  it('keeps the event when the fetch it waited on fails (E4)', async () => {
    const queryClient = makeClient()
    let fail!: (reason: Error) => void
    const response = new Promise<Row>((_resolve, reject) => {
      fail = reject
    })
    queryClient.setQueryData<Row>(key, { n: 1 })
    void queryClient.fetchQuery({ queryKey: key, queryFn: () => response }).catch(() => {})

    reconcileCachedThread<Row>(queryClient, key, applyEvent)
    fail(new Error('the thread request failed'))
    await drain()

    expect(outcomeOf(queryClient.getQueryData<Row>(key))).toBe('holds-the-event')
  })
})
