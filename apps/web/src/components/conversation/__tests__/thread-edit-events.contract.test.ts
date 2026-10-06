/**
 * Live body edits reaching the open threads (client half).
 *
 * Contract for the batch G pick (upstream ccf8f0521 #580, "edit and delete your
 * own support messages") -- the confirmed list items this suite pins (verbatim):
 *
 *   G3 An edited message keeps its place in the thread and carries an "(edited)" mark; saving an unchanged body is not an edit and leaves no mark.
 *   G4 An edit to a customer-visible message reaches the customer's widget and the ticket thread live; an edit to an internal note never reaches the customer.
 *
 * The three thread caches (inbox conversation, ticket, visitor) apply an edit
 * event in place. "In place" is stated through two laws that hold whatever the
 * events are: the message ids keep their count and order (conservation), and
 * every message other than the edited one is untouched.
 */
import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import {
  agentEventChangesInboxList,
  applyAgentThreadEvent,
  applyTicketThreadEvent,
  applyVisitorThreadEvent,
  type AgentThreadCache,
  type TicketThreadCache,
  type VisitorThreadCache,
} from '../events-reducer'
import type {
  AgentConversationMessageDTO,
  ConversationDTO,
  ConversationMessageDTO,
  ConversationStreamEvent,
} from '@/lib/shared/conversation/types'

const CONVERSATION_ID = 'conversation_1' as ConversationDTO['id']
const TICKET_ID = 'ticket_1' as never
const EDIT_STAMP = '2026-07-02T12:00:00.000Z'

type SenderType = 'visitor' | 'agent' | 'system'

function agentMessage(index: number, senderType: SenderType): AgentConversationMessageDTO {
  return {
    id: `conversation_msg_${index}` as AgentConversationMessageDTO['id'],
    conversationId: CONVERSATION_ID,
    ticketId: null,
    senderType,
    content: `original ${index}`,
    createdAt: `2026-07-01T00:00:0${index}.000Z`,
    editedAt: null,
    author: {
      principalId: `principal_${index}` as never,
      displayName: `P${index}`,
      avatarUrl: null,
    },
    attachments: [],
    citations: [],
    isAssistant: false,
    isInternal: false,
    contentJson: null,
    viaEmail: false,
    systemEvent: null,
    reactions: [{ emoji: '👍', count: 1, hasReacted: true, reactors: [] }] as never,
    flaggedAt: '2026-07-01T05:00:00.000Z',
    postSuggestion: null,
    translatedFrom: null,
  }
}

function visitorMessage(index: number, senderType: SenderType): ConversationMessageDTO {
  const { reactions, flaggedAt, postSuggestion, translatedFrom, ...base } = agentMessage(
    index,
    senderType
  )
  void reactions
  void flaggedAt
  void postSuggestion
  void translatedFrom
  return base
}

const sendersArb = fc.array(fc.constantFrom<SenderType>('visitor', 'agent', 'system'), {
  minLength: 1,
  maxLength: 8,
})

/** A generated thread plus the position of the message an edit will target. */
const threadArb = sendersArb.chain((senders) =>
  fc.record({ senders: fc.constant(senders), edited: fc.nat({ max: senders.length - 1 }) })
)

function agentCache(senders: SenderType[]): AgentThreadCache {
  return {
    conversation: { id: CONVERSATION_ID } as ConversationDTO,
    messages: senders.map((sender, index) => agentMessage(index, sender)),
    hasMore: false,
  }
}

function ids(messages: { id: string }[]): string[] {
  return messages.map((m) => m.id)
}

