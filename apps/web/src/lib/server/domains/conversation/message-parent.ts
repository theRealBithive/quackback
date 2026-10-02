/**
 * Resolve which of a message's two possible parents (a conversation or a
 * ticket — every message has exactly one) it belongs to, authorizing a
 * ticket-parented message against the actor along the way. Both
 * `message.actions.ts` (reactions/flags) and `conversation.service.ts`
 * (`deleteConversationMessage`) independently re-derived this "which parent,
 * and can the actor see it" check; this is the one place it's written.
 */
import type { ConversationMessage } from '@/lib/server/db'
import type { ConversationId, TicketId } from '@quackback/ids'
import type { Actor } from '@/lib/server/policy/types'
import { NotFoundError } from '@/lib/shared/errors'

export type MessageParent =
  { kind: 'ticket'; ticketId: TicketId } | { kind: 'conversation'; conversationId: ConversationId }

/**
 * Resolve `message`'s parent. For a ticket-parented message, authorizes the
 * actor can see that ticket (§2.5) via `assertTicketVisible` — throwing
 * NotFound (never Forbidden) on an invisible parent, so a team member
 * without visibility on THIS ticket can't tell it exists. A
 * conversation-parented message gets no equivalent check here: a
 * pre-existing gap (callers today only re-check `canActAsAgent` plus the
 * flat `conversation.note` permission at the server-fn layer, or their own
 * conversation-level authz) that predates this helper — narrowing it further
 * is out of scope for this extraction.
 */
export async function resolveMessageParent(
  message: ConversationMessage,
  actor: Actor
): Promise<MessageParent> {
  if (message.ticketId) {
    const { assertTicketVisible } = await import('@/lib/server/domains/tickets/ticket.service')
    await assertTicketVisible(message.ticketId, actor)
    return { kind: 'ticket', ticketId: message.ticketId }
  }
  // A message has exactly one parent, so conversationId is guaranteed here.
  return { kind: 'conversation', conversationId: message.conversationId as ConversationId }
}

/**
 * `resolveMessageParent` for edit and delete: a teammate who cannot see the
 * ticket is told the *message* does not exist, in the very words used for an
 * id that was never issued. Naming the ticket would tell them the message is
 * real.
 */
export async function resolveVisibleMessageParent(
  message: ConversationMessage,
  actor: Actor
): Promise<MessageParent> {
  try {
    return await resolveMessageParent(message, actor)
  } catch (error) {
    if (error instanceof NotFoundError) {
      throw new NotFoundError('MESSAGE_NOT_FOUND', 'Message not found')
    }
    throw error
  }
}
