/**
 * Real-Postgres coverage for the verified-address rule on every server path
 * that adds a portal user to the team directly: the batch add
 * (addTeamMembers), a role change on a portal user (updateMemberRole, behind
 * the person page and REST PATCH), the people-to-add search, and the person
 * page's detail. The rule itself is unit-tested in team-candidate.test.ts.
 *
 * Batch M contract, confirmed 2026-10-09 (M1-M46, verbatim):
 *
 * M1 A person who signs in with an identity provider for the first time gets
 *   the name and avatar that provider sends for them. When the provider sends no
 *   name, the account is named from the username claim the admin mapped; with
 *   none mapped, from the standard handle claims, then from the account
 *   identifier.
 * M2 (OWASP A03 Injection, A10 SSRF, A05) An avatar is only ever taken from an
 *   absolute `https` address. Any other value the provider sends in the avatar
 *   claim (plain `http`, a `data:` or `javascript:` URL, a relative path, a
 *   non-string) leaves the person without a provider avatar rather than storing
 *   it. (Revised by the user's decision D2: `https` only.)
 * M3 When the admin maps an avatar claim, only that claim supplies the avatar.
 *   A provider that leaves the mapped claim empty does not fall back to the
 *   standard `picture` claim.
 * M4 A person who has no avatar gets the provider's avatar at their next
 *   sign-in, whether or not profile sync is on for that provider.
 * M5 With profile sync off (the default for every provider), a person's name
 *   and a non-empty avatar never change because of a sign-in.
 * M6 (OWASP A01 Broken Access Control) With profile sync on, a name the
 *   provider wrote, or one sign-up generated for the account, follows the
 *   provider's current name at each sign-in. A name the person or an admin
 *   changed in Quackback is never overwritten by a sign-in, now or at any later
 *   sign-in.
 * M7 (OWASP A01) With profile sync on, an avatar the provider wrote follows
 *   the provider's current avatar at each sign-in, as long as nobody uploaded a
 *   picture for that person. An uploaded picture, or an avatar URL someone set
 *   in Quackback, is never replaced by a sign-in.
 * M8 A provider that sends a blank name never blanks out a person's name.
 * M9 (OWASP A08 Software and Data Integrity Failures) A sign-in whose claims
 *   were not read fresh from the provider on this callback (a fallback to a
 *   stored token) changes no name and no avatar.
 * M10 (OWASP A04 Insecure Design) An edit a person makes while their own
 *   sign-in is being processed wins: the sign-in then changes nothing about that
 *   person's profile.
 * M11 The person's display name and avatar shown across the product (portal,
 *   comments, dashboard) change together with the account's, in one step, the
 *   same way a profile edit propagates.
 * M12 (OWASP A09 Security Logging and Monitoring Failures) A failure of the
 *   profile refresh never blocks or fails the sign-in, and its log line carries
 *   no claim values, names or URLs.
 * M13 An instance whose database has not yet applied
 *   `0283_account_profile_sync` still signs everyone in; only the refresh is
 *   skipped.
 * M14 Turning profile sync on, or changing the avatar or username claim, does
 *   not invalidate a passing connection test and does not change which existing
 *   account a sign-in matches.
 * M15 (Operator) An instance already running this fork's latest release
 *   applies the new migration on its next deploy, and a fresh instance applies
 *   it in order with the others.
 * M16 (Operator) The MCP SDK in the lockfile is 1.31.0, the same version
 *   upstream ships.
 * M17 A verified-domain person who signs in through a provider whose default
 *   role was never saved becomes a Member, and the provider's settings show
 *   Member as that default before anything is saved. What the settings show is
 *   what sign-in does.
 * M18 (OWASP A01 Broken Access Control) Only someone holding the
 *   member-management permission can add people to the team, change a teammate's
 *   role or remove a teammate. Someone without it sees no Add people button.
 * M19 (OWASP A01 Broken Access Control) Only an admin can grant the Admin
 *   role, change the role of an admin, or remove an admin, whether through the
 *   dialog, the person page, a role change or the REST API with an API key. A
 *   key whose owner is not an admin cannot do any of it.
 * M20 (OWASP A01 Broken Access Control) A custom workspace role can only be
 *   given by someone whose own permissions cover everything that role grants,
 *   and never the Owner preset.
 * M21 (OWASP A01 Broken Access Control, A07) A portal user can be added
 *   straight to the team only when their email address is verified, or when they
 *   sign in through an identity provider at one of the workspace's verified
 *   domains. Everyone else (an account signed up with a password whose address
 *   was never confirmed, a widget-identified customer, an anonymous visitor, a
 *   contact or import who never signed in, a service or support account) can
 *   only be invited by email. The search for people to add shows whether each
 *   address is verified. (Revised by the user's decision D4.)
 * M22 (OWASP A01 Broken Access Control) Adding people is all or nothing: if
 *   one person in the batch cannot be added, or the batch needs more seats than
 *   are free, nobody is added and no invitation is sent, and the refusal says
 *   why (including how many seats are needed and free).
 * M23 (OWASP A01 Broken Access Control) Two admins adding people at the same
 *   moment can neither exceed the seat limit together nor invite the same email
 *   twice.
 * M24 (OWASP A01 Broken Access Control) Adding someone directly retires their
 *   pending team invitation, so it no longer holds a seat and can no longer
 *   change their role later.
 * M25 (OWASP A09) Every direct addition and every role change is recorded in
 *   the audit log as a role change, with the acting person (or the API key's
 *   owner, marked as a key) and the role before and after.
 * M26 (OWASP A01 Broken Access Control) The last admin can never be demoted or
 *   removed.
 * M27 (OWASP A01 Broken Access Control) Nobody can change their own role from
 *   the person page.
 * M28 (OWASP A01, information exposure) Searching for people to add finds
 *   signed-in portal users and teammates by name, email or provider account ID
 *   only for someone who may also view people. Without that permission the
 *   search only answers whether a typed email is new, invited, already on the
 *   team, or a portal user.
 * M29 A provider's settings always show what Quackback takes from that
 *   provider for each person (Account ID, email, name, username, avatar, and the
 *   people attributes), without a Customize step.
 * M30 Opening the card and leaving it changes nothing: Save and Cancel appear
 *   only after an edit, and a mapping that was stored in an unusual but
 *   equivalent form does not count as an edit.
 * M31 A mapping changed elsewhere while an admin edits the card is never
 *   silently overwritten: unedited parts follow the stored mapping, and an
 *   edited part that also changed underneath makes Save refuse rather than
 *   revert the other change.
 * M32 Changing the Account ID still asks for confirmation before it is saved,
 *   and the connection has to be tested again.
 * M33 (OWASP A01 Broken Access Control) Role rules are checked from the top,
 *   and the first that matches decides. If none matches, a person at one of the
 *   provider's verified domains gets the provider's default role, and everyone
 *   else stays a portal user.
 * M34 (OWASP A01 Broken Access Control) A role rule may give a custom
 *   workspace role. Saving any change to the rules requires that the person
 *   saving could grant every role the rules give; otherwise the save is refused.
 * M35 (OWASP A01 Broken Access Control) A rule that gives Admin, or a custom
 *   role holding admin-only permissions, needs the same explicit confirmation as
 *   Admin before it is saved.
 * M36 (OWASP A01 Broken Access Control) A rule whose role was deleted since it
 *   was saved grants nothing at sign-in: the person keeps the role they hold,
 *   and later rules and the default do not apply to them either.
 * M37 (OWASP A01 Broken Access Control) With "First sign-in only", a returning
 *   teammate's role is never changed by sign-in.
 * M38 (OWASP A01 Broken Access Control) With "Every sign-in", a sign-in only
 *   ever takes away a role that a role rule gave. A teammate who no longer
 *   matches the rule that gave their custom role is moved back to plain Member
 *   at their next sign-in, and every such change is in the audit log. A role an
 *   admin assigned by hand is never changed by a sign-in. (Revised by the user's
 *   decision D6c.)
 * M39 (OWASP A01 Broken Access Control) "Every sign-in" cannot be saved when
 *   it would take the ability to manage SSO away from the people at a verified
 *   domain who manage it today. If the list of those people cannot be loaded,
 *   Save stays held.
 * M40 (OWASP A01 Broken Access Control) Only someone with the SSO-management
 *   permission can see which teammates sign in with a provider and whether they
 *   are admins.
 * M41 The create and edit webhook dialogs stay usable on a short screen: when
 *   the event list is longer than the window, the dialog scrolls instead of
 *   pushing Save out of reach.
 * M42 (OWASP A07 Identification and Authentication Failures) A widget visitor
 *   who follows "View on portal" arrives signed in even when their browser
 *   already holds unrelated cookies on the portal host (a theme preference, a
 *   CDN clearance cookie). Today they see "link expired".
 * M43 (OWASP A01, A07) [D7 accepted: the two J11 cases in
 *   `auth.widget-handoff.test.ts` are rewritten to assert this] The hand-off's
 *   call to verify the one-time token carries only the token. The browser's
 *   cookies are never forwarded to it, so nothing the browser already holds can
 *   change which session the token installs.
 * M44 (OWASP A01, A07) J11, J12, J13, J14, J15, J22 and J23 hold unchanged. In
 *   particular the hand-off still never installs a portal session over a
 *   dashboard session (J13), a teammate still never receives a portal session
 *   through it (J12), and a signed identify still does not mark the email
 *   address verified (J23).
 * M45 `/changelog/rss` and `/changelog/rss.xml` send feed readers permanently
 *   to `/changelog/feed`, on this instance only.
 * M46 (OWASP A05 Security Misconfiguration) A changelog address whose id is
 *   not a changelog id answers "not found", the same answer as a well-formed id
 *   that names no published entry; it never answers with a server error.
 */
