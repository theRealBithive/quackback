/**
 * SSE writer liveness: heartbeatPing must distinguish a live consumer from
 * a queue that nobody is draining.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSseStream } from '../sse'

describe('createSseStream.heartbeatPing', () => {
  it('reports unconsumed when the previous write is still queued', async () => {
    const sse = createSseStream()
    sse.sendRaw(': connected\n\n')
    expect(sse.heartbeatPing()).toBe('unconsumed')
    sse.close()
  })

  it('reports ok once the consumer has drained the queue', async () => {
    const sse = createSseStream()
    sse.sendRaw(': connected\n\n')
    const reader = sse.stream.getReader()
    await reader.read()
    expect(sse.heartbeatPing()).toBe('ok')
    await reader.cancel()
    sse.close()
  })

  it('reports closed after close() and does not throw', () => {
    const sse = createSseStream()
    sse.close()
    expect(sse.heartbeatPing()).toBe('closed')
  })
})

describe('createSseStream keepalive', () => {
  it('writes a comment into an idle stream every interval, so an idle timeout never sees silence', async () => {
    vi.useFakeTimers()
    try {
      const sse = createSseStream({ keepAliveMs: 5_000 })
      const reader = sse.stream.getReader()
      const decoder = new TextDecoder()
      await vi.advanceTimersByTimeAsync(5_000)
      expect(decoder.decode((await reader.read()).value)).toBe(': keepalive\n\n')
      await vi.advanceTimersByTimeAsync(5_000)
      expect(decoder.decode((await reader.read()).value)).toBe(': keepalive\n\n')
      await reader.cancel()
      sse.close()
    } finally {
      vi.useRealTimers()
    }
  })

  it('never adds to a queue the consumer has not drained, so an abandoned reader still shows', async () => {
    vi.useFakeTimers()
    try {
      const sse = createSseStream({ keepAliveMs: 5_000 })
      sse.sendRaw(': connected\n\n')
      await vi.advanceTimersByTimeAsync(20_000)
      expect(sse.heartbeatPing()).toBe('unconsumed')
      const reader = sse.stream.getReader()
      const decoder = new TextDecoder()
      expect(decoder.decode((await reader.read()).value)).toBe(': connected\n\n')
      await reader.cancel()
      sse.close()
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not mistake a keepalive written a moment ago for an abandoned reader', async () => {
    vi.useFakeTimers()
    try {
      const sse = createSseStream({ keepAliveMs: 5_000 })
      // The keepalive lands and the heartbeat runs before the server has
      // pulled it, as when both timers fire in one turn of the event loop.
      await vi.advanceTimersByTimeAsync(5_000)
      expect(sse.heartbeatPing()).toBe('ok')
      sse.close()
    } finally {
      vi.useRealTimers()
    }
  })

  it('still reports a reader that never takes the keepalive on the next beat', async () => {
    vi.useFakeTimers()
    try {
      const sse = createSseStream({ keepAliveMs: 5_000 })
      await vi.advanceTimersByTimeAsync(5_000)
      expect(sse.heartbeatPing()).toBe('ok')
      await vi.advanceTimersByTimeAsync(20_000)
      expect(sse.heartbeatPing()).toBe('unconsumed')
      sse.close()
    } finally {
      vi.useRealTimers()
    }
  })

  it('stops writing once closed', async () => {
    vi.useFakeTimers()
    try {
      const sse = createSseStream({ keepAliveMs: 5_000 })
      sse.close()
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })
})

/** Reads what a client sees: the text of the next chunk, or null once the stream has ended. */
async function readText(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<string | null> {
  const { done, value } = await reader.read()
  if (done) return null
  return new TextDecoder().decode(value)
}

/** Makes the next `count` writes to any stream fail, as a connection that has gone away does. */
function failNextWrites(count: number) {
  const enqueue = vi.spyOn(ReadableStreamDefaultController.prototype, 'enqueue')
  for (let attempt = 0; attempt < count; attempt++) {
    enqueue.mockImplementationOnce(() => {
      throw new TypeError('the connection is gone')
    })
  }
  return enqueue
}

describe('createSseStream frames', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('sends an event as event and data lines ended by a blank line', async () => {
    const sse = createSseStream({ keepAliveMs: 0 })
    const reader = sse.stream.getReader()
    sse.send('message', { text: 'hi' })
    expect(await readText(reader)).toBe('event: message\ndata: {"text":"hi"}\n\n')
    sse.close()
  })

  it('puts the id line first when the event has an id', async () => {
    const sse = createSseStream({ keepAliveMs: 0 })
    const reader = sse.stream.getReader()
    sse.send('message', 1, 'evt_7')
    expect(await readText(reader)).toBe('id: evt_7\nevent: message\ndata: 1\n\n')
    sse.close()
  })

  it('writes a ping comment when the heartbeat finds the reader keeping up', async () => {
    const sse = createSseStream({ keepAliveMs: 0 })
    const reader = sse.stream.getReader()
    expect(sse.heartbeatPing()).toBe('ok')
    expect(await readText(reader)).toBe(': ping\n\n')
    sse.close()
  })

  it('ends the stream for the reader when closed, after what was already written', async () => {
    const sse = createSseStream({ keepAliveMs: 0 })
    const reader = sse.stream.getReader()
    sse.sendRaw('last\n\n')
    sse.close()
    expect(await readText(reader)).toBe('last\n\n')
    expect(await readText(reader)).toBeNull()
  })

  it('closing twice does not throw', () => {
    const sse = createSseStream({ keepAliveMs: 0 })
    sse.close()
    expect(() => sse.close()).not.toThrow()
  })
})

