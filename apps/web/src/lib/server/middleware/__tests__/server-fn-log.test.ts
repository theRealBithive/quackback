/**
 * How a failing server function is logged.
 *
 * Contract (confirmed list for batch K, upstream #688; the full list is in
 * lib/server/__tests__/runtime-error-log.test.ts). The clause held here:
 *
 *   L4 A server-function call rejected for invalid input is logged as a
 *      warning, not an error.
 *
 * Tests without a number predate batch K.
 */
import { describe, it, expect, vi } from 'vitest'
import { redirect, notFound } from '@tanstack/react-router'
import { execValidator } from '@tanstack/react-start'
import { z } from 'zod'
import fc from 'fast-check'
import { classifyServerFnError, runWithServerFnLogging } from '../server-fn-log'
import {
  ForbiddenError,
  InternalError,
  NotFoundError,
  RateLimitError,
  ValidationError,
} from '@/lib/shared/errors'

function fakeLog() {
  return { warn: vi.fn(), error: vi.fn() }
}

describe('classifyServerFnError', () => {
  it('does not log framework control flow', () => {
    // A signed-out visitor being redirected is the system working, and this is
    // the busiest path in the app.
    expect(classifyServerFnError(redirect({ to: '/' }))).toBeNull()
    expect(classifyServerFnError(notFound())).toBeNull()
  })

  it('logs client-caused domain errors at warn', () => {
    expect(classifyServerFnError(new ValidationError('BAD', 'bad'))).toBe('warn')
    expect(classifyServerFnError(new ForbiddenError('NOPE', 'nope'))).toBe('warn')
    expect(classifyServerFnError(new NotFoundError('GONE', 'gone'))).toBe('warn')
    expect(classifyServerFnError(new RateLimitError(30))).toBe('warn')
  })

  it('logs server-caused domain errors at error', () => {
    expect(classifyServerFnError(new InternalError('DB', 'db down'))).toBe('error')
  })

  it('logs validator rejections at warn, not error (L4)', () => {
    // Validators run upstream of the handler, so a stale client or a bot
    // hitting the endpoint with a malformed payload surfaces here.
    const zodish = Object.assign(new Error('Invalid input'), {
      name: 'ZodError',
      issues: [{ path: ['email'], message: 'Required' }],
    })
    expect(classifyServerFnError(zodish)).toBe('warn')

    const standardSchemaish = Object.assign(new Error('Invalid input'), {
      issues: [{ message: 'Required' }],
    })
    expect(classifyServerFnError(standardSchemaish)).toBe('warn')
  })

  it('logs a rejection from the framework validator path at warn (L4)', async () => {
    // createServerFn().validator(zodSchema) runs through execValidator, which
    // does not rethrow the ZodError: it throws a plain Error whose message is
    // the JSON-serialised issue list. Capture the real thrown value.
    const schema = z.object({ token: z.string().uuid(), title: z.string().min(3) })
    const thrown = await execValidator(schema, { token: 'nope', title: 'x' }).then(
      () => undefined,
      (error: unknown) => error
    )
    expect(thrown).toBeInstanceOf(Error)
    expect((thrown as Error).name).toBe('Error')
    expect(classifyServerFnError(thrown)).toBe('warn')
  })

  it('does not mistake an ordinary error with a JSON message for a validation failure (L4)', () => {
    expect(classifyServerFnError(new Error('[]'))).toBe('error')
    expect(classifyServerFnError(new Error('[1, 2, 3]'))).toBe('error')
    expect(classifyServerFnError(new Error('{"message":"upstream said no"}'))).toBe('error')
    expect(classifyServerFnError(new Error('[not json'))).toBe('error')
  })

  it('logs auth denials at warn', () => {
    // requireAuth throws a plain Error, and a signed-out call is the single
    // most common expected failure — at error it would swamp everything else.
    expect(classifyServerFnError(new Error('Authentication required'))).toBe('warn')
    expect(classifyServerFnError(new Error('Access denied: post.view_private'))).toBe('warn')
  })

  it('reads a statusCode off errors that are not DomainExceptions', () => {
    // e.g. CopilotUnavailableError, which carries a status without the base class.
    expect(classifyServerFnError(Object.assign(new Error('gate'), { statusCode: 404 }))).toBe(
      'warn'
    )
    expect(classifyServerFnError(Object.assign(new Error('gate'), { statusCode: 503 }))).toBe(
      'error'
    )
  })

  it('logs anything unrecognised at error', () => {
    expect(classifyServerFnError(new Error('boom'))).toBe('error')
    expect(classifyServerFnError('boom')).toBe('error')
    expect(classifyServerFnError(null)).toBe('error')
  })
})

