/**
 * `resolveVisibleMessageParent`, the edit and delete flavour of the parent
 * lookup.
 *
 *   G10 A teammate who cannot see the conversation or ticket is told the
 *       message does not exist, not that they lack permission.
 *
 * The DB contract suite holds G10 end to end. This one pins the two edges of
 * the translation that need a stubbed ticket check to reach: only a NotFound
 * is reworded, and any other failure reaches the caller unchanged, so an
 * outage is not disguised as a missing message.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ConversationMessage } from '@/lib/server/db'
import type { PrincipalId } from '@quackback/ids'
import type { Actor } from '@/lib/server/policy/types'
import { NotFoundError } from '@/lib/shared/errors'

const mockAssertTicketVisible = vi.fn()
vi.mock('@/lib/server/domains/tickets/ticket.service', () => ({
  assertTicketVisible: (...args: unknown[]) => mockAssertTicketVisible(...args),
}))

import { resolveVisibleMessageParent } from '../message-parent'

const teammate: Actor = {
  principalId: 'principal_teammate' as PrincipalId,
  role: 'member',
  principalType: 'user',
  segmentIds: new Set(),
}

function ticketMessage(): ConversationMessage {
  return {
    id: 'conv_msg_1',
    ticketId: 'ticket_1',
    conversationId: null,
  } as unknown as ConversationMessage
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('resolveVisibleMessageParent', () => {
  it('(G10) an invisible ticket is reported as a missing message', async () => {
    mockAssertTicketVisible.mockRejectedValue(
      new NotFoundError('TICKET_NOT_FOUND', 'Ticket not found')
    )

    const failure = await resolveVisibleMessageParent(ticketMessage(), teammate).catch(
      (error: unknown) => error
    )

    expect(failure).toBeInstanceOf(NotFoundError)
    expect((failure as NotFoundError).code).toBe('MESSAGE_NOT_FOUND')
    expect((failure as NotFoundError).message).toBe('Message not found')
  })

  it('(G10) a failure that is not a NotFound reaches the caller unchanged', async () => {
    const outage = new Error('connection reset')
    mockAssertTicketVisible.mockRejectedValue(outage)

    const failure = await resolveVisibleMessageParent(ticketMessage(), teammate).catch(
      (error: unknown) => error
    )

    expect(failure).toBe(outage)
  })

  it('(G10) a visible ticket resolves to the ticket parent', async () => {
    mockAssertTicketVisible.mockResolvedValue({ id: 'ticket_1' })

    const parent = await resolveVisibleMessageParent(ticketMessage(), teammate)

    expect(parent).toEqual({ kind: 'ticket', ticketId: 'ticket_1' })
  })
})
