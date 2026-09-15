// @vitest-environment happy-dom
/**
 * ## M — Admin menus moved to dropdown items
 * - M1 Every entry of the migrated admin menus does what its label says: workflow Edit navigates and View runs opens the runs; a saved view applies its filters and Save is offered only with active filters; Link existing issue opens the picker and Create new issue creates one; Merge opens the merge dialog; Block, Unblock and Remove act or open their confirmation; a connector policy entry changes the policy.
 * - M2 A menu entry that opens a confirmation (workflow Delete) does so after the menu has closed, so the dialog, not the menu, receives focus.
 */
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { PrincipalId } from '@quackback/ids'

vi.mock('@/lib/server/functions/admin', () => ({
  listPortalUsersFn: vi.fn().mockResolvedValue({ items: [] }),
  listSegmentsFn: vi.fn().mockResolvedValue([]),
}))

vi.mock('@/lib/client/mutations', () => ({
  useMergeLeadIntoUser: () => ({ mutate: vi.fn(), isPending: false }),
}))

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))

import { MergeLeadControl } from '../merge-lead-control'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

const PRINCIPAL_ID = 'principal_1' as PrincipalId

/**
 * The shape the menu-item mode is built for: the entry lives inside the menu,
 * the dialog outside it — a menu unmounts its content when an entry is chosen,
 * so a dialog nested in it would go with it.
 */
function Harness() {
  const [open, setOpen] = useState(false)
  const shared = {
    principalId: PRINCIPAL_ID,
    leadName: 'Anonymous visitor',
    onMerged: vi.fn(),
    open,
    onOpenChange: setOpen,
  }
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger>More actions</DropdownMenuTrigger>
        <DropdownMenuContent>
          <MergeLeadControl {...shared} mode="menu-item" />
        </DropdownMenuContent>
      </DropdownMenu>
      <MergeLeadControl {...shared} mode="dialog" />
    </>
  )
}

function renderHarness() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <Harness />
    </QueryClientProvider>
  )
}

describe('MergeLeadControl as a menu item', () => {
  afterEach(cleanup)

  it('opens the merge dialog from the Merge entry (M1)', async () => {
    renderHarness()

    await userEvent.click(screen.getByRole('button', { name: 'More actions' }))
    expect(screen.queryByRole('dialog')).toBeNull()

    await userEvent.click(await screen.findByRole('menuitem', { name: 'Merge' }))

    expect(await screen.findByRole('dialog')).toHaveTextContent(
      'Merge Anonymous visitor into a user'
    )
  })
})
