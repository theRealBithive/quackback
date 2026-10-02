/**
 * The server function behind "edit message" in the inbox: who it acts for, and
 * what it hands to the edit service.
 *
 * Contract for upstream batch G (#580, `ccf8f0521`, "edit and delete your own
 * support messages") — the confirmed items this suite pins at the entry point;
 * the rules themselves are decided and tested in the service:
 *
 *   G1  A teammate can edit the body of a message they wrote themselves,
 *       whether a reply or an internal note, on a conversation or a ticket, as
 *       long as they still hold the permission that writes that kind of
 *       message.
 *   G10 A teammate who cannot see the conversation or ticket is told the
 *       message does not exist, not that they lack permission.
 *   G13 A service principal (API key) never counts as the author of a message.
 *
 * The permission depends on the message (reply or note, conversation or
 * ticket), so the entry point asks for no fixed permission: it resolves who is
 * calling and leaves the decision to the service, which reads the stored row.
 * What must hold here is that the service is always asked as the *caller* (so a
 * service principal arrives as a service principal, G13), that an unsigned
 * caller never reaches it, and that the service's refusal, including the
 * "does not exist" of G10, reaches the caller untouched.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ConversationMessageId } from '@quackback/ids'
import type { Actor } from '@/lib/server/policy/types'
import { NotFoundError } from '@/lib/shared/errors'

const hoisted = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  policyActorFromAuth: vi.fn(),
  editConversationMessage: vi.fn(),
}))

vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => {
    const chain: Record<string, unknown> = {}
    chain.validator = () => chain
    chain.middleware = () => chain
    chain.handler = (handler: (args: { data?: unknown }) => Promise<unknown>) =>
      Object.assign((args?: { data?: unknown }) => handler(args ?? {}), chain)
    return chain
  },
  createServerOnlyFn: (fn: unknown) => fn,
}))

vi.mock('@/lib/server/functions/auth-helpers', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/functions/auth-helpers')>()),
  requireAuth: hoisted.requireAuth,
  policyActorFromAuth: hoisted.policyActorFromAuth,
}))

vi.mock('@/lib/server/domains/conversation/conversation.edit', () => ({
  editConversationMessage: hoisted.editConversationMessage,
}))

const MESSAGE_ID = 'conversation_msg_edit_1' as ConversationMessageId

type EditFn = (args: {
  data: { messageId: string; content?: string; contentJson?: unknown }
}) => Promise<unknown>

async function callEdit(data: { messageId: string; content?: string; contentJson?: unknown }) {
  const { editConversationMessageFn } = await import('../conversation')
  return (editConversationMessageFn as unknown as EditFn)({ data })
}

function serviceActor(): Actor {
  return {
    principalId: 'principal_api_key' as Actor['principalId'],
    role: 'admin',
    principalType: 'service',
    segmentIds: new Set(),
    permissions: new Set(),
  }
}

beforeEach(() => {
  hoisted.requireAuth.mockReset().mockResolvedValue({ principal: { id: 'principal_1' } })
  hoisted.policyActorFromAuth.mockReset()
  hoisted.editConversationMessage.mockReset()
})

describe('the edit-message server function (G1, G10, G13)', () => {
  it('asks the service to edit as the signed-in caller and returns what it answers (G1)', async () => {
    const caller: Actor = {
      principalId: 'principal_1' as Actor['principalId'],
      role: 'member',
      principalType: 'user',
      segmentIds: new Set(),
    }
    const edited = { id: MESSAGE_ID, content: 'new body' }
    hoisted.policyActorFromAuth.mockResolvedValue(caller)
    hoisted.editConversationMessage.mockResolvedValue(edited)
    const richBody = { type: 'doc', content: [] }

    const result = await callEdit({
      messageId: MESSAGE_ID,
      content: 'new body',
      contentJson: richBody,
    })

    expect(result).toBe(edited)
    expect(hoisted.editConversationMessage).toHaveBeenCalledWith(
      MESSAGE_ID,
      'new body',
      richBody,
      caller
    )
  })

  it('passes no rich body as null, not as undefined (G1)', async () => {
    hoisted.policyActorFromAuth.mockResolvedValue(serviceActor())
    hoisted.editConversationMessage.mockResolvedValue({})

    await callEdit({ messageId: MESSAGE_ID, content: 'plain' })

    expect(hoisted.editConversationMessage.mock.calls[0][2]).toBeNull()
  })

  it('hands a service principal to the service as a service principal, so it is never taken for an author (G13)', async () => {
    const apiKey = serviceActor()
    hoisted.policyActorFromAuth.mockResolvedValue(apiKey)
    hoisted.editConversationMessage.mockResolvedValue({})

    await callEdit({ messageId: MESSAGE_ID, content: 'plain' })

    const actorSeenByService = hoisted.editConversationMessage.mock.calls[0][3] as Actor
    expect(actorSeenByService.principalType).toBe('service')
    expect(actorSeenByService.principalId).toBe(apiKey.principalId)
  })

  it('never reaches the service for a caller who is not signed in (G1)', async () => {
    hoisted.requireAuth.mockRejectedValue(new Error('Authentication required'))

    await expect(callEdit({ messageId: MESSAGE_ID, content: 'x' })).rejects.toThrow(
      'Authentication required'
    )
    expect(hoisted.editConversationMessage).not.toHaveBeenCalled()
  })

  it('lets the service\'s "message not found" reach the caller unchanged (G10)', async () => {
    const notFound = new NotFoundError('MESSAGE_NOT_FOUND', 'Message not found')
    hoisted.policyActorFromAuth.mockResolvedValue(serviceActor())
    hoisted.editConversationMessage.mockRejectedValue(notFound)

    await expect(callEdit({ messageId: MESSAGE_ID, content: 'x' })).rejects.toBe(notFound)
  })
})
