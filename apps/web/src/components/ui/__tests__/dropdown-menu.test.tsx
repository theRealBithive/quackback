// @vitest-environment happy-dom
/**
 * ## U — Base UI wrappers
 * - U1 A Select shows the label of its selected item, also when the item mounts after the trigger or changes its label later, and forgets the label when the item unmounts; an item without readable text shows nothing rather than its raw value.
 * - U2 A Slider reports its value as a list with one entry per thumb, for one thumb and for several.
 * - U3 An overlay trigger (dialog, alert dialog, popover) given an explicit render element attaches open and close to that element; a design-system Button in that place is flattened to a native button that keeps its styles, so the overlay actually opens.
 * - U4 A ref passed to a popover trigger or anchor reaches the DOM node, whether it is a callback ref or an object ref, and the popover's own positioning receives the same node.
 * - U5 Dropdown-menu groups and context-menu submenus render their children.
 */
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

describe('DropdownMenuContent', () => {
  it('does not throw when disablePortal is set (inbox composer heading menu)', () => {
    expect(() =>
      render(
        <DropdownMenu defaultOpen>
          <DropdownMenuTrigger>Text</DropdownMenuTrigger>
          <DropdownMenuContent disablePortal>
            <DropdownMenuItem>Heading 1</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )
    ).not.toThrow(/Menu\.Portal/)
    expect(screen.getByRole('menuitem', { name: 'Heading 1' })).toBeInTheDocument()
  })
})

describe('DropdownMenuGroup', () => {
  it('renders its children inside the open menu (U5)', async () => {
    render(
      <DropdownMenu defaultOpen>
        <DropdownMenuTrigger>Actions</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuGroup>
            <DropdownMenuLabel>Danger zone</DropdownMenuLabel>
            <DropdownMenuItem>Archive</DropdownMenuItem>
            <DropdownMenuItem>Delete</DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    )

    const group = await screen.findByRole('group')
    expect(group).toHaveAttribute('data-slot', 'dropdown-menu-group')
    expect(group).toHaveTextContent('Danger zone')
    expect(screen.getByRole('menuitem', { name: 'Archive' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Delete' })).toBeInTheDocument()
  })
})
