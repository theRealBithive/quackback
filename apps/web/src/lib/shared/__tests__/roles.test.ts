/**
 * The role predicates, and the two audience helpers that sit beside them.
 *
 * The audience half arrived with batch D (upstream #547); its decision cases
 * are pinned in lib/server/functions/__tests__/auth-scope.test.ts, which also
 * carries the confirmed contract list. What is here is the rest of the module,
 * so the pair of suites covers it between them.
 */
import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import {
  isTeamMember,
  isAdmin,
  isEndUser,
  isIdentifiedHuman,
  roleAtLeast,
  sessionRole,
  toSessionScope,
  ROLE_RANK,
  type Role,
} from '../roles'

const ANY_ROLE = ['admin', 'member', 'user'] as const

describe('isTeamMember', () => {
  it('returns true for admin', () => {
    expect(isTeamMember('admin')).toBe(true)
  })

  it('returns true for member', () => {
    expect(isTeamMember('member')).toBe(true)
  })

  it('returns false for other strings', () => {
    expect(isTeamMember('viewer')).toBe(false)
    expect(isTeamMember('user')).toBe(false)
    expect(isTeamMember('')).toBe(false)
  })

  it('returns false for null', () => {
    expect(isTeamMember(null)).toBe(false)
  })

  it('returns false for undefined', () => {
    expect(isTeamMember(undefined)).toBe(false)
  })
})

describe('isIdentifiedHuman', () => {
  it('is true only for customer humans', () => {
    expect(isIdentifiedHuman('user')).toBe(true)
    expect(isIdentifiedHuman('anonymous')).toBe(false)
    expect(isIdentifiedHuman('service')).toBe(false)
    expect(isIdentifiedHuman('support')).toBe(false)
    expect(isIdentifiedHuman(null)).toBe(false)
  })
})

describe('isAdmin', () => {
  it('returns true for admin', () => {
    expect(isAdmin('admin')).toBe(true)
  })

  it('returns false for member', () => {
    expect(isAdmin('member')).toBe(false)
  })

  it('returns false for other strings', () => {
    expect(isAdmin('viewer')).toBe(false)
    expect(isAdmin('user')).toBe(false)
    expect(isAdmin('')).toBe(false)
  })

  it('returns false for null', () => {
    expect(isAdmin(null)).toBe(false)
  })

  it('returns false for undefined', () => {
    expect(isAdmin(undefined)).toBe(false)
  })
})

describe('isEndUser', () => {
  it('is true only for the portal tier', () => {
    expect(isEndUser('user')).toBe(true)
    expect(isEndUser('member')).toBe(false)
    expect(isEndUser('admin')).toBe(false)
    expect(isEndUser('viewer')).toBe(false)
    expect(isEndUser('')).toBe(false)
    expect(isEndUser(null)).toBe(false)
    expect(isEndUser(undefined)).toBe(false)
  })
})

describe('ROLE_RANK and roleAtLeast', () => {
  it('orders the three tiers from end-user to admin', () => {
    expect(ROLE_RANK.user).toBeLessThan(ROLE_RANK.member)
    expect(ROLE_RANK.member).toBeLessThan(ROLE_RANK.admin)
  })

  it('answers each pair the way the order says', () => {
    expect(roleAtLeast('admin', 'admin')).toBe(true)
    expect(roleAtLeast('admin', 'member')).toBe(true)
    expect(roleAtLeast('admin', 'user')).toBe(true)
    expect(roleAtLeast('member', 'admin')).toBe(false)
    expect(roleAtLeast('member', 'member')).toBe(true)
    expect(roleAtLeast('member', 'user')).toBe(true)
    expect(roleAtLeast('user', 'admin')).toBe(false)
    expect(roleAtLeast('user', 'member')).toBe(false)
    expect(roleAtLeast('user', 'user')).toBe(true)
  })

  it('is a total order: of any two roles at least one is at least the other', () => {
    fc.assert(
      fc.property(fc.constantFrom(...ANY_ROLE), fc.constantFrom(...ANY_ROLE), (a, b) => {
        expect(roleAtLeast(a, b) || roleAtLeast(b, a)).toBe(true)
        expect(roleAtLeast(a, b) && roleAtLeast(b, a)).toBe(a === b)
      })
    )
  })

  it('agrees with the tiers it is built from', () => {
    fc.assert(
      fc.property(fc.constantFrom(...ANY_ROLE), (role: Role) => {
        expect(roleAtLeast(role, 'user')).toBe(true)
        expect(isTeamMember(role)).toBe(roleAtLeast(role, 'member'))
        expect(isAdmin(role)).toBe(roleAtLeast(role, 'admin'))
      })
    )
  })
})

describe('the audience helpers, on the cases auth-scope does not name', () => {
  it('reads a stored audience back as itself', () => {
    expect(toSessionScope('dashboard')).toBe('dashboard')
    expect(toSessionScope('widget')).toBe('widget')
    expect(toSessionScope('portal')).toBe('portal')
  })

  it('answers with one of the three for anything at all', () => {
    fc.assert(
      fc.property(fc.anything(), (value) => {
        expect(['dashboard', 'widget', 'portal']).toContain(toSessionScope(value))
      })
    )
  })

  it('keeps a role only on the dashboard audience', () => {
    fc.assert(
      fc.property(fc.constantFrom(...ANY_ROLE), fc.anything(), (role: Role, stored) => {
        const scope = toSessionScope(stored)

        expect(sessionRole(role, scope)).toBe(scope === 'dashboard' ? role : 'user')
      })
    )
  })
})
