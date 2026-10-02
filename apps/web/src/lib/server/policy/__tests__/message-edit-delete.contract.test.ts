/**
 * Who may edit and who may delete a support message: the decision table.
 *
 * Contract for upstream batch G (#580, `ccf8f0521`, "edit and delete your own
 * support messages") — the confirmed list, policy half:
 *
 *   G1  A teammate can edit the body of a message they wrote themselves,
 *       whether a reply or an internal note, on a conversation or a ticket, as
 *       long as they still hold the permission that writes that kind of
 *       message.
 *   G2  Nobody can edit a message someone else wrote, a customer's message, a
 *       system message, a message from the AI assistant, or a structured
 *       message, and that includes moderators.
 *   G11 A teammate can delete their own message while they hold the permission
 *       that writes it; a moderator can delete any message that is not a system
 *       message; a customer can delete their own message in their own
 *       conversation; nobody can delete a system message.
 *   G12 A teammate without moderator rights can no longer delete a message
 *       someone else wrote, on conversations and on tickets alike.
 *   G13 A service principal (API key) never counts as the author of a message.
 *
 * The assistant and structured-message halves of G2 are not visible to a pure
 * policy function (they are refused by the service from the stored row); they
 * are pinned against the real edit path in
 * `domains/conversation/__tests__/message-edit.contract.db.test.ts`.
 *
 * The expected verdict below is written from the contract text, in terms of
 * who the actor is and who wrote the message, not from the policy's branches.
 *
 * Generators: every combination of the four write permissions and
 * `conversation.manage` (32 permission sets) is reachable for a teammate, plus
 * a service principal holding every write permission, the conversation's own
 * visitor, a different visitor and nobody signed in; messages vary sender
 * (agent, visitor, system), author (the actor, somebody else, nobody), parent
 * (conversation, ticket) and internal or not.
 */
import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import type { PrincipalId } from '@quackback/ids'
import { PERMISSIONS, type PermissionKey } from '@/lib/shared/permissions'
import type { Actor } from '@/lib/server/policy/types'
import { canEditMessage, canDeleteMessage } from '../conversation'

const ACTOR_ID = 'principal_actor' as PrincipalId
const OTHER_ID = 'principal_other' as PrincipalId
const OWN_VISITOR_ID = 'principal_visitor' as PrincipalId

type ActorKind = 'teammate' | 'service' | 'ownVisitor' | 'otherVisitor' | 'anonymous'
type SenderType = 'agent' | 'visitor' | 'system'
type Author = 'actor' | 'somebody_else' | 'nobody'
type Parent = 'conversation' | 'ticket'

interface Scenario {
  kind: ActorKind
  holdsConversationReply: boolean
  holdsConversationNote: boolean
  holdsTicketReply: boolean
  holdsTicketNote: boolean
  holdsManage: boolean
  senderType: SenderType
  author: Author
  parent: Parent
  isInternal: boolean
}

const scenarios = fc.record<Scenario>({
  kind: fc.constantFrom<ActorKind>(
    'teammate',
    'service',
    'ownVisitor',
    'otherVisitor',
    'anonymous'
  ),
  holdsConversationReply: fc.boolean(),
  holdsConversationNote: fc.boolean(),
  holdsTicketReply: fc.boolean(),
  holdsTicketNote: fc.boolean(),
  holdsManage: fc.boolean(),
  senderType: fc.constantFrom<SenderType>('agent', 'visitor', 'system'),
  author: fc.constantFrom<Author>('actor', 'somebody_else', 'nobody'),
  parent: fc.constantFrom<Parent>('conversation', 'ticket'),
  isInternal: fc.boolean(),
})

