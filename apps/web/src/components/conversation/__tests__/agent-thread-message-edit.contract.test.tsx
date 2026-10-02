// @vitest-environment happy-dom
/**
 * The inbox thread offers "Edit message" and "Delete" exactly where the
 * contract allows them, and applies a saved edit in place.
 *
 * Contract for the batch G pick (upstream ccf8f0521 #580, "edit and delete your
 * own support messages") -- the confirmed list items this suite pins on the
 * admin-inbox side (verbatim):
 *
 *   G1 A teammate can edit the body of a message they wrote themselves, whether a reply or an internal note, on a conversation or a ticket, as long as they still hold the permission that writes that kind of message.
 *   G2 Nobody can edit a message someone else wrote, a customer's message, a system message, a message from the AI assistant, or a structured message, and that includes moderators.
 *   G3 An edited message keeps its place in the thread and carries an "(edited)" mark; saving an unchanged body is not an edit and leaves no mark.
 *   G11 A teammate can delete their own message while they hold the permission that writes it; a moderator can delete any message that is not a system message; a customer can delete their own message in their own conversation; nobody can delete a system message.
 *   G12 A teammate without moderator rights can no longer delete a message someone else wrote, on conversations and on tickets alike.
 *
 * The real bubble is replaced by a stub that prints the two flags the thread
 * hands it, so the table below is the thread's decision (principal and
 * permissions read from the route context), not the bubble's rendering.
 * "Moderator" is `conversation.manage`; the write permission is
 * `conversation.reply` / `conversation.note` / `ticket.reply` / `ticket.note`.
 */
