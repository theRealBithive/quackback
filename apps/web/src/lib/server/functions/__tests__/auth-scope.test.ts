/**
 * Session audience scoping, read through the helpers every gate goes through.
 *
 * A session now carries the audience it was minted for, and only a dashboard
 * session may satisfy a team or permission gate. The point is the promotion
 * case: a visitor the widget signed in, who is later made a teammate, holds a
 * session that must not become a staff session under them. `requireAuth`,
 * `getOptionalAuth` and `assertPermission` are where that is decided for almost
 * every server function, so they are where it is pinned.
 *
 * Contract (the confirmed list for this batch — the numbers held in other
 * modules are listed at the bottom and quoted there):
 *
 *   R1  A session is stamped with the audience it was minted for: the
 *       dashboard, the embedded widget, or the customer portal.
 *   R2  Only a dashboard session satisfies a team or permission gate. A widget
 *       or portal session is refused whatever role its principal holds.
 *   R3  A principal promoted to staff after the widget minted its session
 *       gains no dashboard authority on that session. The promotion takes
 *       effect at the next dashboard sign-in.
 *   R4  A widget identify never reuses a dashboard session. It mints its own.
 *   R5  An anonymous visitor the widget signs in lazily gets a widget session,
 *       although nothing identified them.
 *   R6  The one-time-token handoff promotes the session to the portal audience
 *       before the cookie is set, not after.
 *   R7  Read through a bare authentication helper, a widget or portal session
 *       presents its principal as an ordinary user with no permissions, so a
 *       policy actor or a team-membership check built from it cannot reach
 *       team data.
 *   R8  A realtime stream token carries the audience of the session that
 *       minted it, and a token naming no audience is refused.
 *   R9  A widget or portal session is refused by the import and export API and
 *       by the onboarding administrator gates.
 *   R10 Re-running the migration changes nothing. Sessions the widget
 *       identified, sessions of anonymous users, and sessions older than their
 *       user's first credential become widget sessions. Sessions with portal
 *       provenance become portal sessions. The rest stay dashboard.
 *   R11 A session an old replica minted during a rolling deploy is re-stamped
 *       as a widget session when its provenance row lands, rather than staying
 *       dashboard until the next deploy.
 *   R12 An unrecognised audience carries no dashboard authority: it reads as a
 *       non-dashboard audience, and its principal presents as an ordinary user.
 *   R13 A cached inbox entry is patched only when it really is a page of posts.
 *       An entry under the same key prefix that is not a list of posts is
 *       handed back untouched, whether it carries no pages or pages that are
 *       not post lists.
 *
 * R12 is the one place this fork deliberately disagrees with upstream, on the
 * user's instruction: upstream reads an unrecognised audience as `dashboard`,
 * which turns a mis-written column into full team authority. Here it reads as
 * the least authority an audience can carry. The reasoning is in the docstring
 * on `toSessionScope`.
 *
 * Where the rest are held:
 *   R1, R5    auth/__tests__/session-scope-on-create.test.ts
 *   R1, R10, R11
 *             auth/__tests__/session-scope-backfill.db.test.ts
 *   R4        routes/api/widget/__tests__/identify-session-audience.test.ts
 *   R6        routes/__tests__/auth.widget-handoff.test.ts
 *   R8        lib/server/realtime/__tests__/stream-token.test.ts
 *   R9        lib/server/functions/__tests__/workspace-api-access.test.ts and
 *             onboarding-bootstrap-claim.db.test.ts
 *   R13       lib/client/mutations/__tests__/inbox-list-cache.test.ts
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import fc from 'fast-check'
import { PERMISSIONS } from '@/lib/shared/permissions'

const mockGetSession = vi.fn()
vi.mock('@/lib/server/auth', () => ({
  auth: { api: { getSession: (...args: unknown[]) => mockGetSession(...args) } },
}))

vi.mock('@tanstack/react-start/server', () => ({
  getRequestHeaders: () => new Headers(),
}))

const mockPrincipalFindFirst = vi.fn()
vi.mock('@/lib/server/db', () => ({
  db: {
    query: {
      principal: { findFirst: (...args: unknown[]) => mockPrincipalFindFirst(...args) },
    },
  },
  principal: {},
  eq: vi.fn(),
}))

vi.mock('../auth-request-cache', () => ({
  memoizePerRequest: (_key: string, fn: () => unknown) => fn(),
}))

vi.mock('@/lib/server/domains/settings/settings.helpers', () => ({
  requireSettingsCached: vi.fn(async () => ({
    id: 'workspace_1',
    slug: 'main',
    name: 'Main',
    logoKey: null,
  })),
}))

vi.mock('@/lib/server/domains/principals/principal.factory', () => ({
  ensurePrincipalForUser: vi.fn(),
}))

vi.mock('@/lib/server/policy/permissions', () => ({
  permissionsForPrincipal: vi.fn(async () => new Set([PERMISSIONS.SETTINGS_MANAGE])),
}))

vi.mock('@/lib/server/domains/segments/segment-membership.service', () => ({
  segmentIdsForPrincipal: vi.fn(async () => new Set(['segment_a'])),
}))

import {
  assertPermission,
  getOptionalAuth,
  policyActorFromAuth,
  requireAuth,
} from '../auth-helpers'
import { ensurePrincipalForUser } from '@/lib/server/domains/principals/principal.factory'
import { isTeamMember, sessionRole, toSessionScope } from '@/lib/shared/roles'

/** The three audiences a session may legitimately carry. */
const KNOWN_SCOPES = ['dashboard', 'widget', 'portal'] as const

