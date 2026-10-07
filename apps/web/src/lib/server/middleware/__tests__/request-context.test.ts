/**
 * Tests for the request-context middleware core.
 *
 * Verifies the real request lifecycle behaviour: an ALS scope is open for the
 * duration of the request (so downstream logs carry request_id), the response
 * echoes x-request-id, and completion/failure are logged once at the boundary.
 * * Contract (confirmed list for batch K, upstream #688):
 *
 *   L1 A client that hangs up mid-request is logged as an aborted request at
 *      info, not as an error.
 *   L2 Work of our own that we cancel is still logged as an error, even though
 *      it fails the same way.
 *   L3 A failure already logged at the request boundary is not printed a
 *      second time by the runtime.
 *   L4 A server-function call rejected for invalid input is logged as a
 *      warning, not an error.
 *   L5 Connecting an integration whose platform credentials are missing is
 *      refused with a clear 400 and logged as a warning.
 *   L6 A caller without a usable session at the link-preview endpoint is
 *      logged as a warning.
 *
 * Where they are held:
 *   L1, L2, L3  lib/server/__tests__/runtime-error-log.test.ts and
 *               lib/server/middleware/__tests__/request-context.test.ts
 *   L4          lib/server/middleware/__tests__/server-fn-log.test.ts
 *   L5          integrations/__tests__/connect-url-platform-credentials.test.ts
 *               and integrations/github/server/__tests__/connect-url.test.ts
 *   L6          lib/server/functions/__tests__/link-preview-log-level.test.ts
 */
import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import { handleRequestWithContext } from '../request-context'
import { getLogContext } from '@/lib/server/log-context'
import { createLogger } from '@/lib/server/logger'

function capture() {
  const lines: string[] = []
  const log = createLogger({
    level: 'info',
    destination: { write: (s: string) => void lines.push(s) },
  })
  return { log, records: () => lines.map((l) => JSON.parse(l)) }
}

describe('handleRequestWithContext', () => {
  it('runs next() inside an ALS scope carrying request_id and route', async () => {
    const { log } = capture()
    let seen: ReturnType<typeof getLogContext>
    const request = new Request('http://localhost/api/posts', { method: 'POST' })

    await handleRequestWithContext({
      request,
      log,
      next: async () => {
        seen = getLogContext()
        return { response: new Response(null, { status: 201 }) }
      },
    })

    expect(seen?.request_id).toBeDefined()
    expect(seen?.route).toBe('POST /api/posts')
  })

  it('reuses an inbound x-request-id and echoes it on the response', async () => {
    const { log } = capture()
    const request = new Request('http://localhost/x', {
      headers: { 'x-request-id': 'incoming-123' },
    })

    const result = await handleRequestWithContext({
      request,
      log,
      next: async () => ({ response: new Response('ok', { status: 200 }) }),
    })

    expect(result.response.headers.get('x-request-id')).toBe('incoming-123')
  })

  it('logs request completion with status and duration', async () => {
    const cap = capture()
    const request = new Request('http://localhost/health')

    await handleRequestWithContext({
      request,
      log: cap.log,
      next: async () => ({ response: new Response('ok', { status: 200 }) }),
    })

    const completed = cap.records().find((r) => r.msg === 'request completed')
    expect(completed).toBeDefined()
    expect(completed.status).toBe(200)
    expect(typeof completed.duration_ms).toBe('number')
    expect(completed.request_id).toBeDefined()
  })

  it('survives a context with no response attached yet', async () => {
    // A failing server function resolves the middleware chain without a
    // response: the error is carried as a value and serialized after this
    // boundary returns. Dereferencing it here threw a TypeError out of the
    // middleware, and the framework reported that to the client as an
    // unhandled 500 instead of the serialized error it had already built.
    const cap = capture()
    const request = new Request('http://localhost/_serverFn/abc')

    const result = await handleRequestWithContext({
      request,
      log: cap.log,
      next: async () => ({}) as { response?: Response },
    })

    expect(result).toEqual({})
    const completed = cap.records().find((r) => r.msg === 'request completed')
    expect(completed).toBeDefined()
    expect(completed.status).toBeUndefined()
    expect(cap.records().some((r) => r.msg === 'request failed')).toBe(false)
  })

  it.each(['/api/health', '/api/health/live', '/api/health/ready'])(
    'does NOT log completion for a healthy %s probe',
    async (path) => {
      const cap = capture()
      const request = new Request(`http://localhost${path}`)

      await handleRequestWithContext({
        request,
        log: cap.log,
        next: async () => ({ response: new Response('ok', { status: 200 }) }),
      })

      expect(cap.records().find((r) => r.msg === 'request completed')).toBeUndefined()
    }
  )

  it('still logs /api/health when the probe is unhealthy (status >= 400)', async () => {
    const cap = capture()
    const request = new Request('http://localhost/api/health')

    await handleRequestWithContext({
      request,
      log: cap.log,
      next: async () => ({ response: new Response('unhealthy', { status: 503 }) }),
    })

    const completed = cap.records().find((r) => r.msg === 'request completed')
    expect(completed).toBeDefined()
    expect(completed.status).toBe(503)
  })

  it('still logs failure when /api/health throws', async () => {
    const cap = capture()
    const request = new Request('http://localhost/api/health')

    await expect(
      handleRequestWithContext({
        request,
        log: cap.log,
        next: async () => {
          throw new Error('probe boom')
        },
      })
    ).rejects.toThrow('probe boom')

    expect(cap.records().find((r) => r.msg === 'request failed')).toBeDefined()
  })

  it('logs failure and rethrows when next() throws', async () => {
    const cap = capture()
    const request = new Request('http://localhost/boom')
    const boom = new Error('kaboom')

    await expect(
      handleRequestWithContext({
        request,
        log: cap.log,
        next: async () => {
          throw boom
        },
      })
    ).rejects.toThrow('kaboom')

    const failed = cap.records().find((r) => r.msg === 'request failed')
    expect(failed).toBeDefined()
    expect(failed.level).toBe('error')
  })

  it('logs a client disconnect below error and still rethrows it (L1)', async () => {
    // What the runtime raises when the client closes the connection mid-request.
    const cap = capture()
    const controller = new AbortController()
    const request = new Request('http://localhost/admin/feedback', { signal: controller.signal })
    const closed = new DOMException('The connection was closed.', 'AbortError')

    await expect(
      handleRequestWithContext({
        request,
        log: cap.log,
        next: async () => {
          controller.abort(closed)
          throw closed
        },
      })
    ).rejects.toBe(closed)

    const records = cap.records()
    expect(records.some((r) => r.level === 'error')).toBe(false)
    const aborted = records.find((r) => r.msg === 'request aborted by client')
    expect(aborted).toBeDefined()
    expect(aborted.level).toBe('info')
  })

  it('logs an AbortError at error when the client is still connected (L2)', async () => {
    // Our own aborted work (a cancelled outbound fetch) escaping a route is a
    // failure, even though it carries the same name as a disconnect.
    const cap = capture()
    const request = new Request('http://localhost/admin/feedback')
    const ours = new DOMException('This operation was aborted', 'AbortError')
    await expect(
      handleRequestWithContext({
        request,
        log: cap.log,
        next: async () => {
          throw ours
        },
      })
    ).rejects.toBe(ours)

    const failed = cap.records().find((r) => r.msg === 'request failed')
    expect(failed?.level).toBe('error')
    expect(cap.records().some((r) => r.msg === 'request aborted by client')).toBe(false)
  })

  it('still logs other failures at error after the client has gone (L2)', async () => {
    const cap = capture()
    const controller = new AbortController()
    const request = new Request('http://localhost/boom', { signal: controller.signal })
    await expect(
      handleRequestWithContext({
        request,
        log: cap.log,
        next: async () => {
          controller.abort(new DOMException('The connection was closed.', 'AbortError'))
          throw new TypeError('cannot read properties of undefined')
        },
      })
    ).rejects.toThrow(TypeError)

    const failed = cap.records().find((r) => r.msg === 'request failed')
    expect(failed?.level).toBe('error')
  })
})