import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest'
import { createId, type PrincipalId, type UserId } from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import {
  account,
  eq,
  identityProvider,
  invitation,
  principal,
  settings,
  ssoVerifiedDomain,
  user,
} from '@/lib/server/db'
import { ALL_PERMISSIONS } from '@/lib/shared/permissions'
import { countSeatUsage } from '../seat-usage'

const hoisted = vi.hoisted(() => ({
  mint: vi.fn(),
  sendInvitationEmail: vi.fn(),
}))

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))
vi.mock('@/lib/server/cache', () => ({
  cacheDel: vi.fn(),
  CACHE_KEYS: { PRINCIPAL_BY_USER: (id: string) => `principal:user:${id}` },
}))
vi.mock('@/lib/server/domains/teams', () => ({ addPrincipalToDefaultTeam: vi.fn() }))
vi.mock('@/lib/server/domains/principals/membership-sync', () => ({
  enqueueMembershipSync: vi.fn(async () => {}),
}))
vi.mock('@/lib/server/functions/invitation-magic-link', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/functions/invitation-magic-link')>()),
  generateInvitationMagicLink: (email: string, callbackPath: string) =>
    hoisted.mint(email, callbackPath),
}))
vi.mock('@quackback/email', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@quackback/email')>()),
  sendInvitationEmail: (...args: unknown[]) => hoisted.sendInvitationEmail(...args),
}))
vi.mock('@/lib/server/auth/magic-link-mint', () => ({ revokeMagicLinkTokens: vi.fn() }))