import fc from 'fast-check'
import { describe, expect, it, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { AgentConversationMessageDTO, ConversationDTO } from '@/lib/shared/conversation/types'

afterEach(cleanup)

const routeContextState = {
  session: { user: { name: 'Agent Smith' } },
  settings: { featureFlags: {} },
  // The admin shell's resolved permissions, read by usePermissions (B24 gates
  // the linked-ticket affordances on these). Default = both ticket
  // permissions; individual tests narrow it.
  permissions: ['ticket.view', 'ticket.set_status'] as string[],
}
vi.mock('@tanstack/react-router', () => ({
  useRouteContext: () => routeContextState,
}))

// The virtualized viewport + its supporting hooks are replaced with a plain
// list render — this test asserts on rendered rows, not scroll/virtualization.
vi.mock('../thread', () => ({
  ThreadViewport: ({
    rows,
    renderRow,
  }: {
    rows: { key: string }[]
    renderRow: (r: unknown) => unknown
  }) => (
    <div data-testid="thread-viewport">
      {rows.map((r) => (
        <div key={r.key}>{renderRow(r) as React.ReactNode}</div>
      ))}
    </div>
  ),
  useThreadVirtualizer: () => ({
    getTotalSize: () => 0,
    getVirtualItems: () => [],
    scrollToIndex: vi.fn(),
    scrollToEnd: vi.fn(),
    isAtEnd: () => true,
    measureElement: () => {},
  }),
  useOlderMessages: () => ({ loadingOlder: false, loadOlder: vi.fn() }),
  useMarkReadOnIncoming: () => {},
  useTypingSender: () => vi.fn(),
}))

const { editProbe } = vi.hoisted(() => ({
  editProbe: { lastOutcome: '' as 'saved' | 'rejected' | '' },
}))
vi.mock('../message-bubble', () => ({
  AgentMessageBubble: ({
    message,
    canEdit,
    canDelete,
    onEdit,
  }: {
    message: AgentConversationMessageDTO
    canEdit?: boolean
    canDelete?: boolean
    onEdit?: (
      id: AgentConversationMessageDTO['id'],
      draft: { content: string; contentJson: null }
    ) => Promise<void>
  }) => (
    <div
      data-testid={`bubble-${message.id}`}
      data-can-edit={String(Boolean(canEdit))}
      data-can-delete={String(Boolean(canDelete))}
    >
      <span>{message.content}</span>
      {message.editedAt ? <span>(edited)</span> : null}
      <button
        type="button"
        onClick={() => {
          onEdit?.(message.id, { content: 'rewritten', contentJson: null }).then(
            () => {
              editProbe.lastOutcome = 'saved'
            },
            () => {
              editProbe.lastOutcome = 'rejected'
            }
          )
        }}
      >
        save-{message.id}
      </button>
    </div>
  ),
  UnreadDivider: () => <div data-testid="unread-divider" />,
}))

vi.mock('../macro-picker', () => ({
  MacroPicker: ({ open }: { open?: boolean }) => (
    <div data-testid="macro-picker" data-open={open ? 'true' : 'false'} />
  ),
}))
// The AI actions row is the only child handed the ACTIVE draft's markdown, so
// it is the seam through which the composer tests read that mirror. Recorded
// into a probe rather than a DOM attribute: the merged markdown carries
// newlines, and an attribute round-trip is a variable those tests do not need.
const { composerAiProbe } = vi.hoisted(() => ({
  composerAiProbe: { activeDraftText: '' },
}))
vi.mock('../composer-ai-actions', async () => {
  const { useEffect } = await import('react')
  return {
    ComposerAiActions: ({
      activeMode,
      activeDraftText,
    }: {
      activeMode: string
      activeDraftText?: string
    }) => {
      useEffect(() => {
        composerAiProbe.activeDraftText = activeDraftText ?? ''
      })
      return <div data-testid="composer-ai-actions" data-active-mode={activeMode} />
    },
  }
})
vi.mock('@/components/admin/conversation/priority-control', () => ({
  PriorityControl: () => null,
}))
vi.mock('@/components/admin/conversation/assignee-control', () => ({
  AssigneeControl: () => null,
}))
vi.mock('@/components/admin/conversation/channel-badge', () => ({ ChannelBadge: () => null }))
vi.mock('@/components/admin/conversation/sla-chip', () => ({ SlaChip: () => null }))
vi.mock('@/components/admin/conversation/conversation-tags-editor', () => ({
  ConversationTagsEditor: () => null,
}))
vi.mock('@/components/admin/conversation/status-control', () => ({ StatusControl: () => null }))
vi.mock('@/components/admin/inbox/inbox-detail-panel', () => ({
  InboxDetailPanel: ({ openCopilotToken }: { openCopilotToken?: number }) => (
    <div data-testid="inbox-detail-panel" data-open-copilot-token={openCopilotToken} />
  ),
}))
vi.mock('@/components/admin/inbox/create-ticket-dialog', () => ({
  CreateTicketDialog: () => null,
}))
vi.mock('@/components/admin/conversation/convert-to-post-dialog', () => ({
  ConvertToPostDialog: () => null,
}))
vi.mock('@/components/admin/conversation/end-conversation-dialog', () => ({
  EndConversationDialog: () => null,
}))
vi.mock('@/components/admin/conversation/share-post-dialog', () => ({
  SharePostDialog: () => null,
}))
vi.mock('@/components/admin/conversation/required-attributes-dialog', () => ({
  RequiredAttributesDialog: () => null,
}))
vi.mock('@/components/admin/users/block-person-control', () => ({
  usePersonBlockStatus: () => ({ blocked: false, isLoading: false }),
}))
vi.mock('@/components/shared/confirm-dialog', () => ({ ConfirmDialog: () => null }))
vi.mock('@/components/admin/conversation/export-transcript-button', () => ({
  downloadTranscriptFile: vi.fn(),
}))
vi.mock('@/components/ui/datetime-picker', () => ({ DateTimePicker: () => null }))
vi.mock('@/components/admin/inbox/ticket-chips', () => ({
  TicketTypeBadge: ({ type }: { type: string }) => (
    <span data-testid="ticket-type-badge">{type}</span>
  ),
  TicketStageChip: () => null,
  TicketStatusChip: ({ status }: { status: { name: string } }) => (
    <span data-testid="ticket-status-chip">{status.name}</span>
  ),
}))
vi.mock('@/components/admin/inbox/ticket-controls', () => ({
  TicketStatusControl: () => <div data-testid="ticket-status-control" />,
  TicketAssigneeControl: () => <div data-testid="ticket-assignee-control" />,
  TicketPriorityControl: () => <div data-testid="ticket-priority-control" />,
}))
// The editor stub keeps the real `editorRef` contract: whichever instance is
// mounted publishes a focus handle, so the composer-focus tests below assert
// against real DOM focus rather than a spy. It also records everything the
// composer does to the editor — `focus(position)`, `clear()`, the `value` it is
// handed, and how many editor instances have been mounted (a key bump remounts
// it, a clear-in-place does not) — and republishes the live `onChange` so a
// test can type the way the real editor reports typing.
const { editorProbe } = vi.hoisted(() => ({
  editorProbe: {
    mounts: 0,
    focusCalls: [] as (string | undefined)[],
    clearCalls: 0,
    value: undefined as unknown,
    onChange: null as null | ((json: unknown, html: string, markdown: string) => void),
    reset() {
      editorProbe.mounts = 0
      editorProbe.focusCalls = []
      editorProbe.clearCalls = 0
      editorProbe.value = undefined
      editorProbe.onChange = null
    },
  },
}))
vi.mock('@/components/ui/rich-text-editor', async () => {
  const { useEffect, useImperativeHandle, useRef } = await import('react')
  return {
    RichTextEditor: ({
      placeholder,
      editorRef,
      value,
      onChange,
    }: {
      placeholder?: string
      editorRef?: React.RefObject<{
        focus: (position?: string) => void
        clear: () => void
      } | null>
      value?: unknown
      onChange?: (json: unknown, html: string, markdown: string) => void
    }) => {
      const areaRef = useRef<HTMLTextAreaElement>(null)
      useEffect(() => {
        editorProbe.mounts += 1
      }, [])
      useEffect(() => {
        editorProbe.value = value
        editorProbe.onChange = onChange ?? null
      })
      useImperativeHandle(editorRef, () => ({
        focus: (position?: string) => {
          editorProbe.focusCalls.push(position)
          areaRef.current?.focus()
        },
        clear: () => {
          editorProbe.clearCalls += 1
        },
      }))
      return <textarea ref={areaRef} data-testid="editor" placeholder={placeholder} readOnly />
    },
    RichTextContent: () => null,
  }
})
vi.mock('@/components/shared/composer-attachment-tray', () => ({
  ComposerAttachmentTray: () => null,
}))
vi.mock('@/components/shared/link-preview-card', () => ({ LinkPreviews: () => null }))
vi.mock('@/components/shared/typing-dots', () => ({ TypingDots: () => null }))
vi.mock('@/components/shared/emoji-picker', () => ({
  EmojiPicker: () => <div data-testid="emoji-picker" />,
}))
vi.mock('@/components/shared/spinner', () => ({ Spinner: () => <div data-testid="spinner" /> }))
vi.mock('@/components/shared/empty-state', () => ({
  EmptyState: ({ title }: { title: string }) => <div data-testid="empty-state">{title}</div>,
}))
vi.mock('@/components/ui/avatar', () => ({ Avatar: () => null }))

vi.mock('@/lib/client/hooks/use-inbox-translation', () => ({
  useInboxTranslation: () => ({
    translationFor: () => undefined,
    showSuggestionBanner: false,
    enabled: false,
    togglePending: false,
    toggleEnabled: vi.fn(),
    dismissSuggestion: vi.fn(),
    activateFromSuggestion: vi.fn(),
    detectedLanguageLabel: '',
  }),
}))
vi.mock('@/lib/client/hooks/use-copilot-insert', () => ({ useCopilotInsert: () => vi.fn() }))
// The composer's own upload options are captured rather than discarded: the
// `onError` it hands the hook is the whole of C5 on this surface, and a mock
// that returns only `upload` leaves that line with no caller.
const { imageUploadOptions, toastError } = vi.hoisted(() => ({
  imageUploadOptions: { current: null } as {
    current: { onError?: (error: Error) => void } | null
  },
  toastError: vi.fn(),
}))
vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), {
    error: toastError,
    success: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
    message: vi.fn(),
    loading: vi.fn(),
    dismiss: vi.fn(),
    custom: vi.fn(),
    promise: vi.fn(),
  }),
  Toaster: () => null,
}))
vi.mock('@/lib/client/hooks/use-image-upload', () => ({
  useImageUpload: (options: { onError?: (error: Error) => void }) => {
    imageUploadOptions.current = options
    return { upload: vi.fn() }
  },
}))
// `clearAttachments` is the composer's own "the send landed" signal: both
// mutations call it first thing in onSuccess. Stable across renders so a test
// can wait on it.
const { addFiles, clearAttachments } = vi.hoisted(() => ({
  addFiles: vi.fn(),
  clearAttachments: vi.fn(),
}))
vi.mock('@/lib/client/hooks/use-conversation-composer-attachments', () => ({
  useConversationComposerAttachments: () => ({
    pending: [],
    addFiles,
    remove: vi.fn(),
    clear: clearAttachments,
    uploading: false,
  }),
}))

