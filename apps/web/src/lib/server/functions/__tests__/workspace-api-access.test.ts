/**
 * The audience gate on the import/export API and on the role every SSR loader
 * reads.
 *
 * `validateApiWorkspaceAccess` is the door to the workspace import and export
 * routes, and `getCurrentUserRole` is what the admin shell asks before it
 * decides what a person may see. Both used to answer from the principal row
 * alone, so a widget token — which the `bearer()` plugin makes a valid session
 * everywhere — reached them with whatever role its principal happened to hold.
 *
 * The session here is the one `getSession()` returns, which is already
 * normalised through `toSessionScope`; that is why the unrecognised-value case
 * is asserted against the normaliser's answer rather than by handing a junk
 * string straight in.
 *
 * Contract (from the confirmed list for this batch; the full list is in
 * functions/__tests__/auth-scope.test.ts):
 *
 *   R9  A widget or portal session is refused by the import and export API and
 *       by the onboarding administrator gates.
 *   R12 An unrecognised audience carries no dashboard authority: it reads as a
 *       non-dashboard audience, and its principal presents as an ordinary user.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import fc from 'fast-check'

const mockGetSession = vi.fn()
vi.mock('@/lib/server/auth/session', () => ({
  getSession: () => mockGetSession(),
}))

const mockPrincipalFindFirst = vi.fn()
const mockSettingsFindFirst = vi.fn()
vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: {
    query: {
      principal: { findFirst: (...args: unknown[]) => mockPrincipalFindFirst(...args) },
      settings: { findFirst: (...args: unknown[]) => mockSettingsFindFirst(...args) },
    },
  },
}))

import { getCurrentUserRole, validateApiWorkspaceAccess } from '../workspace'
import { toSessionScope, type SessionScope } from '@/lib/shared/roles'

/** A session as `getSession()` hands it over: the audience already normalised. */
function sessionScoped(scope: SessionScope) {
  return { session: { id: 'sess_1', scope }, user: { id: 'user_1' } }
}

const nonDashboard = fc
  .oneof(fc.constantFrom('widget' as const, 'portal' as const), fc.string().map(toSessionScope))
  .filter((scope) => scope !== 'dashboard')

beforeEach(() => {
  vi.clearAllMocks()
  mockPrincipalFindFirst.mockResolvedValue({ id: 'principal_1', role: 'admin', type: 'user' })
  mockSettingsFindFirst.mockResolvedValue({ id: 'workspace_1', slug: 'main', name: 'Main' })
})

describe('validateApiWorkspaceAccess (R9)', () => {
  it('lets an admin on a dashboard session through', async () => {
    mockGetSession.mockResolvedValue(sessionScoped('dashboard'))

    const result = await validateApiWorkspaceAccess()

    expect(result.success).toBe(true)
  })

  it('refuses the same admin on a widget session', async () => {
    mockGetSession.mockResolvedValue(sessionScoped('widget'))

    const result = await validateApiWorkspaceAccess()

    expect(result).toEqual({ success: false, error: 'Forbidden', status: 403 })
  })

  it('refuses before it reads anything about the workspace', async () => {
    // The refusal is the first thing after the session read. Nothing about the
    // principal or the settings row may be loaded for a caller that cannot be
    // let in — that is what keeps the gate from depending on their contents.
    mockGetSession.mockResolvedValue(sessionScoped('portal'))

    await validateApiWorkspaceAccess()

    expect(mockPrincipalFindFirst).not.toHaveBeenCalled()
    expect(mockSettingsFindFirst).not.toHaveBeenCalled()
  })

  it('still answers 401 when there is no session at all', async () => {
    mockGetSession.mockResolvedValue(null)

    const result = await validateApiWorkspaceAccess()

    expect(result).toEqual({ success: false, error: 'Unauthorized', status: 401 })
  })

  it('refuses every audience but the dashboard (R9, R12)', async () => {
    await fc.assert(
      fc.asyncProperty(nonDashboard, async (scope) => {
        mockGetSession.mockResolvedValue(sessionScoped(scope))

        const result = await validateApiWorkspaceAccess()

        expect(result.success).toBe(false)
      }),
      { numRuns: 200 }
    )
  })
})

describe('getCurrentUserRole (R9)', () => {
  it('reports the team role on a dashboard session', async () => {
    mockGetSession.mockResolvedValue(sessionScoped('dashboard'))

    expect(await getCurrentUserRole()).toBe('admin')
  })

  it('reports an ordinary user on every other audience (R12)', async () => {
    await fc.assert(
      fc.asyncProperty(nonDashboard, async (scope) => {
        mockGetSession.mockResolvedValue(sessionScoped(scope))

        expect(await getCurrentUserRole()).toBe('user')
      }),
      { numRuns: 200 }
    )
  })

  it('reports nothing without a session or a principal', async () => {
    mockGetSession.mockResolvedValue(null)
    expect(await getCurrentUserRole()).toBeNull()

    mockGetSession.mockResolvedValue(sessionScoped('dashboard'))
    mockPrincipalFindFirst.mockResolvedValue(undefined)
    expect(await getCurrentUserRole()).toBeNull()
  })
})
