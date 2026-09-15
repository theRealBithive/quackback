// @vitest-environment happy-dom
/**
 * ## M — Admin menus moved to dropdown items
 * - M1 Every entry of the migrated admin menus does what its label says: workflow Edit navigates and View runs opens the runs; a saved view applies its filters and Save is offered only with active filters; Link existing issue opens the picker and Create new issue creates one; Merge opens the merge dialog; Block, Unblock and Remove act or open their confirmation; a connector policy entry changes the policy.
 * - M2 A menu entry that opens a confirmation (workflow Delete) does so after the menu has closed, so the dialog, not the menu, receives focus.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { InboxFilters } from '@/lib/shared/types'

// post-views queries pull the whole server-function module in; stub it so no
// server code loads.
vi.mock('@/lib/server/functions/post-views', () => ({
  listPostViewsFn: vi.fn().mockResolvedValue([]),
  createPostViewFn: vi.fn(),
  deletePostViewFn: vi.fn(),
}))

import { SavedViewsMenu } from '../saved-views-menu'

const SAVED_VIEW = {
  id: 'post_view_1',
  name: 'Open bugs',
  filters: { status: ['open'], tags: ['bug'], minVotes: 5 },
}

function renderMenu(options: { views?: unknown[]; hasActiveFilters?: boolean } = {}) {
  const onApply = vi.fn()
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  queryClient.setQueryData(['admin', 'post-views'], options.views ?? [SAVED_VIEW])
  const filters: InboxFilters = { status: ['open'] }

  render(
    <QueryClientProvider client={queryClient}>
      <SavedViewsMenu
        filters={filters}
        hasActiveFilters={options.hasActiveFilters ?? true}
        onApply={onApply}
      />
    </QueryClientProvider>
  )
  return onApply
}

async function openMenu() {
  await userEvent.click(screen.getByRole('button', { name: /Views/ }))
}

describe('SavedViewsMenu', () => {
  afterEach(cleanup)

  it('applies the stored filter set of the view that was chosen (M1)', async () => {
    const onApply = renderMenu()
    await openMenu()

    await userEvent.click(await screen.findByRole('menuitem', { name: /Open bugs/ }))

    expect(onApply).toHaveBeenCalledTimes(1)
    expect(onApply).toHaveBeenCalledWith({ status: ['open'], tags: ['bug'], minVotes: 5 })
  })

  it('offers saving the current filters, and opens the naming dialog (M1)', async () => {
    renderMenu({ hasActiveFilters: true })
    await openMenu()

    const save = await screen.findByRole('menuitem', { name: /Save current filters/ })
    expect(save).not.toHaveAttribute('aria-disabled', 'true')
    await userEvent.click(save)

    expect(await screen.findByText('Save current filters as a view')).toBeInTheDocument()
  })

  it('withholds Save while no filter is active (M1)', async () => {
    renderMenu({ hasActiveFilters: false })
    await openMenu()

    const save = await screen.findByRole('menuitem', { name: /Save current filters/ })
    expect(save).toHaveAttribute('aria-disabled', 'true')

    await userEvent.click(save)
    expect(screen.queryByText('Save current filters as a view')).toBeNull()
  })
})
