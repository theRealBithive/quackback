/**
 * M34 failing closed: a save whose rules give a workspace role is held to the
 * saver's own permissions, so a caller that hands in no permission set at all
 * grants nothing, and the role is never even looked up.
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
import { describe, expect, it, vi } from 'vitest'

const { assertGrantableRole } = vi.hoisted(() => ({ assertGrantableRole: vi.fn() }))
vi.mock('../role.grants', () => ({ assertGrantableRole }))

import { generateId } from '@quackback/ids'
import { checkRoleRuleGrants } from '../role.rule-grants'

const RULE_WITH_ROLE = {
  role: {
    claimPath: 'groups',
    rules: [{ whenContains: 'support', role: 'member', roleId: generateId('role') }],
  },
}

describe('checkRoleRuleGrants without a permission set (M34)', () => {
  it('refuses a rule that gives a workspace role when the saver has no permission set (M34)', async () => {
    await expect(checkRoleRuleGrants(null, RULE_WITH_ROLE, undefined)).rejects.toMatchObject({
      code: 'GRANT_CEILING',
    })
    expect(assertGrantableRole).not.toHaveBeenCalled()
  })
})