const { addTeamMembers } = await import('../team-additions')
const { findPeopleToAdd } = await import('../people-to-add')
const { updateMemberRole } = await import('../principal.service')
const { getPortalUserDetail } = await import('@/lib/server/domains/users/user.detail')
const { invalidateTierLimitsCache } =
  await import('@/lib/server/domains/settings/tier-limits.service')

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: principal.id }).from(principal).limit(0)
    await db.select({ id: ssoVerifiedDomain.id }).from(ssoVerifiedDomain).limit(0)
    await db.select({ id: identityProvider.id }).from(identityProvider).limit(0)
    await db.select({ id: settings.id, tierLimits: settings.tierLimits }).from(settings).limit(0)
  },
})

const tag = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`

type Person = { userId: UserId; principalId: PrincipalId; name: string; email: string }

/** A portal user who has signed in through `providerId` (a password account by default). */
async function seedPortalUser(opts: {
  email?: string
  emailVerified: boolean
  providerId?: string
  role?: 'admin' | 'member' | 'user'
}): Promise<Person> {
  const userId = createId('user') as UserId
  const principalId = createId('principal') as PrincipalId
  const name = `Person ${tag()}`
  const email = opts.email ?? `p-${tag()}@example.com`
  await testDb.insert(user).values({ id: userId, name, email, emailVerified: opts.emailVerified })
  await testDb.insert(principal).values({
    id: principalId,
    userId,
    role: opts.role ?? 'user',
    type: 'user',
    createdAt: new Date(),
  })
  await testDb.insert(account).values({
    accountId: `acct-${tag()}`,
    providerId: opts.providerId ?? 'credential',
    userId,
    updatedAt: new Date(),
  })
  return { userId, principalId, name, email }
}

/** An identity provider with one domain, verified unless `pending`. */
async function seedProvider(domain: string, opts: { pending?: boolean } = {}): Promise<string> {
  const registrationId = `oidc-${tag()}`
  const [row] = await testDb
    .insert(identityProvider)
    .values({ registrationId, label: 'Company Login', clientId: 'client' })
    .returning({ id: identityProvider.id })
  await testDb.insert(ssoVerifiedDomain).values({
    name: domain,
    verificationToken: `token-${tag()}`,
    verifiedAt: opts.pending ? null : new Date(),
    providerId: row!.id,
  })
  return registrationId
}

async function setFreeSeats(free: number) {
  const { used } = await countSeatUsage(testDb)
  const tierLimits = JSON.stringify({ maxTeamSeats: used + free })
  const existing = await testDb.select({ id: settings.id }).from(settings)
  if (existing.length === 0) {
    await testDb.insert(settings).values({
      id: createId('workspace'),
      name: 'Acme',
      slug: `acme-${tag()}`,
      createdAt: new Date(),
      tierLimits,
    })
  } else {
    await testDb.update(settings).set({ tierLimits }).where(eq(settings.id, existing[0]!.id))
  }
  invalidateTierLimitsCache()
}

async function roleOf(principalId: PrincipalId) {
  const [row] = await testDb.select().from(principal).where(eq(principal.id, principalId))
  return row!.role
}

function granterFor(p: Person) {
  return {
    principalId: p.principalId,
    userId: p.userId,
    name: 'Granter',
    role: 'admin' as const,
    permissions: ALL_PERMISSIONS,
  }
}

const ctx = {
  workspace: { name: 'Acme', logoKey: null },
  actor: { email: 'granter@example.com', role: 'admin', type: 'user' as const },
}

async function addDirectly(admin: Person, people: Person[], emails: string[] = []) {
  return addTeamMembers(
    { principalIds: people.map((p) => p.principalId), emails, role: 'member' },
    granterFor(admin),
    ctx
  )
}

if (fixture.available) {
  beforeEach(async () => {
    vi.clearAllMocks()
    hoisted.mint.mockImplementation(async (email: string, callbackPath: string) => ({
      url: `https://acme.test${callbackPath}`,
      token: `token-for-${email}`,
      sealedAddress: email,
    }))
    hoisted.sendInvitationEmail.mockResolvedValue({ sent: true })
    await fixture.begin()
    await setFreeSeats(100)
  })
  afterEach(() => {
    invalidateTierLimitsCache()
    return fixture.rollback()
  })
  afterAll(() => fixture.close())
}

