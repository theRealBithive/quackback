/**
 * Who may join the team straight from the portal, decided from facts already
 * loaded. Kept free of database access so the rule can be read and tested on
 * its own; `team-promotion.ts` loads the facts.
 *
 * Joining directly skips the emailed invitation, which is what used to prove
 * that the person controls their address. So only a person whose address is
 * proven another way may join directly: the address is verified, or they sign
 * in through one of the workspace's identity providers that owns the
 * address's verified domain. Everyone else is invited by email.
 * OWASP A01 Broken Access Control, A07 Identification and Authentication
 * Failures.
 */
import type { PrincipalId, UserId } from '@quackback/ids'
import { emailDomain } from '@/lib/server/auth/normalize-domain'
import { isTeamMember } from '@/lib/shared/roles'

export interface TeamCandidate {
  id: PrincipalId
  userId: UserId | null
  role: string
  type: string
  name: string
  email: string | null
  signedIn: boolean
  /** The address is proven: see {@link isVerifiedForDirectAdd}. */
  verified: boolean
}

export interface AddressFacts {
  email: string | null
  emailVerified: boolean
  /** Better Auth provider ids of the person's linked accounts. */
  accountProviderIds: readonly string[]
}

/** A workspace identity provider and the domains verified for it. */
export interface ProviderVerifiedDomains {
  /** Better Auth's provider id for it, as on the person's account rows. */
  registrationId: string
  /** Canonical domain names whose verification has completed. */
  verifiedDomains: readonly string[]
}

/**
 * The person's address is proven well enough to skip the invitation: it is
 * verified, or a provider they sign in with owns its verified domain. A
 * provider owning some other verified domain proves nothing about this one.
 */
export function isVerifiedForDirectAdd(
  facts: AddressFacts,
  providers: readonly ProviderVerifiedDomains[]
): boolean {
  if (facts.emailVerified) return true
  // Null for an address without a usable domain, which no provider owns.
  const domain = emailDomain(facts.email)
  for (const provider of providers) {
    const theySignInWithIt = facts.accountProviderIds.includes(provider.registrationId)
    const itOwnsTheDomain = provider.verifiedDomains.some((name) => name === domain)
    if (theySignInWithIt && itOwnsTheDomain) return true
  }
  return false
}

export type CandidateVerdict =
  'teammate' | 'eligible' | 'not_signed_in' | 'unverified' | 'not_a_person'

/** Where a principal stands for joining the team. */
export function classifyTeamCandidate(candidate: TeamCandidate): CandidateVerdict {
  if (candidate.type !== 'user' || !candidate.userId) return 'not_a_person'
  if (isTeamMember(candidate.role)) return 'teammate'
  if (candidate.role !== 'user') return 'not_a_person'
  if (!candidate.signedIn) return 'not_signed_in'
  if (!candidate.verified) return 'unverified'
  return 'eligible'
}

/** Why a portal user cannot join directly, in the words the refusal uses. */
export function notEligibleMessage(name: string, verdict: 'not_signed_in' | 'unverified'): string {
  if (verdict === 'unverified') {
    return `${name}'s email address isn't verified. Invite them by email instead.`
  }
  return `${name} hasn't signed in yet. Invite them by email instead.`
}
