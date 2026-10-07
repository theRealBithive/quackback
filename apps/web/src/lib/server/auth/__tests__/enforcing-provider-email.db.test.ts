/**
 * Real-DB coverage for the enforcing provider's vouch.
 *
 * Every refusal is paired with the case that does vouch, so a test that sees
 * nothing change is evidence the rule held, not that the seam carried nothing.
 * Runs inside the db-test-fixture rollback transaction.
 *
 * Contract (upstream #689), confirmed:
 *
 * E1 When an address's domain requires SSO, the person cannot sign in by email link or code either. The refusal depends only on the domain, never on whether an account exists.
 * E2 A person changes their email address only through the confirmed flow. The library's direct change endpoints cannot be reached over HTTP.
 * E3 An address at a domain that requires SSO cannot be taken by the person's own change or by an admin's edit, unless the account already signs in through that domain's provider. Renaming someone whose address stays the same still works.
 * E4 When an admin enters a new address, it is not treated as verified. An unchanged address keeps its verification.
 * E5 When a domain's enforcing provider signs someone in with an address at that domain, that sign-in verifies the account it lands on, so the account links instead of staying stuck. Whoever held an unlinked account before loses their sessions.
 * E6 An admin's edit that crosses with a concurrent change to the same address is refused, not silently overwritten.
 * E7 An address at a domain that requires SSO cannot be given up for one the provider does not manage.
 *
 * Only E5 is held here. That Better Auth then links the verified account is
 * the library's behaviour and is not re-proved; the hand-off from a sign-in
 * to this function is `email-change-wiring.test.ts`.
 */
import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest'
import { createId, type UserId } from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { account, session, user, eq } from '@/lib/server/db'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

const audit = vi.hoisted(() => ({ recordAuditEvent: vi.fn(async (..._a: unknown[]) => {}) }))
vi.mock('@/lib/server/audit/log', () => ({ recordAuditEvent: audit.recordAuditEvent }))

import { vouchForEnforcedAddress } from '../enforcing-provider-email'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: user.id, verified: user.emailVerified }).from(user).limit(0)
    await db.select({ id: session.id }).from(session).limit(0)
  },
})