const { editConversationMessageFn, threadState } = vi.hoisted(() => ({
  editConversationMessageFn: vi.fn(),
  threadState: { messages: [] as unknown[] },
}))
vi.mock('@/lib/server/functions/conversation', () => ({
  sendAgentMessageFn: vi.fn(),
  addConversationNoteFn: vi.fn(),
  deleteConversationMessageFn: vi.fn(),
  editConversationMessageFn,
  addMessageReactionFn: vi.fn(),
  removeMessageReactionFn: vi.fn(),
  setMessageFlagFn: vi.fn(),
  markConversationUnreadFromMessageFn: vi.fn(),
  exportConversationTranscriptFn: vi.fn(),
  snoozeConversationFn: vi.fn(),
  setConversationStatusFn: vi.fn(),
}))
vi.mock('@/lib/server/functions/sla', () => ({ removeConversationSlaFn: vi.fn() }))
vi.mock('@/lib/server/functions/blocking', () => ({
  blockPersonFn: vi.fn(),
  unblockPersonFn: vi.fn(),
}))
vi.mock('@/lib/server/functions/tickets', () => ({
  sendTicketMessageFn: vi.fn(),
  addTicketNoteFn: vi.fn(),
  listTicketMessagesFn: vi.fn(),
  markTicketUnreadFromMessageFn: vi.fn(),
  markTicketReadFn: vi.fn().mockResolvedValue({ ok: true }),
  getTicketFn: vi.fn(),
  setTicketStatusFn: vi.fn(),
  exportTicketTranscriptFn: vi.fn(),
}))
vi.mock('@/lib/client/queries/inbox', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/client/queries/inbox')>()
  return {
    ...original,
    inboxQueries: {
      ticketThread: (id: string) => ({
        // The key the thread writes an edit under, or a saved edit never shows.
        queryKey: original.ticketKeys.thread(id as never),
        queryFn: () => Promise.resolve({ hasMore: false, messages: threadState.messages }),
      }),
      ticketDetail: (id: string) => ({
        queryKey: ['ticket-detail', id],
        queryFn: () =>
          Promise.resolve({
            id,
            number: 1,
            reference: '#1',
            type: 'customer',
            ticketType: null,
            title: 'Cannot log in',
            status: { id: 'ticket_status_1', name: 'Open', color: '#22c55e', category: 'open' },
            stage: { slot: null, label: null },
            priority: 'none',
            requester: null,
            assignee: { principalId: null, displayName: null, teamId: null, teamName: null },
            company: null,
            firstResponseAt: null,
            dueAt: null,
            resolvedAt: null,
            sla: null,
            createdAt: '2026-07-03T00:00:00.000Z',
            updatedAt: '2026-07-03T00:00:00.000Z',
            reopenedCount: 0,
            customAttributes: {},
            lastMessagePreview: null,
            lastMessageAt: '2026-07-03T00:00:00.000Z',
          }),
      }),
      conversationTicketLink: (id: string) => ({
        queryKey: ['conversation-ticket-link', id],
        queryFn: () => Promise.resolve(null),
      }),
    },
    ticketQueries: {
      statuses: () => ({ queryKey: ['ticket-statuses'], queryFn: () => Promise.resolve([]) }),
      provenanceConversations: (id: string) => ({
        queryKey: ['ticket-provenance-conversations', id],
        queryFn: () => Promise.resolve({ count: 0 }),
      }),
    },
  }
})
vi.mock('@/lib/client/queries/conversation-inbox', async () => {
  const { conversationKeys } = await import('@/components/conversation/query-keys')
  return {
    conversationInboxQueries: {
      thread: (id: string) => ({
        queryKey: conversationKeys.agentThread(id as never),
        queryFn: () =>
          Promise.resolve({
            hasMore: false,
            conversation: conversationFor(id),
            messages: threadState.messages,
          }),
      }),
    },
  }
})

