// @vitest-environment happy-dom
/**
 * ## U — Base UI wrappers
 * - U1 A Select shows the label of its selected item, also when the item mounts after the trigger or changes its label later, and forgets the label when the item unmounts; an item without readable text shows nothing rather than its raw value.
 * - U2 A Slider reports its value as a list with one entry per thumb, for one thumb and for several.
 * - U3 An overlay trigger (dialog, alert dialog, popover) given an explicit render element attaches open and close to that element; a design-system Button in that place is flattened to a native button that keeps its styles, so the overlay actually opens.
 * - U4 A ref passed to a popover trigger or anchor reaches the DOM node, whether it is a callback ref or an object ref, and the popover's own positioning receives the same node.
 * - U5 Dropdown-menu groups and context-menu submenus render their children.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'

function renderMenu() {
  render(
    <ContextMenu>
      <ContextMenuTrigger>Right-click me</ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem>Open</ContextMenuItem>
        <ContextMenuSub>
          <ContextMenuSubTrigger>Move to</ContextMenuSubTrigger>
          <ContextMenuSubContent>
            <ContextMenuItem>Roadmap</ContextMenuItem>
          </ContextMenuSubContent>
        </ContextMenuSub>
      </ContextMenuContent>
    </ContextMenu>
  )
  fireEvent.contextMenu(screen.getByText('Right-click me'))
}

describe('ContextMenuSub', () => {
  afterEach(cleanup)

  it('renders the submenu trigger inside the open context menu (U5)', async () => {
    renderMenu()

    expect(await screen.findByRole('menuitem', { name: 'Open' })).toBeInTheDocument()
    expect(screen.getByText('Move to')).toBeInTheDocument()
  })

  it('renders the submenu content once the submenu is opened (U5)', async () => {
    renderMenu()

    const subTrigger = await screen.findByText('Move to')
    expect(screen.queryByRole('menuitem', { name: 'Roadmap' })).toBeNull()

    await userEvent.click(subTrigger)

    expect(await screen.findByRole('menuitem', { name: 'Roadmap' })).toBeInTheDocument()
  })
})
