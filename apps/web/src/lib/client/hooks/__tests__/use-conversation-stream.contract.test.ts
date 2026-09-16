// @vitest-environment happy-dom
/**
 * useConversationStream — which frames reach the inbox, and when a connection
 * counts as a gap that has to be caught up.
 *
 * Upstream's characterization suite beside this one
 * (`use-conversation-stream.test.ts`) drives the two new reconnect paths one
 * at a time. This suite states the laws they are instances of, so a
 * combination neither example visits is still held.
 *
 * Contract for the batch E pick (upstream #553, `f8062929a`) — the confirmed
 * list; the other numbers are held where they belong, the whole of it is in
 * `lib/client/conversation/__tests__/reconcile-cached-thread.contract.test.ts`:
 *
 *   E6 Every frame kind the inbox relies on is listened for. A named frame
 *      with no listener is dropped by the browser, and the cache then goes
 *      stale silently.
 *   E7 The first clean connection does not trigger a catch-up refetch. A
 *      connection that follows a failed attempt does, because that gap is the
 *      same gap a reconnect leaves.
 *
 * E6 is checked against the event union rather than against a list written
 * out here. The union is a TypeScript type and is gone at runtime, so the
 * declaration in `conversation/types.ts` is read as text — the only oracle
 * that exists for "a kind was added". What the hook did with it is then read
 * behaviourally, off the listeners it actually registered. A second list of
 * kinds maintained in this file would be the very thing the test is for.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import fc from 'fast-check'
import { renderHook, act } from '@testing-library/react'
import { useConversationStream } from '../use-conversation-stream'

/** Records the frame names a listener was registered for. */
class ListenerRecordingEventSource {
  static instances: ListenerRecordingEventSource[] = []
  url: string
  onopen: (() => void) | null = null
  onerror: (() => void) | null = null
  close = vi.fn()
  readonly registered: string[] = []

  constructor(url: string) {
    this.url = url
    ListenerRecordingEventSource.instances.push(this)
  }

  addEventListener(name: string) {
    this.registered.push(name)
  }
}

const flush = () => act(async () => {})

/** Every `kind: '…'` the stream's event unions declare. */
function declaredEventKinds(): string[] {
  const source = readFileSync('apps/web/src/lib/shared/conversation/types.ts', 'utf8')
  const kinds = new Set<string>()
  for (const match of source.matchAll(/kind:\s*'([a-z_]+)'/g)) kinds.add(match[1])
  return [...kinds].sort()
}

beforeEach(() => {
  vi.useFakeTimers()
  ListenerRecordingEventSource.instances = []
  vi.stubGlobal('EventSource', ListenerRecordingEventSource as unknown as typeof EventSource)
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('useConversationStream (E6)', () => {
  it('registers a listener for every frame kind the stream can send', async () => {
    renderHook(() =>
      useConversationStream({
        buildUrl: async () => '/api/chat/stream?scope=inbox',
        enabled: true,
        onEvent: vi.fn(),
      })
    )
    await flush()

    const kinds = declaredEventKinds()
    // The extraction itself has to be load-bearing: an empty list would make
    // the subset check below pass while holding nothing.
    expect(kinds).toContain('ticket_message')
    expect(kinds.length).toBeGreaterThan(8)
    expect([...ListenerRecordingEventSource.instances[0].registered].sort()).toEqual(kinds)
  })
})

/** One connection attempt, as the network decides it. */
type Attempt = 'mint-miss' | 'error' | 'open'

describe('useConversationStream (E7)', () => {
  it('catches up once per gap, and never after a clean first connection', async () => {
    // The generator has to reach more than the two paths upstream's examples
    // drive; asserted below rather than assumed.
    const reached = new Set<string>()
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.constantFrom<Attempt>('mint-miss', 'error', 'open'), {
          minLength: 1,
          maxLength: 6,
        }),
        async (attempts) => {
          ListenerRecordingEventSource.instances = []
          const onReconnect = vi.fn()
          let step = 0
          const { unmount } = renderHook(() =>
            useConversationStream({
              buildUrl: async () => (attempts[step] === 'mint-miss' ? null : '/stream'),
              enabled: true,
              onEvent: vi.fn(),
              onReconnect,
            })
          )
          await flush()

          let opens = 0
          for (const attempt of attempts) {
            const stream = ListenerRecordingEventSource.instances.at(-1)
            if (attempt === 'open' && stream) {
              act(() => stream.onopen?.())
              opens++
            } else if (attempt === 'error' && stream) {
              act(() => stream.onerror?.())
            }
            step++
            // Let the backoff elapse so the next attempt is actually made.
            act(() => {
              vi.advanceTimersByTime(60_000)
            })
            await flush()
          }

          const catchUps = onReconnect.mock.calls.length
          const startedWithAGap = attempts[0] !== 'open'

          // A catch-up refetch belongs to a connection, never to nothing.
          expect(catchUps).toBeLessThanOrEqual(opens)
          // Every connection after the first is a reconnect and catches up.
          expect(catchUps).toBeGreaterThanOrEqual(Math.max(0, opens - 1))
          // The one connection that is free of a catch-up is a clean first one,
          // so the count is exact. Stated unguarded: with no connection at all
          // it reads 0, which is what the two laws above already say.
          expect(catchUps).toBe(Math.max(0, opens - (startedWithAGap ? 0 : 1)))
          reached.add(`${opens} opens, ${startedWithAGap ? 'gap first' : 'clean first'}`)

          unmount()
        }
      ),
      { numRuns: 80 }
    )

    // Both boundary shapes, and a sequence that reconnects more than once.
    expect(reached).toContain('1 opens, clean first')
    expect(reached).toContain('1 opens, gap first')
    expect([...reached].some((shape) => shape.startsWith('2 opens'))).toBe(true)
  })
})