import { AgentConversationThread } from '../agent-conversation-thread'

function conversationFor(id: string): ConversationDTO {
  return {
    id: id as ConversationDTO['id'],
    status: 'open',
    priority: 'none',
    channel: 'messenger',
    subject: null,
    lastMessagePreview: null,
    lastMessageAt: '2026-07-01T00:00:00.000Z',
    createdAt: '2026-07-01T00:00:00.000Z',
    visitor: { principalId: 'principal_visitor', displayName: 'Vic Visitor', avatarUrl: null },
    assignedAgent: null,
    unreadCount: 0,
    visitorLastReadAt: null,
    agentLastReadAt: null,
    csatRating: null,
    visitorEmail: 'vic@example.com',
    resolvedAt: null,
    snoozedUntil: null,
    assignedTeamId: null,
    endReason: null,
    endNote: null,
    spamReason: null,
    tags: [],
    sla: null,
    customAttributes: {},
    translation: null,
  } as ConversationDTO
}

type ParentKind = 'conversation' | 'ticket'
type SenderType = 'visitor' | 'agent' | 'system'
type Author = 'me' | 'other' | 'none'

interface MessageSpec {
  senderType: SenderType
  author: Author
  isInternal: boolean
  isAssistant: boolean
  structured: boolean
}

const ME = 'principal_me'
const WRITE_PERMISSIONS = [
  'conversation.reply',
  'conversation.note',
  'ticket.reply',
  'ticket.note',
] as const
const MODERATOR = 'conversation.manage'

