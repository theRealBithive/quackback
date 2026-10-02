// @vitest-environment node
/**
 * The shared SSE writer under the server's idle timeout: a stream with nothing
 * to say must not look dead to the server, and a reader that really has gone
 * must still be noticed.
 *
 * Contract for batch F, upstream #600 (`c5690f2aa`, "keep live and assistant
 * streams open through the server's idle timeout"). Items owned by this file,
 * verbatim:
 *
 *   F19 An open chat or inbox stream with no events is not cut by the server's
 *       idle timeout.
 *   F20 A reader that has really gone away is still detected by the next
 *       heartbeat.
 *
 * The server in question is Bun, which closes a connection that carries no
 * bytes for 10 seconds. The bound is stated here as a plain number on purpose:
 * it is the platform's, not a constant of ours, and reading it off the writer
 * would make the test agree with whatever the writer does.
 *
 * Route-level halves of F19 and F21 are in
 * routes/api/chat/__tests__/stream-idle.contract.test.ts.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fc from 'fast-check'
import { createSseStream } from '../sse'

/** Bun closes a connection that carries no bytes for this long. */
const SERVER_IDLE_TIMEOUT_MS = 10_000

/** A live reader needs one beat's worth of margin before a stall can be called. */
const STALL_MARGIN_MS = 1_000

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

/**
 * Reads the stream the way a connection does, recording when each chunk
 * arrived. With `chunkLimit` the reader goes away after that many chunks and
 * leaves no read outstanding, which is what a vanished client looks like.
 */
function startReader(stream: ReadableStream<Uint8Array>, chunkLimit = Infinity) {
  const reader = stream.getReader()
  const arrivals: number[] = []
  const done = (async () => {
    while (arrivals.length < chunkLimit) {
      const { done: ended } = await reader.read()
      if (ended) return
      arrivals.push(Date.now())
    }
  })()
  return { arrivals, done, reader }
}

async function runFor(totalMs: number, stepMs = 1_000) {
  for (let elapsed = 0; elapsed < totalMs; elapsed += stepMs) {
    await vi.advanceTimersByTimeAsync(stepMs)
  }
}

/** Longest stretch without a byte, counting from `openedAt` and up to `closedAt`. */
function longestSilence(arrivals: number[], openedAt: number, closedAt: number): number {
  const marks = [openedAt, ...arrivals, closedAt]
  let longest = 0
  for (let i = 1; i < marks.length; i++) {
    longest = Math.max(longest, marks[i] - marks[i - 1])
  }
  return longest
}

describe('a stream with nothing to say (F19)', () => {
  it('(F19) never goes ten seconds without a byte, however long it stays idle', async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 30, max: 900 }), async (idleSeconds) => {
        const openedAt = Date.now()
        const sse = createSseStream()
        const { arrivals, reader } = startReader(sse.stream)

        await runFor(idleSeconds * 1_000)

        expect(arrivals.length).toBeGreaterThan(0)
        expect(longestSilence(arrivals, openedAt, Date.now())).toBeLessThan(SERVER_IDLE_TIMEOUT_MS)

        sse.close()
        await reader.cancel().catch(() => {})
      }),
      { numRuns: 15 }
    )
  })

  it('(F19) stays within the bound when events arrive at arbitrary moments, too', async () => {
    const eventTimes = fc.array(fc.integer({ min: 0, max: 120_000 }), { maxLength: 10 })
    await fc.assert(
      fc.asyncProperty(eventTimes, async (times) => {
        const openedAt = Date.now()
        const sse = createSseStream()
        const { arrivals, reader } = startReader(sse.stream)
        for (const time of times) {
          setTimeout(() => sse.send('message', { at: time }), time)
        }

        await runFor(150_000)

        expect(arrivals.length).toBeGreaterThanOrEqual(times.length)
        expect(longestSilence(arrivals, openedAt, Date.now())).toBeLessThan(SERVER_IDLE_TIMEOUT_MS)

        sse.close()
        await reader.cancel().catch(() => {})
      }),
      { numRuns: 10 }
    )
  })

  it('(F19) stops writing once the stream is closed', async () => {
    const sse = createSseStream()
    const { arrivals } = startReader(sse.stream)
    await runFor(20_000)
    sse.close()
    await vi.advanceTimersByTimeAsync(0)
    const writtenBeforeClose = arrivals.length

    await runFor(60_000)

    expect(arrivals.length).toBe(writtenBeforeClose)
  })
})

