/**
 * The one-time-token handoff, driven through the real production handler.
 *
 * The suite beside this one exercises a hand-kept mirror of the handler, which
 * is the right shape for its branch cases and the wrong shape for one claim:
 *
 *   R6 The one-time-token handoff promotes the session to the portal audience
 *      before the cookie is set, not after.
 *
 * "Before, not after" is a fact about the real handler, and a mirror can agree
 * with a test while disagreeing with the code it mirrors. So this file captures
 * the handler `createServerFn` was given and calls it, with the two writes it
 * makes — the audience promotion and the Set-Cookie header — recorded in one
 * ordered log. The confirmed contract list this number comes from is in
 * lib/server/functions/__tests__/auth-scope.test.ts.
 *
 * Trust boundary (OWASP A01, broken access control): the token arrives from the
 * visitor's URL, and the session it resolves to is one Better Auth minted for
 * the widget. The promotion is what stops that cookie satisfying a team gate
 * once it reaches the portal; the provenance refusal above it is what stops a
 * token from any other flow earning the portal grant at all.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

type HandoffHandler = (args: { data: { ott?: string; returnTo?: string } }) => Promise<{
  kind: string
  status?: string
  to?: string
}>

const hoisted = vi.hoisted(() => ({
  /** The handler the route handed to `createServerFn(...).handler(...)`. */
  handler: null as HandoffHandler | null,
  /** Every write the handler makes, in the order it makes them. */
  writes: [] as string[],
  findFirst: vi.fn(),
  updateWhere: vi.fn(),
  updateSet: vi.fn(),
  insertValues: vi.fn(),
  recordAuditEvent: vi.fn(),
}))

vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => {
    const chain: Record<string, unknown> = {}
    chain.validator = () => chain
    chain.handler = (handler: HandoffHandler) => {
      hoisted.handler = handler
      return Object.assign((args: Parameters<HandoffHandler>[0]) => handler(args), chain)
    }
    return chain
  },
  // The production wrapper is a server-side identity; the route calls the
  // result directly, so the test needs the same.
  createServerOnlyFn: (fn: unknown) => fn,
}))

const mockSetResponseHeader = vi.fn((name: string, _value: unknown) => {
  hoisted.writes.push(`header:${name}`)
})

vi.mock('@tanstack/react-start/server', () => ({
  setResponseHeader: (name: string, value: unknown) => mockSetResponseHeader(name, value),
  getRequestHeaders: () => new Headers(),
}))

vi.mock('@/lib/server/config', () => ({ config: { baseUrl: 'http://localhost:3000' } }))

vi.mock('@/lib/server/audit/log', () => ({ recordAuditEvent: hoisted.recordAuditEvent }))

vi.mock('@/lib/server/logger', () => ({
  logger: {
    child: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
  },
}))

vi.mock('@/lib/server/db', () => ({
  db: {
    query: {
      widgetIdentifiedSession: { findFirst: (...args: unknown[]) => hoisted.findFirst(...args) },
    },
    update: () => ({
      set: (values: unknown) => {
        hoisted.updateSet(values)
        return {
          where: (condition: unknown) => {
            hoisted.writes.push('promote')
            return hoisted.updateWhere(condition)
          },
        }
      },
    }),
    insert: () => ({
      values: (row: unknown) => {
        hoisted.insertValues(row)
        return { onConflictDoNothing: () => Promise.resolve(undefined) }
      },
    }),
  },
  session: { id: 'session.id' },
  widgetIdentifiedSession: { sessionId: 'widget_identified_session.session_id' },
  widgetOriginSession: { sessionId: 'widget_origin_session.session_id' },
  eq: (column: unknown, value: unknown) => ({ kind: 'eq', column, value }),
}))

const VERIFIED_SESSION = 'sess_from_the_token'

/** A Better Auth verify response for a session the widget really identified. */
function baVerifyResponse(): Response {
  return {
    ok: true,
    status: 200,
    headers: new Headers([['set-cookie', 'better-auth.session_token=abc; Path=/']]),
    json: async () => ({
      session: { id: VERIFIED_SESSION, userId: 'user_1' },
      user: { id: 'user_1' },
    }),
  } as unknown as Response
}

