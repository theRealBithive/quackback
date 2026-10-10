/**
 * What a sign-in through an identity provider does to a person's role, decided
 * from facts already loaded. Kept free of database access so the rule can be
 * read and tested on its own; `handleAutoProvisionAfter` in `hooks.ts` loads
 * the facts and writes the plan.
 *
 * The provider owns only what a sign-in gave. With "First sign-in only", a
 * sign-in sets the role of a portal user and never touches a teammate. With
 * "Every sign-in", it also keeps a teammate's role following the provider, but
 * only while that role was written by a sign-in (a role rule or the
 * provider's default role). A role an admin assigned by hand is never changed
 * by a sign-in, in either direction.
 * OWASP A01 Broken Access Control (privilege loss and escalation through a
 * provider's group claims).
 */
import type { RoleId } from '@quackback/ids'
import { SYSTEM_ROLES } from '@/lib/shared/permissions'
import type { Role } from '@/lib/shared/roles'

/** A workspace role the person holds now. */
export interface HeldAssignment {
  id: RoleId
  key: string
  name: string
  /** Written by a sign-in rather than by a person. */
  grantedBySso: boolean
}

export interface SignInRoleFacts {
  /** False for a returning user whose principal was removed: treated as a first sign-in. */
  hasPrincipal: boolean
  /** The principal's tier as stored ('user' for a portal user or a fresh sign-in). */
  currentRole: string
  syncOnEverySignIn: boolean
  /** The tier the provider's rules (or its default role) give. */
  targetRole: Role
  /** The workspace role a matched rule gives on top of the member tier. */
  targetCustom: { id: RoleId; name: string } | null
  currentAssignment: HeldAssignment | null
}

export interface RoleChangePlan {
  role: Role
  assignRoleId: RoleId | undefined
  /** Put the plain tier's role back in place of a rule-given workspace role. */
  resetAssignment: boolean
  /** The matched rule names a different workspace role than the one held. */
  customMoves: boolean
  /** A rule-given workspace role gives way to the plain member role. */
  clearsCustom: boolean
}

/**
 * Whether this sign-in may change the role at all, before any role is looked
 * up: only a first sign-in, unless the provider syncs on every sign-in, and
 * taking someone back to portal user only under sync.
 */
export function signInMayChangeRole(facts: {
  currentRole: string
  syncOnEverySignIn: boolean
  targetRole: Role
}): boolean {
  const firstSignIn = facts.currentRole === 'user'
  if (!facts.syncOnEverySignIn && !firstSignIn) return false
  if (facts.targetRole === 'user' && !facts.syncOnEverySignIn) return false
  return true
}

/**
 * A teammate whose workspace role was not written by a sign-in holds it by
 * hand. Without any recorded assignment nothing shows a sign-in gave it, so
 * that counts as by hand too: keeping a role is the safe reading of an
 * unknown origin.
 */
export function holdsRoleByHand(facts: SignInRoleFacts): boolean {
  const isTeammate = facts.hasPrincipal && facts.currentRole !== 'user'
  if (!isTeammate) return false
  const givenBySignIn = facts.currentAssignment?.grantedBySso === true
  return !givenBySignIn
}

/** The role change this sign-in makes, or null when it changes nothing. */
export function planSignInRoleChange(facts: SignInRoleFacts): RoleChangePlan | null {
  if (!signInMayChangeRole(facts)) return null
  if (holdsRoleByHand(facts)) return null

  const { currentRole, targetRole, targetCustom, currentAssignment } = facts
  const plainMemberOutcome = targetRole === 'member' && targetCustom === null
  const staysMemberUnderSync =
    facts.syncOnEverySignIn && plainMemberOutcome && currentRole === 'member'
  const holdsOtherThanPlainMember =
    currentAssignment !== null && currentAssignment.key !== SYSTEM_ROLES.MANAGER
  const clearsCustom = staysMemberUnderSync && holdsOtherThanPlainMember
  const customMoves = targetCustom !== null && currentAssignment?.id !== targetCustom.id

  const tierUnchanged = currentRole === targetRole
  if (tierUnchanged && !customMoves && !clearsCustom) return null

  return {
    role: targetRole,
    assignRoleId: targetCustom?.id,
    resetAssignment: clearsCustom,
    customMoves,
    clearsCustom,
  }
}