function makeMessage(spec: MessageSpec, index: number, parent: ParentKind) {
  const authorIds = { me: ME, other: 'principal_other', none: null }
  const principalId = authorIds[spec.author]
  return {
    id: `conversation_msg_${index}`,
    conversationId: parent === 'conversation' ? 'conversation_1' : null,
    ticketId: parent === 'ticket' ? 'ticket_1' : null,
    senderType: spec.senderType,
    content: `message ${index}`,
    createdAt: '2026-07-01T00:00:00.000Z',
    author: principalId ? { principalId, displayName: 'Someone', avatarUrl: null } : null,
    attachments: [],
    citations: [],
    isAssistant: spec.isAssistant,
    isInternal: spec.isInternal,
    contentJson: null,
    viaEmail: false,
    systemEvent: null,
    reactions: [],
    flaggedAt: null,
    postSuggestion: null,
    translatedFrom: null,
    block: spec.structured ? { kind: 'buttons', prompt: 'Pick', options: [] } : undefined,
  }
}

function renderThread(parent: ParentKind, onChanged = vi.fn()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const item =
    parent === 'ticket'
      ? { kind: 'ticket', id: 'ticket_1' }
      : { kind: 'conversation', id: 'conversation_1' }
  return render(
    <QueryClientProvider client={client}>
      <AgentConversationThread
        item={item as never}
        targetMessageId={null}
        onChanged={onChanged}
        onBack={vi.fn()}
        onSelectItem={vi.fn()}
        onOpenPost={vi.fn()}
        isVisitorTyping={false}
        isOtherAgentTyping={false}
      />
    </QueryClientProvider>
  )
}