describe('a reader that has gone away (F20)', () => {
  /** Calls heartbeatPing every `beatMs`, first beat `phaseMs` after `startedAt`. */
  function beatEvery(sse: ReturnType<typeof createSseStream>, beatMs: number, phaseMs: number) {
    const beats: Array<{ at: number; result: string }> = []
    setTimeout(() => {
      beats.push({ at: Date.now(), result: sse.heartbeatPing() })
      setInterval(() => beats.push({ at: Date.now(), result: sse.heartbeatPing() }), beatMs)
    }, phaseMs)
    return beats
  }

  it('(F20) is reported by the next heartbeat once the stall is older than the idle bound', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 0, max: 8 }),
        fc.constantFrom(5_000, 10_000, 15_000, 20_000, 30_000),
        fc.integer({ min: 0, max: 20 }).map((seconds) => seconds * 1_000),
        async (chunksRead, beatMs, phaseMs) => {
          const startedAt = Date.now()
          const sse = createSseStream()
          const { arrivals } = startReader(sse.stream, chunksRead)
          const beats = beatEvery(sse, beatMs, phaseMs)

          await runFor(300_000)

          const lastPull = arrivals.at(-1) ?? startedAt
          const beatsAfterStall = beats.filter(
            (beat) => beat.at >= lastPull + SERVER_IDLE_TIMEOUT_MS + STALL_MARGIN_MS
          )
          expect(beatsAfterStall.length).toBeGreaterThan(0)
          for (const beat of beatsAfterStall) {
            expect(beat.result).toBe('unconsumed')
          }
          sse.close()
        }
      ),
      { numRuns: 20 }
    )
  })

  it('(F20) a reader that keeps pulling is never reported, whatever the beat timing', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(5_000, 10_000, 15_000, 20_000, 30_000),
        fc.integer({ min: 0, max: 20 }).map((seconds) => seconds * 1_000),
        async (beatMs, phaseMs) => {
          const sse = createSseStream()
          const { reader } = startReader(sse.stream)
          const beats = beatEvery(sse, beatMs, phaseMs)

          await runFor(300_000)

          expect(beats.length).toBeGreaterThan(0)
          for (const beat of beats) {
            expect(beat.result).toBe('ok')
          }
          sse.close()
          await reader.cancel().catch(() => {})
        }
      ),
      { numRuns: 15 }
    )
  })

  it('(F20) a connection the keepalive can no longer write to counts as gone', async () => {
    const enqueueThatFails = vi
      .spyOn(ReadableStreamDefaultController.prototype, 'enqueue')
      .mockImplementation(() => {
        throw new TypeError('the connection is gone')
      })
    try {
      const sse = createSseStream()

      await runFor(SERVER_IDLE_TIMEOUT_MS)
      const attemptsWhenGone = enqueueThatFails.mock.calls.length

      expect(attemptsWhenGone).toBe(1)
      expect(sse.isClosed()).toBe(true)
      expect(sse.heartbeatPing()).toBe('closed')

      // A gone connection is not written to again, however long it stays open.
      await runFor(60_000)
      expect(enqueueThatFails.mock.calls.length).toBe(attemptsWhenGone)
    } finally {
      enqueueThatFails.mockRestore()
    }
  })

  it('(F20) a closed stream reports closed, not a stalled reader', () => {
    const sse = createSseStream()
    sse.close()
    expect(sse.heartbeatPing()).toBe('closed')
  })
})
