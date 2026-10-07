/**
 * The HTTP runtime prints any non-HTTP error that escapes a request with a
 * bare console.error, which Bun renders as a multi-line dump. These tests drive
 * the framework's real request handler, and where it matters the real request
 * boundary inside it, so they fail if the print moves or changes shape, or if
 * the boundary stops telling the runtime log what it already logged.
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
import { getEventListeners } from 'node:events'
import { describe, it, expect, vi } from 'vitest'
import { requestHandler } from '@tanstack/react-start/server'
import { createLogger, logger } from '@/lib/server/logger'
import { handleRequestWithContext } from '@/lib/server/middleware/request-context'
import {
  installRuntimeErrorLog,
  isClientDisconnect,
  noteClientDisconnectOf,
  noteLoggedAtBoundary,
} from '@/lib/server/runtime-error-log'

function capture() {
  const lines: string[] = []
  const log = createLogger({
    level: 'debug',
    destination: { write: (s: string) => void lines.push(s) },
  })
  return { log, records: () => lines.map((l) => JSON.parse(l)) }
}

/** A console stand-in, so the test never patches the real one. */
function fakeConsole() {
  const printed: unknown[][] = []
  return { printed, target: { error: (...args: unknown[]) => void printed.push(args) } }
}

/** Run one request through the framework with the given console.error. */
async function runThroughFramework(
  target: { error: (...args: unknown[]) => void },
  handler: (request: Request) => Promise<Response>,
  request = new Request('http://localhost/admin/feedback')
): Promise<Response> {
  const original = console.error
  console.error = (...args: unknown[]) => target.error(...args)
  try {
    return await requestHandler(handler)(request, {} as never)
  } finally {
    console.error = original
  }
}

const closed = () => new DOMException('The connection was closed.', 'AbortError')

/** What the runtime prints for an error it did not expect: h3's unhandled wrapper. */
function unhandledWrapper(cause: unknown) {
  return Object.assign(new Error('HTTPError'), {
    name: 'HTTPError',
    unhandled: true,
    status: 500,
    cause,
  })
}

