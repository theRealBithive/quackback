/**
 * The audience of the session POST /api/widget/identify hands back.
 *
 * The route mints an ordinary Better Auth session and returns its token as a
 * Bearer, and the `bearer()` plugin makes that token satisfy
 * `auth.api.getSession()` everywhere. So the one thing that keeps it away from
 * the dashboard is the audience written on the row — and the one thing that
 * keeps it from *inheriting* a dashboard audience is the filter on the reuse
 * lookup, which is why both halves are asserted here.
 *
 * Drizzle's operators are the real ones in this suite rather than stubs: the
 * reuse filter is the claim, and a `vi.fn()` standing in for `and` would let
 * every arrangement of conditions pass, the missing one included.
 *
 * Contract (from the confirmed list for this batch; the full list is in
 * lib/server/functions/__tests__/auth-scope.test.ts):
 *
 *   R4 A widget identify never reuses a dashboard session. It mints its own.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockUserFindFirst = vi.fn()
const mockPrincipalFindFirst = vi.fn()
const mockSessionFindFirst = vi.fn()
const mockInsertedRows: Array<Record<string, unknown>> = []
const mockVerifyJWT = vi.fn()

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: vi.fn(() => (opts: unknown) => ({ options: opts })),
}))

vi.mock('@/lib/server/db', async (importOriginal) => ({
  // The operators and tables stay real; only the handle is doubled.
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: {
    query: {
      user: { findFirst: (...args: unknown[]) => mockUserFindFirst(...args) },
      session: { findFirst: (...args: unknown[]) => mockSessionFindFirst(...args) },
      principal: { findFirst: (...args: unknown[]) => mockPrincipalFindFirst(...args) },
      segments: { findFirst: vi.fn() },
    },
    insert: () => ({
      values: (row: Record<string, unknown>) => {
        mockInsertedRows.push(row)
        const chain = {
          returning: async () => [{ id: 'newly_inserted' }],
          onConflictDoUpdate: async () => undefined,
          onConflictDoNothing: () => chain,
        }
        return chain
      },
    }),
    update: () => ({ set: () => ({ where: async () => undefined }) }),
  },
}))

vi.mock('@/lib/server/domains/settings/settings.widget', () => ({
  getWidgetConfig: vi.fn(async () => ({ enabled: true, identifyVerification: false })),
  getWidgetSecret: vi.fn(async () => 'secret'),
}))
vi.mock('@/lib/server/domains/posts/post.public', () => ({
  getAllUserVotedPostIds: vi.fn(async () => new Set()),
}))
vi.mock('@/lib/server/storage/s3', () => ({ getPublicUrlOrNull: vi.fn(() => null) }))
vi.mock('@/lib/server/auth/identify-merge', () => ({
  resolveAndMergeAnonymousToken: vi.fn(),
}))
vi.mock('@/lib/server/widget/identity-token', () => ({
  verifyHS256JWT: (...args: unknown[]) => mockVerifyJWT(...args),
}))
vi.mock('@/lib/server/domains/users/user.attributes', () => ({
  validateAndCoerceAttributes: vi.fn(async () => ({ valid: {}, removals: [], errors: [] })),
}))
vi.mock('@/lib/server/domains/segments/segment-membership.service', () => ({
  addMember: vi.fn(async () => undefined),
  reconcileWidgetMemberships: vi.fn(async () => undefined),
}))

import { Route } from '../identify'

type RouteOpts = {
  server: { handlers: { POST: (args: { request: Request }) => Promise<Response> } }
}
const { POST } = (Route as unknown as { options: RouteOpts }).options.server.handlers

function postIdentify(body: Record<string, unknown>): Promise<Response> {
  return POST({
    request: new Request('http://test/api/widget/identify', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  })
}

/**
 * Every string anywhere inside a drizzle condition tree.
 *
 * A `where` is a nest of SQL objects and column references, and the claim is
 * about one fragment inside it. Flattening is how that fragment can be looked
 * for without pinning the exact shape drizzle happens to build this release.
 */
function stringsIn(value: unknown, seen = new Set<unknown>()): string[] {
  if (typeof value === 'string') return [value]
  if (value === null || typeof value !== 'object' || seen.has(value)) return []
  seen.add(value)
  return Object.values(value as Record<string, unknown>).flatMap((v) => stringsIn(v, seen))
}

/** The row the route asked the session table to insert, if it minted one. */
function mintedSession(): Record<string, unknown> | undefined {
  return mockInsertedRows.find((row) => 'token' in row && 'expiresAt' in row)
}

beforeEach(() => {
  vi.clearAllMocks()
  mockInsertedRows.length = 0
  mockUserFindFirst.mockResolvedValue({
    id: 'user_portal_sso',
    email: 'sso@acme.com',
    name: 'Portal User',
    image: null,
    imageKey: null,
    metadata: null,
  })
  mockPrincipalFindFirst.mockResolvedValue({ id: 'principal_portal_sso', role: 'user' })
  mockSessionFindFirst.mockResolvedValue(null)
  mockVerifyJWT.mockReturnValue({ sub: 'sso-user', email: 'sso@acme.com', name: 'SSO User' })
})

describe('the session a widget identify hands back (R4)', () => {
  it('mints it with the widget audience', async () => {
    const res = await postIdentify({ ssoToken: 'jwt.token.here' })

    expect(res.status).toBe(200)
    expect(mintedSession()).toMatchObject({ scope: 'widget' })
  })

  it('only ever looks for a widget or portal session to reuse', async () => {
    await postIdentify({ ssoToken: 'jwt.token.here' })

    expect(mockSessionFindFirst).toHaveBeenCalled()
    const where = mockSessionFindFirst.mock.calls[0][0] as { where: unknown }
    const fragments = stringsIn(where.where)

    // The filter is what stops a teammate's dashboard session being handed to
    // an embedding origin as a Bearer token.
    expect(fragments.join(' ')).toContain("in ('widget', 'portal')")
  })

  it('mints rather than reuses when the lookup finds nothing', async () => {
    mockSessionFindFirst.mockResolvedValue(null)

    const res = await postIdentify({ ssoToken: 'jwt.token.here' })

    expect(res.status).toBe(200)
    expect(mintedSession()).toBeDefined()
  })

  it('reuses the session the lookup did find, and mints none', async () => {
    mockSessionFindFirst.mockResolvedValue({
      id: 'sess_existing',
      token: 'existing-token',
      userId: 'user_portal_sso',
      scope: 'widget',
      expiresAt: new Date(Date.now() + 3600_000),
    })

    const res = await postIdentify({ ssoToken: 'jwt.token.here' })

    expect(res.status).toBe(200)
    expect(mintedSession()).toBeUndefined()
    const body = (await res.json()) as { sessionToken?: string }
    expect(body.sessionToken).toBe('existing-token')
  })
})
