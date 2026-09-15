// @vitest-environment happy-dom
/**
 * ## M — Admin menus moved to dropdown items
 * - M1 Every entry of the migrated admin menus does what its label says: workflow Edit navigates and View runs opens the runs; a saved view applies its filters and Save is offered only with active filters; Link existing issue opens the picker and Create new issue creates one; Merge opens the merge dialog; Block, Unblock and Remove act or open their confirmation; a connector policy entry changes the policy.
 * - M2 A menu entry that opens a confirmation (workflow Delete) does so after the menu has closed, so the dialog, not the menu, receives focus.
 */
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { PrincipalId } from '@quackback/ids'

vi.mock('@/lib/server/functions/blocking', () => ({
  getPersonBlockStatusFn: vi.fn(),
  blockPersonFn: vi.fn(),
  unblockPersonFn: vi.fn(),
}))

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))

import { BlockPersonControl } from '../block-person-control'
import { blockPersonFn, unblockPersonFn } from '@/lib/server/functions/blocking'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

const PRINCIPAL_ID = 'principal_1' as PrincipalId

/**
 * The shape the menu-item mode is built for: the entry lives inside the menu,
 * the confirmation outside it — a menu unmounts its content when an entry is
 * chosen, so a dialog nested in it would go with it.
 */
function Harness() {
  const [open, setOpen] = useState(false)
  const shared = {
    principalId: PRINCIPAL_ID,
    personName: 'Maya Chen',
    open,
    onOpenChange: setOpen,
  }
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger>More actions</DropdownMenuTrigger>
        <DropdownMenuContent>
          <BlockPersonControl {...shared} mode="menu-item" />
        </DropdownMenuContent>
      </DropdownMenu>
      <BlockPersonControl {...shared} mode="dialog" />
    </>
  )
}

function renderInMenu(blockedAt: string | null) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  // The control hides itself while the block status is loading, so the status
  // has to be in the cache before it renders.
  queryClient.setQueryData(['admin', 'person-block-status', PRINCIPAL_ID], { blockedAt })
  render(
    <QueryClientProvider client={queryClient}>
      <Harness />
    </QueryClientProvider>
  )
}

describe('BlockPersonControl as a menu item', () => {
  beforeEach(() => {
    vi.mocked(blockPersonFn).mockReset()
    vi.mocked(blockPersonFn).mockResolvedValue({ ok: true })
    vi.mocked(unblockPersonFn).mockReset()
    vi.mocked(unblockPersonFn).mockResolvedValue({ ok: true })
  })
  afterEach(cleanup)

  it('asks before blocking someone who is not blocked yet (M1)', async () => {
    renderInMenu(null)

    await userEvent.click(screen.getByRole('button', { name: 'More actions' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Block' }))

    expect(await screen.findByText('Block Maya Chen?')).toBeInTheDocument()
    expect(blockPersonFn).not.toHaveBeenCalled()
  })

  it('unblocks straight away, with no confirmation, when they are blocked (M1)', async () => {
    renderInMenu('2026-09-01T00:00:00.000Z')

    await userEvent.click(screen.getByRole('button', { name: 'More actions' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Unblock' }))

    await waitFor(() => expect(unblockPersonFn).toHaveBeenCalledTimes(1))
    expect(unblockPersonFn).toHaveBeenCalledWith({ data: { principalId: PRINCIPAL_ID } })
    expect(screen.queryByText('Block Maya Chen?')).toBeNull()
  })
})