describe('installRuntimeErrorLog', () => {
  it('drops the dump for a client disconnect the request boundary saw (L1, L3)', async () => {
    const cap = capture()
    const { printed, target } = fakeConsole()
    installRuntimeErrorLog({ log: cap.log, target })
    const controller = new AbortController()
    const reason = closed()

    const res = await runThroughFramework(
      target,
      (request) =>
        handleRequestWithContext({
          request,
          log: cap.log,
          next: async () => {
            controller.abort(reason)
            throw reason
          },
        }) as never,
      new Request('http://localhost/admin/feedback', { signal: controller.signal })
    )

    expect(res.status).toBe(500)
    expect(printed).toEqual([])
    const records = cap.records()
    expect(records.some((r) => r.level === 'error')).toBe(false)
    expect(records.map((r) => r.msg)).toEqual(['request aborted by client'])
  })

  it('drops a disconnect the framework raises after the boundary has returned (L1, L3)', async () => {
    // The framework rethrows the signal's reason once the middleware chain is
    // done, so this throw never passes through the boundary's catch.
    const cap = capture()
    const { printed, target } = fakeConsole()
    installRuntimeErrorLog({ log: cap.log, target })
    const controller = new AbortController()

    await runThroughFramework(
      target,
      async (request) => {
        await handleRequestWithContext({
          request,
          log: cap.log,
          next: async () => ({ response: new Response('ok') }),
        })
        controller.abort(closed())
        throw request.signal.reason
      },
      new Request('http://localhost/admin/feedback', { signal: controller.signal })
    )

    expect(printed).toEqual([])
    expect(cap.records().some((r) => r.level === 'error')).toBe(false)
  })

  it('logs an AbortError that is not a client disconnect (L2)', async () => {
    // e.g. our own cancelled outbound fetch escaping a route.
    const cap = capture()
    const { printed, target } = fakeConsole()
    installRuntimeErrorLog({ log: cap.log, target })

    await runThroughFramework(target, async () => {
      throw new DOMException('This operation was aborted', 'AbortError')
    })

    expect(printed).toEqual([])
    const records = cap.records()
    expect(records).toHaveLength(1)
    expect(records[0].level).toBe('error')
    expect(records[0].msg).toBe('unhandled request error')
  })

  it('logs any other escaped error as one structured line (L3)', async () => {
    const cap = capture()
    const { printed, target } = fakeConsole()
    installRuntimeErrorLog({ log: cap.log, target })

    await runThroughFramework(target, async () => {
      throw new TypeError('cannot read properties of undefined')
    })

    expect(printed).toEqual([])
    const records = cap.records()
    expect(records).toHaveLength(1)
    expect(records[0].level).toBe('error')
    expect(records[0].msg).toBe('unhandled request error')
    expect(records[0].status).toBe(500)
    // The original error, not the runtime's wrapper around it.
    expect(records[0].err.type).toBe('TypeError')
    expect(records[0].err.message).toBe('cannot read properties of undefined')
  })

  it('does not log again an error the request boundary already logged (L3)', async () => {
    const cap = capture()
    const { printed, target } = fakeConsole()
    installRuntimeErrorLog({ log: cap.log, target })

    await runThroughFramework(
      target,
      (request) =>
        handleRequestWithContext({
          request,
          log: cap.log,
          next: async () => {
            throw new Error('kaboom')
          },
        }) as never
    )

    expect(printed).toEqual([])
    const records = cap.records()
    expect(records.map((r) => [r.level, r.msg])).toEqual([['error', 'request failed']])
  })

  it('shares what the boundary logged with a wrapper installed before a module reload (L3)', async () => {
    // A dev reload re-evaluates this module but the console keeps the first
    // wrapper (the install guard lives on the console), so both must read one set.
    const cap = capture()
    const { printed, target } = fakeConsole()
    installRuntimeErrorLog({ log: cap.log, target })

    vi.resetModules()
    const reloaded = await import('@/lib/server/runtime-error-log')
    const boom = new Error('kaboom')
    reloaded.noteLoggedAtBoundary(boom)

    await runThroughFramework(target, async () => {
      throw boom
    })

    expect(printed).toEqual([])
    expect(cap.records()).toEqual([])
  })

  it('passes every other console.error call through untouched', () => {
    const cap = capture()
    const { printed, target } = fakeConsole()
    installRuntimeErrorLog({ log: cap.log, target })

    const plain = new Error('library failure')
    target.error('Error in SSR cleanup:', plain)
    target.error(plain)

    expect(printed).toEqual([['Error in SSR cleanup:', plain], [plain]])
    expect(cap.records()).toEqual([])
  })

  it('wraps the target only once', () => {
    const cap = capture()
    const { printed, target } = fakeConsole()
    installRuntimeErrorLog({ log: cap.log, target })
    installRuntimeErrorLog({ log: cap.log, target })

    target.error('once')
    expect(printed).toEqual([['once']])
  })

  it('keeps the first installation when installed again (L3)', () => {
    const first = capture()
    const second = capture()
    const { printed, target } = fakeConsole()
    installRuntimeErrorLog({ log: first.log, target })
    installRuntimeErrorLog({ log: second.log, target })

    target.error(unhandledWrapper(new TypeError('boom')))

    expect(printed).toEqual([])
    expect(first.records().map((r) => r.msg)).toEqual(['unhandled request error'])
    expect(second.records()).toEqual([])
  })

  it('is not fooled into skipping its install by an unrelated mark on the console (L3)', () => {
    // The install mark is a process-wide registry key, which any other code
    // can claim under a name of its own; only ours means "already wrapped".
    const cap = capture()
    const { printed, target } = fakeConsole()
    const marked = Object.assign(target, { [Symbol.for('')]: true })
    installRuntimeErrorLog({ log: cap.log, target: marked })

    marked.error(unhandledWrapper(new TypeError('boom')))

    expect(printed).toEqual([])
    expect(cap.records().map((r) => r.msg)).toEqual(['unhandled request error'])
  })

  it('takes over only the runtime print of an unexpected error (L2, L3)', () => {
    // Everything that is not exactly that one call shape is printed as it
    // was: the wrapper with a second argument, an HTTP error raised on
    // purpose, an ordinary error that merely carries the flag, a lookalike
    // that is no Error at all, and nothing.
    const cap = capture()
    const { printed, target } = fakeConsole()
    installRuntimeErrorLog({ log: cap.log, target })
    const wrapper = unhandledWrapper(new TypeError('boom'))
    const deliberate = Object.assign(new Error('Not Found'), { name: 'HTTPError', status: 404 })
    const flaggedPlainError = Object.assign(new Error('boom'), { unhandled: true })
    const lookalike = { name: 'HTTPError', unhandled: true, cause: new TypeError('boom') }

    target.error(wrapper, 'extra')
    target.error(deliberate)
    target.error(flaggedPlainError)
    target.error(lookalike)
    target.error(null)

    expect(printed).toEqual([
      [wrapper, 'extra'],
      [deliberate],
      [flaggedPlainError],
      [lookalike],
      [null],
    ])
    expect(cap.records()).toEqual([])
  })

  it('logs under the http-runtime component when given no logger (L2)', () => {
    const cap = capture()
    const child = vi
      .spyOn(logger, 'child')
      .mockImplementation((bindings) => cap.log.child(bindings))
    try {
      const { printed, target } = fakeConsole()
      installRuntimeErrorLog({ target })

      target.error(unhandledWrapper(new TypeError('boom')))

      expect(printed).toEqual([])
      const records = cap.records()
      expect(records.map((r) => [r.level, r.component, r.msg])).toEqual([
        ['error', 'http-runtime', 'unhandled request error'],
      ])
    } finally {
      child.mockRestore()
    }
  })
})

