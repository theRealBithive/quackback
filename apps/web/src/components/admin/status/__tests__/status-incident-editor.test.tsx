// @vitest-environment happy-dom
/**
 * ## F — Forms
 * - F1 Typing in a post, changelog or help-center article editor updates the form's content as markdown and marks the form dirty, without running validation on each keystroke.
 * - F2 A checkbox that feeds a boolean setting (ticket field required, incident restores the status) stores true for a checked box and false for an unchecked one.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { generateId } from '@quackback/ids'

const postUpdate = vi.hoisted(() => ({ mutateAsync: vi.fn() }))

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
  Link: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}))

// The editor reads its search params off the route; the id under test comes in
// as a prop, so an empty search is all the hook needs.
vi.mock('@/routes/admin/status', () => ({
  Route: { useSearch: () => ({}) },
}))

vi.mock('@/lib/client/mutations/status', () => ({
  useUpdateStatusIncident: () => ({ mutateAsync: vi.fn().mockResolvedValue(undefined) }),
  usePostStatusIncidentUpdate: () => ({
    mutateAsync: postUpdate.mutateAsync,
    isPending: false,
  }),
}))

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

// The affected-components picker and the template picker own their own
// queries; the composer's restore box is what is under test here.
vi.mock('../status-incident-fields', () => ({
  AffectedComponentsField: () => null,
  TemplatePickerButton: () => null,
}))

import { StatusIncidentModal } from '../status-incident-editor'
import { statusKeys } from '@/lib/client/queries/status'

function renderEditor() {
  const incidentId = generateId('status_incident')
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  // A monitoring incident: the composer's next stage is "resolved", which is
  // the terminal step that offers the restore box.
  queryClient.setQueryData(statusKeys.incidentDetail(incidentId), {
    id: incidentId,
    kind: 'incident',
    title: 'Login outage',
    status: 'monitoring',
    impact: 'major',
    impactOverride: false,
    affectedComponents: [],
    scheduledStartAt: null,
    scheduledEndAt: null,
    autoStart: false,
    autoComplete: false,
    backfilled: false,
    notifiedAt: null,
    startedAt: new Date('2026-09-01T10:00:00.000Z').toISOString(),
    resolvedAt: null,
    updates: [],
  })

  render(
    <QueryClientProvider client={queryClient}>
      <StatusIncidentModal incidentId={incidentId} />
    </QueryClientProvider>
  )
  return incidentId
}

async function writeUpdate() {
  const composer = await screen.findByPlaceholderText(/What's the latest/)
  await userEvent.type(composer, 'Traffic is back to normal.')
}

describe('StatusIncidentEditor restore checkbox', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    postUpdate.mutateAsync.mockResolvedValue(undefined)
  })
  afterEach(cleanup)

  it('keeps the restore box checked by default, so the post does not skip it (F2)', async () => {
    const incidentId = renderEditor()
    await writeUpdate()

    const box = await screen.findByRole('checkbox', {
      name: 'Restore affected services to operational',
    })
    expect(box).toBeChecked()

    await userEvent.click(screen.getByRole('button', { name: /Post update/ }))

    await waitFor(() => expect(postUpdate.mutateAsync).toHaveBeenCalledTimes(1))
    expect(postUpdate.mutateAsync.mock.calls[0]![0]).toMatchObject({
      id: incidentId,
      status: 'resolved',
      skipRestore: false,
    })
  })

  it('skips the restore once the box is cleared (F2)', async () => {
    renderEditor()
    await writeUpdate()

    await userEvent.click(
      await screen.findByRole('checkbox', { name: 'Restore affected services to operational' })
    )

    await userEvent.click(screen.getByRole('button', { name: /Post update/ }))

    await waitFor(() => expect(postUpdate.mutateAsync).toHaveBeenCalledTimes(1))
    expect(postUpdate.mutateAsync.mock.calls[0]![0]).toMatchObject({ skipRestore: true })
  })
})
