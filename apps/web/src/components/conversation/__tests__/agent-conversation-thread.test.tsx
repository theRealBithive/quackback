// @vitest-environment happy-dom
/**
 * <AgentConversationThread> capability wiring (UNIFIED-INBOX-SPEC.md §2.5,
 * M4): the same container drives a conversation and a ticket, gated by the
 * `ThreadCapabilities` derived from `item.kind`/a ticket's `type`. These tests
 * pin the three load-bearing behaviors the fold introduced:
 *
 *  - a back_office/tracker ticket is note-only (no Reply/Note toggle, forced
 *    note mode) — `capabilities.reply` false;
 *  - a customer ticket keeps both Reply and Note tabs — `capabilities.reply`
 *    true.
 *
 * Heavy children (controls, dialogs, the rich editor, the virtualized
 * viewport) are stubbed — this test is about capability wiring, not those
 * components' own behavior, and several of them fire unconditional queries
 * that would otherwise hit real server functions.
 *
 * The suite at the foot of this file pins the composer's send lifecycle.
 * Contract group C (verbatim from contract-c.md):
 *
 *  C1 After a send completes, focus returns to the composer only when focus
 *     was still on the composer or its send controls; a user who moved to
 *     another control mid-flight is not pulled back.
 *  C2 A successful send clears the composer in place and keeps the caret in
 *     it.
 *  C3 When a send fails and the composer is still empty, the failed draft is
 *     restored verbatim.
 *  C4 When a send fails and the user has typed on, the new typing stays on
 *     top and the failed text is kept below it behind a separator, a toast
 *     says so, and the composer regains focus.
 */
