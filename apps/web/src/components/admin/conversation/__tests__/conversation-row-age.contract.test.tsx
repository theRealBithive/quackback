// @vitest-environment happy-dom
/**
 * The age on an inbox row, from server render to the minutes after.
 *
 * Contract for the batch F pick (upstream f63d503f8, #624) -- the confirmed
 * list item this suite pins (the component-level law, over generated clocks,
 * is in `components/ui/__tests__/time-ago.contract.test.tsx`):
 *
 *   F22 A row's age reads the same in the server render and the first client
 *       render, then switches to the browser's current value and keeps
 *       updating every minute.
 */
import { act } from 'react'
import { hydrateRoot } from 'react-dom/client'
import { renderToString } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ConversationId, PrincipalId } from '@quackback/ids'
import type { ConversationDTO } from '@/lib/shared/conversation/types'
import type { InboxItemDTO } from '@/lib/shared/inbox/items'
import { ConversationRow } from '../conversation-list-column'

const LAST_MESSAGE_AT = '2026-10-01T03:30:37.700Z'

const conversation: Partial<ConversationDTO> = {
  id: 'conversation_01JTEST' as ConversationId,
  status: 'open',
  priority: 'none',
  channel: 'messenger',
  subject: null,
  lastMessagePreview: 'Where is my order?',
  lastMessageAt: LAST_MESSAGE_AT,
  createdAt: LAST_MESSAGE_AT,
  visitor: {
    principalId: 'principal_visitor' as PrincipalId,
    displayName: 'Rita Visitor',
    avatarUrl: null,
  },
  assignedAgent: null,
  unreadCount: 0,
  visitorLastReadAt: null,
  agentLastReadAt: null,
  csatRating: null,
  visitorEmail: null,
  resolvedAt: null,
  endReason: null,
  endNote: null,
  snoozedUntil: null,
  tags: [],
}

const item: Extract<InboxItemDTO, { kind: 'conversation' }> = {
  kind: 'conversation',
  conversation: conversation as ConversationDTO,
  linkedTicket: null,
  searchSnippet: null,
}

const row = () => (
  <ConversationRow item={item} id={item.conversation.id} selected={false} onSelect={() => {}} />
)

afterEach(() => vi.useRealTimers())

function ageOnRow(container: HTMLElement): string {
  const match = container.textContent?.match(/(\d+[mhd]|now)/)
  return match ? match[1] : ''
}

describe('conversation row age', () => {
  it('(F22) keeps the server age through hydration, shows the browser age, then ticks each minute', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] })
    vi.setSystemTime(new Date('2026-10-01T03:34:37.600Z'))
    const container = document.createElement('div')
    container.innerHTML = renderToString(row())
    expect(ageOnRow(container)).toBe('3m')

    vi.setSystemTime(new Date('2026-10-01T03:34:38.100Z'))
    const errors: unknown[] = []
    await act(async () => {
      hydrateRoot(container, row(), { onRecoverableError: (error) => errors.push(error) })
    })
    expect(errors).toEqual([])
    expect(ageOnRow(container)).toBe('4m')

    await act(async () => {
      vi.advanceTimersByTime(60_000)
    })
    expect(ageOnRow(container)).toBe('5m')
  })
})
