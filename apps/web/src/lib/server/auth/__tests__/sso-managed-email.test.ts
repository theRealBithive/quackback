/**
 * "Require SSO" for writers of an account's email address: the one rule both
 * the person's own change and an admin's edit ask before they write.
 *
 * Contract (upstream #689), confirmed:
 *
 * E1 When an address's domain requires SSO, the person cannot sign in by email link or code either. The refusal depends only on the domain, never on whether an account exists.
 * E2 A person changes their email address only through the confirmed flow. The library's direct change endpoints cannot be reached over HTTP.
 * E3 An address at a domain that requires SSO cannot be taken by the person's own change or by an admin's edit. Renaming someone whose address stays the same still works.
 * E4 When an admin enters a new address, it is not treated as verified. An unchanged address keeps its verification.
 * E5 When a domain's enforcing provider signs someone in with an address at that domain, that sign-in verifies the account it lands on, so the account links instead of staying stuck. Whoever held an unlinked account before loses their sessions.
 * E6 An admin's edit that crosses with a concurrent change to the same address is refused, not silently overwritten.
 *
 * Only E3 is held here. The module also does two things E3 does not say, and
 * they are tested with no number because the contract does not cover them:
 * it refuses moving an account OFF a managed address, and it lets an account
 * that already signs in through a domain's provider take an address there.
 * The second one reads against the letter of E3 ("cannot be taken"); both are
 * reported as open questions rather than stretched into a number.
 *
 * The workspace in every case: `a.com` and `b.com` require SSO through two
 * registered providers; `c.com` requires it through a provider that is not
 * registered right now (so it manages nothing); `d.com` is verified without
 * requiring SSO; `other.com` is nobody's.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import fc from 'fast-check'

const hoisted = vi.hoisted(() => ({
  linkedProviders: new Set<string>(),
}))

const PROVIDERS = [
  enforcing('idp_a', 'oidc_a', 'a.com'),
  enforcing('idp_b', 'oidc_b', 'b.com'),
  enforcing('idp_c', 'oidc_c', 'c.com'),
  {
    id: 'idp_d',
    registrationId: 'oidc_d',
    showButton: true,
    domains: [{ name: 'd.com', enforced: false, verifiedAt: '2026-01-01T00:00:00Z' }],
  },
]

function enforcing(id: string, registrationId: string, domain: string) {
  return {
    id,
    registrationId,
    showButton: true,
    domains: [{ name: domain, enforced: true, verifiedAt: '2026-01-01T00:00:00Z' }],
  }
}

vi.mock('@/lib/server/domains/settings/identity-providers.service', () => ({
  listIdentityProviders: async () => PROVIDERS,
}))
vi.mock('../registered-providers', () => ({
  getRegisteredOidcProviderIds: async () => new Set(['oidc_a', 'oidc_b', 'oidc_d']),
}))

/** The account table, reduced to the one question asked of it: is this provider linked? */
vi.mock('@/lib/server/db', () => ({
  account: { userId: 'account.userId', providerId: 'account.providerId' },
  eq: (column: string, value: string) => ({ column, value }),
  and: (...parts: Array<{ column: string; value: string }>) => parts,
  db: {
    query: {
      account: {
        findFirst: async ({ where }: { where: Array<{ column: string; value: string }> }) => {
          const provider = where.find((part) => part.column === 'account.providerId')
          const linked = provider !== undefined && hoisted.linkedProviders.has(provider.value)
          return linked ? { id: 'acc_1' } : undefined
        },
      },
    },
  },
}))

import { isEmailMoveSsoBlocked, assertEmailMoveAllowed, loadSsoDomains } from '../sso-managed-email'
import { SSO_MANAGED_EMAIL_MESSAGE } from '@/lib/shared/sso-managed-email'
import { ValidationError } from '@/lib/shared/errors'
import type { UserId } from '@quackback/ids'

const USER = 'user_1' as UserId

/** Which provider manages a domain in this workspace, by the fixture above. */
const MANAGING_PROVIDER: Record<string, string> = { 'a.com': 'oidc_a', 'b.com': 'oidc_b' }

function managingProvider(address: string | null): string | null {
  if (address === null) return null
  const domain = address.slice(address.lastIndexOf('@') + 1).toLowerCase()
  return MANAGING_PROVIDER[domain] ?? null
}

/**
 * Addresses across every kind of domain above, in mixed letter case, plus a
 * subdomain of a managed domain (which the domain rule does not cover) and
 * no address at all.
 */
