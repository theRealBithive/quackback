/**
 * The admin shell's guard, and the one thing upstream's version of it does
 * that this fork must not.
 *
 * Upstream races the workspace-role import with a billing lock-out helper and
 * redirects an over-quota workspace to `/admin/billing`. Billing is excluded
 * from this fork for good (see UPSTREAM.md), so the pick dropped that half —
 * and a dropped hunk is exactly the kind of thing a later sync restores by
 * accident, silently, on a page every team member loads.
 *
 * Contract for the batch E pick (upstream #553, `f8062929a`) — the confirmed
 * list; the whole of it is in
 * `lib/client/conversation/__tests__/reconcile-cached-thread.contract.test.ts`:
 *
 *   E11 The admin area never redirects to a billing page.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Route } from '../admin'

const hoisted = vi.hoisted(() => ({
  requireWorkspaceRole: vi.fn(),
}))

vi.mock('@/lib/server/functions/workspace-utils', () => ({
  requireWorkspaceRole: hoisted.requireWorkspaceRole,
}))

type BeforeLoad = (args: { location: { pathname: string } }) => Promise<Record<string, unknown>>

// Statically imported, above: pulling the admin shell's module graph in costs
// more than a test's whole timeout budget, and a dynamic import inside the
// test spends it there instead of in the file's import phase.
const beforeLoad = (Route as unknown as { options: { beforeLoad: BeforeLoad } }).options.beforeLoad

const TEAM_MEMBER = {
  user: { id: 'user_1', name: 'Team member', email: 'member@example.com' },
  principal: { id: 'principal_1', chatAvailability: 'online' },
  permissions: [],
}

beforeEach(() => {
  hoisted.requireWorkspaceRole.mockReset()
  hoisted.requireWorkspaceRole.mockResolvedValue(TEAM_MEMBER)
})

describe('the admin shell guard (E11)', () => {
  it('lets a team member through instead of sending them to a billing page', async () => {
    const context = await beforeLoad({ location: { pathname: '/admin/inbox' } })

    expect(context).toEqual(TEAM_MEMBER)
    expect(hoisted.requireWorkspaceRole).toHaveBeenCalledWith({
      data: { allowedRoles: ['admin', 'member'] },
    })
  })

  it('still lets the public admin pages through without asking for a role', async () => {
    for (const pathname of ['/admin/login', '/admin/signup']) {
      expect(await beforeLoad({ location: { pathname } })).toEqual({})
    }
    expect(hoisted.requireWorkspaceRole).not.toHaveBeenCalled()
  })

  it('carries no lock-out that could route the admin shell at billing', async () => {
    const { readFileSync } = await import('node:fs')
    const source = readFileSync('apps/web/src/routes/admin.tsx', 'utf8')

    // A billing destination can only reach the router as a string — an import
    // path or a route path. The word itself is allowed to appear, and does:
    // the comment above the guard is what records that upstream's lock-out was
    // dropped here on purpose, and deleting that comment is how the next sync
    // puts it back without anyone noticing.
    expect(source).not.toMatch(/['"`][^'"`\n]*billing/i)
    // The guard reaches its decision without a redirect at all, so there is
    // nothing for a billing destination to be attached to.
    expect(source).not.toContain('redirect(')
  })
})