function actAs(permissions: string[]) {
  routeContextState.permissions = ['ticket.view', 'conversation.view', ...permissions]
  ;(routeContextState as { principal?: { id: string } }).principal = { id: ME }
}

// The expected table, written from the contract text.
function contractAllowsEdit(spec: MessageSpec, parent: ParentKind, held: string[]): boolean {
  if (spec.senderType !== 'agent') return false
  if (spec.isAssistant || spec.structured) return false
  if (spec.author !== 'me') return false
  const writes = `${parent}.${spec.isInternal ? 'note' : 'reply'}`
  return held.includes(writes)
}

function contractAllowsDelete(spec: MessageSpec, parent: ParentKind, held: string[]): boolean {
  if (spec.senderType === 'system') return false
  if (held.includes(MODERATOR)) return true
  if (spec.senderType !== 'agent') return false
  if (spec.author !== 'me') return false
  const writes = `${parent}.${spec.isInternal ? 'note' : 'reply'}`
  return held.includes(writes)
}

const messageSpecArb: fc.Arbitrary<MessageSpec> = fc
  .record({
    senderType: fc.constantFrom<SenderType>('visitor', 'agent', 'system'),
    author: fc.constantFrom<Author>('me', 'other', 'none'),
    isInternal: fc.boolean(),
    isAssistant: fc.boolean(),
    structured: fc.boolean(),
  })
  .map((spec) => {
    // A customer or system row is never written by the signed-in teammate, and
    // only an agent-side row can be the assistant's or a structured one.
    if (spec.senderType !== 'agent') {
      return {
        ...spec,
        author: spec.author === 'me' ? 'other' : spec.author,
        isAssistant: false,
        structured: false,
        isInternal: false,
      }
    }
    if (spec.isAssistant) return { ...spec, author: spec.author === 'me' ? 'other' : spec.author }
    return spec
  })

const permissionsArb = fc.subarray([...WRITE_PERMISSIONS, MODERATOR])

describe('AgentConversationThread -- which actions a message offers (G1, G2, G11, G12)', () => {
  it('offers Edit and Delete exactly where the contract allows them, on conversations and tickets (G1, G2, G11, G12)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom<ParentKind>('conversation', 'ticket'),
        fc.array(messageSpecArb, { minLength: 1, maxLength: 6 }),
        permissionsArb,
        async (parent, specs, held) => {
          threadState.messages = specs.map((spec, index) => makeMessage(spec, index, parent))
          actAs(held)
          const { unmount } = renderThread(parent)
          for (let index = 0; index < specs.length; index++) {
            const bubble = await screen.findByTestId(`bubble-conversation_msg_${index}`)
            expect(bubble.dataset.canEdit, `edit #${index}`).toBe(
              String(contractAllowsEdit(specs[index], parent, held))
            )
            expect(bubble.dataset.canDelete, `delete #${index}`).toBe(
              String(contractAllowsDelete(specs[index], parent, held))
            )
          }
          unmount()
        }
      ),
      { numRuns: 30 }
    )
  }, 60_000)

  it('without a signed-in principal nothing is editable and only a moderator can delete (G2, G12)', async () => {
    threadState.messages = [
      makeMessage(
        {
          senderType: 'agent',
          author: 'me',
          isInternal: false,
          isAssistant: false,
          structured: false,
        },
        0,
        'conversation'
      ),
    ]
    actAs(['conversation.reply'])
    ;(routeContextState as { principal?: { id: string } }).principal = undefined
    renderThread('conversation')
    const bubble = await screen.findByTestId('bubble-conversation_msg_0')
    expect(bubble.dataset.canEdit).toBe('false')
    expect(bubble.dataset.canDelete).toBe('false')
  })
})