const suffix = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`

function providers(enforced: boolean) {
  return [
    {
      id: 'idp_acme',
      registrationId: 'oidc_acme',
      showButton: true,
      domains: [{ name: 'acme.com', enforced, verifiedAt: '2026-01-01T00:00:00Z' }],
    },
  ]
}

async function seed(email: string, opts: { verified?: boolean } = {}) {
  const userId = createId('user') as UserId
  await testDb.insert(user).values({
    id: userId,
    name: 'Sam',
    email,
    emailVerified: opts.verified ?? false,
  })
  await testDb.insert(session).values({
    id: `sess_${suffix()}`,
    token: `tok_${suffix()}`,
    userId,
    expiresAt: new Date(Date.now() + 86_400_000),
    createdAt: new Date(),
    updatedAt: new Date(),
  })
  return userId
}

async function state(userId: UserId) {
  const [row] = await testDb
    .select({ verified: user.emailVerified })
    .from(user)
    .where(eq(user.id, userId))
  const sessions = await testDb
    .select({ id: session.id })
    .from(session)
    .where(eq(session.userId, userId))
  return { verified: row.verified, sessions: sessions.length }
}

describe.skipIf(!fixture.available)('vouchForEnforcedAddress', () => {
  beforeEach(() => {
    audit.recordAuditEvent.mockClear()
    return fixture.begin()
  })
  afterEach(() => fixture.rollback())
  afterAll(() => fixture.close())

  it('verifies an unverified account at its enforced domain and ends its sessions (E5)', async () => {
    const email = `sam-${suffix()}@acme.com`
    const userId = await seed(email)

    await vouchForEnforcedAddress({
      registrationId: 'oidc_acme',
      accountId: `sub-${suffix()}`,
      email: email.toUpperCase(),
      providers: providers(true),
    })

    expect(await state(userId)).toEqual({ verified: true, sessions: 0 })
    expect(audit.recordAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'user.email_verified.asserted' })
    )
  })

  it('does nothing for a provider that does not enforce the domain (E5)', async () => {
    const email = `sam-${suffix()}@acme.com`
    const userId = await seed(email)

    await vouchForEnforcedAddress({
      registrationId: 'oidc_other',
      accountId: `sub-${suffix()}`,
      email,
      providers: providers(true),
    })

    expect(await state(userId)).toEqual({ verified: false, sessions: 1 })
  })

  it('does nothing when the domain does not require SSO (E5)', async () => {
    const email = `sam-${suffix()}@acme.com`
    const userId = await seed(email)

    await vouchForEnforcedAddress({
      registrationId: 'oidc_acme',
      accountId: `sub-${suffix()}`,
      email,
      providers: providers(false),
    })

    expect(await state(userId)).toEqual({ verified: false, sessions: 1 })
  })

  // Another identity of this provider owns the account the address sits on, so
  // this sign-in does not land there and may not vouch for it.
  it('leaves an account another identity of the provider owns alone (E5)', async () => {
    const email = `sam-${suffix()}@acme.com`
    const userId = await seed(email)
    await testDb.insert(account).values({
      accountId: `someone-else-${suffix()}`,
      providerId: 'oidc_acme',
      userId,
      createdAt: new Date(),
      updatedAt: new Date(),
    })

    await vouchForEnforcedAddress({
      registrationId: 'oidc_acme',
      accountId: `sub-${suffix()}`,
      email,
      providers: providers(true),
    })

    expect(await state(userId)).toEqual({ verified: false, sessions: 1 })
  })

  // An admin corrected the address of someone already on the provider; their
  // next sign-in restores verification, and their session stays.
  it('re-verifies the linked account this identity signs in to (E5)', async () => {
    const email = `sam-${suffix()}@acme.com`
    const userId = await seed(email)
    const sub = `sub-${suffix()}`
    await testDb.insert(account).values({
      accountId: sub,
      providerId: 'oidc_acme',
      userId,
      createdAt: new Date(),
      updatedAt: new Date(),
    })

    await vouchForEnforcedAddress({
      registrationId: 'oidc_acme',
      accountId: sub,
      email,
      providers: providers(true),
    })

    expect(await state(userId)).toEqual({ verified: true, sessions: 1 })
  })

  it('does not vouch for a linked account whose address is not the one asserted (E5)', async () => {
    const userId = await seed(`old-${suffix()}@acme.com`)
    const sub = `sub-${suffix()}`
    await testDb.insert(account).values({
      accountId: sub,
      providerId: 'oidc_acme',
      userId,
      createdAt: new Date(),
      updatedAt: new Date(),
    })

    await vouchForEnforcedAddress({
      registrationId: 'oidc_acme',
      accountId: sub,
      email: `new-${suffix()}@acme.com`,
      providers: providers(true),
    })

    expect(await state(userId)).toEqual({ verified: false, sessions: 1 })
  })

  it('leaves an already verified account and its sessions alone (E5)', async () => {
    const email = `sam-${suffix()}@acme.com`
    const userId = await seed(email, { verified: true })

    await vouchForEnforcedAddress({
      registrationId: 'oidc_acme',
      accountId: `sub-${suffix()}`,
      email,
      providers: providers(true),
    })

    expect(await state(userId)).toEqual({ verified: true, sessions: 1 })
  })
  it('writes and records nothing when no account holds the asserted address (E5)', async () => {
    const bystander = await seed(`someone-${suffix()}@acme.com`)

    await vouchForEnforcedAddress({
      registrationId: 'oidc_acme',
      accountId: `sub-${suffix()}`,
      email: `nobody-${suffix()}@acme.com`,
      providers: providers(true),
    })

    expect(await state(bystander)).toEqual({ verified: false, sessions: 1 })
    expect(audit.recordAuditEvent).not.toHaveBeenCalled()
  })
})