/** Everything else a column read can hand back, including the shapes no column should hold. */
const unknownScope = fc
  .oneof(
    fc.constant(undefined),
    fc.constant(null),
    fc.constant(''),
    fc.constant('Dashboard'),
    fc.constant('dashboard '),
    fc.constant('admin'),
    fc.integer(),
    fc.boolean(),
    fc.object(),
    fc.string()
  )
  .filter((value) => !KNOWN_SCOPES.includes(value as (typeof KNOWN_SCOPES)[number]))

/**
 * What Better Auth hands back. `scope` is passed through exactly as given so a
 * test can hand over a value no writer of the column would ever produce.
 */
function sessionWithScope(scope: unknown) {
  return {
    session: { id: 'sess_1', scope },
    user: { id: 'user_1', email: 'ada@example.com', name: 'Ada', image: null },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockPrincipalFindFirst.mockResolvedValue({ id: 'principal_1', role: 'admin', type: 'user' })
  vi.mocked(ensurePrincipalForUser).mockResolvedValue({
    principal: { id: 'principal_1', role: 'admin', type: 'user' } as never,
    created: false,
  })
})

describe('requireAuth at a permission gate (R2, R3)', () => {
  it('denies a widget session even after the principal was promoted to admin (R3)', async () => {
    mockGetSession.mockResolvedValue(sessionWithScope('widget'))

    await expect(requireAuth({ permission: PERMISSIONS.SETTINGS_MANAGE })).rejects.toThrow(
      /dashboard session/
    )
  })

  it('denies a portal session (R2)', async () => {
    mockGetSession.mockResolvedValue(sessionWithScope('portal'))

    await expect(requireAuth({ permission: PERMISSIONS.SETTINGS_MANAGE })).rejects.toThrow(
      /dashboard session/
    )
  })

  it('allows the same principal on a dashboard session (R2)', async () => {
    mockGetSession.mockResolvedValue(sessionWithScope('dashboard'))

    const auth = await requireAuth({ permission: PERMISSIONS.SETTINGS_MANAGE })

    expect(auth.scope).toBe('dashboard')
    expect(auth.permissions).toContain(PERMISSIONS.SETTINGS_MANAGE)
  })

  it('refuses every audience but the dashboard, whatever the column held (R2, R12)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.oneof(fc.constantFrom('widget', 'portal'), unknownScope),
        async (scope) => {
          mockGetSession.mockResolvedValue(sessionWithScope(scope))

          await expect(requireAuth({ permission: PERMISSIONS.SETTINGS_MANAGE })).rejects.toThrow(
            /dashboard session/
          )
        }
      ),
      { numRuns: 200 }
    )
  })
})

describe('requireAuth without a permission (R2, R7)', () => {
  it('stays cross-plane but strips team authority from a widget session (R2)', async () => {
    mockGetSession.mockResolvedValue(sessionWithScope('widget'))

    const auth = await requireAuth()

    expect(auth.scope).toBe('widget')
    expect(auth.principal.role).toBe('user')
    expect(auth.permissions).toEqual([])
  })

  it('keeps the team role and permissions on a dashboard session (R2)', async () => {
    mockGetSession.mockResolvedValue(sessionWithScope('dashboard'))

    const auth = await requireAuth()

    expect(auth.principal.role).toBe('admin')
    expect(auth.permissions).toContain(PERMISSIONS.SETTINGS_MANAGE)
  })

  it('never reports a team member on a non-dashboard audience (R7, R12)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.oneof(fc.constantFrom('widget', 'portal'), unknownScope),
        async (scope) => {
          mockGetSession.mockResolvedValue(sessionWithScope(scope))

          const auth = await requireAuth()

          // The conservation law across every audience: authority is carried by
          // the scope, never by the role the principal row happens to hold.
          expect(isTeamMember(auth.principal.role)).toBe(false)
          expect(auth.permissions).toEqual([])
        }
      ),
      { numRuns: 200 }
    )
  })
})