import { createRef } from 'react'
import fc from 'fast-check'
import { describe, expect, it, vi, afterEach, beforeEach } from 'vitest'
import { act, render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { TicketDTO } from '@/lib/server/domains/tickets'
import type { ConversationDTO, AgentConversationMessageDTO } from '@/lib/shared/conversation/types'
import type { LinkedTicketSummary } from '@/lib/shared/inbox/items'

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

vi.mock('../message-bubble', () => ({
  AgentMessageBubble: ({ message }: { message: AgentConversationMessageDTO }) => (
    <div data-testid={`bubble-${message.id}`}>{message.content}</div>
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

vi.mock('@/lib/server/functions/conversation', () => ({
  sendAgentMessageFn: vi.fn(),
  addConversationNoteFn: vi.fn(),
  deleteConversationMessageFn: vi.fn(),
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

const {
  mockTicket,
  mockTicketThread,
  mockTicketVariants,
  mockTicketLink,
  mockTicketStatuses,
  mockProvenanceCount,
} = vi.hoisted(() => {
  const mockTicket = {
    id: 'ticket_1',
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
    lastMessagePreview: 'Help please',
    lastMessageAt: '2026-07-03T00:00:00.000Z',
  } as TicketDTO
  const mockTicketThread = {
    hasMore: false,
    messages: [
      {
        id: 'conversation_msg_1',
        conversationId: null,
        ticketId: 'ticket_1',
        senderType: 'visitor',
        content: 'Help please',
        createdAt: '2026-07-03T00:00:00.000Z',
        author: null,
        attachments: [],
        citations: [],
        isAssistant: false,
        isInternal: false,
        contentJson: null,
        viaEmail: false,
        systemEvent: null,
        reactions: [],
        flaggedAt: null,
        postSuggestion: null,
        translatedFrom: null,
      },
    ],
  }
  // Per-id ticket-detail overrides for tests that need a variant (e.g. a
  // closed-category status) to survive the mount refetch — seeding the query
  // cache alone gets overwritten by the mocked queryFn's canonical row.
  const mockTicketVariants: Record<string, Partial<TicketDTO>> = {}
  // The linked-ticket summary the conversationTicketLink queryFn hands back
  // (null = no linked ticket) and the status catalogue the statuses queryFn
  // serves — object refs so individual tests can flip them per render.
  const mockTicketLink: { value: LinkedTicketSummary | null } = { value: null }
  const mockTicketStatuses: {
    value: { id: string; slug: string; category: string; isDefault: boolean }[]
  } = { value: [] }
  // How many conversations the open ticket was opened from — decides whether
  // the composer offers to share a note at all.
  const mockProvenanceCount = { value: 0 }
  return {
    mockTicket,
    mockTicketThread,
    mockTicketVariants,
    mockTicketLink,
    mockTicketStatuses,
    mockProvenanceCount,
  }
})

vi.mock('@/lib/server/functions/tickets', () => ({
  sendTicketMessageFn: vi.fn(),
  addTicketNoteFn: vi.fn(),
  listTicketMessagesFn: vi.fn().mockResolvedValue(mockTicketThread),
  markTicketUnreadFromMessageFn: vi.fn(),
  markTicketReadFn: vi.fn().mockResolvedValue({ ok: true }),
  getTicketFn: vi.fn().mockResolvedValue(mockTicket),
  setTicketStatusFn: vi.fn(),
  exportTicketTranscriptFn: vi.fn(),
}))
vi.mock('@/lib/client/queries/inbox', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/client/queries/inbox')>()),
  inboxQueries: {
    ticketThread: (id: string) => ({
      queryKey: ['ticket-thread', id],
      queryFn: () => Promise.resolve(mockTicketThread),
    }),
    ticketDetail: (id: string) => ({
      queryKey: ['ticket-detail', id],
      queryFn: () => Promise.resolve({ ...mockTicket, ...(mockTicketVariants[id] ?? {}), id }),
    }),
    conversationTicketLink: (id: string) => ({
      queryKey: ['conversation-ticket-link', id],
      queryFn: () => Promise.resolve(mockTicketLink.value),
    }),
  },
  ticketQueries: {
    statuses: () => ({
      queryKey: ['ticket-statuses'],
      queryFn: () => Promise.resolve(mockTicketStatuses.value),
    }),
    provenanceConversations: (id: string) => ({
      queryKey: ['ticket-provenance-conversations', id],
      queryFn: () => Promise.resolve({ count: mockProvenanceCount.value }),
    }),
  },
}))
vi.mock('@/lib/client/queries/conversation-inbox', () => ({
  conversationInboxQueries: {
    thread: (id: string) => ({
      queryKey: ['conv-thread', id],
      queryFn: () =>
        Promise.resolve({
          hasMore: false,
          conversation: makeConversation({ id: id as ConversationDTO['id'] }),
          messages: [] as AgentConversationMessageDTO[],
        }),
    }),
  },
}))

import { AgentConversationThread } from '../agent-conversation-thread'
import type { ThreadComposerHandle } from '../agent-conversation-thread'
import {
  setConversationStatusFn,
  sendAgentMessageFn,
  addConversationNoteFn,
} from '@/lib/server/functions/conversation'
import { setTicketStatusFn } from '@/lib/server/functions/tickets'
import {
  TRANSLATION_RICH_CONTENT_MESSAGE,
  TRANSLATION_UNAVAILABLE_MESSAGE,
} from '@/lib/shared/conversation/translation'

afterEach(() => {
  mockTicketLink.value = null
  mockTicketStatuses.value = []
  mockProvenanceCount.value = 0
  routeContextState.permissions = ['ticket.view', 'ticket.set_status']
  vi.clearAllMocks()
})

function makeConversation(overrides: Partial<ConversationDTO> = {}): ConversationDTO {
  return {
    id: 'conversation_1' as ConversationDTO['id'],
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
    ...overrides,
  }
}

function renderThread(item: { kind: 'conversation' | 'ticket'; id: string }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <AgentConversationThread
        item={item as never}
        targetMessageId={null}
        onChanged={vi.fn()}
        onBack={vi.fn()}
        onSelectItem={vi.fn()}
        onOpenPost={vi.fn()}
        isVisitorTyping={false}
        isOtherAgentTyping={false}
      />
    </QueryClientProvider>
  )
}

describe('AgentConversationThread — ticket capability wiring', () => {
  it('a back_office/tracker ticket is note-only: no Reply/Note toggle', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    client.setQueryData(['ticket-detail', 'ticket_tracker'], {
      ...mockTicket,
      id: 'ticket_tracker',
      type: 'tracker',
    })
    client.setQueryData(['ticket-thread', 'ticket_tracker'], mockTicketThread)
    render(
      <QueryClientProvider client={client}>
        <AgentConversationThread
          item={{ kind: 'ticket', id: 'ticket_tracker' } as never}
          targetMessageId={null}
          onChanged={vi.fn()}
          onBack={vi.fn()}
          onSelectItem={vi.fn()}
          onOpenPost={vi.fn()}
          isVisitorTyping={false}
          isOtherAgentTyping={false}
        />
      </QueryClientProvider>
    )
    const editor = await screen.findByTestId('editor')
    expect(editor).toHaveAttribute('placeholder', 'Add an internal note for your team…')
    expect(screen.queryByText('Reply')).not.toBeInTheDocument()
    expect(screen.queryByText('Note')).not.toBeInTheDocument()
  })

  it('a customer ticket keeps both Reply and Note modes', async () => {
    // Repoint the ticket-detail queryFn for this one render via a fresh client
    // seeded with the customer variant.
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    client.setQueryData(['ticket-detail', 'ticket_2'], {
      ...mockTicket,
      id: 'ticket_2',
      type: 'customer',
    })
    client.setQueryData(['ticket-thread', 'ticket_2'], mockTicketThread)
    render(
      <QueryClientProvider client={client}>
        <AgentConversationThread
          item={{ kind: 'ticket', id: 'ticket_2' } as never}
          targetMessageId={null}
          onChanged={vi.fn()}
          onBack={vi.fn()}
          onSelectItem={vi.fn()}
          onOpenPost={vi.fn()}
          isVisitorTyping={false}
          isOtherAgentTyping={false}
        />
      </QueryClientProvider>
    )
    const trigger = await screen.findByRole('button', { name: 'Reply' })
    fireEvent.click(trigger)
    expect(await screen.findByRole('menuitemradio', { name: 'Note' })).toBeInTheDocument()
  })

  it('offers no share control on a back-office ticket opened from nothing', async () => {
    mockTicketVariants['ticket_bo_solo'] = { type: 'back_office' }
    mockProvenanceCount.value = 0
    renderThread({ kind: 'ticket', id: 'ticket_bo_solo' })

    await screen.findByTestId('editor')
    // Nothing to share to, so the choice is never put in front of the agent.
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /share with conversation/i })).toBeNull()
    )
  })

  it('starts a back-office note unshared and only shares it when asked', async () => {
    mockTicketVariants['ticket_bo_linked'] = { type: 'back_office' }
    mockProvenanceCount.value = 1
    renderThread({ kind: 'ticket', id: 'ticket_bo_linked' })

    const share = await screen.findByRole('button', { name: /share with conversation/i })
    // Ticket-only is where every note starts: the control is an unpressed
    // offer, not a mode the composer is already in.
    expect(share).toHaveAttribute('aria-pressed', 'false')

    fireEvent.click(share)
    expect(share).toHaveAttribute('aria-pressed', 'true')
  })

  it('renders the ticket header controls + type badge', async () => {
    renderThread({ kind: 'ticket', id: 'ticket_1' })
    expect(await screen.findByTestId('ticket-type-badge')).toHaveTextContent('customer')
    expect(screen.getByTestId('ticket-status-control')).toBeInTheDocument()
    expect(screen.getByTestId('ticket-assignee-control')).toBeInTheDocument()
    expect(screen.getByTestId('ticket-priority-control')).toBeInTheDocument()
  })
})

