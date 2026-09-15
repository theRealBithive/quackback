// @vitest-environment happy-dom
/**
 * ## M — Admin menus moved to dropdown items
 * - M1 Every entry of the migrated admin menus does what its label says: workflow Edit navigates and View runs opens the runs; a saved view applies its filters and Save is offered only with active filters; Link existing issue opens the picker and Create new issue creates one; Merge opens the merge dialog; Block, Unblock and Remove act or open their confirmation; a connector policy entry changes the policy.
 * - M2 A menu entry that opens a confirmation (workflow Delete) does so after the menu has closed, so the dialog, not the menu, receives focus.
 */
import { describe, expect, it, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { TicketId } from '@quackback/ids'
import type { TicketDTO } from '@/lib/server/domains/tickets'

// ticketQueries imports the whole ticket fn module; stub it so no server code loads.
vi.mock('@/lib/server/functions/tickets', () => ({
  getTicketLinksFn: vi.fn(),
  listTicketsFn: vi.fn().mockResolvedValue([]),
  linkTicketToTrackerFn: vi.fn(),
  unlinkTicketFromTrackerFn: vi.fn(),
  getTicketFn: vi.fn(),
  listTicketStatusesFn: vi.fn(),
  getTicketStageLabelsFn: vi.fn(),
  listTicketMessagesFn: vi.fn(),
}))

import { TicketLinks } from '../ticket-links'
import { ticketKeys } from '@/lib/client/queries/inbox'
import { listTicketsFn, linkTicketToTrackerFn } from '@/lib/server/functions/tickets'

function ticket(overrides: Partial<TicketDTO> = {}): TicketDTO {
  return {
    id: 'ticket_1' as TicketId,
    number: 142,
    reference: '#142',
    type: 'customer',
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
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    reopenedCount: 0,
    ...overrides,
  } as TicketDTO
}

function renderLinks(t: TicketDTO, links: { tracker: TicketDTO | null; linked: TicketDTO[] }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  qc.setQueryData(ticketKeys.links(t.id), links)
  return render(
    <QueryClientProvider client={qc}>
      <TicketLinks ticket={t} onChanged={vi.fn()} />
    </QueryClientProvider>
  )
}

describe('TicketLinks', () => {
  beforeEach(() => {
    vi.mocked(listTicketsFn).mockResolvedValue([])
    vi.mocked(linkTicketToTrackerFn).mockClear()
  })
  afterEach(cleanup)

  it('a tracker lists the customer tickets it tracks', () => {
    const tracker = ticket({ id: 'ticket_tr' as TicketId, type: 'tracker', reference: '#9' })
    const linked = ticket({ id: 'ticket_c' as TicketId, reference: '#142', title: 'Cannot log in' })
    renderLinks(tracker, { tracker: null, linked: [linked] })
    expect(screen.getByText('Tracking')).toBeTruthy()
    expect(screen.getByText('Attach')).toBeTruthy()
    expect(screen.getByText('#142')).toBeTruthy()
    expect(screen.getByLabelText('Unlink #142')).toBeTruthy()
  })

  it('a customer ticket shows the tracker it belongs to, with an unlink', () => {
    const customer = ticket({ id: 'ticket_c' as TicketId, type: 'customer' })
    const tracker = ticket({
      id: 'ticket_tr' as TicketId,
      type: 'tracker',
      reference: '#9',
      title: 'Login outage',
    })
    renderLinks(customer, { tracker, linked: [] })
    expect(screen.getByText('Tracker')).toBeTruthy() // the row label
    expect(screen.getByText('#9')).toBeTruthy()
    expect(screen.getByLabelText('Unlink from tracker')).toBeTruthy()
  })

  it('an unlinked customer ticket offers to link to a tracker', () => {
    const customer = ticket({ id: 'ticket_c' as TicketId, type: 'customer' })
    renderLinks(customer, { tracker: null, linked: [] })
    expect(screen.getByText('Link to tracker')).toBeTruthy()
  })

  it('a back_office ticket shows no tracker link', () => {
    const bo = ticket({ id: 'ticket_bo' as TicketId, type: 'back_office' })
    renderLinks(bo, { tracker: null, linked: [] })
    expect(screen.getByText('None')).toBeTruthy()
    expect(screen.queryByText('Link to tracker')).toBeNull()
  })
})

describe('TicketLinks picker menu', () => {
  beforeEach(() => {
    vi.mocked(listTicketsFn).mockResolvedValue([])
    vi.mocked(linkTicketToTrackerFn).mockReset()
    vi.mocked(linkTicketToTrackerFn).mockResolvedValue({ success: true })
  })
  afterEach(cleanup)

  it('links the ticket to the tracker the menu entry names (M1)', async () => {
    const customer = ticket({ id: 'ticket_c' as TicketId, type: 'customer' })
    const candidate = ticket({
      id: 'ticket_tr' as TicketId,
      type: 'tracker',
      reference: '#9',
      title: 'Login outage',
    })
    vi.mocked(listTicketsFn).mockResolvedValue([candidate])

    renderLinks(customer, { tracker: null, linked: [] })

    await userEvent.click(await screen.findByRole('button', { name: /Link to tracker/ }))
    await userEvent.click(await screen.findByRole('menuitem', { name: /Login outage/ }))

    await waitFor(() => expect(linkTicketToTrackerFn).toHaveBeenCalledTimes(1))
    expect(linkTicketToTrackerFn).toHaveBeenCalledWith({
      data: { trackerTicketId: 'ticket_tr', ticketId: 'ticket_c' },
    })
  })

  it('never offers the ticket itself as its own tracker (M1)', async () => {
    const customer = ticket({ id: 'ticket_c' as TicketId, type: 'customer' })
    vi.mocked(listTicketsFn).mockResolvedValue([
      customer,
      ticket({
        id: 'ticket_tr' as TicketId,
        type: 'tracker',
        reference: '#9',
        title: 'Login outage',
      }),
    ])

    renderLinks(customer, { tracker: null, linked: [] })

    await userEvent.click(await screen.findByRole('button', { name: /Link to tracker/ }))

    expect(await screen.findByRole('menuitem', { name: /Login outage/ })).toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: /Cannot log in/ })).toBeNull()
  })
})