/** What the actor holds. Only teammates and the service principal hold anything. */
function heldPermissions(scenario: Scenario): Set<PermissionKey> {
  const held = new Set<PermissionKey>()
  const holdsAnything = scenario.kind === 'teammate' || scenario.kind === 'service'
  if (!holdsAnything) return held
  if (scenario.holdsConversationReply) held.add(PERMISSIONS.CONVERSATION_REPLY)
  if (scenario.holdsConversationNote) held.add(PERMISSIONS.CONVERSATION_NOTE)
  if (scenario.holdsTicketReply) held.add(PERMISSIONS.TICKET_REPLY)
  if (scenario.holdsTicketNote) held.add(PERMISSIONS.TICKET_NOTE)
  // A service principal is a credential, not a moderator: it is generated
  // without moderator rights so the table speaks only about authorship (G13).
  if (scenario.holdsManage && scenario.kind === 'teammate') {
    held.add(PERMISSIONS.CONVERSATION_MANAGE)
  }
  return held
}

function actorFor(scenario: Scenario): Actor {
  const permissions = heldPermissions(scenario)
  switch (scenario.kind) {
    case 'teammate':
      return {
        principalId: ACTOR_ID,
        role: 'member',
        principalType: 'user',
        segmentIds: new Set(),
        permissions,
      }
    case 'service':
      return {
        principalId: ACTOR_ID,
        role: 'member',
        principalType: 'service',
        segmentIds: new Set(),
        permissions,
      }
    case 'ownVisitor':
      return {
        principalId: OWN_VISITOR_ID,
        role: 'user',
        principalType: 'user',
        segmentIds: new Set(),
        permissions,
      }
    case 'otherVisitor':
      return {
        principalId: OTHER_ID,
        role: 'user',
        principalType: 'user',
        segmentIds: new Set(),
        permissions,
      }
    case 'anonymous':
      return {
        principalId: null,
        role: null,
        principalType: 'anonymous',
        segmentIds: new Set(),
        permissions,
      }
  }
}

function authorPrincipalId(scenario: Scenario, actor: Actor): PrincipalId | null {
  if (scenario.author === 'nobody') return null
  if (scenario.author === 'somebody_else')
    return OTHER_ID === actor.principalId ? ACTOR_ID : OTHER_ID
  return actor.principalId
}

function messageFor(scenario: Scenario, actor: Actor) {
  return {
    senderType: scenario.senderType,
    authorPrincipalId: authorPrincipalId(scenario, actor),
    parent: scenario.parent,
    isInternal: scenario.isInternal,
  }
}

const conversationOwnedByVisitor = { visitorPrincipalId: OWN_VISITOR_ID, status: 'open' as const }

function deleteVerdict(scenario: Scenario, actor: Actor) {
  const message = messageFor(scenario, actor)
  const conversation = scenario.parent === 'conversation' ? conversationOwnedByVisitor : null
  return canDeleteMessage(actor, message, conversation).allowed
}

function editVerdict(scenario: Scenario, actor: Actor) {
  return canEditMessage(actor, messageFor(scenario, actor)).allowed
}

// ---- The table, written from the contract text -----------------------------

function holdsWritePermission(scenario: Scenario): boolean {
  if (scenario.parent === 'conversation' && !scenario.isInternal)
    return scenario.holdsConversationReply
  if (scenario.parent === 'conversation' && scenario.isInternal)
    return scenario.holdsConversationNote
  if (scenario.parent === 'ticket' && !scenario.isInternal) return scenario.holdsTicketReply
  return scenario.holdsTicketNote
}

/** A signed-in teammate (not a service principal) who wrote this agent message. */
function isTeammateAuthorOfAgentMessage(scenario: Scenario): boolean {
  return (
    scenario.kind === 'teammate' && scenario.senderType === 'agent' && scenario.author === 'actor'
  )
}

function expectedEditAllowed(scenario: Scenario): boolean {
  return isTeammateAuthorOfAgentMessage(scenario) && holdsWritePermission(scenario)
}

function expectedDeleteAllowed(scenario: Scenario): boolean {
  if (scenario.senderType === 'system') return false
  const isModerator = scenario.kind === 'teammate' && scenario.holdsManage
  if (isModerator) return true
  if (isTeammateAuthorOfAgentMessage(scenario) && holdsWritePermission(scenario)) return true
  const customerDeletesOwnMessage =
    scenario.kind === 'ownVisitor' &&
    scenario.senderType === 'visitor' &&
    scenario.author === 'actor' &&
    scenario.parent === 'conversation'
  return customerDeletesOwnMessage
}

