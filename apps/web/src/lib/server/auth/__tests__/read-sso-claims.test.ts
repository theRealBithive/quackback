/**
 * `readSsoClaimsWithProvenance` — where a sign-in's claims come from, and
 * whether they are this request's.
 *
 * The resolver stashes the claims it validated for this very callback; the
 * stored ID token is only a fallback, and one that can never carry a claim
 * that arrived through userinfo. Attribute sync relies on `fresh` to tell the
 * two apart, so the provenance is the contract here, not just the claims.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fakeJwt } from './_idp-worlds'

const mockAccountFindFirst = vi.fn()

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: {
    query: {
      account: { findFirst: (...args: unknown[]) => mockAccountFindFirst(...args) },
    },
  },
  and: vi.fn((...parts: unknown[]) => ({ op: 'and', parts })),
  eq: vi.fn((col: unknown, val: unknown) => ({ op: 'eq', col, val })),
  desc: vi.fn((col: unknown) => ({ op: 'desc', col })),
}))

const { readSsoClaims, readSsoClaimsWithProvenance } = await import('../read-sso-claims')
const { stashResolvedClaims, takeResolvedClaims } = await import('../resolved-claims-stash')

const PROVIDER = 'oidc_acme'
const USER = 'user_1' as const

beforeEach(() => {
  vi.clearAllMocks()
  // The stash is module state; drain what a prior test may have left.
  takeResolvedClaims(PROVIDER, 'sub-1')
})

describe('readSsoClaimsWithProvenance', () => {
  it('returns the claims the resolver validated for this sign-in, marked fresh', async () => {
    mockAccountFindFirst.mockResolvedValue({ accountId: 'sub-1', idToken: null })
    stashResolvedClaims(PROVIDER, 'sub-1', { sub: 'sub-1', department: 'Engineering' })

    await expect(readSsoClaimsWithProvenance(USER, PROVIDER)).resolves.toEqual({
      claims: { sub: 'sub-1', department: 'Engineering' },
      fresh: true,
    })
  })

  it('hands the stash out once: a second read falls back to the stored token', async () => {
    mockAccountFindFirst.mockResolvedValue({ accountId: 'sub-1', idToken: null })
    stashResolvedClaims(PROVIDER, 'sub-1', { department: 'Engineering' })

    await readSsoClaimsWithProvenance(USER, PROVIDER)

    await expect(readSsoClaimsWithProvenance(USER, PROVIDER)).resolves.toEqual({
      claims: {},
      fresh: false,
    })
  })

  it('falls back to the stored ID token, not marked fresh, when nothing resolved this request', async () => {
    const exp = Math.floor(Date.now() / 1000) + 3600
    mockAccountFindFirst.mockResolvedValue({
      accountId: 'sub-1',
      idToken: fakeJwt({ sub: 'sub-1', department: 'Sales', exp }),
    })

    const read = await readSsoClaimsWithProvenance(USER, PROVIDER)

    expect(read.fresh).toBe(false)
    expect(read.claims).toMatchObject({ sub: 'sub-1', department: 'Sales' })
  })

  it('reads nothing for a user who has no account with this provider', async () => {
    mockAccountFindFirst.mockResolvedValue(undefined)

    await expect(readSsoClaims(USER, PROVIDER)).resolves.toEqual({})
  })
})