describe.skipIf(!fixture.available)('adding a portal user directly (M21, M22)', () => {
  it('adds a portal user whose email address is verified (M21)', async () => {
    const admin = await seedPortalUser({ emailVerified: true, role: 'admin' })
    const sam = await seedPortalUser({ emailVerified: true })
    const result = await addDirectly(admin, [sam])
    expect(result.added).toEqual([{ principalId: sam.principalId, name: sam.name }])
    expect(await roleOf(sam.principalId)).toBe('member')
  })

  it('refuses an unverified password account, names why, and writes nothing in the batch (M21, M22)', async () => {
    const admin = await seedPortalUser({ emailVerified: true, role: 'admin' })
    const verified = await seedPortalUser({ emailVerified: true })
    const unverified = await seedPortalUser({ emailVerified: false })
    await expect(
      addDirectly(admin, [verified, unverified], ['new.person@example.com'])
    ).rejects.toMatchObject({
      code: 'NOT_ELIGIBLE',
      principalId: unverified.principalId,
      message: `${unverified.name}'s email address isn't verified. Invite them by email instead.`,
    })
    expect(await roleOf(unverified.principalId)).toBe('user')
    expect(await roleOf(verified.principalId)).toBe('user')
    expect(await testDb.select().from(invitation).where(eq(invitation.status, 'pending'))).toEqual(
      []
    )
    expect(hoisted.sendInvitationEmail).not.toHaveBeenCalled()
  })

  it('adds an unverified address when they sign in through the provider owning its verified domain (M21)', async () => {
    const domain = `${tag()}.example.com`
    const providerId = await seedProvider(domain)
    const admin = await seedPortalUser({ emailVerified: true, role: 'admin' })
    const sam = await seedPortalUser({ emailVerified: false, email: `sam@${domain}`, providerId })
    await addDirectly(admin, [sam])
    expect(await roleOf(sam.principalId)).toBe('member')
  })

  it('refuses when the domain is verified for another provider than the one they use (M21)', async () => {
    const domain = `${tag()}.example.com`
    await seedProvider(domain)
    const theirProvider = await seedProvider(`${tag()}.example.org`)
    const admin = await seedPortalUser({ emailVerified: true, role: 'admin' })
    const sam = await seedPortalUser({
      emailVerified: false,
      email: `sam@${domain}`,
      providerId: theirProvider,
    })
    await expect(addDirectly(admin, [sam])).rejects.toMatchObject({ code: 'NOT_ELIGIBLE' })
    expect(await roleOf(sam.principalId)).toBe('user')
  })

  it("refuses when their provider's domain is still pending verification (M21)", async () => {
    const domain = `${tag()}.example.com`
    const providerId = await seedProvider(domain, { pending: true })
    const admin = await seedPortalUser({ emailVerified: true, role: 'admin' })
    const sam = await seedPortalUser({ emailVerified: false, email: `sam@${domain}`, providerId })
    await expect(addDirectly(admin, [sam])).rejects.toMatchObject({ code: 'NOT_ELIGIBLE' })
  })

  it('still invites the unverified address by email (M21)', async () => {
    const admin = await seedPortalUser({ emailVerified: true, role: 'admin' })
    const sam = await seedPortalUser({ emailVerified: false })
    const result = await addDirectly(admin, [], [sam.email])
    expect(result.invited).toHaveLength(1)
    expect(result.invited[0]).toMatchObject({ email: sam.email })
    expect(await roleOf(sam.principalId)).toBe('user')
  })
})