describe('AgentConversationThread — conversation kind unaffected', () => {
  it('still renders the conversation detail panel and the Reply/Note switcher', async () => {
    renderThread({ kind: 'conversation', id: 'conversation_1' })
    const trigger = await screen.findByRole('button', { name: 'Reply' })
    fireEvent.click(trigger)
    expect(await screen.findByRole('menuitemradio', { name: 'Note' })).toBeInTheDocument()
    expect(screen.getByTestId('inbox-detail-panel')).toBeInTheDocument()
    expect(screen.getByTestId('composer-ai-actions')).toHaveAttribute('data-active-mode', 'reply')
  })
})

/** A minimal, valid `AgentConversationMessageDTO` — every field the type
 *  requires, only `id`/`senderType` varied per test. */
function makeMessage(
  overrides: Partial<AgentConversationMessageDTO> = {}
): AgentConversationMessageDTO {
  return {
    id: 'conversation_msg_1' as AgentConversationMessageDTO['id'],
    conversationId: 'conversation_suggest' as ConversationDTO['id'],
    ticketId: null,
    senderType: 'visitor',
    content: 'It is still broken',
    createdAt: '2026-07-09T00:00:00.000Z',
    author: null,
    attachments: [],
    citations: [],
    isAssistant: false,
    isInternal: false,
    contentJson: null,
    viaEmail: false,
    systemEvent: null,
    reactions: [],
    flaggedAt: null,
    postSuggestion: null,
    translatedFrom: null,
    ...overrides,
  } as AgentConversationMessageDTO
}

describe('AgentConversationThread — openCopilotToken forwarding', () => {
  it("the route's openCopilotToken reaches the detail panel UNTOUCHED", async () => {
    // The route owns the one open-Copilot signal; this component forwards it
    // verbatim (no local counter merged in), so the panel's 0-sentinel
    // semantics read the route's real token.
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    client.setQueryData(['conv-thread', 'conversation_suggest'], {
      hasMore: false,
      conversation: makeConversation({ id: 'conversation_suggest' as ConversationDTO['id'] }),
      messages: [makeMessage({ id: 'conversation_msg_1' as never, senderType: 'visitor' })],
    })
    render(
      <QueryClientProvider client={client}>
        <AgentConversationThread
          item={{ kind: 'conversation', id: 'conversation_suggest' } as never}
          targetMessageId={null}
          onChanged={vi.fn()}
          onBack={vi.fn()}
          onSelectItem={vi.fn()}
          onOpenPost={vi.fn()}
          isVisitorTyping={false}
          isOtherAgentTyping={false}
          openCopilotToken={7}
        />
      </QueryClientProvider>
    )
    expect(await screen.findByTestId('inbox-detail-panel')).toHaveAttribute(
      'data-open-copilot-token',
      '7'
    )
  })
})

describe('AgentConversationThread — close with a linked ticket', () => {
  const openLink: LinkedTicketSummary = {
    id: 'ticket_9' as LinkedTicketSummary['id'],
    number: 1042,
    title: 'Billing issue',
    statusName: 'Open',
    statusCategory: 'open',
  }

  it('a plain close (no linked ticket) skips the confirm and closes directly', async () => {
    renderThread({ kind: 'conversation', id: 'conversation_1' })
    fireEvent.click(await screen.findByRole('button', { name: 'Close' }))
    await waitFor(() => expect(setConversationStatusFn).toHaveBeenCalled())
    expect(screen.queryByText(/is still open/)).not.toBeInTheDocument()
    expect(setTicketStatusFn).not.toHaveBeenCalled()
  })

  it('closing with an OPEN linked ticket asks first; "Close conversation only" leaves the ticket alone', async () => {
    mockTicketLink.value = openLink
    renderThread({ kind: 'conversation', id: 'conversation_1' })
    fireEvent.click(await screen.findByRole('button', { name: 'Close' }))
    expect(await screen.findByText('Ticket #1042 is still open')).toBeInTheDocument()
    // Nothing has happened yet — the guard held the close.
    expect(setConversationStatusFn).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Close conversation only' }))
    await waitFor(() => expect(setConversationStatusFn).toHaveBeenCalled())
    expect(setTicketStatusFn).not.toHaveBeenCalled()
  })

  it('"Resolve ticket and close" stamps the resolved status on the linked ticket, then closes', async () => {
    mockTicketLink.value = openLink
    // A closed-category default that ISN'T 'resolved' proves the resolve
    // picks the 'resolved' slug over resolveDefaultClosedStatusId's default.
    mockTicketStatuses.value = [
      { id: 'ticket_status_new', slug: 'new', category: 'open', isDefault: true },
      { id: 'ticket_status_wont_do', slug: 'wont_do', category: 'closed', isDefault: true },
      { id: 'ticket_status_resolved', slug: 'resolved', category: 'closed', isDefault: false },
    ]
    // useSetTicketStatus seeds the detail cache with the fn's return value.
    vi.mocked(setTicketStatusFn).mockResolvedValue({
      ...mockTicket,
      id: 'ticket_9',
    } as TicketDTO)
    renderThread({ kind: 'conversation', id: 'conversation_1' })
    fireEvent.click(await screen.findByRole('button', { name: 'Close' }))
    expect(await screen.findByText('Ticket #1042 is still open')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Resolve ticket and close' }))
    await waitFor(() => expect(setConversationStatusFn).toHaveBeenCalled())
    expect(setTicketStatusFn).toHaveBeenCalledWith({
      data: { ticketId: 'ticket_9', statusId: 'ticket_status_resolved' },
    })
  })

  it('a closed-category linked ticket skips the confirm entirely', async () => {
    mockTicketLink.value = { ...openLink, statusName: 'Resolved', statusCategory: 'closed' }
    renderThread({ kind: 'conversation', id: 'conversation_1' })
    fireEvent.click(await screen.findByRole('button', { name: 'Close' }))
    await waitFor(() => expect(setConversationStatusFn).toHaveBeenCalled())
    expect(screen.queryByText(/is still open/)).not.toBeInTheDocument()
    expect(setTicketStatusFn).not.toHaveBeenCalled()
  })
})

describe('AgentConversationThread — B24 ticket-permission gating', () => {
  const openLink: LinkedTicketSummary = {
    id: 'ticket_9' as LinkedTicketSummary['id'],
    number: 1042,
    title: 'Billing issue',
    statusName: 'Open',
    statusCategory: 'open',
  }

  it('a view-only agent (no ticket.set_status) gets the inert status chip, not the dropdown', async () => {
    routeContextState.permissions = ['ticket.view']
    renderThread({ kind: 'ticket', id: 'ticket_1' })
    expect(await screen.findByTestId('ticket-status-chip')).toBeInTheDocument()
    expect(screen.queryByTestId('ticket-status-control')).not.toBeInTheDocument()
  })

  it('an agent without ticket.view sees no linked-ticket pill on a conversation (the 403-bound detail fetch stays disabled)', async () => {
    routeContextState.permissions = []
    mockTicketLink.value = openLink
    renderThread({ kind: 'conversation', id: 'conversation_1' })
    // The thread itself renders fine — only the ticket affordance is gone.
    await screen.findByRole('button', { name: 'Reply' })
    expect(screen.queryByTestId('ticket-status-control')).not.toBeInTheDocument()
    expect(screen.queryByTestId('ticket-status-chip')).not.toBeInTheDocument()
  })

  it('the close confirm hides "Resolve ticket and close" without ticket.set_status', async () => {
    routeContextState.permissions = ['ticket.view']
    mockTicketLink.value = openLink
    renderThread({ kind: 'conversation', id: 'conversation_1' })
    fireEvent.click(await screen.findByRole('button', { name: 'Close' }))
    expect(await screen.findByText('Ticket #1042 is still open')).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Resolve ticket and close' })
    ).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Close conversation only' }))
    await waitFor(() => expect(setConversationStatusFn).toHaveBeenCalled())
    expect(setTicketStatusFn).not.toHaveBeenCalled()
  })
})

