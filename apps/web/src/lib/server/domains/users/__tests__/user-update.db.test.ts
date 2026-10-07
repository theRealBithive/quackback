/**
 * Real-DB coverage for updatePortalUserProfile (the admin profile edit).
 *
 * The lead arm writes principal.contactEmail — an OVERWRITE, deliberately
 * unlike the capture-once widget paths, because an admin correcting a typo
 * must be able to replace an address already on file — and the edit must
 * immediately re-key the duplicate detection (findDuplicatesForPrincipal
 * reads contactEmail). Only Postgres proves both the write and the re-match.
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
 * Held here: E3 (the admin's edit), E4, E6 and E7. Tests without a number
 * predate #689.
 */
import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest'
import { createId, type PrincipalId, type UserId } from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { account, principal, user, eq } from '@/lib/server/db'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

// No verified domains unless a test sets one; the provider registry is not what
// this suite is about, so it stands in rather than needing provider rows.
const sso = vi.hoisted(() => ({ providers: [] as unknown[] }))
vi.mock('@/lib/server/domains/settings/identity-providers.service', () => ({
  listIdentityProviders: async () => sso.providers,
}))
vi.mock('@/lib/server/auth/registered-providers', () => ({
  getRegisteredOidcProviderIds: async () => new Set(['oidc_acme']),
}))

// The SSO check is real. It also runs between the edit's read of the stored
// address and its write, which makes it the one place a concurrent change can
// be staged from out here (E6): `race.meanwhile` runs just before it.
const race = vi.hoisted(() => ({ meanwhile: null as null | (() => Promise<void>) }))
vi.mock('@/lib/server/auth/sso-managed-email', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/server/auth/sso-managed-email')>()
  return {
    ...real,
    assertEmailMoveAllowed: async (opts: Parameters<typeof real.assertEmailMoveAllowed>[0]) => {
      if (race.meanwhile) await race.meanwhile()
      return real.assertEmailMoveAllowed(opts)
    },
  }
})

import { updatePortalUserProfile } from '../user.update'
import { findDuplicatesForPrincipal } from '../user.dedup'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db
      .select({ id: principal.id, email: principal.contactEmail, type: principal.type })
      .from(principal)
      .limit(0)
    await db.select({ id: user.id, email: user.email }).from(user).limit(0)
  },
})

const runSuffix = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

async function seedUser(opts: {
  name: string
  email: string | null
  emailVerified?: boolean
}): Promise<{ userId: UserId; principalId: PrincipalId }> {
  const userId = createId('user') as UserId
  const principalId = createId('principal') as PrincipalId
  await testDb.insert(user).values({
    id: userId,
    name: opts.name,
    email: opts.email,
    emailVerified: opts.emailVerified ?? false,
  })
  await testDb.insert(principal).values({
    id: principalId,
    userId,
    role: 'user',
    type: 'user',
    displayName: opts.name,
    createdAt: new Date(),
  })
  return { userId, principalId }
}

async function seedLead(opts: {
  name: string | null
  contactEmail: string | null
}): Promise<{ userId: UserId; principalId: PrincipalId; placeholderEmail: string }> {
  const userId = createId('user') as UserId
  const principalId = createId('principal') as PrincipalId
  const placeholderEmail = `temp-${runSuffix()}@anon.quackback.io`
  await testDb.insert(user).values({
    id: userId,
    name: opts.name ?? 'Anonymous',
    email: placeholderEmail,
    isAnonymous: true,
  })
  await testDb.insert(principal).values({
    id: principalId,
    userId,
    role: 'user',
    type: 'anonymous',
    displayName: opts.name,
    contactEmail: opts.contactEmail,
    createdAt: new Date(),
  })
  return { userId, principalId, placeholderEmail }
}