const RUNS = 4000

describe('who may edit a message (G1, G2, G13)', () => {
  it('matches the contract table for every actor and message (G1, G2, G13)', () => {
    fc.assert(
      fc.property(scenarios, (scenario) => {
        const actor = actorFor(scenario)
        expect(editVerdict(scenario, actor)).toBe(expectedEditAllowed(scenario))
      }),
      { numRuns: RUNS }
    )
  })

  it('lets a teammate edit their own reply or note on a conversation or ticket while they hold its write permission (G1)', () => {
    const parents: Parent[] = ['conversation', 'ticket']
    for (const parent of parents) {
      for (const isInternal of [false, true]) {
        const required =
          parent === 'conversation'
            ? isInternal
              ? PERMISSIONS.CONVERSATION_NOTE
              : PERMISSIONS.CONVERSATION_REPLY
            : isInternal
              ? PERMISSIONS.TICKET_NOTE
              : PERMISSIONS.TICKET_REPLY
        const message = {
          senderType: 'agent' as const,
          authorPrincipalId: ACTOR_ID,
          parent,
          isInternal,
        }
        const holdingIt: Actor = {
          principalId: ACTOR_ID,
          role: 'member',
          principalType: 'user',
          segmentIds: new Set(),
          permissions: new Set([required]),
        }
        const holdingEverythingButIt = new Set<PermissionKey>([
          PERMISSIONS.CONVERSATION_REPLY,
          PERMISSIONS.CONVERSATION_NOTE,
          PERMISSIONS.TICKET_REPLY,
          PERMISSIONS.TICKET_NOTE,
          PERMISSIONS.CONVERSATION_MANAGE,
        ])
        holdingEverythingButIt.delete(required)
        const missingIt: Actor = { ...holdingIt, permissions: holdingEverythingButIt }

        expect(canEditMessage(holdingIt, message).allowed).toBe(true)
        expect(canEditMessage(missingIt, message).allowed).toBe(false)
      }
    }
  })

  it('never lets a moderator edit what someone else wrote (G2)', () => {
    const moderator: Actor = {
      principalId: ACTOR_ID,
      role: 'admin',
      principalType: 'user',
      segmentIds: new Set(),
      permissions: new Set(Object.values(PERMISSIONS)),
    }
    for (const parent of ['conversation', 'ticket'] as const) {
      for (const senderType of ['agent', 'visitor', 'system'] as const) {
        for (const author of [OTHER_ID, null]) {
          const message = { senderType, authorPrincipalId: author, parent, isInternal: false }
          expect(canEditMessage(moderator, message).allowed).toBe(false)
        }
      }
    }
  })

  it('never lets a teammate edit a customer or system message, even one carrying their own id (G2)', () => {
    fc.assert(
      fc.property(scenarios, (scenario) => {
        const senderType: SenderType =
          scenario.senderType === 'agent' ? 'visitor' : scenario.senderType
        const notAnAgentMessage: Scenario = { ...scenario, senderType }
        const actor = actorFor(notAnAgentMessage)
        expect(editVerdict(notAnAgentMessage, actor)).toBe(false)
      }),
      { numRuns: RUNS }
    )
  })

  it('never counts a service principal as the author of a message (G13)', () => {
    fc.assert(
      fc.property(scenarios, (scenario) => {
        const asService: Scenario = { ...scenario, kind: 'service', author: 'actor' }
        const actor = actorFor(asService)
        expect(editVerdict(asService, actor)).toBe(false)
        expect(deleteVerdict(asService, actor)).toBe(false)
      }),
      { numRuns: RUNS }
    )
  })
})

