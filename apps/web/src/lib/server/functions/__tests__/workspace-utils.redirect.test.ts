import { describe, it, expect, vi, beforeEach } from 'vitest'
import { db } from '@/lib/server/db'

/**
 * `requireWorkspaceRole` guards team routes in `beforeLoad`. When an
 * unauthenticated caller hits a team-only route it must land on the
 * portal sign-in dialog (portal root with `auth=signin`) carrying
 * `callbackUrl=/admin`. Portal-allowed routes still fall back to `/`.
 *
 * The handler is a `createServerFn`, so we stub `createServerFn` to
 * capture the raw handler and invoke it directly — the same pattern the
 * other function-handler tests use.
 *
 * Batch D adds the audience gate on the same route guard, contract R2 — a
 * teammate's role is not enough, the session has to be a dashboard one. The
 * confirmed list is in auth-scope.test.ts.
 */

const hoisted = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
}))

vi.mock('@/lib/server/auth/session', () => ({ getSession: hoisted.mockGetSession }))

// Spread the real db module so tables/operators stay current; override only what this suite drives.
vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: { query: { settings: { findFirst: vi.fn() }, principal: { findFirst: vi.fn() } } },
  eq: vi.fn(),
}))

// The permission resolver opens its own query builder; this suite drives the
// route guard, and the resolver has its own tests next door.
vi.mock('@/lib/server/policy/permissions', () => ({
  permissionsForPrincipal: vi.fn(async () => new Set<string>()),
}))

vi.mock('@/lib/server/logger', () => ({
  logger: { child: () => ({ debug: vi.fn(), error: vi.fn(), warn: vi.fn(), info: vi.fn() }) },
}))

type AnyHandler = (args: { data: { allowedRoles: string[] } }) => Promise<unknown>

const handlers: AnyHandler[] = []
vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => {
    const chain = {
      validator() {
        return chain
      },
      handler(fn: AnyHandler) {
        handlers.push(fn)
        return chain
      },
    }
    return chain
  },
}))

type RedirectErr = {
  to?: string
  search?: { callbackUrl?: string; auth?: string; error?: string }
  options?: { to?: string; search?: { callbackUrl?: string; auth?: string; error?: string } }
}

let requireWorkspaceRole: AnyHandler

beforeEach(async () => {
  vi.clearAllMocks()
  if (handlers.length === 0) await import('../workspace-utils')
  requireWorkspaceRole = handlers[0]
})

describe('requireWorkspaceRole redirect target', () => {
  it('sends unauthenticated team-only callers to the sign-in dialog with callbackUrl=/admin', async () => {
    hoisted.mockGetSession.mockResolvedValue(null)

    const err = await requireWorkspaceRole({ data: { allowedRoles: ['admin', 'member'] } })
      .then(() => null)
      .catch((e) => e as RedirectErr)

    expect(err?.to ?? err?.options?.to).toBe('/')
    const search = err?.search ?? err?.options?.search
    expect(search?.auth).toBe('signin')
    expect(search?.callbackUrl).toBe('/admin')
  })

  it('leaves portal-allowed (non-team) callers on /', async () => {
    hoisted.mockGetSession.mockResolvedValue(null)

    const err = await requireWorkspaceRole({ data: { allowedRoles: ['admin', 'user'] } })
      .then(() => null)
      .catch((e) => e as { to?: string; options?: { to?: string } })

    expect(err?.to ?? err?.options?.to).toBe('/')
  })

  it.each(['widget', 'portal'] as const)(
    'turns an admin on a %s session away from a team route (R2)',
    async (scope) => {
      hoisted.mockGetSession.mockResolvedValue({ session: { scope }, user: { id: 'user_001' } })
      ;(db.query.settings.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 1 })
      ;(db.query.principal.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: 'principal_1',
        role: 'admin',
      })

      const err = await requireWorkspaceRole({ data: { allowedRoles: ['admin', 'member'] } })
        .then(() => null)
        .catch((e) => e as RedirectErr)

      const search = err?.search ?? err?.options?.search
      expect(search?.error).toBe('not_team_member')
    }
  )

  it('lets the same admin through on a dashboard session (R2)', async () => {
    hoisted.mockGetSession.mockResolvedValue({
      session: { scope: 'dashboard' },
      user: { id: 'user_001' },
    })
    ;(db.query.settings.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 1 })
    ;(db.query.principal.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'principal_1',
      role: 'admin',
    })

    await expect(
      requireWorkspaceRole({ data: { allowedRoles: ['admin', 'member'] } })
    ).resolves.toBeDefined()
  })

  it('redirects wrong-role callers to sign-in dialog with not_team_member error', async () => {
    hoisted.mockGetSession.mockResolvedValue({ user: { id: 'user_001' } })
    ;(db.query.settings.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 1 })
    ;(db.query.principal.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({ role: 'user' })

    const err = await requireWorkspaceRole({ data: { allowedRoles: ['admin', 'member'] } })
      .then(() => null)
      .catch((e) => e as RedirectErr)

    expect(err?.to ?? err?.options?.to).toBe('/')
    const search = err?.search ?? err?.options?.search
    expect(search?.auth).toBe('signin')
    expect(search?.callbackUrl).toBe('/admin')
    expect(search?.error).toBe('not_team_member')
  })
})