describe('AgentConversationThread -- saving an edit (G3)', () => {
  const ownReply: MessageSpec = {
    senderType: 'agent',
    author: 'me',
    isInternal: false,
    isAssistant: false,
    structured: false,
  }

  async function saveMessageTwo(parent: ParentKind, onChanged = vi.fn()) {
    threadState.messages = [0, 1, 2].map((index) =>
      makeMessage(
        index === 2 ? ownReply : { ...ownReply, senderType: 'visitor', author: 'other' },
        index,
        parent
      )
    )
    actAs([`${parent}.reply`])
    renderThread(parent, onChanged)
    const bubble = await screen.findByTestId('bubble-conversation_msg_2')
    fireEvent.click(within(bubble).getByRole('button', { name: 'save-conversation_msg_2' }))
  }

  it.each<ParentKind>(['conversation', 'ticket'])(
    'a saved %s edit shows the new body with the mark, in the same place (G3)',
    async (parent) => {
      const onChanged = vi.fn()
      editProbe.lastOutcome = ''
      editConversationMessageFn.mockImplementation(async () => ({
        ...makeMessage(ownReply, 2, parent),
        content: 'rewritten',
        editedAt: '2026-07-01T01:00:00.000Z',
      }))
      await saveMessageTwo(parent, onChanged)

      await waitFor(() =>
        expect(
          within(screen.getByTestId('bubble-conversation_msg_2')).getByText('(edited)')
        ).toBeTruthy()
      )
      const bubble = screen.getByTestId('bubble-conversation_msg_2')
      expect(within(bubble).getByText('rewritten')).toBeTruthy()
      expect(editProbe.lastOutcome).toBe('saved')
      expect(onChanged).toHaveBeenCalled()
      const order = screen.getAllByTestId(/^bubble-/).map((el) => el.dataset.testid)
      expect(order).toEqual([
        'bubble-conversation_msg_0',
        'bubble-conversation_msg_1',
        'bubble-conversation_msg_2',
      ])
      expect(screen.getAllByText('(edited)')).toHaveLength(1)
    }
  )

  it('a failed save tells the teammate, rejects to the editor and changes nothing (G3)', async () => {
    editProbe.lastOutcome = ''
    toastError.mockClear()
    editConversationMessageFn.mockRejectedValue(new Error('network down'))
    await saveMessageTwo('conversation')

    await waitFor(() => expect(editProbe.lastOutcome).toBe('rejected'))
    expect(toastError).toHaveBeenCalledWith('Failed to edit message')
    const bubble = screen.getByTestId('bubble-conversation_msg_2')
    expect(within(bubble).getByText('message 2')).toBeTruthy()
    expect(within(bubble).queryByText('(edited)')).toBeNull()
  })

  it('the edit request carries the message id and the new body (G1)', async () => {
    editConversationMessageFn.mockClear()
    editConversationMessageFn.mockImplementation(async () =>
      makeMessage(ownReply, 2, 'conversation')
    )
    await saveMessageTwo('conversation')
    await waitFor(() => expect(editConversationMessageFn).toHaveBeenCalled())
    expect(editConversationMessageFn).toHaveBeenCalledWith({
      data: { messageId: 'conversation_msg_2', content: 'rewritten', contentJson: null },
    })
  })
})