/** Anything a route can throw, AbortErrors of every construction among them. */
const thrownValue = fc.oneof(
  fc.string().map((message) => new Error(message)),
  fc.string().map((message) => new TypeError(message)),
  fc
    .tuple(fc.string(), fc.constantFrom('AbortError', 'TimeoutError', 'NetworkError'))
    .map(([message, name]) => new DOMException(message, name)),
  fc.string().map((message) => Object.assign(new Error(message), { name: 'AbortError' })),
  fc.string()
)

/** One request through the boundary that fails with `thrown`; returns what was logged. */
async function failOnce(thrown: unknown, clientHungUpWith?: unknown) {
  const cap = capture()
  const controller = new AbortController()
  const request = new Request('http://localhost/admin/feedback', { signal: controller.signal })
  const outcome = await handleRequestWithContext({
    request,
    log: cap.log,
    next: async () => {
      if (clientHungUpWith !== undefined) controller.abort(clientHungUpWith)
      throw thrown
    },
  }).then(
    () => 'resolved',
    (error: unknown) => error
  )
  return { outcome, records: cap.records() }
}

describe('the level a failed request is logged at (L1, L2)', () => {
  it('is error for anything thrown while the client is still connected (L2)', async () => {
    await fc.assert(
      fc.asyncProperty(thrownValue, async (thrown) => {
        const { outcome, records } = await failOnce(thrown)

        expect(outcome).toBe(thrown)
        expect(records.map((r) => [r.level, r.msg])).toEqual([['error', 'request failed']])
      }),
      { numRuns: 200 }
    )
  })

  it('is info for the hang-up itself, whatever the runtime named its reason (L1)', async () => {
    const hangUpReason = fc.oneof(
      fc.constant(new DOMException('The connection was closed.', 'AbortError')),
      fc.string().map((message) => new DOMException(message, 'AbortError')),
      fc.string().map((message) => new Error(message))
    )
    await fc.assert(
      fc.asyncProperty(hangUpReason, async (reason) => {
        const { outcome, records } = await failOnce(reason, reason)

        expect(outcome).toBe(reason)
        expect(records.map((r) => [r.level, r.msg])).toEqual([
          ['info', 'request aborted by client'],
        ])
      }),
      { numRuns: 200 }
    )
  })
})