describe('inbox conversation thread applies message_updated edits in place (G3)', () => {
  it('keeps the order and changes only the edited message body and mark (G3)', () => {
    fc.assert(
      fc.property(threadArb, fc.string({ minLength: 1 }), ({ senders, edited }, newBody) => {
        const prev = agentCache(senders)
        const target = prev.messages[edited]
        const incoming = { ...target, content: newBody, editedAt: EDIT_STAMP }
        const next = applyAgentThreadEvent(
          prev,
          { kind: 'message_updated', conversationId: CONVERSATION_ID, message: incoming },
          CONVERSATION_ID
        )!

        expect(ids(next.messages)).toEqual(ids(prev.messages))
        expect(next.messages[edited].content).toBe(newBody)
        expect(next.messages[edited].editedAt).toBe(EDIT_STAMP)
        expect(next.messages[edited]).toEqual({ ...target, content: newBody, editedAt: EDIT_STAMP })
        next.messages.forEach((message, index) => {
          if (index !== edited) expect(message).toBe(prev.messages[index])
        })
      })
    )
  })

  it('an edit for an unknown message leaves the thread as it was, not appended (G3)', () => {
    fc.assert(
      fc.property(sendersArb, (senders) => {
        const prev = agentCache(senders)
        const stranger = {
          ...agentMessage(99, 'agent'),
          content: 'edit of something not loaded',
          editedAt: EDIT_STAMP,
        }
        const next = applyAgentThreadEvent(
          prev,
          { kind: 'message_updated', conversationId: CONVERSATION_ID, message: stranger },
          CONVERSATION_ID
        )
        expect(next).toBe(prev)
      })
    )
  })

  it('an edit announced for another conversation changes nothing (G3)', () => {
    const prev = agentCache(['agent', 'visitor'])
    const edit = { ...prev.messages[0], content: 'elsewhere', editedAt: EDIT_STAMP }
    const next = applyAgentThreadEvent(
      prev,
      {
        kind: 'message_updated',
        conversationId: 'conversation_other' as ConversationDTO['id'],
        message: edit,
      },
      CONVERSATION_ID
    )
    expect(next).toBe(prev)
  })

  it('any sequence of edits keeps the message count and id order (G3, conservation)', () => {
    fc.assert(
      fc.property(
        sendersArb,
        fc.array(fc.tuple(fc.nat({ max: 12 }), fc.string()), { maxLength: 12 }),
        (senders, edits) => {
          const start = agentCache(senders)
          let cache: AgentThreadCache | undefined = start
          for (const [position, body] of edits) {
            const message = {
              ...agentMessage(position, 'agent'),
              content: body,
              editedAt: EDIT_STAMP,
            }
            cache = applyAgentThreadEvent(
              cache,
              { kind: 'message_updated', conversationId: CONVERSATION_ID, message },
              CONVERSATION_ID
            )
          }
          expect(ids(cache!.messages)).toEqual(ids(start.messages))
        }
      )
    )
  })

  it('an editor keeps their own reaction and flag when another teammate edits (G3)', () => {
    const prev = agentCache(['agent'])
    const incoming = {
      ...prev.messages[0],
      content: 'by someone else',
      editedAt: EDIT_STAMP,
      reactions: [{ emoji: '👍', count: 1, hasReacted: false, reactors: [] }] as never,
      flaggedAt: null,
    }
    const next = applyAgentThreadEvent(
      prev,
      { kind: 'message_updated', conversationId: CONVERSATION_ID, message: incoming },
      CONVERSATION_ID
    )!
    expect(next.messages[0].reactions[0].hasReacted).toBe(true)
    expect(next.messages[0].flaggedAt).toBe(prev.messages[0].flaggedAt)
  })
})

describe('ticket thread applies ticket_message_updated edits live (G3, G4)', () => {
  function ticketCache(senders: SenderType[]): TicketThreadCache {
    return {
      messages: senders.map((sender, index) => ({
        ...agentMessage(index, sender),
        conversationId: null,
        ticketId: TICKET_ID,
        translatedFrom: { language: 'fr', original: 'bonjour' } as never,
      })),
      hasMore: false,
    }
  }
  function editEvent(
    message: ConversationMessageDTO,
    ticketId = TICKET_ID
  ): ConversationStreamEvent {
    return { kind: 'ticket_message_updated', ticketId, message }
  }

  it('shows the new body and mark in the same place, touching nothing else (G3, G4)', () => {
    fc.assert(
      fc.property(threadArb, fc.string({ minLength: 1 }), ({ senders, edited }, newBody) => {
        const prev = ticketCache(senders)
        const target = prev.messages[edited]
        const next = applyTicketThreadEvent(
          prev,
          editEvent({
            ...visitorMessage(edited, senders[edited]),
            content: newBody,
            editedAt: EDIT_STAMP,
          }),
          TICKET_ID
        )!

        expect(ids(next.messages)).toEqual(ids(prev.messages))
        expect(next.messages[edited].content).toBe(newBody)
        expect(next.messages[edited].editedAt).toBe(EDIT_STAMP)
        // The viewer's own reaction state is not the broadcaster's to replace.
        expect(next.messages[edited].reactions).toEqual(target.reactions)
        expect(next.messages[edited].flaggedAt).toBe(target.flaggedAt)
        next.messages.forEach((message, index) => {
          if (index !== edited) expect(message).toBe(prev.messages[index])
        })
      })
    )
  })

  it('an edit replaces the sent text, so no pre-translation original is shown for it (G3)', () => {
    const prev = ticketCache(['agent'])
    const next = applyTicketThreadEvent(
      prev,
      editEvent({ ...visitorMessage(0, 'agent'), content: 'new', editedAt: EDIT_STAMP }),
      TICKET_ID
    )!
    expect(next.messages[0].translatedFrom).toBeNull()
  })

  it('an edit of an unknown message, or for another ticket, changes nothing (G3)', () => {
    const prev = ticketCache(['agent', 'visitor'])
    const stranger = { ...visitorMessage(99, 'agent'), content: 'x', editedAt: EDIT_STAMP }
    const unknown = applyTicketThreadEvent(prev, editEvent(stranger), TICKET_ID)!
    expect(ids(unknown.messages)).toEqual(ids(prev.messages))
    expect(unknown.messages).toEqual(prev.messages)

    const sameIdOtherTicket = { ...visitorMessage(0, 'agent'), content: 'x', editedAt: EDIT_STAMP }
    const other = applyTicketThreadEvent(
      prev,
      editEvent(sameIdOtherTicket, 'ticket_other' as never),
      TICKET_ID
    )
    expect(other).toBe(prev)
  })

  it('any sequence of edits keeps the message count and id order (G3, conservation)', () => {
    fc.assert(
      fc.property(
        sendersArb,
        fc.array(fc.tuple(fc.nat({ max: 12 }), fc.string()), { maxLength: 12 }),
        (senders, edits) => {
          const start = ticketCache(senders)
          let cache: TicketThreadCache | undefined = start
          for (const [position, body] of edits) {
            const message = {
              ...visitorMessage(position, 'agent'),
              content: body,
              editedAt: EDIT_STAMP,
            }
            cache = applyTicketThreadEvent(cache, editEvent(message), TICKET_ID)
          }
          expect(ids(cache!.messages)).toEqual(ids(start.messages))
        }
      )
    )
  })

  it('a body edit can change the inbox row preview; a reaction or flag cannot (G4)', () => {
    const message = visitorMessage(0, 'agent')
    expect(
      agentEventChangesInboxList({ kind: 'ticket_message_updated', ticketId: TICKET_ID, message })
    ).toBe(true)
    expect(
      agentEventChangesInboxList({
        kind: 'message_updated',
        conversationId: CONVERSATION_ID,
        message: agentMessage(0, 'agent'),
      })
    ).toBe(false)
  })
})