describe('AgentConversationThread — composer focus handle', () => {
  function renderWithHandle(item: { kind: 'conversation' | 'ticket'; id: string }) {
    const composerRef = createRef<ThreadComposerHandle>()
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={client}>
        <AgentConversationThread
          item={item as never}
          targetMessageId={null}
          onChanged={vi.fn()}
          onBack={vi.fn()}
          onSelectItem={vi.fn()}
          onOpenPost={vi.fn()}
          isVisitorTyping={false}
          isOtherAgentTyping={false}
          composerRef={composerRef}
        />
      </QueryClientProvider>
    )
    return composerRef
  }

  it('focusComposer("note") switches the thread into note mode and focuses the note editor', async () => {
    const composerRef = renderWithHandle({ kind: 'conversation', id: 'conversation_1' })
    const reply = await screen.findByTestId('editor')
    expect(reply).toHaveAttribute('placeholder', 'Type your reply…')

    act(() => composerRef.current?.focusComposer('note'))

    // The note editor replaces the reply editor in the same commit; the focus
    // lands on the newly mounted one, not the unmounted reply editor.
    const note = screen.getByTestId('editor')
    expect(note).toHaveAttribute('placeholder', 'Add an internal note for your team…')
    expect(document.activeElement).toBe(note)
  })

  it('marks the composer box so the inbox Escape binding can find it from the editor', async () => {
    const composerRef = renderWithHandle({ kind: 'conversation', id: 'conversation_1' })
    const editor = await screen.findByTestId('editor')
    expect(editor.closest('[data-inbox-composer]')).not.toBeNull()

    // The marker follows the note composer too — the modes share one box.
    act(() => composerRef.current?.focusComposer('note'))
    expect(screen.getByTestId('editor').closest('[data-inbox-composer]')).not.toBeNull()
  })

  it('pasting an image on the composer stages the attachment tray, not an inline node', async () => {
    renderWithHandle({ kind: 'conversation', id: 'conversation_1' })
    const editor = await screen.findByTestId('editor')
    const box = editor.closest('[data-inbox-composer]')
    expect(box).not.toBeNull()
    const file = new File([new Uint8Array([1, 2, 3])], 'shot.png', { type: 'image/png' })
    fireEvent.paste(box as HTMLElement, {
      clipboardData: { files: [file], items: [] },
    })
    expect(addFiles).toHaveBeenCalledWith([file])
  })

  it('dropping an image on the composer stages the attachment tray, not an inline node (C1)', async () => {
    addFiles.mockClear()
    renderWithHandle({ kind: 'conversation', id: 'conversation_1' })
    const editor = await screen.findByTestId('editor')
    const box = editor.closest('[data-inbox-composer]') as HTMLElement
    const file = new File([new Uint8Array([1, 2, 3])], 'shot.png', { type: 'image/png' })

    // A handled drop is a cancelled one — the browser must not also navigate to
    // the file or drop it into the contenteditable.
    const handled = fireEvent.drop(box, { dataTransfer: { files: [file], items: [] } })

    expect(handled).toBe(false)
    expect(addFiles).toHaveBeenCalledWith([file])
  })

  it('leaves a drop carrying no image to the browser (C1)', async () => {
    addFiles.mockClear()
    renderWithHandle({ kind: 'conversation', id: 'conversation_1' })
    const editor = await screen.findByTestId('editor')
    const box = editor.closest('[data-inbox-composer]') as HTMLElement
    const notes = new File(['hello'], 'notes.txt', { type: 'text/plain' })

    expect(fireEvent.drop(box, { dataTransfer: { files: [notes], items: [] } })).toBe(true)
    expect(fireEvent.drop(box, { dataTransfer: { files: [], items: [] } })).toBe(true)
    expect(addFiles).not.toHaveBeenCalled()
  })

  it('shows an upload failure as a toast carrying the error’s own message (C5)', async () => {
    toastError.mockClear()
    renderWithHandle({ kind: 'conversation', id: 'conversation_1' })
    await screen.findByTestId('editor')

    expect(imageUploadOptions.current?.onError).toBeTypeOf('function')
    imageUploadOptions.current!.onError!(new Error('The storage bucket is full'))

    expect(toastError).toHaveBeenCalledWith('The storage bucket is full')
  })

  it('focusComposer("reply") focuses the reply editor already showing, leaving the mode alone', async () => {
    const composerRef = renderWithHandle({ kind: 'conversation', id: 'conversation_1' })
    await screen.findByTestId('editor')

    act(() => composerRef.current?.focusComposer('reply'))

    const editor = screen.getByTestId('editor')
    expect(editor).toHaveAttribute('placeholder', 'Type your reply…')
    expect(document.activeElement).toBe(editor)
  })

  it('a note-only ticket coerces focusComposer("reply") onto the note composer', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    client.setQueryData(['ticket-detail', 'ticket_tracker'], {
      ...mockTicket,
      id: 'ticket_tracker',
      type: 'tracker',
    })
    client.setQueryData(['ticket-thread', 'ticket_tracker'], mockTicketThread)
    const composerRef = createRef<ThreadComposerHandle>()
    render(
      <QueryClientProvider client={client}>
        <AgentConversationThread
          item={{ kind: 'ticket', id: 'ticket_tracker' } as never}
          targetMessageId={null}
          onChanged={vi.fn()}
          onBack={vi.fn()}
          onSelectItem={vi.fn()}
          onOpenPost={vi.fn()}
          isVisitorTyping={false}
          isOtherAgentTyping={false}
          composerRef={composerRef}
        />
      </QueryClientProvider>
    )
    await screen.findByTestId('editor')

    act(() => composerRef.current?.focusComposer('reply'))

    const editor = screen.getByTestId('editor')
    expect(editor).toHaveAttribute('placeholder', 'Add an internal note for your team…')
    expect(document.activeElement).toBe(editor)
  })

  it('openMacros() opens the macro picker on the open conversation', async () => {
    const composerRef = renderWithHandle({ kind: 'conversation', id: 'conversation_1' })
    const picker = await screen.findByTestId('macro-picker')
    expect(picker).toHaveAttribute('data-open', 'false')

    act(() => composerRef.current?.openMacros())

    expect(screen.getByTestId('macro-picker')).toHaveAttribute('data-open', 'true')
  })

  it('openMacros() from note mode returns the thread to reply and opens the picker', async () => {
    const composerRef = renderWithHandle({ kind: 'conversation', id: 'conversation_1' })
    await screen.findByTestId('editor')
    act(() => composerRef.current?.focusComposer('note'))
    expect(screen.queryByTestId('macro-picker')).not.toBeInTheDocument()

    act(() => composerRef.current?.openMacros())

    expect(screen.getByTestId('editor')).toHaveAttribute('placeholder', 'Type your reply…')
    expect(screen.getByTestId('macro-picker')).toHaveAttribute('data-open', 'true')
  })

  it('openMacros() is a no-op on a note-only ticket (no picker renders there)', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    client.setQueryData(['ticket-detail', 'ticket_tracker'], {
      ...mockTicket,
      id: 'ticket_tracker',
      type: 'tracker',
    })
    client.setQueryData(['ticket-thread', 'ticket_tracker'], mockTicketThread)
    const composerRef = createRef<ThreadComposerHandle>()
    render(
      <QueryClientProvider client={client}>
        <AgentConversationThread
          item={{ kind: 'ticket', id: 'ticket_tracker' } as never}
          targetMessageId={null}
          onChanged={vi.fn()}
          onBack={vi.fn()}
          onSelectItem={vi.fn()}
          onOpenPost={vi.fn()}
          isVisitorTyping={false}
          isOtherAgentTyping={false}
          composerRef={composerRef}
        />
      </QueryClientProvider>
    )
    await screen.findByTestId('editor')

    act(() => composerRef.current?.openMacros())

    expect(screen.queryByTestId('macro-picker')).not.toBeInTheDocument()
  })
})

