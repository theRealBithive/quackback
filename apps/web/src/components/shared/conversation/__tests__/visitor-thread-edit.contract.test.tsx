// @vitest-environment happy-dom
/**
 * What the customer sees of an edited support message, in their own language.
 *
 * Contract for the batch G pick (upstream ccf8f0521 #580, "edit and delete your
 * own support messages") -- the confirmed list items this suite pins on the
 * customer's side (verbatim):
 *
 *   G3 An edited message keeps its place in the thread and carries an "(edited)" mark; saving an unchanged body is not an edit and leaves no mark.
 *   G4 An edit to a customer-visible message reaches the customer's widget and the ticket thread live; an edit to an internal note never reaches the customer.
 *
 * The widget thread is rendered under the German catalogue and asserted
 * against `de.json`: English is what `defaultMessage` says as well, so an
 * English assertion would pass whether or not the catalogue is consulted.
 * The live stream is replaced by a handle the test pushes frames through, the
 * same frames the SSE connection delivers.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, cleanup, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type {
  ConversationMessageDTO,
  ConversationStreamEvent,
} from '@/lib/shared/conversation/types'
import { renderInGerman } from '@/test/render-with-intl'
import de from '@/locales/de.json'
import en from '@/locales/en.json'

const { stream, getMyConversationFn } = vi.hoisted(() => ({
  stream: { push: null as null | ((event: unknown) => void) },
  getMyConversationFn: vi.fn(),
}))
vi.mock('@/lib/server/functions/conversation', () => ({
  getMyConversationFn: (...args: unknown[]) => getMyConversationFn(...args),
  listConversationMessagesFn: vi.fn(async () => ({ messages: [], hasMore: false })),
  sendConversationMessageFn: vi.fn(),
  mintConversationStreamTokenFn: vi.fn(async () => ({ token: null })),
  submitCsatFn: vi.fn(async () => ({})),
  markConversationReadFn: vi.fn(async () => ({})),
}))
vi.mock('@/lib/server/functions/tickets', () => ({
  getConversationLinkedTicketFn: vi.fn(async () => null),
}))
vi.mock('@/lib/server/functions/widget-capabilities', () => ({
  getWidgetCapabilitiesFn: vi.fn(async () => ({ chat: { mode: 'poll', pollIntervalMs: 60_000 } })),
}))
vi.mock('@/lib/client/hooks/use-conversation-stream', () => ({
  useConversationStream: (options: { onEvent: (event: unknown) => void }) => {
    stream.push = options.onEvent
    return { connected: true }
  },
}))
vi.mock('@/components/ui/rich-text-editor', () => ({
  RichTextEditor: () => <textarea aria-label="composer" />,
}))

// The virtualized viewport measures real layout, which a DOM without layout
// cannot give; a plain list shows the same rows in the same order.
vi.mock('@/components/conversation/thread', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/components/conversation/thread')>()),
  ThreadViewport: ({
    rows,
    renderRow,
  }: {
    rows: { key: string }[]
    renderRow: (row: unknown) => React.ReactNode
  }) => (
    <div data-testid="thread-viewport">
      {rows.map((row) => (
        <div key={row.key}>{renderRow(row)}</div>
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
  useMarkReadOnIncoming: () => {},
}))

import { VisitorConversationThread } from '../visitor-conversation-thread'

const CONVERSATION_ID = 'conversation_1'
const EDIT_STAMP = '2026-07-02T12:00:00.000Z'
const PRESENCE = { agentsOnline: true, withinOfficeHours: true, nextOpenAt: null }

function message(
  index: number,
  senderType: 'visitor' | 'agent',
  content: string,
  editedAt: string | null = null
): ConversationMessageDTO {
  return {
    id: `conversation_msg_${index}`,
    conversationId: CONVERSATION_ID,
    ticketId: null,
    senderType,
    content,
    createdAt: `2026-07-01T00:00:0${index}.000Z`,
    editedAt,
    author: { principalId: `principal_${index}`, displayName: 'Alex', avatarUrl: null },
    attachments: [],
    citations: [],
    isAssistant: false,
    isInternal: false,
    contentJson: null,
    viaEmail: false,
    systemEvent: null,
  } as unknown as ConversationMessageDTO
}

function pushFrame(event: ConversationStreamEvent) {
  act(() => stream.push?.(event))
}

async function renderGermanThread(messages: ConversationMessageDTO[]) {
  getMyConversationFn.mockResolvedValue({
    conversation: { id: CONVERSATION_ID, status: 'open', agentLastReadAt: null, csatRating: null },
    messages,
    hasMore: false,
    teamName: 'Acme',
    canEmailVisitor: false,
  })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  renderInGerman(
    <QueryClientProvider client={client}>
      <VisitorConversationThread
        conversationTarget={CONVERSATION_ID as never}
        sessionVersion={1}
        uploadImage={async () => 'https://example.test/image.png'}
        presence={PRESENCE}
        showHeader={false}
      />
    </QueryClientProvider>
  )
  await screen.findByText(messages[0].content)
}

beforeEach(() => {
  stream.push = null
})
afterEach(cleanup)

describe('the customer thread marks edited messages in German (G3)', () => {
  it('the German mark differs from the English one, so the assertions below prove the catalogue (G3)', () => {
    const german = (de as Record<string, string>)['widget.messenger.edited']
    const english = (en as Record<string, string>)['widget.messenger.edited']
    expect(german).toBe('(bearbeitet)')
    expect(german).not.toBe(english)
  })

  it('shows "(bearbeitet)" on exactly the edited message and keeps the thread order (G3)', async () => {
    const mark = (de as Record<string, string>)['widget.messenger.edited']
    await renderGermanThread([
      message(1, 'visitor', 'Hello team'),
      message(2, 'agent', 'We fixed it', EDIT_STAMP),
      message(3, 'agent', 'Anything else?'),
    ])

    expect(screen.getAllByText(mark)).toHaveLength(1)
    expect(screen.queryByText('(edited)')).toBeNull()
    const editedBody = screen.getByText('We fixed it')
    const nextBody = screen.getByText('Anything else?')
    const markElement = screen.getByText(mark)
    // The mark sits between the edited body and the next message's body, so it
    // belongs to the edited message and the order is the order sent.
    expect(
      editedBody.compareDocumentPosition(markElement) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
    expect(
      markElement.compareDocumentPosition(nextBody) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
    expect(
      screen.getByText('Hello team').compareDocumentPosition(editedBody) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
  })

  it('a message_edited frame replaces the text live and adds the mark (G3, G4)', async () => {
    const mark = (de as Record<string, string>)['widget.messenger.edited']
    await renderGermanThread([
      message(1, 'visitor', 'Hello team'),
      message(2, 'agent', 'We will look'),
    ])
    expect(screen.queryByText(mark)).toBeNull()

    pushFrame({
      kind: 'message_edited',
      conversationId: CONVERSATION_ID as never,
      message: message(2, 'agent', 'We looked: it works now', EDIT_STAMP),
    })

    await waitFor(() => expect(screen.getByText('We looked: it works now')).toBeTruthy())
    expect(screen.queryByText('We will look')).toBeNull()
    expect(screen.getAllByText(mark)).toHaveLength(1)
  })

  it('an agent-side update naming an internal note never shows it to the customer (G4)', async () => {
    await renderGermanThread([
      message(1, 'visitor', 'Hello team'),
      message(2, 'agent', 'Public reply'),
    ])

    pushFrame({
      kind: 'message_updated',
      conversationId: CONVERSATION_ID as never,
      message: {
        ...message(3, 'agent', 'Internal: customer is difficult', EDIT_STAMP),
        isInternal: true,
        reactions: [],
        flaggedAt: null,
        postSuggestion: null,
        translatedFrom: null,
      } as never,
    })
    // An edit frame that names a message the customer never received is
    // dropped, not appended as if it were new.
    pushFrame({
      kind: 'message_edited',
      conversationId: CONVERSATION_ID as never,
      message: {
        ...message(3, 'agent', 'Internal: customer is difficult', EDIT_STAMP),
        isInternal: true,
      },
    })

    expect(screen.queryByText('Internal: customer is difficult')).toBeNull()
    expect(screen.getByText('Public reply')).toBeTruthy()
  })
})