describe('createSseStream when a write fails', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('marks the stream closed and writes nothing further', async () => {
    const enqueue = failNextWrites(1)
    const sse = createSseStream({ keepAliveMs: 0 })
    const reader = sse.stream.getReader()

    sse.sendRaw('lost\n\n')
    expect(sse.isClosed()).toBe(true)
    sse.sendRaw('after\n\n')

    expect(enqueue).toHaveBeenCalledTimes(1)
    enqueue.mockRestore()
    sse.close()
    expect(await readText(reader)).toBeNull()
  })

  it('stops the keepalive timer at once, not on its next tick', async () => {
    vi.useFakeTimers()
    failNextWrites(1)
    const sse = createSseStream({ keepAliveMs: 5_000 })

    sse.sendRaw('lost\n\n')
    await vi.advanceTimersByTimeAsync(5_000)

    expect(vi.getTimerCount()).toBe(0)
    sse.close()
  })

  it('stops the keepalive timer when the keepalive itself cannot be written', async () => {
    vi.useFakeTimers()
    failNextWrites(1)
    const sse = createSseStream({ keepAliveMs: 5_000 })

    await vi.advanceTimersByTimeAsync(5_000)

    expect(sse.isClosed()).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('reports closed from the heartbeat and stays closed', () => {
    const enqueue = failNextWrites(1)
    const sse = createSseStream({ keepAliveMs: 0 })

    expect(sse.heartbeatPing()).toBe('closed')
    expect(sse.isClosed()).toBe(true)
    expect(sse.heartbeatPing()).toBe('closed')
    expect(enqueue).toHaveBeenCalledTimes(1)
  })

  it('reports closed from the heartbeat when the stream reports no capacity at all', () => {
    vi.spyOn(ReadableStreamDefaultController.prototype, 'desiredSize', 'get').mockReturnValue(null)
    failNextWrites(1)
    const sse = createSseStream({ keepAliveMs: 0 })

    expect(sse.heartbeatPing()).toBe('closed')
  })
})

describe('createSseStream keepalive details', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('starts no timer when the keepalive is switched off with 0', async () => {
    vi.useFakeTimers()
    const sse = createSseStream({ keepAliveMs: 0 })
    expect(vi.getTimerCount()).toBe(0)
    const reader = sse.stream.getReader()
    await vi.advanceTimersByTimeAsync(60_000)
    sse.close()
    expect(await readText(reader)).toBeNull()
  })

  it('does not queue a keepalive behind a chunk the reader has not taken', async () => {
    vi.useFakeTimers()
    const sse = createSseStream({ keepAliveMs: 5_000 })
    const reader = sse.stream.getReader()
    sse.sendRaw('one\n\n')
    sse.sendRaw('two\n\n')
    await vi.advanceTimersByTimeAsync(20_000)
    sse.close()
    expect(await readText(reader)).toBe('one\n\n')
    expect(await readText(reader)).toBe('two\n\n')
    expect(await readText(reader)).toBeNull()
  })

  it('does not queue a keepalive behind a chunk that exactly fills the buffer', async () => {
    vi.useFakeTimers()
    const sse = createSseStream({ keepAliveMs: 5_000 })
    sse.sendRaw('one\n\n')
    await vi.advanceTimersByTimeAsync(20_000)
    const reader = sse.stream.getReader()
    sse.close()
    expect(await readText(reader)).toBe('one\n\n')
    expect(await readText(reader)).toBeNull()
  })

  it('still counts a keepalive as unread once the grace period has fully passed', async () => {
    vi.useFakeTimers()
    const sse = createSseStream({ keepAliveMs: 5_000 })
    await vi.advanceTimersByTimeAsync(5_000)
    await vi.advanceTimersByTimeAsync(999)
    expect(sse.heartbeatPing()).toBe('ok')
    await vi.advanceTimersByTimeAsync(1)
    expect(sse.heartbeatPing()).toBe('unconsumed')
    sse.close()
  })

  it('works where a timer handle has no unref method', () => {
    vi.stubGlobal('setInterval', () => 42)
    vi.stubGlobal('clearInterval', () => {})
    expect(() => createSseStream({ keepAliveMs: 5_000 })).not.toThrow()
  })

  it('runs the cancel callback, closes the stream and stops the timer when the reader cancels', async () => {
    vi.useFakeTimers()
    const onCancel = vi.fn()
    const sse = createSseStream({ keepAliveMs: 5_000, onCancel })
    const reader = sse.stream.getReader()

    await reader.cancel()

    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(sse.isClosed()).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('cancels without a callback', async () => {
    const sse = createSseStream({ keepAliveMs: 0 })
    await sse.stream.getReader().cancel()
    expect(sse.isClosed()).toBe(true)
  })
})