/** The inbox composer's send lifecycle — focus hand-back, the in-place clear,
 *  and what happens to a draft whose send failed. Contract group C is quoted
 *  in this file's header. */
describe('AgentConversationThread — composer send lifecycle', () => {
  /** A promise whose settlement this test controls, so a send can be held in
   *  flight while the test moves focus or types on. */
  function deferred<T>() {
    let resolve!: (value: T) => void
    let reject!: (reason: unknown) => void
    const promise = new Promise<T>((res, rej) => {
      resolve = res
      reject = rej
    })
    return { promise, resolve, reject }
  }

  // The composer schedules its post-restore focus on the next animation frame.
  // Queue the callbacks instead of running them, so a test can flush them once
  // the remount it is waiting for has actually committed.
  const frameQueue: FrameRequestCallback[] = []
  function flushFrames() {
    const queued = frameQueue.splice(0)
    act(() => {
      for (const callback of queued) callback(0)
    })
  }

  beforeEach(() => {
    frameQueue.length = 0
    editorProbe.reset()
    composerAiProbe.activeDraftText = ''
    // vi.clearAllMocks() (file-level afterEach) clears calls, not
    // implementations — so each test below sets its own, and these start from
    // nothing rather than from the previous test's leftovers.
    vi.mocked(sendAgentMessageFn).mockReset()
    vi.mocked(addConversationNoteFn).mockReset()
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frameQueue.push(callback)
      return frameQueue.length
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  const TYPED_JSON = {
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hello' }] }],
  }
  const RETYPED_JSON = {
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Typed anew' }] }],
  }

  function renderComposer() {
    const composerRef = createRef<ThreadComposerHandle>()
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    })
    render(
      <QueryClientProvider client={client}>
        <AgentConversationThread
          item={{ kind: 'conversation', id: 'conversation_1' } as never}
          targetMessageId={null}
          onChanged={vi.fn()}
          onBack={vi.fn()}
          onSelectItem={vi.fn()}
          onOpenPost={vi.fn()}
          isVisitorTyping={false}
          isOtherAgentTyping={false}
          composerRef={composerRef}
        />
      </QueryClientProvider>
    )
    return composerRef
  }

  /** Wait until the thread query has settled, so the placeholder no longer
   *  changes underneath a mount count taken afterwards. */
  async function settledReplyComposer() {
    const editor = await screen.findByTestId('editor')
    await waitFor(() => expect(editor).toHaveAttribute('placeholder', 'Type your reply…'))
    return editor
  }

  /** Report typing the way the real editor does: json + html + markdown. */
  function typeIntoComposer(json: unknown, markdown: string) {
    act(() => {
      editorProbe.onChange?.(json, '', markdown)
    })
  }

  /** The server's own reply to a successful send. */
  function sentMessage() {
    return {
      conversation: makeConversation(),
      message: makeMessage({
        id: 'conversation_msg_sent' as AgentConversationMessageDTO['id'],
        senderType: 'agent',
        content: 'Hello',
      }),
    }
  }

  it('hands focus back to the composer when the send controls still hold it (C1)', async () => {
    const inFlight = deferred<unknown>()
    vi.mocked(sendAgentMessageFn).mockReturnValue(inFlight.promise as never)
    renderComposer()
    const editor = await settledReplyComposer()
    typeIntoComposer(TYPED_JSON, 'Hello')

    fireEvent.click(screen.getByRole('button', { name: 'Send reply' }))
    // The send itself puts the caret back in the editor, which is inside the
    // composer box — the state the hand-back is allowed to act on.
    expect(document.activeElement).toBe(editor)
    expect(editor.closest('[data-inbox-composer]')).not.toBeNull()
    const focusCallsBeforeCompletion = editorProbe.focusCalls.length

    await act(async () => {
      inFlight.resolve(sentMessage())
      await inFlight.promise
    })
    await waitFor(() => expect(clearAttachments).toHaveBeenCalled())

    expect(editorProbe.focusCalls.length).toBe(focusCallsBeforeCompletion + 1)
    expect(editorProbe.focusCalls.at(-1)).toBe('end')
  })

  it('hands focus back to the composer when nothing holds focus at all (C1)', async () => {
    const inFlight = deferred<unknown>()
    vi.mocked(sendAgentMessageFn).mockReturnValue(inFlight.promise as never)
    renderComposer()
    await settledReplyComposer()
    typeIntoComposer(TYPED_JSON, 'Hello')

    fireEvent.click(screen.getByRole('button', { name: 'Send reply' }))
    act(() => (document.activeElement as HTMLElement | null)?.blur())
    expect(document.activeElement).toBe(document.body)
    const focusCallsBeforeCompletion = editorProbe.focusCalls.length

    await act(async () => {
      inFlight.resolve(sentMessage())
      await inFlight.promise
    })
    await waitFor(() => expect(clearAttachments).toHaveBeenCalled())

    expect(editorProbe.focusCalls.length).toBe(focusCallsBeforeCompletion + 1)
    expect(editorProbe.focusCalls.at(-1)).toBe('end')
  })

  it('never yanks focus back from a control the agent moved to mid-flight (C1)', async () => {
    const inFlight = deferred<unknown>()
    vi.mocked(sendAgentMessageFn).mockReturnValue(inFlight.promise as never)
    renderComposer()
    await settledReplyComposer()
    typeIntoComposer(TYPED_JSON, 'Hello')

    fireEvent.click(screen.getByRole('button', { name: 'Send reply' }))
    // A triage control in the header — outside the composer box, which is what
    // the guard reads.
    const elsewhere = screen.getByRole('button', { name: 'Close' })
    expect(elsewhere.closest('[data-inbox-composer]')).toBeNull()
    act(() => elsewhere.focus())
    expect(document.activeElement).toBe(elsewhere)
    const focusCallsBeforeCompletion = editorProbe.focusCalls.length

    await act(async () => {
      inFlight.resolve(sentMessage())
      await inFlight.promise
    })
    await waitFor(() => expect(clearAttachments).toHaveBeenCalled())

    expect(editorProbe.focusCalls.length).toBe(focusCallsBeforeCompletion)
    expect(document.activeElement).toBe(elsewhere)
  })

  it('hands focus back after a note is added, under the same guard (C1)', async () => {
    const inFlight = deferred<unknown>()
    vi.mocked(addConversationNoteFn).mockReturnValue(inFlight.promise as never)
    const composerRef = renderComposer()
    await settledReplyComposer()
    act(() => composerRef.current?.focusComposer('note'))
    const note = screen.getByTestId('editor')
    expect(note).toHaveAttribute('placeholder', 'Add an internal note for your team…')
    typeIntoComposer(TYPED_JSON, 'Hello')

    fireEvent.click(screen.getByRole('button', { name: 'Add note' }))
    expect(document.activeElement).toBe(note)
    const focusCallsBeforeCompletion = editorProbe.focusCalls.length

    await act(async () => {
      inFlight.resolve(sentMessage())
      await inFlight.promise
    })
    await waitFor(() => expect(clearAttachments).toHaveBeenCalled())

    expect(editorProbe.focusCalls.length).toBe(focusCallsBeforeCompletion + 1)
    expect(editorProbe.focusCalls.at(-1)).toBe('end')
  })

  it('clears the composer in place on send and keeps the caret in it (C2)', async () => {
    const inFlight = deferred<unknown>()
    vi.mocked(sendAgentMessageFn).mockReturnValue(inFlight.promise as never)
    renderComposer()
    const editor = await settledReplyComposer()
    typeIntoComposer(TYPED_JSON, 'Hello')
    const mountsBeforeSend = editorProbe.mounts

    fireEvent.click(screen.getByRole('button', { name: 'Send reply' }))

    // Cleared imperatively, with the state mirroring it — and the caret left
    // where it was, because nothing remounted the editing surface.
    expect(editorProbe.clearCalls).toBe(1)
    expect(editorProbe.focusCalls.at(-1)).toBe('end')
    expect(document.activeElement).toBe(editor)

    await act(async () => {
      inFlight.resolve(sentMessage())
      await inFlight.promise
    })
    await waitFor(() => expect(clearAttachments).toHaveBeenCalled())

    expect(editorProbe.mounts).toBe(mountsBeforeSend)
    expect(screen.getByTestId('editor')).toBe(editor)
    expect(editorProbe.value).toBe('')
  })

  it('restores the failed draft verbatim into an untouched reply composer (C3)', async () => {
    const inFlight = deferred<unknown>()
    vi.mocked(sendAgentMessageFn).mockReturnValue(inFlight.promise as never)
    renderComposer()
    await settledReplyComposer()
    typeIntoComposer(TYPED_JSON, 'Hello')
    const mountsBeforeSend = editorProbe.mounts

    fireEvent.click(screen.getByRole('button', { name: 'Send reply' }))
    expect(editorProbe.value).toBe('')

    await act(async () => {
      inFlight.reject(new Error('the network went away'))
      await inFlight.promise.catch(() => {})
    })

    await waitFor(() => expect(editorProbe.value).toEqual(TYPED_JSON))
    // Verbatim means the document itself, which only a remount can re-seed.
    expect(editorProbe.mounts).toBe(mountsBeforeSend + 1)
    expect(composerAiProbe.activeDraftText).toBe('Hello')
    expect(toastError).toHaveBeenCalledWith('Failed to send message')

    flushFrames()
    expect(editorProbe.focusCalls.at(-1)).toBe('end')
  })

  it('restores the failed draft verbatim into an untouched note composer (C3)', async () => {
    const inFlight = deferred<unknown>()
    vi.mocked(addConversationNoteFn).mockReturnValue(inFlight.promise as never)
    const composerRef = renderComposer()
    await settledReplyComposer()
    act(() => composerRef.current?.focusComposer('note'))
    typeIntoComposer(TYPED_JSON, 'Hello')
    const mountsBeforeSend = editorProbe.mounts

    fireEvent.click(screen.getByRole('button', { name: 'Add note' }))
    expect(editorProbe.value).toBe('')

    await act(async () => {
      inFlight.reject(new Error('the network went away'))
      await inFlight.promise.catch(() => {})
    })

    await waitFor(() => expect(editorProbe.value).toEqual(TYPED_JSON))
    expect(editorProbe.mounts).toBe(mountsBeforeSend + 1)
    expect(screen.getByTestId('editor')).toHaveAttribute(
      'placeholder',
      'Add an internal note for your team…'
    )
    expect(toastError).toHaveBeenCalledWith('Failed to add note')

    flushFrames()
    expect(editorProbe.focusCalls.at(-1)).toBe('end')
  })

  it('keeps new reply typing on top and the failed text below a separator (C4)', async () => {
    const inFlight = deferred<unknown>()
    vi.mocked(sendAgentMessageFn).mockReturnValue(inFlight.promise as never)
    renderComposer()
    await settledReplyComposer()
    typeIntoComposer(TYPED_JSON, 'Hello')
    const mountsBeforeSend = editorProbe.mounts

    fireEvent.click(screen.getByRole('button', { name: 'Send reply' }))
    // The composer stays editable mid-flight; the trailing blank line proves
    // the merge strips it rather than stacking four newlines.
    typeIntoComposer(RETYPED_JSON, 'Typed anew\n\n')

    await act(async () => {
      inFlight.reject(new Error('the network went away'))
      await inFlight.promise.catch(() => {})
    })

    await waitFor(() =>
      expect(editorProbe.value).toEqual({
        type: 'doc',
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: 'Typed anew' }] },
          {
            type: 'paragraph',
            content: [{ type: 'text', text: '— failed to send, kept below —' }],
          },
          { type: 'paragraph', content: [{ type: 'text', text: 'Hello' }] },
        ],
      })
    )
    expect(composerAiProbe.activeDraftText).toBe(
      'Typed anew\n\n--- failed to send, kept below ---\n\nHello'
    )
    expect(editorProbe.mounts).toBe(mountsBeforeSend + 1)
    expect(toastError).toHaveBeenCalledWith('Failed to send message — kept below your new typing')

    flushFrames()
    expect(editorProbe.focusCalls.at(-1)).toBe('end')
  })

  it('keeps new note typing on top and the failed note below a separator (C4)', async () => {
    const inFlight = deferred<unknown>()
    vi.mocked(addConversationNoteFn).mockReturnValue(inFlight.promise as never)
    const composerRef = renderComposer()
    await settledReplyComposer()
    act(() => composerRef.current?.focusComposer('note'))
    typeIntoComposer(TYPED_JSON, 'Hello')
    const mountsBeforeSend = editorProbe.mounts

    fireEvent.click(screen.getByRole('button', { name: 'Add note' }))
    typeIntoComposer(RETYPED_JSON, 'Typed anew\n\n')

    await act(async () => {
      inFlight.reject(new Error('the network went away'))
      await inFlight.promise.catch(() => {})
    })

    await waitFor(() =>
      expect(editorProbe.value).toEqual({
        type: 'doc',
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: 'Typed anew' }] },
          {
            type: 'paragraph',
            content: [{ type: 'text', text: '— failed to send, kept below —' }],
          },
          { type: 'paragraph', content: [{ type: 'text', text: 'Hello' }] },
        ],
      })
    )
    expect(composerAiProbe.activeDraftText).toBe(
      'Typed anew\n\n--- failed to send, kept below ---\n\nHello'
    )
    expect(editorProbe.mounts).toBe(mountsBeforeSend + 1)
    expect(screen.getByTestId('editor')).toHaveAttribute(
      'placeholder',
      'Add an internal note for your team…'
    )
    expect(toastError).toHaveBeenCalledWith('Failed to send message — kept below your new typing')

    flushFrames()
    expect(editorProbe.focusCalls.at(-1)).toBe('end')
  })

  it('keeps every node of both drafts, in order, around the separator (C4)', async () => {
    // The generator reaches: one- and many-paragraph drafts on each side of the
    // merge, and a new draft that ends in nothing, a newline, several
    // newlines, or a tab — the states the merge's own trailing-whitespace
    // handling distinguishes. Trailing whitespace is a NON-INTERFERENCE input:
    // the drafts' own text never carries any, so however much of it the agent
    // leaves behind, the merged result must read the same.
    const paragraphTexts = fc.array(fc.constantFrom('alpha', 'beta', 'gamma', 'delta'), {
      minLength: 1,
      maxLength: 3,
    })
    const document = (texts: readonly string[]) => ({
      type: 'doc',
      content: texts.map((text) => ({ type: 'paragraph', content: [{ type: 'text', text }] })),
    })

    await fc.assert(
      fc.asyncProperty(
        paragraphTexts,
        paragraphTexts,
        fc.constantFrom('', '\n', '\n\n\n', '  ', '\t'),
        async (failedTexts, retypedTexts, trailing) => {
          cleanup()
          editorProbe.reset()
          frameQueue.length = 0
          const inFlight = deferred<unknown>()
          vi.mocked(sendAgentMessageFn)
            .mockReset()
            .mockReturnValue(inFlight.promise as never)

          renderComposer()
          await settledReplyComposer()
          const failedMarkdown = failedTexts.join('\n\n')
          const retypedMarkdown = retypedTexts.join('\n\n')
          typeIntoComposer(document(failedTexts), failedMarkdown)

          fireEvent.click(screen.getByRole('button', { name: 'Send reply' }))
          typeIntoComposer(document(retypedTexts), retypedMarkdown + trailing)

          await act(async () => {
            inFlight.reject(new Error('the network went away'))
            await inFlight.promise.catch(() => {})
          })

          await waitFor(() =>
            expect(editorProbe.value).toEqual({
              type: 'doc',
              content: [
                ...document(retypedTexts).content,
                {
                  type: 'paragraph',
                  content: [{ type: 'text', text: '— failed to send, kept below —' }],
                },
                ...document(failedTexts).content,
              ],
            })
          )
          expect(composerAiProbe.activeDraftText).toBe(
            `${retypedMarkdown}\n\n--- failed to send, kept below ---\n\n${failedMarkdown}`
          )
        }
      ),
      { numRuns: 12 }
    )
  })

  // The two "Send untranslated" fallbacks re-clear the composer the failure
  // restored, resend, and put the caret back on the next frame. That is C2's
  // guarantee applied to the retry — with the one difference that the re-clear
  // remounts the editor rather than clearing it in place (see the report).
  for (const [label, message, description] of [
    [
      'an image the translation cannot carry',
      TRANSLATION_RICH_CONTENT_MESSAGE,
      'Translation cannot carry images or embeds. Send untranslated to keep them, or remove them and try again.',
    ],
    [
      'a translation that is unavailable',
      TRANSLATION_UNAVAILABLE_MESSAGE,
      'Send it in your own language instead, or try again.',
    ],
  ] as const) {
    it(`"Send untranslated" after ${label} resends, re-clears and refocuses (C2)`, async () => {
      const inFlight = deferred<unknown>()
      vi.mocked(sendAgentMessageFn).mockReturnValue(inFlight.promise as never)
      renderComposer()
      await settledReplyComposer()
      typeIntoComposer(TYPED_JSON, 'Hello')

      fireEvent.click(screen.getByRole('button', { name: 'Send reply' }))
      await act(async () => {
        inFlight.reject(new Error(message))
        await inFlight.promise.catch(() => {})
      })

      // The blocked send restored the draft, so the offer has something to
      // resend and something to re-clear.
      await waitFor(() => expect(editorProbe.value).toEqual(TYPED_JSON))
      const [title, options] = toastError.mock.calls.at(-1) as [
        string,
        { description: string; action: { label: string; onClick: () => void } },
      ]
      expect(title).toBe('Could not translate your reply.')
      expect(options.description).toBe(description)
      expect(options.action.label).toBe('Send untranslated')

      // Drain the restore's own scheduled focus first, so what the offer
      // schedules is the only frame left to account for.
      flushFrames()
      const mountsBeforeRetry = editorProbe.mounts
      const focusCallsBeforeRetry = editorProbe.focusCalls.length
      // The retry is left in flight so the only focus that follows is the
      // scheduled one.
      vi.mocked(sendAgentMessageFn).mockReturnValue(new Promise(() => {}) as never)
      await act(async () => options.action.onClick())

      expect(vi.mocked(sendAgentMessageFn).mock.calls.at(-1)?.[0]).toMatchObject({
        data: { content: 'Hello', skipTranslation: true },
      })
      expect(editorProbe.mounts).toBe(mountsBeforeRetry + 1)
      expect(editorProbe.value).toBe('')

      flushFrames()
      expect(editorProbe.focusCalls.length).toBe(focusCallsBeforeRetry + 1)
      expect(editorProbe.focusCalls.at(-1)).toBe('end')
    })
  }
})
