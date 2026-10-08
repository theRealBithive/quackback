// @vitest-environment happy-dom
/**
 * A ticket's date field holds a calendar date ("2026-10-01"). The detail panel
 * shows it like its other dates ("Oct 1, 2026"), as the day it names for
 * every agent: read as a moment it would be Sep 30 west of UTC.
 */
import { render, screen, cleanup } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { IntlProvider } from 'react-intl'
import type { TicketId, TicketTypeId } from '@quackback/ids'
import type { TicketDTO } from '@/lib/server/domains/tickets'
import { ticketKeys } from '@/lib/client/queries/inbox'
import { restoreRuntimeLocale, setRuntimeLocale } from '@/test/runtime-locale'

vi.mock('@/components/admin/inbox/ticket-chips', () => ({
  TicketTypeBadge: () => null,
  TicketStageChip: () => null,
}))
vi.mock('@/components/admin/inbox/ticket-controls', () => ({
  TicketStatusControl: () => null,
  TicketAssigneeControl: () => null,
  TicketPriorityControl: () => null,
  TicketWatchControl: () => null,
}))
vi.mock('@/components/admin/inbox/ticket-links', () => ({ TicketLinks: () => null }))
vi.mock('@/components/admin/conversation/company-card', () => ({ CompanyCard: () => null }))
vi.mock('@/components/admin/users/block-person-control', () => ({
  usePersonBlockStatus: () => ({ blocked: false, isLoading: false }),
}))
vi.mock('@/lib/server/functions/conversation', () => ({
  listConversationsForUserFn: vi.fn().mockResolvedValue({ conversations: [], hasMore: false }),
  getConversationAssistantActivityFn: vi.fn().mockResolvedValue(null),
}))
vi.mock('@/lib/server/functions/admin', () => ({
  getPortalUserFn: vi.fn().mockResolvedValue(null),
}))
vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
  useRouteContext: (opts?: { select?: (context: object) => unknown }) =>
    opts?.select ? opts.select({}) : {},
}))

import { InboxDetailPanel } from '../inbox-detail-panel'

const TYPE_ID = 'ticket_type_1' as TicketTypeId

const ticket = {
  id: 'ticket_1' as TicketId,
  number: 142,
  reference: '#142',
  type: 'customer',
  ticketType: {
    id: TYPE_ID,
    name: 'Bug',
    slug: 'bug',
    category: 'customer',
    icon: null,
    color: '#888',
  },
  title: 'Cannot log in',
  status: { id: 'ticket_status_1', name: 'Open', color: '#10b981', category: 'open' },
  stage: { slot: 'received', label: 'Received' },
  priority: 'high',
  requester: null,
  assignee: { principalId: null, displayName: null, teamId: null, teamName: null },
  company: null,
  firstResponseAt: null,
  dueAt: null,
  resolvedAt: null,
  sla: null,
  createdAt: '2026-09-20T10:00:00.000Z',
  updatedAt: '2026-09-20T10:00:00.000Z',
  reopenedCount: 0,
  customAttributes: { incident_day: '2026-10-01' },
  lastMessagePreview: null,
  lastMessageAt: null,
} as unknown as TicketDTO

afterEach(() => {
  cleanup()
  restoreRuntimeLocale()
})

describe('InboxDetailPanel ticket date field', () => {
  it('shows a date answer as the day it names, west of UTC', () => {
    setRuntimeLocale('en-US', 'America/Los_Angeles')
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    client.setQueryData(ticketKeys.types(), [
      {
        id: TYPE_ID,
        fields: [
          {
            key: 'incident_day',
            label: 'Day it happened',
            type: 'date',
            required: false,
            visibleToCustomer: true,
            order: 0,
          },
        ],
      },
    ])
    render(
      <IntlProvider locale="en" defaultLocale="en">
        <QueryClientProvider client={client}>
          <InboxDetailPanel
            item={{ kind: 'ticket', id: ticket.id }}
            ticket={ticket}
            onChanged={() => {}}
            onSelectItem={() => {}}
            onTrackAsFeedback={() => {}}
            onCreateTicket={() => {}}
            onInsertFromCopilot={() => {}}
          />
        </QueryClientProvider>
      </IntlProvider>
    )

    const row = screen.getByText('Day it happened').closest('div')!.parentElement!
    expect(row.textContent).toContain('Oct 1, 2026')
  })
})

// Batch L contract, T4: A date inside copy of a fixed language (an English admin sentence) stays in that language, so a sentence never mixes languages.
describe('InboxDetailPanel due chip', () => {
  it('keeps the date in its English "Due" title English on a German page (T4)', async () => {
    setRuntimeLocale('de-DE', 'Europe/Berlin')
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    client.setQueryData(ticketKeys.types(), [{ id: TYPE_ID, fields: [] }])
    const dueAt = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString()
    render(
      <IntlProvider locale="de" defaultLocale="en" onError={() => {}}>
        <QueryClientProvider client={client}>
          <InboxDetailPanel
            item={{ kind: 'ticket', id: ticket.id }}
            ticket={{ ...ticket, dueAt }}
            onChanged={() => {}}
            onSelectItem={() => {}}
            onTrackAsFeedback={() => {}}
            onCreateTicket={() => {}}
            onInsertFromCopilot={() => {}}
          />
        </QueryClientProvider>
      </IntlProvider>
    )

    const chip = await screen.findByTitle(/^Due /)
    const title = chip.getAttribute('title')!
    const english = new Intl.DateTimeFormat('en-US', { month: 'short' }).format(new Date(dueAt))
    const german = new Intl.DateTimeFormat('de-DE', { month: 'short' }).format(new Date(dueAt))
    expect(title).toContain(english)
    if (english !== german) expect(title).not.toContain(german)
  })
})