describe('noteLoggedAtBoundary', () => {
  it('accepts a thrown value that is not an object without failing the boundary (L3)', () => {
    // `throw 'text'` and `throw null` are legal; the boundary notes whatever
    // it caught, and a note must never become a second failure.
    for (const thrown of [null, undefined, 'text', 42, false]) {
      expect(() => noteLoggedAtBoundary(thrown)).not.toThrow()
    }
  })

  it('keeps its record in a global slot no unrelated code shares (L3)', async () => {
    // The set lives in the process-wide symbol registry so a reloaded module
    // finds it; something else holding a different registry key must not
    // be mistaken for it.
    const unrelated = Symbol.for('')
    const globals = globalThis as Record<symbol, unknown>
    globals[unrelated] = {}
    try {
      vi.resetModules()
      const reloaded = await import('@/lib/server/runtime-error-log')
      expect(() => reloaded.noteLoggedAtBoundary(new Error('kaboom'))).not.toThrow()
    } finally {
      delete globals[unrelated]
    }
  })
})

describe('noteClientDisconnectOf', () => {
  it('accounts for a disconnect that already happened when the request arrives (L1, L3)', async () => {
    const cap = capture()
    const { printed, target } = fakeConsole()
    installRuntimeErrorLog({ log: cap.log, target })
    const controller = new AbortController()
    controller.abort(closed())
    const request = new Request('http://localhost/admin/feedback', { signal: controller.signal })

    noteClientDisconnectOf(request)
    target.error(unhandledWrapper(request.signal.reason))

    expect(printed).toEqual([])
    expect(cap.records()).toEqual([])
  })

  it('accounts for a disconnect that happens later, and then lets go of the signal', () => {
    // No contract number: what this pins is that the listener is released
    // once it has fired, so a long-lived request does not keep it.
    const cap = capture()
    const { printed, target } = fakeConsole()
    installRuntimeErrorLog({ log: cap.log, target })
    const controller = new AbortController()
    const request = new Request('http://localhost/admin/feedback', { signal: controller.signal })

    noteClientDisconnectOf(request)
    expect(getEventListeners(request.signal, 'abort')).toHaveLength(1)
    controller.abort(closed())
    expect(getEventListeners(request.signal, 'abort')).toHaveLength(0)

    target.error(unhandledWrapper(request.signal.reason))
    expect(printed).toEqual([])
    expect(cap.records()).toEqual([])
  })
})

describe('isClientDisconnect', () => {
  it("is the request's own abort and nothing else (L1, L2)", () => {
    const controller = new AbortController()
    const request = new Request('http://localhost/', { signal: controller.signal })
    const reason = closed()

    // Not yet aborted: an AbortError by name alone is not a disconnect.
    expect(isClientDisconnect(reason, request)).toBe(false)

    controller.abort(reason)
    expect(isClientDisconnect(request.signal.reason, request)).toBe(true)
    expect(isClientDisconnect(closed(), request)).toBe(true)
    expect(isClientDisconnect(new TypeError('boom'), request)).toBe(false)
    expect(isClientDisconnect(new DOMException('timed out', 'TimeoutError'), request)).toBe(false)
  })

  it('counts the signal reason itself, whatever kind of error it is (L1)', () => {
    const controller = new AbortController()
    const request = new Request('http://localhost/', { signal: controller.signal })
    const reason = new Error('socket reset')

    controller.abort(reason)

    expect(isClientDisconnect(reason, request)).toBe(true)
  })

  it('does not count a thrown value that only borrows the name (L1, L2)', () => {
    const controller = new AbortController()
    const request = new Request('http://localhost/', { signal: controller.signal })
    controller.abort(closed())
    // A class thrown in place of an instance carries the name but is no error object.
    class AbortError {}

    expect(isClientDisconnect(null, request)).toBe(false)
    expect(isClientDisconnect(AbortError, request)).toBe(false)
  })
})