describe.skipIf(!fixture.available)('updatePortalUserProfile', () => {
  beforeEach(() => {
    race.meanwhile = null
    return fixture.begin()
  })
  afterEach(() => fixture.rollback())
  afterAll(() => fixture.close())

  it('sets a contact email on a lead that has none', async () => {
    const lead = await seedLead({ name: 'Window shopper', contactEmail: null })
    const email = `new-lead-${runSuffix()}@example.com`

    await updatePortalUserProfile({ principalId: lead.principalId, email })

    const [row] = await testDb
      .select({ contactEmail: principal.contactEmail })
      .from(principal)
      .where(eq(principal.id, lead.principalId))
    expect(row.contactEmail).toBe(email)
  })

  it('overwrites an existing contact email (admin correction, not capture-once)', async () => {
    const lead = await seedLead({
      name: 'Typo visitor',
      contactEmail: `typo-${runSuffix()}@example.com`,
    })
    const corrected = `fixed-${runSuffix()}@example.com`

    await updatePortalUserProfile({ principalId: lead.principalId, email: corrected })

    const [row] = await testDb
      .select({ contactEmail: principal.contactEmail })
      .from(principal)
      .where(eq(principal.id, lead.principalId))
    expect(row.contactEmail).toBe(corrected)
  })

  it('never touches the lead placeholder user.email', async () => {
    const lead = await seedLead({ name: 'Placeholder guard', contactEmail: null })

    await updatePortalUserProfile({
      principalId: lead.principalId,
      email: `guard-${runSuffix()}@example.com`,
    })

    const [row] = await testDb
      .select({ email: user.email })
      .from(user)
      .where(eq(user.id, lead.userId))
    expect(row.email).toBe(lead.placeholderEmail)
  })

  it('clears the contact email on null', async () => {
    const lead = await seedLead({
      name: 'Clear me',
      contactEmail: `clear-${runSuffix()}@example.com`,
    })

    await updatePortalUserProfile({ principalId: lead.principalId, email: null })

    const [row] = await testDb
      .select({ contactEmail: principal.contactEmail })
      .from(principal)
      .where(eq(principal.id, lead.principalId))
    expect(row.contactEmail).toBeNull()
  })

  it('rejects an undeliverable address without writing anything', async () => {
    const before = `keep-${runSuffix()}@example.com`
    const lead = await seedLead({ name: 'Bad address', contactEmail: before })

    await expect(
      updatePortalUserProfile({ principalId: lead.principalId, email: 'not-an-email' })
    ).rejects.toThrow()

    const [row] = await testDb
      .select({ contactEmail: principal.contactEmail })
      .from(principal)
      .where(eq(principal.id, lead.principalId))
    expect(row.contactEmail).toBe(before)
  })

  it('refuses a synthetic anon placeholder as a contact email', async () => {
    const lead = await seedLead({ name: 'Synthetic guard', contactEmail: null })

    await expect(
      updatePortalUserProfile({
        principalId: lead.principalId,
        email: `temp-${runSuffix()}@anon.quackback.io`,
      })
    ).rejects.toThrow()
  })

  it('re-keys duplicate detection: a lead edited onto a user address matches that user', async () => {
    const shared = `dupe-${runSuffix()}@example.com`
    const existing = await seedUser({ name: 'Existing Person', email: shared })
    const lead = await seedLead({ name: 'Unmatched visitor', contactEmail: null })

    expect(await findDuplicatesForPrincipal(lead.principalId)).toHaveLength(0)

    await updatePortalUserProfile({ principalId: lead.principalId, email: shared })

    const matches = await findDuplicatesForPrincipal(lead.principalId)
    const byEmail = matches.find((m) => m.principalId === existing.principalId)
    expect(byEmail).toBeDefined()
    expect(byEmail?.reasons).toContain('email')
  })

  it('drops a stale duplicate once the lead email is corrected away', async () => {
    const shared = `stale-${runSuffix()}@example.com`
    const existing = await seedUser({ name: 'Other Person', email: shared })
    const lead = await seedLead({ name: 'Wrongly matched', contactEmail: shared })

    expect(
      (await findDuplicatesForPrincipal(lead.principalId)).some(
        (m) => m.principalId === existing.principalId
      )
    ).toBe(true)

    await updatePortalUserProfile({
      principalId: lead.principalId,
      email: `unique-${runSuffix()}@example.com`,
    })

    expect(
      (await findDuplicatesForPrincipal(lead.principalId)).some(
        (m) => m.principalId === existing.principalId
      )
    ).toBe(false)
  })

  it('keeps the identified-user behaviour: account email with uniqueness guard', async () => {
    const taken = `taken-${runSuffix()}@example.com`
    await seedUser({ name: 'First Person', email: taken })
    const second = await seedUser({ name: 'Second Person', email: null })

    await expect(
      updatePortalUserProfile({ principalId: second.principalId, email: taken })
    ).rejects.toThrow(/already in use/i)

    const own = `own-${runSuffix()}@example.com`
    await updatePortalUserProfile({ principalId: second.principalId, email: own })
    const [row] = await testDb
      .select({ email: user.email })
      .from(user)
      .where(eq(user.id, second.userId))
    expect(row.email).toBe(own)
  })

  // An admin can type any address. Leaving it marked verified would let a
  // provider that matches on verified addresses sign someone else in to this
  // account, on nothing but the admin's word.
  it('clears emailVerified when an admin changes the address (E4)', async () => {
    const person = await seedUser({
      name: 'Verified Person',
      email: `verified-${runSuffix()}@example.com`,
      emailVerified: true,
    })

    await updatePortalUserProfile({
      principalId: person.principalId,
      email: `typed-${runSuffix()}@example.com`,
    })

    const [row] = await testDb
      .select({ emailVerified: user.emailVerified })
      .from(user)
      .where(eq(user.id, person.userId))
    expect(row.emailVerified).toBe(false)
  })

  it('keeps emailVerified when the address is unchanged or only the name moves (E4)', async () => {
    const address = `same-${runSuffix()}@example.com`
    const person = await seedUser({ name: 'Same Person', email: address, emailVerified: true })

    await updatePortalUserProfile({ principalId: person.principalId, email: address.toUpperCase() })
    await updatePortalUserProfile({ principalId: person.principalId, name: 'Renamed' })

    const [row] = await testDb
      .select({ emailVerified: user.emailVerified })
      .from(user)
      .where(eq(user.id, person.userId))
    expect(row.emailVerified).toBe(true)
  })

  describe('a domain that requires SSO', () => {
    beforeEach(() => {
      sso.providers = [
        {
          id: 'idp_acme',
          registrationId: 'oidc_acme',
          showButton: true,
          domains: [{ name: 'acme.com', enforced: true, verifiedAt: '2026-01-01T00:00:00Z' }],
        },
      ]
    })
    afterEach(() => {
      sso.providers = []
    })

    it('refuses to move someone off a managed address (E7)', async () => {
      const person = await seedUser({ name: 'Sam', email: `sam-${runSuffix()}@acme.com` })

      await expect(
        updatePortalUserProfile({
          principalId: person.principalId,
          email: `sam-${runSuffix()}@gmail.com`,
        })
      ).rejects.toThrow(/single sign-on/i)
    })

    it('refuses to move someone onto a managed domain they do not sign in through (E3)', async () => {
      const person = await seedUser({ name: 'Pat', email: `pat-${runSuffix()}@example.com` })

      await expect(
        updatePortalUserProfile({
          principalId: person.principalId,
          email: `pat-${runSuffix()}@acme.com`,
        })
      ).rejects.toThrow(/single sign-on/i)
    })

    it('lets someone who signs in through the owning provider get an address there (E3)', async () => {
      const person = await seedUser({ name: 'Lee', email: null })
      await testDb.insert(account).values({
        accountId: `sub-${runSuffix()}`,
        providerId: 'oidc_acme',
        userId: person.userId,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      const address = `lee-${runSuffix()}@acme.com`

      await updatePortalUserProfile({ principalId: person.principalId, email: address })

      const [row] = await testDb
        .select({ email: user.email })
        .from(user)
        .where(eq(user.id, person.userId))
      expect(row.email).toBe(address)
    })

    it('lets an admin correct an address within the domain for someone on its provider (E3)', async () => {
      const person = await seedUser({ name: 'Jon', email: `jhon-${runSuffix()}@acme.com` })
      await testDb.insert(account).values({
        accountId: `sub-${runSuffix()}`,
        providerId: 'oidc_acme',
        userId: person.userId,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      const corrected = `john-${runSuffix()}@acme.com`

      await updatePortalUserProfile({ principalId: person.principalId, email: corrected })

      const [row] = await testDb
        .select({ email: user.email })
        .from(user)
        .where(eq(user.id, person.userId))
      expect(row.email).toBe(corrected)
    })

    it('still renames someone at a managed address (E3)', async () => {
      const address = `kim-${runSuffix()}@acme.com`
      const person = await seedUser({ name: 'Kim', email: address })

      await updatePortalUserProfile({
        principalId: person.principalId,
        name: 'Kim Lee',
        email: address,
      })

      const [row] = await testDb
        .select({ name: user.name, email: user.email })
        .from(user)
        .where(eq(user.id, person.userId))
      expect(row).toEqual({ name: 'Kim Lee', email: address })
    })

    // The rename half of E3 when the address is typed back in a different
    // case, by an admin, for someone who does not sign in through the domain's
    // provider: the address has not changed, so there is nothing to refuse,
    // and its verification stays (E4).
    it('still renames someone whose managed address is typed back in another case (E3, E4)', async () => {
      const address = `ana-${runSuffix()}@acme.com`
      const person = await seedUser({ name: 'Ana', email: address, emailVerified: true })

      await updatePortalUserProfile({
        principalId: person.principalId,
        name: 'Ana Lee',
        email: address.toUpperCase(),
      })

      const [row] = await testDb
        .select({ name: user.name, email: user.email, emailVerified: user.emailVerified })
        .from(user)
        .where(eq(user.id, person.userId))
      expect(row).toEqual({ name: 'Ana Lee', email: address, emailVerified: true })
    })
  })

  it('leaves no verified address behind when an admin clears it (E4)', async () => {
    const person = await seedUser({
      name: 'Cleared Person',
      email: `cleared-${runSuffix()}@example.com`,
      emailVerified: true,
    })

    await updatePortalUserProfile({ principalId: person.principalId, email: null })

    const [row] = await testDb
      .select({ email: user.email, emailVerified: user.emailVerified })
      .from(user)
      .where(eq(user.id, person.userId))
    expect(row).toEqual({ email: null, emailVerified: false })
  })

  // E6, staged: the person's address changes between the edit reading it and
  // writing over it. The edit must refuse, and the address written in between
  // must be the one that stays. Both write branches: a new address, and none.
  describe('an edit that crosses a concurrent change (E6)', () => {
    async function personWhoseAddressChangesMeanwhile() {
      const person = await seedUser({
        name: 'Moving Person',
        email: `before-${runSuffix()}@example.com`,
        emailVerified: true,
      })
      const meanwhile = `meanwhile-${runSuffix()}@example.com`
      race.meanwhile = async () => {
        race.meanwhile = null
        await testDb.update(user).set({ email: meanwhile }).where(eq(user.id, person.userId))
      }
      return { person, meanwhile }
    }

    async function storedEmail(userId: UserId) {
      const [row] = await testDb
        .select({ email: user.email, emailVerified: user.emailVerified })
        .from(user)
        .where(eq(user.id, userId))
      return row
    }

    it('refuses an admin-typed address and keeps the concurrent one', async () => {
      const { person, meanwhile } = await personWhoseAddressChangesMeanwhile()

      await expect(
        updatePortalUserProfile({
          principalId: person.principalId,
          email: `typed-${runSuffix()}@example.com`,
        })
      ).rejects.toMatchObject({ code: 'EMAIL_CHANGED' })

      expect(await storedEmail(person.userId)).toEqual({ email: meanwhile, emailVerified: true })
    })

    it('refuses clearing the address and keeps the concurrent one', async () => {
      const { person, meanwhile } = await personWhoseAddressChangesMeanwhile()

      await expect(
        updatePortalUserProfile({ principalId: person.principalId, email: null })
      ).rejects.toMatchObject({ code: 'EMAIL_CHANGED' })

      expect(await storedEmail(person.userId)).toEqual({ email: meanwhile, emailVerified: true })
    })

    // The control: the same edit with nothing happening in between is
    // written, so the refusals above are the race and not the edit.
    it('writes the same edit when nothing changed in between', async () => {
      const person = await seedUser({
        name: 'Still Person',
        email: `still-${runSuffix()}@example.com`,
      })
      const typed = `typed-${runSuffix()}@example.com`

      await updatePortalUserProfile({ principalId: person.principalId, email: typed })

      expect((await storedEmail(person.userId)).email).toBe(typed)
    })
  })

  it('updates the display name on user and principal', async () => {
    const lead = await seedLead({ name: 'Old Name', contactEmail: null })

    await updatePortalUserProfile({ principalId: lead.principalId, name: 'New Name' })

    const [u] = await testDb.select({ name: user.name }).from(user).where(eq(user.id, lead.userId))
    const [p] = await testDb
      .select({ displayName: principal.displayName })
      .from(principal)
      .where(eq(principal.id, lead.principalId))
    expect(u.name).toBe('New Name')
    expect(p.displayName).toBe('New Name')
  })

  it('throws NotFoundError for an unknown principal', async () => {
    await expect(
      updatePortalUserProfile({
        principalId: createId('principal') as PrincipalId,
        email: `ghost-${runSuffix()}@example.com`,
      })
    ).rejects.toThrow(/not found/i)
  })
})