describe('who may delete a message (G11, G12, G13)', () => {
  it('matches the contract table for every actor and message (G11, G12, G13)', () => {
    fc.assert(
      fc.property(scenarios, (scenario) => {
        const actor = actorFor(scenario)
        expect(deleteVerdict(scenario, actor)).toBe(expectedDeleteAllowed(scenario))
      }),
      { numRuns: RUNS }
    )
  })

  it('lets nobody delete a system message, moderators included (G11)', () => {
    fc.assert(
      fc.property(scenarios, (scenario) => {
        const systemMessage: Scenario = { ...scenario, senderType: 'system' }
        const actor = actorFor(systemMessage)
        expect(deleteVerdict(systemMessage, actor)).toBe(false)
      }),
      { numRuns: RUNS }
    )
  })

  it('lets a moderator delete any message that is not a system message (G11)', () => {
    fc.assert(
      fc.property(scenarios, (scenario) => {
        const byModerator: Scenario = { ...scenario, kind: 'teammate', holdsManage: true }
        const actor = actorFor(byModerator)
        const expected = byModerator.senderType !== 'system'
        expect(deleteVerdict(byModerator, actor)).toBe(expected)
      }),
      { numRuns: RUNS }
    )
  })

  it('refuses a teammate without moderator rights anything somebody else wrote, whatever else they hold (G12)', () => {
    const everyWritePermission = new Set<PermissionKey>([
      PERMISSIONS.CONVERSATION_REPLY,
      PERMISSIONS.CONVERSATION_NOTE,
      PERMISSIONS.TICKET_REPLY,
      PERMISSIONS.TICKET_NOTE,
    ])
    const teammate: Actor = {
      principalId: ACTOR_ID,
      role: 'member',
      principalType: 'user',
      segmentIds: new Set(),
      permissions: everyWritePermission,
    }
    for (const parent of ['conversation', 'ticket'] as const) {
      for (const isInternal of [false, true]) {
        for (const author of [OTHER_ID, null]) {
          const message = {
            senderType: 'agent' as const,
            authorPrincipalId: author,
            parent,
            isInternal,
          }
          const conversation = parent === 'conversation' ? conversationOwnedByVisitor : null
          expect(canDeleteMessage(teammate, message, conversation).allowed).toBe(false)
        }
      }
    }
  })

  it('lets a customer delete their own message in their own conversation only (G11)', () => {
    const customer: Actor = {
      principalId: OWN_VISITOR_ID,
      role: 'user',
      principalType: 'user',
      segmentIds: new Set(),
      permissions: new Set(),
    }
    const own = {
      senderType: 'visitor' as const,
      authorPrincipalId: OWN_VISITOR_ID,
      parent: 'conversation' as const,
      isInternal: false,
    }
    const someoneElses = { ...own, authorPrincipalId: OTHER_ID }
    const otherCustomersConversation = { visitorPrincipalId: OTHER_ID, status: 'open' as const }

    expect(canDeleteMessage(customer, own, conversationOwnedByVisitor).allowed).toBe(true)
    expect(canDeleteMessage(customer, someoneElses, conversationOwnedByVisitor).allowed).toBe(false)
    expect(canDeleteMessage(customer, own, otherCustomersConversation).allowed).toBe(false)
  })
})

describe('editing and deleting stay consistent (G2, G11, G12)', () => {
  it('never allows an edit where the same actor, without moderator rights, may not delete (G2, G11, G12)', () => {
    fc.assert(
      fc.property(scenarios, (scenario) => {
        const withoutModeratorRights: Scenario = { ...scenario, holdsManage: false }
        const actor = actorFor(withoutModeratorRights)
        const mayEdit = editVerdict(withoutModeratorRights, actor)
        const mayDelete = deleteVerdict(withoutModeratorRights, actor)
        expect(mayEdit && !mayDelete).toBe(false)
      }),
      { numRuns: RUNS }
    )
  })

  it('treats a system message as neither editable nor deletable for anybody (G2, G11)', () => {
    fc.assert(
      fc.property(scenarios, (scenario) => {
        const systemMessage: Scenario = { ...scenario, senderType: 'system' }
        const actor = actorFor(systemMessage)
        expect(editVerdict(systemMessage, actor)).toBe(false)
        expect(deleteVerdict(systemMessage, actor)).toBe(false)
      }),
      { numRuns: RUNS }
    )
  })
})
