/**
 * Editing and deleting your own support messages, against real Postgres:
 * what the edit changes, who hears about it, and what a refusal leaves behind.
 *
 * Contract for upstream batch G (#580, `ccf8f0521`, "edit and delete your own
 * support messages") — the confirmed list, server half:
 *
 *   G1  A teammate can edit the body of a message they wrote themselves,
 *       whether a reply or an internal note, on a conversation or a ticket, as
 *       long as they still hold the permission that writes that kind of
 *       message.
 *   G2  Nobody can edit a message someone else wrote, a customer's message, a
 *       system message, a message from the AI assistant, or a structured
 *       message, and that includes moderators.
 *   G3  An edited message keeps its place in the thread and carries an
 *       "(edited)" mark; saving an unchanged body is not an edit and leaves no
 *       mark. (Server half: `editedAt` is set on a real edit and untouched on
 *       an unchanged save, and the row keeps its id, createdAt and position.)
 *   G4  An edit to a customer-visible message reaches the customer's widget and
 *       the ticket thread live; an edit to an internal note never reaches the
 *       customer. (Server half: what is published, and to which channel.)
 *   G5  If the edited message is the conversation's latest customer-visible
 *       message, the inbox preview shows the new text.
 *   G6  Mentions in an edited internal note are recomputed: a newly mentioned
 *       teammate is notified, and a removed mention no longer counts.
 *   G7  An edit is refused while the original is still being delivered; a
 *       message mirrored to GitHub updates its GitHub comment first, and if
 *       that fails the message stays unchanged. An email that was already sent
 *       is not changed.
 *   G8  An edit to a customer-visible message emits a "message updated"
 *       webhook; an edit to an internal note does not.
 *   G9  Edited content is sanitised like new content.
 *   G10 A teammate who cannot see the conversation or ticket is told the
 *       message does not exist, not that they lack permission.
 *   G11 A teammate can delete their own message while they hold the permission
 *       that writes it; a moderator can delete any message that is not a system
 *       message; a customer can delete their own message in their own
 *       conversation; nobody can delete a system message.
 *   G12 A teammate without moderator rights can no longer delete a message
 *       someone else wrote, on conversations and on tickets alike.
 *   G13 A service principal (API key) never counts as the author of a message.
 *
 * The decision table behind G1, G2, G11, G12 and G13 is swept over every
 * actor and message in `policy/__tests__/message-edit-delete.contract.test.ts`;
 * this suite runs the real edit and delete paths, so it also pins what a
 * refusal leaves in the database.
 *
 * Real Postgres inside the rollback fixture. Realtime is observed at the
 * pub/sub boundary (channel name plus payload), webhooks and note-mention
 * notifications at the event dispatcher, the GitHub comment write at the
 * GitHub client; everything between is the production code.
 *
 * Generators: G3 draws body text made of one to five lowercase words, so an
 * "unchanged" save and a "changed" save are both always reachable and the text
 * is never blank (a blank body is refused by an unrelated rule).
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest'
import fc from 'fast-check'
import {
  createId,
  type ConversationId,
  type ConversationMessageId,
  type PrincipalId,
  type TicketId,
  type TicketStatusId,
  type UserId,
} from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import {
  conversations,
  conversationMessages,
  conversationMessageMentions,
  ticketConversations,
  tickets,
  ticketStatuses,
  principal,
  user,
  eq,
  asc,
} from '@/lib/server/db'
import { PERMISSIONS, type PermissionKey } from '@/lib/shared/permissions'
import { ForbiddenError, NotFoundError, ValidationError } from '@/lib/shared/errors'
import type { Actor } from '@/lib/server/policy/types'
import type { TiptapContent } from '@/lib/shared/db-types'
import type { ConversationMessageMetadata } from '@/lib/server/db'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

const published = vi.hoisted(() => ({
  frames: [] as Array<{ channel: string; payload: Record<string, unknown> }>,
}))

vi.mock('@/lib/server/realtime/pubsub', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/realtime/pubsub')>()),
  publish: (channel: string, payload: Record<string, unknown>) => {
    published.frames.push({ channel, payload })
  },
}))

const events = vi.hoisted(() => ({
  messageUpdated: vi.fn(async (..._args: unknown[]) => {}),
  messageDeleted: vi.fn(async (..._args: unknown[]) => {}),
  noteMentioned: vi.fn(async (..._args: unknown[]) => {}),
}))

vi.mock('@/lib/server/events/dispatch', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/events/dispatch')>()),
  dispatchMessageUpdated: events.messageUpdated,
  dispatchMessageDeleted: events.messageDeleted,
  dispatchConversationNoteMentioned: events.noteMentioned,
}))

const assistant = vi.hoisted(() => ({ principalId: null as string | null }))

vi.mock('@/lib/server/messages/assistant-principal', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/messages/assistant-principal')>()),
  assistantPrincipalIdOnce: async () => assistant.principalId,
}))

const github = vi.hoisted(() => ({
  updateComment: vi.fn(async (..._args: unknown[]) => {}),
  deleteComment: vi.fn(async (..._args: unknown[]) => {}),
}))

vi.mock('@/lib/server/domains/channels/github-deliver', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/domains/channels/github-deliver')>()),
  updateGitHubIssueComment: github.updateComment,
  deleteGitHubIssueComment: github.deleteComment,
}))

const email = vi.hoisted(() => ({ send: vi.fn(async (..._args: unknown[]) => {}) }))

vi.mock('@/lib/server/domains/conversation/conversation.notify', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('@/lib/server/domains/conversation/conversation.notify')
  >()),
  sendVisitorConversationEmail: email.send,
}))

import { editConversationMessage } from '../conversation.edit'
import { deleteConversationMessage } from '../conversation.service'
import { sanitizeTiptapContent } from '@/lib/server/sanitize-tiptap'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db
      .select({ editedAt: conversationMessages.editedAt, metadata: conversationMessages.metadata })
      .from(conversationMessages)
      .limit(0)
    await db.select({ preview: conversations.lastMessagePreview }).from(conversations).limit(0)
    await db.select({ ticketId: ticketConversations.ticketId }).from(ticketConversations).limit(0)
    await db
      .select({ id: conversationMessageMentions.id })
      .from(conversationMessageMentions)
      .limit(0)
  },
})

// ---- Seeding ---------------------------------------------------------------

const runSuffix = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

type SeededRole = 'admin' | 'member' | 'user'

async function seedPrincipal(
  role: SeededRole,
  type: 'user' | 'service' = 'user'
): Promise<PrincipalId> {
  const principalId = createId('principal') as PrincipalId
  if (type === 'service') {
    await testDb.insert(principal).values({
      id: principalId,
      role,
      type,
      displayName: 'API key',
      createdAt: new Date(),
    })
    return principalId
  }
  const userId = createId('user') as UserId
  await testDb
    .insert(user)
    .values({ id: userId, name: `${role} ${runSuffix()}`, email: `${runSuffix()}@example.com` })
  await testDb.insert(principal).values({
    id: principalId,
    userId,
    role,
    type,
    displayName: `${role} ${runSuffix()}`,
    createdAt: new Date(),
  })
  return principalId
}

const ALL_WRITE_PERMISSIONS: PermissionKey[] = [
  PERMISSIONS.CONVERSATION_REPLY,
  PERMISSIONS.CONVERSATION_NOTE,
  PERMISSIONS.TICKET_REPLY,
  PERMISSIONS.TICKET_NOTE,
]

const CAN_SEE_EVERYTHING: PermissionKey[] = [
  PERMISSIONS.CONVERSATION_VIEW,
  PERMISSIONS.TICKET_VIEW_ALL,
]

function teammate(principalId: PrincipalId, held: PermissionKey[]): Actor {
  return {
    principalId,
    role: 'member',
    principalType: 'user',
    segmentIds: new Set(),
    permissions: new Set(held),
  }
}

function customer(principalId: PrincipalId): Actor {
  return {
    principalId,
    role: 'user',
    principalType: 'user',
    segmentIds: new Set(),
    permissions: new Set(),
  }
}

async function seedConversation(
  visitorPrincipalId: PrincipalId,
  channel: 'messenger' | 'email' | 'github' = 'messenger'
): Promise<ConversationId> {
  const id = createId('conversation') as ConversationId
  await testDb.insert(conversations).values({ id, visitorPrincipalId, channel })
  return id
}

async function seedTicket(): Promise<TicketId> {
  const statusId = createId('ticket_status') as TicketStatusId
  await testDb.insert(ticketStatuses).values({
    id: statusId,
    name: 'Open',
    slug: `open-${runSuffix()}`,
    category: 'open',
  })
  const id = createId('ticket') as TicketId
  await testDb.insert(tickets).values({ id, title: 'Ticket', statusId })
  return id
}

type Parent = { conversationId: ConversationId } | { ticketId: TicketId }

interface MessageSeed {
  senderType?: 'visitor' | 'agent' | 'system'
  authorId: PrincipalId | null
  isInternal?: boolean
  content?: string
  contentJson?: TiptapContent | null
  metadata?: ConversationMessageMetadata | null
}

let clock = 0

async function seedMessage(parent: Parent, seed: MessageSeed): Promise<ConversationMessageId> {
  clock += 1
  const id = createId('conversation_message') as ConversationMessageId
  await testDb.insert(conversationMessages).values({
    id,
    ...parent,
    principalId: seed.authorId,
    senderType: seed.senderType ?? 'agent',
    isInternal: seed.isInternal ?? false,
    content: seed.content ?? 'original body',
    contentJson: seed.contentJson ?? null,
    metadata: seed.metadata ?? null,
    createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, clock)),
  })
  return id
}

async function rowOf(messageId: ConversationMessageId) {
  const [row] = await testDb
    .select()
    .from(conversationMessages)
    .where(eq(conversationMessages.id, messageId))
  return row
}

async function threadOrder(parent: Parent): Promise<string[]> {
  const where =
    'conversationId' in parent
      ? eq(conversationMessages.conversationId, parent.conversationId)
      : eq(conversationMessages.ticketId, parent.ticketId)
  const rows = await testDb
    .select({ id: conversationMessages.id })
    .from(conversationMessages)
    .where(where)
    .orderBy(asc(conversationMessages.createdAt), asc(conversationMessages.id))
  return rows.map((row) => row.id)
}

function docWithText(text: string): TiptapContent {
  return {
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
  } as TiptapContent
}

function docMentioning(principalIds: PrincipalId[], text = 'note'): TiptapContent {
  const mentions = principalIds.map((id) => ({ type: 'mention', attrs: { id, label: 'Teammate' } }))
  return {
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text: `${text} ` }, ...mentions] }],
  } as TiptapContent
}

async function waitForTicks(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 25))
}

function framesOn(channel: string) {
  return published.frames.filter((frame) => frame.channel === channel)
}

const visitorChannel = (id: ConversationId) => `conversation:${id}`
const ticketChannelOf = (id: TicketId) => `ticket:${id}`

async function failureOf(attempt: Promise<unknown>): Promise<unknown> {
  try {
    await attempt
  } catch (error) {
    return error
  }
  throw new Error('expected the call to be refused, but it succeeded')
}

describe.skipIf(!fixture.available)('editing and deleting your own support messages', () => {
  beforeEach(async () => {
    await fixture.begin()
    published.frames.length = 0
    events.messageUpdated.mockClear()
    events.messageDeleted.mockClear()
    events.noteMentioned.mockClear()
    github.updateComment.mockReset()
    github.updateComment.mockResolvedValue(undefined)
    github.deleteComment.mockClear()
    email.send.mockClear()
    assistant.principalId = null
  })
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  // ---------------------------------------------------------------------------
  describe('who can edit (G1, G2, G13)', () => {
    const KINDS: Array<{
      label: string
      parent: 'conversation' | 'ticket'
      isInternal: boolean
      permission: PermissionKey
    }> = [
      {
        label: 'a conversation reply',
        parent: 'conversation',
        isInternal: false,
        permission: PERMISSIONS.CONVERSATION_REPLY,
      },
      {
        label: 'a conversation note',
        parent: 'conversation',
        isInternal: true,
        permission: PERMISSIONS.CONVERSATION_NOTE,
      },
      {
        label: 'a ticket reply',
        parent: 'ticket',
        isInternal: false,
        permission: PERMISSIONS.TICKET_REPLY,
      },
      {
        label: 'a ticket note',
        parent: 'ticket',
        isInternal: true,
        permission: PERMISSIONS.TICKET_NOTE,
      },
    ]

    async function seedOwnMessage(kind: (typeof KINDS)[number], authorId: PrincipalId) {
      const visitor = await seedPrincipal('user')
      const parent: Parent =
        kind.parent === 'conversation'
          ? { conversationId: await seedConversation(visitor) }
          : { ticketId: await seedTicket() }
      const messageId = await seedMessage(parent, { authorId, isInternal: kind.isInternal })
      return { parent, messageId }
    }

    for (const kind of KINDS) {
      it(`lets a teammate edit their own ${kind.label} while they hold the permission that writes it (G1)`, async () => {
        const author = await seedPrincipal('member')
        const { messageId } = await seedOwnMessage(kind, author)
        const actor = teammate(author, [...CAN_SEE_EVERYTHING, kind.permission])

        const dto = await editConversationMessage(messageId, 'rewritten body', null, actor)

        expect(dto.content).toBe('rewritten body')
        expect((await rowOf(messageId)).content).toBe('rewritten body')
      })

      it(`refuses the author of ${kind.label} once they lose the permission that writes it, and changes nothing (G1)`, async () => {
        const author = await seedPrincipal('member')
        const { messageId } = await seedOwnMessage(kind, author)
        const everythingButIt = ALL_WRITE_PERMISSIONS.filter((p) => p !== kind.permission)
        const actor = teammate(author, [...CAN_SEE_EVERYTHING, ...everythingButIt])
        const before = await rowOf(messageId)

        const error = await failureOf(
          editConversationMessage(messageId, 'rewritten body', null, actor)
        )

        expect(error).toBeInstanceOf(ForbiddenError)
        expect(await rowOf(messageId)).toEqual(before)
      })
    }

    it("refuses a moderator who tries to edit a teammate's message (G2)", async () => {
      const author = await seedPrincipal('member')
      const moderatorId = await seedPrincipal('admin')
      const visitor = await seedPrincipal('user')
      const conversationId = await seedConversation(visitor)
      const messageId = await seedMessage({ conversationId }, { authorId: author })
      const moderator = teammate(moderatorId, [
        ...CAN_SEE_EVERYTHING,
        ...ALL_WRITE_PERMISSIONS,
        PERMISSIONS.CONVERSATION_MANAGE,
      ])
      const before = await rowOf(messageId)

      const error = await failureOf(
        editConversationMessage(messageId, 'rewritten body', null, moderator)
      )

      expect(error).toBeInstanceOf(ForbiddenError)
      expect(await rowOf(messageId)).toEqual(before)
    })

    it('refuses an agent message that has no author (G2)', async () => {
      const someone = await seedPrincipal('member')
      const visitor = await seedPrincipal('user')
      const conversationId = await seedConversation(visitor)
      const messageId = await seedMessage({ conversationId }, { authorId: null })
      const actor = teammate(someone, [...CAN_SEE_EVERYTHING, ...ALL_WRITE_PERMISSIONS])

      const error = await failureOf(
        editConversationMessage(messageId, 'rewritten body', null, actor)
      )

      expect(error).toBeInstanceOf(ForbiddenError)
    })

    it("refuses a customer's message, even to the customer who wrote it and even to a teammate holding that principal id (G2)", async () => {
      const visitor = await seedPrincipal('user')
      const conversationId = await seedConversation(visitor)
      const messageId = await seedMessage(
        { conversationId },
        { senderType: 'visitor', authorId: visitor }
      )
      const theCustomer = customer(visitor)
      const teammateWithSameId = teammate(visitor, [
        ...CAN_SEE_EVERYTHING,
        ...ALL_WRITE_PERMISSIONS,
      ])
      const before = await rowOf(messageId)

      const byCustomer = await failureOf(
        editConversationMessage(messageId, 'rewritten', null, theCustomer)
      )
      const byTeammate = await failureOf(
        editConversationMessage(messageId, 'rewritten', null, teammateWithSameId)
      )

      expect(byCustomer).toBeInstanceOf(ForbiddenError)
      expect(byTeammate).toBeInstanceOf(ForbiddenError)
      expect(await rowOf(messageId)).toEqual(before)
    })

    it('refuses a system message (G2)', async () => {
      const someone = await seedPrincipal('admin')
      const visitor = await seedPrincipal('user')
      const conversationId = await seedConversation(visitor)
      const messageId = await seedMessage(
        { conversationId },
        { senderType: 'system', authorId: someone }
      )
      const actor = teammate(someone, [
        ...CAN_SEE_EVERYTHING,
        ...ALL_WRITE_PERMISSIONS,
        PERMISSIONS.CONVERSATION_MANAGE,
      ])
      const before = await rowOf(messageId)

      const error = await failureOf(editConversationMessage(messageId, 'rewritten', null, actor))

      expect(error).toBeInstanceOf(ForbiddenError)
      expect(await rowOf(messageId)).toEqual(before)
    })

    it("refuses a message from the AI assistant, even to the assistant's own principal (G2)", async () => {
      const assistantId = await seedPrincipal('member', 'service')
      assistant.principalId = assistantId
      const visitor = await seedPrincipal('user')
      const conversationId = await seedConversation(visitor)
      const messageId = await seedMessage({ conversationId }, { authorId: assistantId })
      const asAssistant = teammate(assistantId, [...CAN_SEE_EVERYTHING, ...ALL_WRITE_PERMISSIONS])
      const before = await rowOf(messageId)

      const error = await failureOf(
        editConversationMessage(messageId, 'rewritten', null, asAssistant)
      )

      expect(error).toBeInstanceOf(ForbiddenError)
      expect(await rowOf(messageId)).toEqual(before)
    })

    it('refuses a structured message, even to the teammate who sent it (G2)', async () => {
      const author = await seedPrincipal('member')
      const visitor = await seedPrincipal('user')
      const conversationId = await seedConversation(visitor)
      const messageId = await seedMessage(
        { conversationId },
        {
          authorId: author,
          metadata: {
            block: { kind: 'card', title: 'Pick one' },
          } as unknown as ConversationMessageMetadata,
        }
      )
      const actor = teammate(author, [...CAN_SEE_EVERYTHING, ...ALL_WRITE_PERMISSIONS])
      const before = await rowOf(messageId)

      const error = await failureOf(editConversationMessage(messageId, 'rewritten', null, actor))

      expect(error).toBeInstanceOf(ForbiddenError)
      expect(await rowOf(messageId)).toEqual(before)
    })

    it('never counts a service principal as the author, on a conversation or a ticket (G13)', async () => {
      const serviceId = await seedPrincipal('admin', 'service')
      const visitor = await seedPrincipal('user')
      const conversationId = await seedConversation(visitor)
      const ticketId = await seedTicket()
      const onConversation = await seedMessage({ conversationId }, { authorId: serviceId })
      const onTicket = await seedMessage({ ticketId }, { authorId: serviceId })
      const apiKey: Actor = {
        principalId: serviceId,
        role: 'admin',
        principalType: 'service',
        segmentIds: new Set(),
        permissions: new Set([...CAN_SEE_EVERYTHING, ...ALL_WRITE_PERMISSIONS]),
      }

      for (const messageId of [onConversation, onTicket]) {
        const before = await rowOf(messageId)
        const error = await failureOf(editConversationMessage(messageId, 'rewritten', null, apiKey))
        expect(error).toBeInstanceOf(ForbiddenError)
        expect(await rowOf(messageId)).toEqual(before)
      }
    })

    it('refuses a request with no signed-in principal (G2)', async () => {
      const author = await seedPrincipal('member')
      const visitor = await seedPrincipal('user')
      const conversationId = await seedConversation(visitor)
      const messageId = await seedMessage({ conversationId }, { authorId: author })
      const nobody: Actor = {
        principalId: null,
        role: null,
        principalType: 'anonymous',
        segmentIds: new Set(),
        permissions: new Set(),
      }

      const error = await failureOf(editConversationMessage(messageId, 'rewritten', null, nobody))

      expect(error).toBeInstanceOf(ForbiddenError)
    })

    it('treats a deleted message like one that never existed (G2)', async () => {
      const author = await seedPrincipal('member')
      const visitor = await seedPrincipal('user')
      const conversationId = await seedConversation(visitor)
      const messageId = await seedMessage({ conversationId }, { authorId: author })
      await testDb
        .update(conversationMessages)
        .set({ deletedAt: new Date() })
        .where(eq(conversationMessages.id, messageId))
      const actor = teammate(author, [...CAN_SEE_EVERYTHING, ...ALL_WRITE_PERMISSIONS])

      const error = await failureOf(editConversationMessage(messageId, 'rewritten', null, actor))

      expect(error).toBeInstanceOf(NotFoundError)
    })
  })

  // ---------------------------------------------------------------------------
  describe('what an edit changes (G3, G9)', () => {
    async function seedReply(content = 'original body') {
      const author = await seedPrincipal('member')
      const visitor = await seedPrincipal('user')
      const conversationId = await seedConversation(visitor)
      const first = await seedMessage(
        { conversationId },
        { senderType: 'visitor', authorId: visitor }
      )
      const messageId = await seedMessage({ conversationId }, { authorId: author, content })
      const last = await seedMessage(
        { conversationId },
        { senderType: 'visitor', authorId: visitor }
      )
      const actor = teammate(author, [...CAN_SEE_EVERYTHING, ...ALL_WRITE_PERMISSIONS])
      return { actor, conversationId, messageId, thread: [first, messageId, last] }
    }

    it('marks the message edited and keeps its id, creation time and place in the thread (G3)', async () => {
      const { actor, conversationId, messageId } = await seedReply()
      const before = await rowOf(messageId)
      const orderBefore = await threadOrder({ conversationId })

      await editConversationMessage(messageId, 'a different body', null, actor)

      const after = await rowOf(messageId)
      expect(after.id).toBe(before.id)
      expect(after.createdAt).toEqual(before.createdAt)
      expect(after.editedAt).toBeInstanceOf(Date)
      expect(before.editedAt).toBeNull()
      expect(await threadOrder({ conversationId })).toEqual(orderBefore)
    })

    it('does not mark an unchanged body as edited, and changes nothing (G3)', async () => {
      const { actor, messageId } = await seedReply('same words')
      const before = await rowOf(messageId)

      await editConversationMessage(messageId, 'same words', null, actor)

      expect(await rowOf(messageId)).toEqual(before)
    })

    it('does not mark a plain message as edited when it is saved untouched from the rich editor (G3)', async () => {
      const { actor, messageId } = await seedReply('same words')
      const before = await rowOf(messageId)

      await editConversationMessage(messageId, 'same words', docWithText('same words'), actor)

      const after = await rowOf(messageId)
      expect(after.editedAt).toBeNull()
      expect(after.content).toBe(before.content)
    })

    it('marks an edit only when the text really changed, for any body (G3)', async () => {
      const words = fc
        .array(fc.stringMatching(/^[a-z]{1,8}$/), { minLength: 1, maxLength: 5 })
        .map((list) => list.join(' '))
      const { actor, conversationId } = await seedReply()
      const author = actor.principalId as PrincipalId

      await fc.assert(
        fc.asyncProperty(words, words, async (original, saved) => {
          const messageId = await seedMessage(
            { conversationId },
            { authorId: author, content: original }
          )

          await editConversationMessage(messageId, saved, null, actor)

          const after = await rowOf(messageId)
          expect(after.editedAt !== null).toBe(saved !== original)
          expect(after.content).toBe(saved)
          expect(after.content === original).toBe(after.editedAt === null)
        }),
        { numRuns: 25 }
      )
    })

    it('keeps what else is attached to the message, and answers with it, when the body is edited (G3)', async () => {
      const author = await seedPrincipal('member')
      const visitor = await seedPrincipal('user')
      const conversationId = await seedConversation(visitor)
      const suggestion = { boardId: 'board_1', title: 'Dark mode', content: 'Please add it' }
      const pendingAction = { pendingActionId: 'pending_1', toolName: 'close', summary: 'Close it' }
      const messageId = await seedMessage(
        { conversationId },
        {
          authorId: author,
          isInternal: true,
          metadata: { postSuggestion: suggestion, assistantPendingAction: pendingAction },
        }
      )
      const actor = teammate(author, [...CAN_SEE_EVERYTHING, ...ALL_WRITE_PERMISSIONS])

      const dto = await editConversationMessage(messageId, 'reworded', null, actor)

      expect(dto.postSuggestion).toEqual(suggestion)
      expect(dto.assistantPendingAction).toEqual(pendingAction)
      expect((await rowOf(messageId)).metadata).toEqual({
        postSuggestion: suggestion,
        assistantPendingAction: pendingAction,
      })
    })

    it('stops presenting an edited message as a translation of its original, and keeps the rest (G3)', async () => {
      const author = await seedPrincipal('member')
      const visitor = await seedPrincipal('user')
      const conversationId = await seedConversation(visitor)
      const translatedFrom = { originalContent: 'Hello', sourceLocale: 'en', targetLocale: 'de' }
      const onlyTranslated = await seedMessage(
        { conversationId },
        { authorId: author, content: 'Hallo', metadata: { translatedFrom } }
      )
      const translatedAndMirrored = await seedMessage(
        { conversationId },
        { authorId: author, content: 'Hallo', metadata: { translatedFrom, githubCommentId: '9' } }
      )
      const actor = teammate(author, [...CAN_SEE_EVERYTHING, ...ALL_WRITE_PERMISSIONS])

      const dto = await editConversationMessage(onlyTranslated, 'Guten Tag', null, actor)
      await editConversationMessage(translatedAndMirrored, 'Guten Tag', null, actor)

      expect(dto.translatedFrom).toBeNull()
      expect((await rowOf(onlyTranslated)).metadata).toBeNull()
      expect((await rowOf(translatedAndMirrored)).metadata).toEqual({ githubCommentId: '9' })
    })

    it('keeps presenting a translated message as a translation when it is saved unchanged (G3)', async () => {
      const author = await seedPrincipal('member')
      const visitor = await seedPrincipal('user')
      const conversationId = await seedConversation(visitor)
      const translatedFrom = { originalContent: 'Hello', sourceLocale: 'en', targetLocale: 'de' }
      const messageId = await seedMessage(
        { conversationId },
        { authorId: author, content: 'Hallo', metadata: { translatedFrom } }
      )
      const actor = teammate(author, [...CAN_SEE_EVERYTHING, ...ALL_WRITE_PERMISSIONS])
      const before = await rowOf(messageId)

      const dto = await editConversationMessage(messageId, 'Hallo', null, actor)

      expect(dto.translatedFrom).toEqual(translatedFrom)
      expect(await rowOf(messageId)).toEqual(before)
    })

    it('stores edited rich content sanitised exactly like new content (G9)', async () => {
      const { actor, messageId } = await seedReply()
      const hostile = {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              {
                type: 'text',
                text: 'click me',
                marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }],
              },
            ],
          },
          { type: 'image', attrs: { src: 'https://example.com/a.png', onerror: 'alert(1)' } },
          { type: 'script', content: [{ type: 'text', text: 'alert(1)' }] },
        ],
      } as unknown as TiptapContent

      await editConversationMessage(messageId, 'click me', hostile, actor)

      const stored = (await rowOf(messageId)).contentJson
      expect(stored).toEqual(sanitizeTiptapContent(hostile))
      const storedText = JSON.stringify(stored)
      expect(storedText).not.toContain('javascript:')
      expect(storedText).not.toContain('onerror')
      expect(storedText).not.toContain('"script"')
    })
  })

  // ---------------------------------------------------------------------------
  describe('who hears about an edit (G4, G8)', () => {
    it('sends a customer-visible edit to the visitor, to the ticket thread, to the inbox and to webhooks (G4, G8)', async () => {
      const author = await seedPrincipal('member')
      const visitor = await seedPrincipal('user')
      const conversationId = await seedConversation(visitor)
      const ticketId = await seedTicket()
      await testDb
        .insert(ticketConversations)
        .values({ ticketId, conversationId, ticketType: 'customer' })
      const messageId = await seedMessage({ conversationId }, { authorId: author })
      const actor = teammate(author, [...CAN_SEE_EVERYTHING, ...ALL_WRITE_PERMISSIONS])

      await editConversationMessage(messageId, 'fixed wording', null, actor)
      await vi.waitFor(() => expect(events.messageUpdated).toHaveBeenCalledTimes(1))

      const toVisitor = framesOn(visitorChannel(conversationId))
      const editedFrame = toVisitor.find((frame) => frame.payload.kind === 'message_edited')
      expect(editedFrame).toBeDefined()
      expect(JSON.stringify(editedFrame?.payload)).toContain('fixed wording')

      const toTicket = framesOn(ticketChannelOf(ticketId))
      expect(toTicket.some((frame) => frame.payload.kind === 'ticket_message_updated')).toBe(true)

      const toInbox = framesOn('conversation:inbox')
      expect(toInbox.some((frame) => frame.payload.kind === 'message_updated')).toBe(true)
    })

    it('sends an edit of a ticket reply to the ticket thread and webhooks nothing for a ticket-only message (G4)', async () => {
      const author = await seedPrincipal('member')
      const ticketId = await seedTicket()
      const messageId = await seedMessage({ ticketId }, { authorId: author })
      const actor = teammate(author, [...CAN_SEE_EVERYTHING, ...ALL_WRITE_PERMISSIONS])

      await editConversationMessage(messageId, 'fixed wording', null, actor)

      const toTicket = framesOn(ticketChannelOf(ticketId))
      expect(toTicket.some((frame) => frame.payload.kind === 'ticket_message_updated')).toBe(true)
    })

    it("keeps an edit of an internal note off the customer's channel and out of webhooks (G4, G8)", async () => {
      const author = await seedPrincipal('member')
      const visitor = await seedPrincipal('user')
      const conversationId = await seedConversation(visitor)
      const messageId = await seedMessage(
        { conversationId },
        { authorId: author, isInternal: true }
      )
      const actor = teammate(author, [...CAN_SEE_EVERYTHING, ...ALL_WRITE_PERMISSIONS])

      await editConversationMessage(messageId, 'reworded note', null, actor)
      await waitForTicks()

      expect(framesOn(visitorChannel(conversationId))).toEqual([])
      expect(framesOn('conversation:inbox').length).toBeGreaterThan(0)
      expect(events.messageUpdated).not.toHaveBeenCalled()
    })

    it('does not tell the visitor or webhooks about an edit that was refused (G4, G8)', async () => {
      const author = await seedPrincipal('member')
      const other = await seedPrincipal('member')
      const visitor = await seedPrincipal('user')
      const conversationId = await seedConversation(visitor)
      const messageId = await seedMessage({ conversationId }, { authorId: author })
      const actor = teammate(other, [...CAN_SEE_EVERYTHING, ...ALL_WRITE_PERMISSIONS])

      await failureOf(editConversationMessage(messageId, 'sneaky', null, actor))
      await waitForTicks()

      expect(published.frames).toEqual([])
      expect(events.messageUpdated).not.toHaveBeenCalled()
    })
  })

  // ---------------------------------------------------------------------------
  describe('the inbox preview (G5)', () => {
    async function seedThread() {
      const author = await seedPrincipal('member')
      const visitor = await seedPrincipal('user')
      const conversationId = await seedConversation(visitor)
      await testDb
        .update(conversations)
        .set({ lastMessagePreview: 'preview before' })
        .where(eq(conversations.id, conversationId))
      const customersQuestion = await seedMessage(
        { conversationId },
        { senderType: 'visitor', authorId: visitor, content: 'question' }
      )
      const latestReply = await seedMessage(
        { conversationId },
        { authorId: author, content: 'latest reply' }
      )
      const laterNote = await seedMessage(
        { conversationId },
        { authorId: author, isInternal: true, content: 'later note' }
      )
      const laterSystemLine = await seedMessage(
        { conversationId },
        { senderType: 'system', authorId: null, content: 'assigned to someone' }
      )
      const actor = teammate(author, [...CAN_SEE_EVERYTHING, ...ALL_WRITE_PERMISSIONS])
      return { actor, conversationId, latestReply, laterNote, customersQuestion, laterSystemLine }
    }

    async function previewOf(conversationId: ConversationId) {
      const [row] = await testDb
        .select({ preview: conversations.lastMessagePreview })
        .from(conversations)
        .where(eq(conversations.id, conversationId))
      return row.preview
    }

    it('shows the new text when the edited message is the latest customer-visible one, ignoring later notes and system lines (G5)', async () => {
      const { actor, conversationId, latestReply } = await seedThread()

      await editConversationMessage(latestReply, 'corrected reply', null, actor)

      expect(await previewOf(conversationId)).toBe('corrected reply')
    })

    it('leaves the preview alone when an older customer-visible message is edited (G5)', async () => {
      const { actor, conversationId } = await seedThread()
      const author = actor.principalId as PrincipalId
      const olderReply = await seedMessage(
        { conversationId: conversationId },
        { authorId: author, content: 'older reply' }
      )
      // Place it before the latest reply.
      await testDb
        .update(conversationMessages)
        .set({ createdAt: new Date(Date.UTC(2025, 0, 1)) })
        .where(eq(conversationMessages.id, olderReply))

      await editConversationMessage(olderReply, 'corrected older reply', null, actor)

      expect(await previewOf(conversationId)).toBe('preview before')
    })

    it('leaves the preview alone when an internal note is edited (G5)', async () => {
      const { actor, conversationId, laterNote } = await seedThread()

      await editConversationMessage(laterNote, 'corrected note', null, actor)

      expect(await previewOf(conversationId)).toBe('preview before')
    })
  })

  // ---------------------------------------------------------------------------
  describe('mentions in an edited note (G6)', () => {
    async function seedNoteMentioning(initial: PrincipalId[]) {
      const author = await seedPrincipal('member')
      const visitor = await seedPrincipal('user')
      const conversationId = await seedConversation(visitor)
      const messageId = await seedMessage(
        { conversationId },
        { authorId: author, isInternal: true, contentJson: docMentioning(initial) }
      )
      for (const mentioned of initial) {
        await testDb
          .insert(conversationMessageMentions)
          .values({ conversationMessageId: messageId, principalId: mentioned })
      }
      const actor = teammate(author, [...CAN_SEE_EVERYTHING, ...ALL_WRITE_PERMISSIONS])
      return { actor, messageId, author }
    }

    async function mentionedIn(messageId: ConversationMessageId): Promise<string[]> {
      const rows = await testDb
        .select({ principalId: conversationMessageMentions.principalId })
        .from(conversationMessageMentions)
        .where(eq(conversationMessageMentions.conversationMessageId, messageId))
      return rows.map((row) => row.principalId).sort()
    }

    it('notifies a newly mentioned teammate and drops a mention that was removed (G6)', async () => {
      const stays = await seedPrincipal('member')
      const removed = await seedPrincipal('member')
      const added = await seedPrincipal('member')
      const { actor, messageId } = await seedNoteMentioning([stays, removed])

      await editConversationMessage(
        messageId,
        'note again',
        docMentioning([stays, added], 'note again'),
        actor
      )

      expect(await mentionedIn(messageId)).toEqual([stays, added].sort())
      expect(events.noteMentioned).toHaveBeenCalledTimes(1)
      const [, payload] = events.noteMentioned.mock.calls[0] as [
        unknown,
        { mentionedPrincipalIds: string[] },
      ]
      expect(payload.mentionedPrincipalIds).toEqual([added])
    })

    it('forgets every mention when the edit mentions nobody (G6)', async () => {
      const first = await seedPrincipal('member')
      const second = await seedPrincipal('member')
      const { actor, messageId } = await seedNoteMentioning([first, second])

      await editConversationMessage(
        messageId,
        'no mentions now',
        docWithText('no mentions now'),
        actor
      )

      expect(await mentionedIn(messageId)).toEqual([])
      expect(events.noteMentioned).not.toHaveBeenCalled()
    })

    it('does not notify the author for mentioning themselves (G6)', async () => {
      const { actor, messageId, author } = await seedNoteMentioning([])

      await editConversationMessage(
        messageId,
        'me again',
        docMentioning([author], 'me again'),
        actor
      )

      expect(events.noteMentioned).not.toHaveBeenCalled()
    })
  })

  // ---------------------------------------------------------------------------
  describe('delivery in flight, GitHub and email (G7)', () => {
    it('refuses an edit while the original is still being delivered, and changes nothing (G7)', async () => {
      const author = await seedPrincipal('member')
      const visitor = await seedPrincipal('user')
      const conversationId = await seedConversation(visitor, 'github')
      const messageId = await seedMessage(
        { conversationId },
        {
          authorId: author,
          metadata: {
            channelDelivery: { status: 'pending', channel: 'github', at: new Date().toISOString() },
          },
        }
      )
      const actor = teammate(author, [...CAN_SEE_EVERYTHING, ...ALL_WRITE_PERMISSIONS])
      const before = await rowOf(messageId)

      const error = await failureOf(editConversationMessage(messageId, 'rewritten', null, actor))

      expect(error).toBeInstanceOf(ValidationError)
      expect(await rowOf(messageId)).toEqual(before)
      expect(github.updateComment).not.toHaveBeenCalled()
    })

    it('updates the GitHub comment before the message is saved (G7)', async () => {
      const author = await seedPrincipal('member')
      const visitor = await seedPrincipal('user')
      const conversationId = await seedConversation(visitor, 'github')
      const messageId = await seedMessage(
        { conversationId },
        { authorId: author, metadata: { githubCommentId: '4711' } }
      )
      const actor = teammate(author, [...CAN_SEE_EVERYTHING, ...ALL_WRITE_PERMISSIONS])
      let editedAtWhenGithubWasCalled: Date | null | 'not called' = 'not called'
      github.updateComment.mockImplementation(async () => {
        editedAtWhenGithubWasCalled = (await rowOf(messageId)).editedAt
      })

      await editConversationMessage(messageId, 'rewritten', null, actor)

      expect(github.updateComment).toHaveBeenCalledTimes(1)
      const [calledConversation, commentId, markdown] = github.updateComment.mock.calls[0]
      expect(calledConversation).toBe(conversationId)
      expect(commentId).toBe('4711')
      expect(String(markdown)).toContain('rewritten')
      expect(editedAtWhenGithubWasCalled).toBeNull()
      expect((await rowOf(messageId)).editedAt).toBeInstanceOf(Date)
    })

    it('leaves the message exactly as it was when the GitHub comment cannot be updated (G7)', async () => {
      const author = await seedPrincipal('member')
      const visitor = await seedPrincipal('user')
      const conversationId = await seedConversation(visitor, 'github')
      const messageId = await seedMessage(
        { conversationId },
        { authorId: author, metadata: { githubCommentId: '4711' } }
      )
      const actor = teammate(author, [...CAN_SEE_EVERYTHING, ...ALL_WRITE_PERMISSIONS])
      github.updateComment.mockRejectedValue(new Error('GitHub is not connected.'))
      const before = await rowOf(messageId)

      const error = await failureOf(editConversationMessage(messageId, 'rewritten', null, actor))

      expect((error as Error).message).toBe('GitHub is not connected.')
      expect(await rowOf(messageId)).toEqual(before)
      expect((await rowOf(messageId)).editedAt).toBeNull()
      await waitForTicks()
      expect(published.frames).toEqual([])
      expect(events.messageUpdated).not.toHaveBeenCalled()
    })

    it('does not touch GitHub for an edit that changes nothing (G7)', async () => {
      const author = await seedPrincipal('member')
      const visitor = await seedPrincipal('user')
      const conversationId = await seedConversation(visitor, 'github')
      const messageId = await seedMessage(
        { conversationId },
        { authorId: author, content: 'same', metadata: { githubCommentId: '4711' } }
      )
      const actor = teammate(author, [...CAN_SEE_EVERYTHING, ...ALL_WRITE_PERMISSIONS])

      await editConversationMessage(messageId, 'same', null, actor)

      expect(github.updateComment).not.toHaveBeenCalled()
    })

    it('changes the stored message but sends nothing again for an email that was already sent (G7)', async () => {
      const author = await seedPrincipal('member')
      const visitor = await seedPrincipal('user')
      const conversationId = await seedConversation(visitor, 'email')
      const messageId = await seedMessage(
        { conversationId },
        {
          authorId: author,
          metadata: {
            channelDelivery: { status: 'sent', channel: 'email', at: new Date().toISOString() },
          },
        }
      )
      const actor = teammate(author, [...CAN_SEE_EVERYTHING, ...ALL_WRITE_PERMISSIONS])

      await editConversationMessage(messageId, 'rewritten', null, actor)
      await waitForTicks()

      expect(email.send).not.toHaveBeenCalled()
      expect(github.updateComment).not.toHaveBeenCalled()
      const after = await rowOf(messageId)
      expect(after.metadata?.channelDelivery).toEqual(
        expect.objectContaining({ status: 'sent', channel: 'email' })
      )
    })
  })

  // ---------------------------------------------------------------------------
  describe('a teammate who cannot see the message (G10)', () => {
    it('is told an edited message does not exist, exactly as for an id that was never used (G10)', async () => {
      const author = await seedPrincipal('member')
      const visitor = await seedPrincipal('user')
      const conversationId = await seedConversation(visitor)
      const messageId = await seedMessage({ conversationId }, { authorId: author })
      const cannotSee = teammate(author, ALL_WRITE_PERMISSIONS)
      const neverExisted = createId('conversation_message') as ConversationMessageId
      const before = await rowOf(messageId)

      const hidden = await failureOf(
        editConversationMessage(messageId, 'rewritten', null, cannotSee)
      )
      const missing = await failureOf(
        editConversationMessage(neverExisted, 'rewritten', null, cannotSee)
      )

      expect(hidden).toBeInstanceOf(NotFoundError)
      expect(hidden).toEqual(missing)
      expect(await rowOf(messageId)).toEqual(before)
    })

    it('is told an edited ticket message does not exist, exactly as for an id that was never used (G10)', async () => {
      const author = await seedPrincipal('member')
      const ticketId = await seedTicket()
      const messageId = await seedMessage({ ticketId }, { authorId: author })
      const cannotSee = teammate(author, ALL_WRITE_PERMISSIONS)
      const neverExisted = createId('conversation_message') as ConversationMessageId

      const hidden = await failureOf(
        editConversationMessage(messageId, 'rewritten', null, cannotSee)
      )
      const missing = await failureOf(
        editConversationMessage(neverExisted, 'rewritten', null, cannotSee)
      )

      expect(hidden).toBeInstanceOf(NotFoundError)
      expect(hidden).toEqual(missing)
    })

    it('is told a deleted message does not exist, exactly as for an id that was never used (G10)', async () => {
      const author = await seedPrincipal('member')
      const visitor = await seedPrincipal('user')
      const conversationId = await seedConversation(visitor)
      const messageId = await seedMessage({ conversationId }, { authorId: author })
      const cannotSee = teammate(author, ALL_WRITE_PERMISSIONS)
      const neverExisted = createId('conversation_message') as ConversationMessageId

      const hidden = await failureOf(deleteConversationMessage(messageId, cannotSee))
      const missing = await failureOf(deleteConversationMessage(neverExisted, cannotSee))

      expect(hidden).toBeInstanceOf(NotFoundError)
      expect(hidden).toEqual(missing)
      expect((await rowOf(messageId)).deletedAt).toBeNull()
    })

    it('is told a deleted ticket message does not exist, exactly as for an id that was never used (G10)', async () => {
      const author = await seedPrincipal('member')
      const ticketId = await seedTicket()
      const messageId = await seedMessage({ ticketId }, { authorId: author })
      const cannotSee = teammate(author, ALL_WRITE_PERMISSIONS)
      const neverExisted = createId('conversation_message') as ConversationMessageId

      const hidden = await failureOf(deleteConversationMessage(messageId, cannotSee))
      const missing = await failureOf(deleteConversationMessage(neverExisted, cannotSee))

      expect(hidden).toBeInstanceOf(NotFoundError)
      expect(hidden).toEqual(missing)
      expect((await rowOf(messageId)).deletedAt).toBeNull()
    })
  })

  // ---------------------------------------------------------------------------
  describe('who can delete (G11, G12, G13)', () => {
    async function seedBothParents() {
      const visitor = await seedPrincipal('user')
      const conversationId = await seedConversation(visitor)
      const ticketId = await seedTicket()
      return { visitor, conversationId, ticketId }
    }

    it('lets a teammate delete their own message on a conversation and on a ticket while they hold its write permission (G11)', async () => {
      const author = await seedPrincipal('member')
      const { conversationId, ticketId } = await seedBothParents()
      const onConversation = await seedMessage({ conversationId }, { authorId: author })
      const onTicket = await seedMessage({ ticketId }, { authorId: author })
      const actor = teammate(author, [...CAN_SEE_EVERYTHING, ...ALL_WRITE_PERMISSIONS])

      await deleteConversationMessage(onConversation, actor)
      await deleteConversationMessage(onTicket, actor)

      expect((await rowOf(onConversation)).deletedAt).toBeInstanceOf(Date)
      expect((await rowOf(onTicket)).deletedAt).toBeInstanceOf(Date)
    })

    it('refuses the author once they lose the permission that writes the message (G11)', async () => {
      const author = await seedPrincipal('member')
      const { conversationId, ticketId } = await seedBothParents()
      const note = await seedMessage({ conversationId }, { authorId: author, isInternal: true })
      const ticketReply = await seedMessage({ ticketId }, { authorId: author })
      const actor = teammate(author, [
        ...CAN_SEE_EVERYTHING,
        PERMISSIONS.CONVERSATION_REPLY,
        PERMISSIONS.TICKET_NOTE,
      ])

      const noteError = await failureOf(deleteConversationMessage(note, actor))
      const replyError = await failureOf(deleteConversationMessage(ticketReply, actor))

      expect(noteError).toBeInstanceOf(ForbiddenError)
      expect(replyError).toBeInstanceOf(ForbiddenError)
      expect((await rowOf(note)).deletedAt).toBeNull()
      expect((await rowOf(ticketReply)).deletedAt).toBeNull()
    })

    it("lets a moderator delete anyone's message on a conversation and on a ticket (G11)", async () => {
      const author = await seedPrincipal('member')
      const moderatorId = await seedPrincipal('admin')
      const { visitor, conversationId, ticketId } = await seedBothParents()
      const someonesReply = await seedMessage({ conversationId }, { authorId: author })
      const customersMessage = await seedMessage(
        { conversationId },
        { senderType: 'visitor', authorId: visitor }
      )
      const ticketNote = await seedMessage({ ticketId }, { authorId: author, isInternal: true })
      const moderator = teammate(moderatorId, [
        ...CAN_SEE_EVERYTHING,
        PERMISSIONS.CONVERSATION_MANAGE,
      ])

      for (const messageId of [someonesReply, customersMessage, ticketNote]) {
        await deleteConversationMessage(messageId, moderator)
        expect((await rowOf(messageId)).deletedAt).toBeInstanceOf(Date)
      }
    })

    it("lets a customer delete their own message in their own conversation, and no one else's (G11)", async () => {
      const author = await seedPrincipal('member')
      const { visitor, conversationId } = await seedBothParents()
      const mine = await seedMessage(
        { conversationId },
        { senderType: 'visitor', authorId: visitor }
      )
      const teammatesReply = await seedMessage({ conversationId }, { authorId: author })
      const theCustomer = customer(visitor)

      await deleteConversationMessage(mine, theCustomer)
      const error = await failureOf(deleteConversationMessage(teammatesReply, theCustomer))

      expect((await rowOf(mine)).deletedAt).toBeInstanceOf(Date)
      expect(error).toBeInstanceOf(ForbiddenError)
      expect((await rowOf(teammatesReply)).deletedAt).toBeNull()
    })

    it('lets nobody delete a system message, moderators included, on a conversation or a ticket (G11)', async () => {
      const moderatorId = await seedPrincipal('admin')
      const { conversationId, ticketId } = await seedBothParents()
      const onConversation = await seedMessage(
        { conversationId },
        { senderType: 'system', authorId: null }
      )
      const onTicket = await seedMessage({ ticketId }, { senderType: 'system', authorId: null })
      const moderator = teammate(moderatorId, [
        ...CAN_SEE_EVERYTHING,
        ...ALL_WRITE_PERMISSIONS,
        PERMISSIONS.CONVERSATION_MANAGE,
      ])

      for (const messageId of [onConversation, onTicket]) {
        const error = await failureOf(deleteConversationMessage(messageId, moderator))
        expect(error).toBeInstanceOf(ForbiddenError)
        expect((await rowOf(messageId)).deletedAt).toBeNull()
      }
    })

    it("refuses a teammate with every write permission but no moderator rights another teammate's message, on a conversation (G12)", async () => {
      const author = await seedPrincipal('member')
      const colleagueId = await seedPrincipal('member')
      const { conversationId } = await seedBothParents()
      const reply = await seedMessage({ conversationId }, { authorId: author })
      const note = await seedMessage({ conversationId }, { authorId: author, isInternal: true })
      const colleague = teammate(colleagueId, [...CAN_SEE_EVERYTHING, ...ALL_WRITE_PERMISSIONS])

      for (const messageId of [reply, note]) {
        const error = await failureOf(deleteConversationMessage(messageId, colleague))
        expect(error).toBeInstanceOf(ForbiddenError)
        expect((await rowOf(messageId)).deletedAt).toBeNull()
      }
    })

    it("refuses a teammate with every write permission but no moderator rights another teammate's message, on a ticket (G12)", async () => {
      const author = await seedPrincipal('member')
      const colleagueId = await seedPrincipal('member')
      const { ticketId } = await seedBothParents()
      const reply = await seedMessage({ ticketId }, { authorId: author })
      const note = await seedMessage({ ticketId }, { authorId: author, isInternal: true })
      const colleague = teammate(colleagueId, [...CAN_SEE_EVERYTHING, ...ALL_WRITE_PERMISSIONS])

      for (const messageId of [reply, note]) {
        const error = await failureOf(deleteConversationMessage(messageId, colleague))
        expect(error).toBeInstanceOf(ForbiddenError)
        expect((await rowOf(messageId)).deletedAt).toBeNull()
      }
    })

    it('never counts a service principal as the author of a message it tries to delete (G13)', async () => {
      const serviceId = await seedPrincipal('admin', 'service')
      const { conversationId, ticketId } = await seedBothParents()
      const onConversation = await seedMessage({ conversationId }, { authorId: serviceId })
      const onTicket = await seedMessage({ ticketId }, { authorId: serviceId })
      const apiKey: Actor = {
        principalId: serviceId,
        role: 'admin',
        principalType: 'service',
        segmentIds: new Set(),
        permissions: new Set([...CAN_SEE_EVERYTHING, ...ALL_WRITE_PERMISSIONS]),
      }

      for (const messageId of [onConversation, onTicket]) {
        const error = await failureOf(deleteConversationMessage(messageId, apiKey))
        expect(error).toBeInstanceOf(ForbiddenError)
        expect((await rowOf(messageId)).deletedAt).toBeNull()
      }
    })
  })
})
