// @vitest-environment happy-dom
/**
 * ## M — Admin menus moved to dropdown items
 * - M1 Every entry of the migrated admin menus does what its label says: workflow Edit navigates and View runs opens the runs; a saved view applies its filters and Save is offered only with active filters; Link existing issue opens the picker and Create new issue creates one; Merge opens the merge dialog; Block, Unblock and Remove act or open their confirmation; a connector policy entry changes the policy.
 * - M2 A menu entry that opens a confirmation (workflow Delete) does so after the menu has closed, so the dialog, not the menu, receives focus.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { TicketExternalLinkId, TicketId } from '@quackback/ids'

// ticketQueries imports the whole ticket fn module; stub it so no server code
// loads.
vi.mock('@/lib/server/functions/tickets', () => ({
  fetchTicketExternalLinksFn: vi.fn(),
  createTicketIssueFn: vi.fn(),
  linkTicketIssueFn: vi.fn(),
  unlinkTicketIssueFn: vi.fn(),
  getTicketLinksFn: vi.fn(),
  listTicketsFn: vi.fn().mockResolvedValue([]),
  linkTicketToTrackerFn: vi.fn(),
  unlinkTicketFromTrackerFn: vi.fn(),
  getTicketFn: vi.fn(),
  listTicketStatusesFn: vi.fn(),
  getTicketStageLabelsFn: vi.fn(),
  listTicketMessagesFn: vi.fn(),
}))

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))

import { TicketTrackerLinks } from '../ticket-tracker-links'
import { ticketKeys } from '@/lib/client/queries/inbox'
import { createTicketIssueFn } from '@/lib/server/functions/tickets'

const TICKET_ID = 'ticket_1' as TicketId

function renderTracker(tracker: { canLink: boolean; canCreate: boolean }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  queryClient.setQueryData(ticketKeys.externalLinks(TICKET_ID), {
    links: [],
    trackers: [{ integrationType: 'github', name: 'GitHub', ...tracker }],
  })
  render(
    <QueryClientProvider client={queryClient}>
      <TicketTrackerLinks ticketId={TICKET_ID} onChanged={vi.fn()} />
    </QueryClientProvider>
  )
}

describe('TicketTrackerLinks add-issue menu', () => {
  beforeEach(() => {
    vi.mocked(createTicketIssueFn).mockReset()
    vi.mocked(createTicketIssueFn).mockResolvedValue({
      id: 'ticket_external_link_1' as TicketExternalLinkId,
      integrationType: 'github',
      externalId: '1',
      externalDisplayId: '#1',
      externalUrl: 'https://example.test/1',
      createdAt: new Date('2026-09-01T00:00:00.000Z'),
    })
  })
  afterEach(cleanup)

  it('opens the issue picker from Link existing issue (M1)', async () => {
    renderTracker({ canLink: true, canCreate: true })

    await userEvent.click(await screen.findByRole('button', { name: /Add issue/ }))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Link existing issue…' }))

    expect(await screen.findByLabelText('GitHub issue URL or reference')).toBeInTheDocument()
    expect(createTicketIssueFn).not.toHaveBeenCalled()
  })

  it('creates an issue from Create new issue (M1)', async () => {
    renderTracker({ canLink: true, canCreate: true })

    await userEvent.click(await screen.findByRole('button', { name: /Add issue/ }))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Create new issue' }))

    await waitFor(() => expect(createTicketIssueFn).toHaveBeenCalledTimes(1))
    expect(createTicketIssueFn).toHaveBeenCalledWith({
      data: { ticketId: TICKET_ID, integrationType: 'github' },
    })
    expect(screen.queryByLabelText('GitHub issue URL or reference')).toBeNull()
  })

  it('needs no menu when the tracker offers only one of the two (M1)', async () => {
    renderTracker({ canLink: true, canCreate: false })

    expect(await screen.findByRole('button', { name: /Link issue/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Add issue/ })).toBeNull()
  })
})