describe('the customer thread applies message_edited and nothing agent-only (G3, G4)', () => {
  function visitorCache(senders: SenderType[]): VisitorThreadCache {
    return {
      messages: senders.map((sender, index) => visitorMessage(index, sender)),
      hasMore: false,
      agentLastReadAt: null,
      status: 'open',
      csatRating: null,
    }
  }
  function edited(message: ConversationMessageDTO): ConversationStreamEvent {
    return { kind: 'message_edited', conversationId: CONVERSATION_ID, message }
  }

  it('shows the new body with the mark in the same place, touching nothing else (G3, G4)', () => {
    fc.assert(
      fc.property(
        threadArb,
        fc.string({ minLength: 1 }),
        ({ senders, edited: position }, newBody) => {
          const prev = visitorCache(senders)
          const next = applyVisitorThreadEvent(
            prev,
            edited({ ...prev.messages[position], content: newBody, editedAt: EDIT_STAMP }),
            CONVERSATION_ID
          )!

          expect(ids(next.messages)).toEqual(ids(prev.messages))
          expect(next.messages[position].content).toBe(newBody)
          expect(next.messages[position].editedAt).toBe(EDIT_STAMP)
          next.messages.forEach((message, index) => {
            if (index !== position) expect(message).toBe(prev.messages[index])
          })
        }
      )
    )
  })

  it('an edit event without a timestamp clears the mark rather than keeping a stale one (G3)', () => {
    const prev = visitorCache(['agent'])
    prev.messages[0] = { ...prev.messages[0], editedAt: EDIT_STAMP }
    const next = applyVisitorThreadEvent(
      prev,
      edited({ ...prev.messages[0], editedAt: undefined }),
      CONVERSATION_ID
    )!
    expect(next.messages[0].editedAt).toBeNull()
  })

  it('an edit of a message the customer never loaded is not appended (G3, G4)', () => {
    const prev = visitorCache(['agent', 'visitor'])
    const note = { ...visitorMessage(99, 'agent'), isInternal: true, editedAt: EDIT_STAMP }
    expect(applyVisitorThreadEvent(prev, edited(note), CONVERSATION_ID)).toBe(prev)
  })

  it('the agent-side message_updated frame never changes the customer thread (G4)', () => {
    fc.assert(
      fc.property(threadArb, fc.boolean(), ({ senders, edited: position }, isNote) => {
        const prev = visitorCache(senders)
        const frame: ConversationStreamEvent = {
          kind: 'message_updated',
          conversationId: CONVERSATION_ID,
          message: {
            ...agentMessage(position, 'agent'),
            isInternal: isNote,
            content: 'internal wording',
            editedAt: EDIT_STAMP,
          },
        }
        expect(applyVisitorThreadEvent(prev, frame, CONVERSATION_ID)).toBe(prev)
      })
    )
  })

  it('any sequence of edits keeps the message count and id order (G3, conservation)', () => {
    fc.assert(
      fc.property(
        sendersArb,
        fc.array(fc.tuple(fc.nat({ max: 12 }), fc.string()), { maxLength: 12 }),
        (senders, edits) => {
          const start = visitorCache(senders)
          let cache: VisitorThreadCache | undefined = start
          for (const [position, body] of edits) {
            const message = {
              ...visitorMessage(position, 'agent'),
              content: body,
              editedAt: EDIT_STAMP,
            }
            cache = applyVisitorThreadEvent(cache, edited(message), CONVERSATION_ID)
          }
          expect(ids(cache!.messages)).toEqual(ids(start.messages))
        }
      )
    )
  })
})