const address: fc.Arbitrary<string | null> = fc.oneof(
  fc.constant(null),
  fc
    .tuple(
      fc.stringMatching(/^[a-z][a-z0-9.]{0,9}$/),
      fc.constantFrom('a.com', 'A.COM', 'b.com', 'B.com', 'c.com', 'd.com', 'other.com', 'x.a.com')
    )
    .map(([local, domain]) => `${local}@${domain}`)
)

const links = fc.subarray(['oidc_a', 'oidc_b', 'oidc_c', 'oidc_d'])

async function blocked(from: string | null, to: string | null, linked: string[]) {
  hoisted.linkedProviders = new Set(linked)
  return isEmailMoveSsoBlocked({ userId: USER, from, to })
}

beforeEach(() => {
  hoisted.linkedProviders = new Set()
})

describe('isEmailMoveSsoBlocked', () => {
  // Reaches: a managed destination from no address, from an unmanaged one,
  // from the other managed domain and from the same one; with any links
  // except the destination's own provider.
  it('refuses taking an address at a managed domain without its provider (E3)', async () => {
    await fc.assert(
      fc.asyncProperty(address, address, links, async (from, to, linked) => {
        const destinationOwner = managingProvider(to)
        fc.pre(destinationOwner !== null && !linked.includes(destinationOwner))

        expect(await blocked(from, to, linked)).toBe(true)
      }),
      { numRuns: 200 }
    )
  })

  it('never refuses a move between addresses no provider manages (E3)', async () => {
    await fc.assert(
      fc.asyncProperty(address, address, links, async (from, to, linked) => {
        fc.pre(managingProvider(from) === null && managingProvider(to) === null)

        expect(await blocked(from, to, linked)).toBe(false)
      }),
      { numRuns: 200 }
    )
  })

  // Unguarded, across every pair: a link to a provider that manages neither
  // address never changes the answer.
  it('is not moved by links to providers that manage neither address (E3)', async () => {
    await fc.assert(
      fc.asyncProperty(address, address, links, links, async (from, to, linkedA, linkedB) => {
        const relevant = [managingProvider(from), managingProvider(to)]
        const keepRelevant = (linked: string[]) =>
          linked.filter((provider) => relevant.includes(provider))
        const sameRelevantLinks =
          JSON.stringify(keepRelevant(linkedA)) === JSON.stringify(keepRelevant(linkedB))
        fc.pre(sameRelevantLinks)

        expect(await blocked(from, to, linkedA)).toBe(await blocked(from, to, linkedB))
      }),
      { numRuns: 200 }
    )
  })

  it('refuses moving off a managed address to anywhere its provider does not manage (no number: beyond E3)', async () => {
    await fc.assert(
      fc.asyncProperty(address, address, links, async (from, to, linked) => {
        const sourceOwner = managingProvider(from)
        fc.pre(sourceOwner !== null && managingProvider(to) !== sourceOwner)

        expect(await blocked(from, to, linked)).toBe(true)
      }),
      { numRuns: 200 }
    )
  })

  it("lets an account on the domain's provider take or correct an address there (no number: conflicts with E3's wording)", async () => {
    await fc.assert(
      fc.asyncProperty(address, address, links, async (from, to, linked) => {
        const destinationOwner = managingProvider(to)
        const sourceOwner = managingProvider(from)
        fc.pre(destinationOwner !== null && linked.includes(destinationOwner))
        fc.pre(sourceOwner === null || sourceOwner === destinationOwner)

        expect(await blocked(from, to, linked)).toBe(false)
      }),
      { numRuns: 200 }
    )
  })
})

describe('assertEmailMoveAllowed', () => {
  it('refuses with the shared message the settings page shows (E3)', async () => {
    const attempt = assertEmailMoveAllowed({ userId: USER, from: null, to: 'sam@a.com' })

    await expect(attempt).rejects.toBeInstanceOf(ValidationError)
    await expect(attempt).rejects.toMatchObject({
      code: 'SSO_MANAGED',
      message: SSO_MANAGED_EMAIL_MESSAGE,
    })
  })

  it('lets an unmanaged move through (E3)', async () => {
    await expect(
      assertEmailMoveAllowed({ userId: USER, from: 'sam@other.com', to: 'sam@d.com' })
    ).resolves.toBeUndefined()
  })
})

describe('loadSsoDomains', () => {
  it('reads the providers and which of them are registered right now', async () => {
    const { providers, registered } = await loadSsoDomains()

    expect(providers).toBe(PROVIDERS)
    expect([...registered].sort()).toEqual(['oidc_a', 'oidc_b', 'oidc_d'])
  })
})