describe.skipIf(!fixture.available)('a role change on a portal user (M19, M21)', () => {
  const actor = { userId: null, email: 'admin@example.com', role: 'admin', type: 'user' as const }
  const asAdmin = { granterPermissions: ALL_PERMISSIONS, granterRole: 'admin' as const }

  it('refuses an unverified address on the role-change path too (M21)', async () => {
    const admin = await seedPortalUser({ emailVerified: true, role: 'admin' })
    const sam = await seedPortalUser({ emailVerified: false })
    await expect(
      updateMemberRole(sam.principalId, 'member', admin.principalId, actor, undefined, asAdmin)
    ).rejects.toMatchObject({
      code: 'NOT_ELIGIBLE',
      message: `${sam.name}'s email address isn't verified. Invite them by email instead.`,
    })
    expect(await roleOf(sam.principalId)).toBe('user')
  })

  it('promotes a verified address on the role-change path (M21)', async () => {
    const admin = await seedPortalUser({ emailVerified: true, role: 'admin' })
    const sam = await seedPortalUser({ emailVerified: true })
    await updateMemberRole(sam.principalId, 'member', admin.principalId, actor, undefined, asAdmin)
    expect(await roleOf(sam.principalId)).toBe('member')
  })
})

describe.skipIf(!fixture.available)('the search for people to add (M21, M28)', () => {
  it("shows whether each portal user's address is verified (M21)", async () => {
    const t = tag()
    const caller = await seedPortalUser({ emailVerified: true, role: 'admin' })
    const verified = await seedPortalUser({ emailVerified: true, email: `v-${t}@example.com` })
    const unverified = await seedPortalUser({ emailVerified: false, email: `u-${t}@example.com` })
    const result = await findPeopleToAdd({
      query: t,
      callerPrincipalId: caller.principalId,
      canSearchPeople: true,
    })
    const byId = new Map(result.people.map((p) => [p.principalId, p]))
    expect(byId.get(verified.principalId)).toMatchObject({ status: 'portal_user', verified: true })
    expect(byId.get(unverified.principalId)).toMatchObject({
      status: 'portal_user',
      verified: false,
    })
  })

  it('a typed address of an unverified portal user offers an invitation, not a direct add (M21)', async () => {
    const caller = await seedPortalUser({ emailVerified: true, role: 'admin' })
    const sam = await seedPortalUser({ emailVerified: false })
    const result = await findPeopleToAdd({
      query: sam.email,
      callerPrincipalId: caller.principalId,
      canSearchPeople: true,
    })
    expect(result.email).toEqual({
      address: sam.email,
      status: 'unverified_portal_user',
      principalId: sam.principalId,
    })
  })

  it('without people.view the answer does not reveal the portal user (M28)', async () => {
    const caller = await seedPortalUser({ emailVerified: true, role: 'admin' })
    const sam = await seedPortalUser({ emailVerified: false })
    const result = await findPeopleToAdd({
      query: sam.email,
      callerPrincipalId: caller.principalId,
      canSearchPeople: false,
    })
    expect(result.email).toEqual({ address: sam.email, status: 'new' })
  })
})

describe.skipIf(!fixture.available)('the person page (M21)', () => {
  it('says whether the address is verified, by the same rule the add path enforces (M21)', async () => {
    const domain = `${tag()}.example.com`
    const providerId = await seedProvider(domain)
    const verified = await seedPortalUser({ emailVerified: true })
    const unverified = await seedPortalUser({ emailVerified: false })
    const viaProvider = await seedPortalUser({
      emailVerified: false,
      email: `kim@${domain}`,
      providerId,
    })
    expect((await getPortalUserDetail(verified.principalId))?.addressVerified).toBe(true)
    expect((await getPortalUserDetail(unverified.principalId))?.addressVerified).toBe(false)
    expect((await getPortalUserDetail(viaProvider.principalId))?.addressVerified).toBe(true)
  })
})