describe('runWithServerFnLogging', () => {
  it('passes the result through untouched on success', async () => {
    const log = fakeLog()
    const result = await runWithServerFnLogging({
      next: async () => ({ ok: true }),
      name: 'fetchThings',
      log: log as never,
    })
    expect(result).toEqual({ ok: true })
    expect(log.error).not.toHaveBeenCalled()
    expect(log.warn).not.toHaveBeenCalled()
  })

  it('logs the failure and rethrows it unchanged', async () => {
    const log = fakeLog()
    const boom = new Error('boom')
    await expect(
      runWithServerFnLogging({
        next: async () => {
          throw boom
        },
        name: 'fetchThings',
        log: log as never,
      })
    ).rejects.toBe(boom)

    expect(log.error).toHaveBeenCalledTimes(1)
    const [fields, message] = log.error.mock.calls[0]
    expect(message).toBe('fetchThings failed')
    expect(fields.err).toBe(boom)
    expect(fields.server_fn).toBe('fetchThings')
    expect(typeof fields.duration_ms).toBe('number')
  })

  it('rethrows a redirect without logging it', async () => {
    const log = fakeLog()
    const r = redirect({ to: '/' })
    await expect(
      runWithServerFnLogging({
        next: async () => {
          throw r
        },
        name: 'requireWorkspace',
        log: log as never,
      })
    ).rejects.toBe(r)

    expect(log.error).not.toHaveBeenCalled()
    expect(log.warn).not.toHaveBeenCalled()
  })

  it('uses warn for a 4xx domain error', async () => {
    const log = fakeLog()
    await expect(
      runWithServerFnLogging({
        next: async () => {
          throw new ForbiddenError('NOPE', 'nope')
        },
        name: 'deleteThing',
        log: log as never,
      })
    ).rejects.toBeInstanceOf(ForbiddenError)

    expect(log.warn).toHaveBeenCalledTimes(1)
    expect(log.error).not.toHaveBeenCalled()
  })
})

describe('invalid input to a server function (L4)', () => {
  const schema = z.object({ token: z.string().uuid(), title: z.string().min(3), count: z.number() })

  it('logs every rejection the framework validator produces at warn', async () => {
    const invalidPayload = fc
      .oneof(
        fc.anything(),
        fc.record(
          { token: fc.string(), title: fc.string(), count: fc.anything() },
          { requiredKeys: [] }
        )
      )
      .filter((payload) => !schema.safeParse(payload).success)
    await fc.assert(
      fc.asyncProperty(invalidPayload, async (payload) => {
        const thrown = await execValidator(schema, payload).then(
          () => 'accepted',
          (error: unknown) => error
        )

        expect(classifyServerFnError(thrown)).toBe('warn')
      }),
      { numRuns: 200 }
    )
  })

  /** A standard-schema issue as the validator serialises it. */
  const issue = fc.record(
    {
      message: fc.string(),
      path: fc.array(fc.oneof(fc.string(), fc.nat())),
      code: fc.string(),
    },
    { requiredKeys: ['message'] }
  )

  it('logs a serialised issue list at warn, however it is padded', () => {
    fc.assert(
      fc.property(
        fc.array(issue, { minLength: 1, maxLength: 5 }),
        fc.constantFrom('', ' ', '\n  '),
        (issues, padding) => {
          const error = new Error(padding + JSON.stringify(issues))

          expect(classifyServerFnError(error)).toBe('warn')
        }
      )
    )
  })

  it('logs at error what only resembles an issue list', () => {
    const notAnIssue = fc.oneof(
      fc.record({ message: fc.oneof(fc.integer(), fc.constant(null), fc.boolean()) }),
      fc.record({ path: fc.array(fc.string()) }),
      fc.string(),
      fc.integer(),
      fc.constant(null)
    )
    const resemblance = fc.oneof(
      // An empty list is not a rejection.
      fc.constant({ name: 'Error', text: '[]' }),
      // One entry that is not an issue spoils the list.
      fc
        .tuple(fc.array(issue, { maxLength: 3 }), notAnIssue, fc.array(issue, { maxLength: 3 }))
        .map(([before, odd, after]) => ({
          name: 'Error',
          text: JSON.stringify([...before, odd, ...after]),
        })),
      // A real issue list on an error the validator does not throw.
      fc.array(issue, { minLength: 1, maxLength: 3 }).map((issues) => ({
        name: 'TypeError',
        text: JSON.stringify(issues),
      }))
    )
    fc.assert(
      fc.property(resemblance, ({ name, text }) => {
        const error = name === 'TypeError' ? new TypeError(text) : new Error(text)

        expect(classifyServerFnError(error)).toBe('error')
      })
    )
  })
})