describe('getOptionalAuth (R2, R7)', () => {
  it('downgrades a promoted widget principal to the portal tier (R3)', async () => {
    mockGetSession.mockResolvedValue(sessionWithScope('widget'))

    const auth = await getOptionalAuth()

    expect(auth?.scope).toBe('widget')
    expect(auth?.principal.role).toBe('user')
    expect(auth?.permissions).toEqual([])
  })

  it('keeps the team role on a dashboard session (R2)', async () => {
    mockGetSession.mockResolvedValue(sessionWithScope('dashboard'))

    const auth = await getOptionalAuth()

    expect(auth?.principal.role).toBe('admin')
    expect(auth?.permissions).toContain(PERMISSIONS.SETTINGS_MANAGE)
  })
})

describe('assertPermission (R2)', () => {
  it('denies a widget session holding the permission', () => {
    expect(() =>
      assertPermission(
        {
          permissions: [PERMISSIONS.SETTINGS_MANAGE],
          principal: { id: 'principal_1', role: 'admin', type: 'user' },
          scope: 'widget',
        },
        PERMISSIONS.SETTINGS_MANAGE
      )
    ).toThrow(/dashboard session/)
  })

  it('allows a dashboard session holding the permission', () => {
    expect(() =>
      assertPermission(
        {
          permissions: [PERMISSIONS.SETTINGS_MANAGE],
          principal: { id: 'principal_1', role: 'admin', type: 'user' },
          scope: 'dashboard',
        },
        PERMISSIONS.SETTINGS_MANAGE
      )
    ).not.toThrow()
  })
})

describe('the policy actor built from a scoped session (R7)', () => {
  it('reaches the policy engine as an ordinary user on a widget session', async () => {
    mockGetSession.mockResolvedValue(sessionWithScope('widget'))

    const actor = await policyActorFromAuth(await requireAuth())

    expect(actor.role).toBe('user')
  })

  it('reaches it as an admin on a dashboard session', async () => {
    mockGetSession.mockResolvedValue(sessionWithScope('dashboard'))

    const actor = await policyActorFromAuth(await requireAuth())

    expect(actor.role).toBe('admin')
  })
})

describe('toSessionScope (R12)', () => {
  it('maps each audience to itself', () => {
    expect(toSessionScope('widget')).toBe('widget')
    expect(toSessionScope('portal')).toBe('portal')
    expect(toSessionScope('dashboard')).toBe('dashboard')
  })

  it('refuses dashboard authority to anything else', () => {
    // Upstream answers 'dashboard' to all of these. The fork does not; see the
    // docstring on `toSessionScope` for why, and the note at the top of this
    // file for who decided it.
    expect(toSessionScope(undefined)).not.toBe('dashboard')
    expect(toSessionScope(null)).not.toBe('dashboard')
    expect(toSessionScope('')).not.toBe('dashboard')
    expect(toSessionScope('Dashboard')).not.toBe('dashboard')
    expect(toSessionScope('future')).not.toBe('dashboard')
  })

  it('answers with an audience that carries no team role, for any value at all', () => {
    fc.assert(
      fc.property(
        unknownScope,
        fc.constantFrom('admin' as const, 'member' as const),
        (value, role) => {
          const scope = toSessionScope(value)

          expect(KNOWN_SCOPES).toContain(scope)
          expect(scope).not.toBe('dashboard')
          expect(sessionRole(role, scope)).toBe('user')
        }
      ),
      { numRuns: 500 }
    )
  })
})

describe('sessionRole (R2)', () => {
  it('keeps the role only for dashboard sessions', () => {
    expect(sessionRole('admin', 'dashboard')).toBe('admin')
    expect(sessionRole('member', 'dashboard')).toBe('member')
    expect(sessionRole('admin', 'widget')).toBe('user')
    expect(sessionRole('member', 'portal')).toBe('user')
  })

  it('leaves an end-user an end-user on every audience', () => {
    fc.assert(
      fc.property(fc.constantFrom(...KNOWN_SCOPES), (scope) => {
        expect(sessionRole('user', scope)).toBe('user')
      })
    )
  })
})