/** Load the route once and hand back the handler it registered. */
async function handoffHandler(): Promise<HandoffHandler> {
  await import('../auth.widget-handoff')
  if (!hoisted.handler) throw new Error('the route registered no server-fn handler')
  return hoisted.handler
}

beforeEach(() => {
  hoisted.writes.length = 0
  hoisted.findFirst.mockReset()
  hoisted.updateWhere.mockReset().mockResolvedValue(undefined)
  hoisted.updateSet.mockReset()
  hoisted.insertValues.mockReset()
  hoisted.recordAuditEvent.mockReset().mockResolvedValue(undefined)
  mockSetResponseHeader.mockClear()
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => baVerifyResponse())
  )
})

describe('the handoff handler on a session the widget identified (R6)', () => {
  it('promotes the session to the portal audience before it forwards the cookie', async () => {
    // The order is the guarantee. Installing the cookie first opens a window —
    // however short — in which the browser holds a session that still satisfies
    // every dashboard gate, and a promotion that failed afterwards would leave
    // it there for good.
    hoisted.findFirst.mockResolvedValue({ hmacVerified: true })

    const result = await (await handoffHandler())({ data: { ott: 'tok', returnTo: '/portal' } })

    expect(result).toEqual({ kind: 'redirect', to: '/portal' })
    expect(hoisted.writes).toEqual(['promote', 'header:Set-Cookie'])
  })

  it('writes the portal audience, not some other one', async () => {
    hoisted.findFirst.mockResolvedValue({ hmacVerified: true })

    await (
      await handoffHandler()
    )({ data: { ott: 'tok', returnTo: '/portal' } })

    expect(hoisted.updateSet).toHaveBeenCalledWith({ scope: 'portal' })
  })

  it('promotes the session the token resolved to', async () => {
    // Not the one the browser arrived with: the cookie about to be installed is
    // the token's session, so that is the row whose audience has to change.
    hoisted.findFirst.mockResolvedValue({ hmacVerified: true })

    await (
      await handoffHandler()
    )({ data: { ott: 'tok', returnTo: '/portal' } })

    expect(hoisted.updateWhere).toHaveBeenCalledWith(
      expect.objectContaining({ value: VERIFIED_SESSION })
    )
  })
})

describe('the handoff handler on a session it refuses (R6)', () => {
  it('neither promotes nor forwards a cookie when provenance fails', async () => {
    // The refusal has to come before both writes: a promotion here would edit a
    // session the visitor is not being given, and a cookie would hand it over.
    hoisted.findFirst.mockResolvedValue({ hmacVerified: false })

    const result = await (await handoffHandler())({ data: { ott: 'tok', returnTo: '/portal' } })

    expect(result).toEqual({ kind: 'error', status: 'invalid' })
    expect(hoisted.writes).toEqual([])
  })

  it('neither promotes nor forwards a cookie when the token names no session', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        headers: new Headers([['set-cookie', 'better-auth.session_token=abc']]),
        json: async () => ({}),
      }))
    )

    const result = await (await handoffHandler())({ data: { ott: 'tok', returnTo: '/portal' } })

    expect(result).toEqual({ kind: 'error', status: 'invalid' })
    expect(hoisted.writes).toEqual([])
  })
})

describe('the handoff handler when the promotion write fails (R6)', () => {
  it('still installs the cookie, so the visitor reaches the portal', async () => {
    // Accepted behaviour, recorded rather than asserted as desirable: the
    // promotion is best-effort, exactly like the origin-marker insert below it.
    // A session that stayed `dashboard` here is one whose principal is a widget
    // visitor with no team role, so the audience is the second lock and not the
    // only one — but it is a lock that silently did not engage.
    hoisted.findFirst.mockResolvedValue({ hmacVerified: true })
    hoisted.updateWhere.mockRejectedValue(new Error('connection refused'))

    const result = await (await handoffHandler())({ data: { ott: 'tok', returnTo: '/portal' } })

    expect(result).toEqual({ kind: 'redirect', to: '/portal' })
    expect(hoisted.writes).toEqual(['promote', 'header:Set-Cookie'])
  })
})
