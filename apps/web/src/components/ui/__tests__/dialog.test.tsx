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
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'

describe('Dialog triggers given an explicit render element', () => {
  afterEach(cleanup)

  it('opens from a design-system Button flattened into a native button (U3)', async () => {
    render(
      <>
        <Button variant="destructive" size="sm">
          Reference
        </Button>
        <Dialog>
          <DialogTrigger render={<Button variant="destructive" size="sm" />}>Open</DialogTrigger>
          <DialogContent>
            <DialogTitle>Archive this board</DialogTitle>
          </DialogContent>
        </Dialog>
      </>
    )

    const trigger = screen.getByRole('button', { name: 'Open' })
    expect(trigger.tagName).toBe('BUTTON')
    // The flattened host keeps the styles the Button would have carried.
    expect(trigger.className).toBe(screen.getByRole('button', { name: 'Reference' }).className)

    await userEvent.click(trigger)
    expect(await screen.findByRole('dialog')).toHaveTextContent('Archive this board')
  })

  it('opens from a render element that is not a button at all (U3)', async () => {
    render(
      <Dialog>
        <DialogTrigger render={<span />}>Open as span</DialogTrigger>
        <DialogContent>
          <DialogTitle>Archive this board</DialogTitle>
        </DialogContent>
      </Dialog>
    )

    const trigger = screen.getByText('Open as span')
    expect(trigger.tagName).toBe('SPAN')

    await userEvent.click(trigger)
    expect(await screen.findByRole('dialog')).toHaveTextContent('Archive this board')
  })

  it('closes from a close control given its own render element (U3)', async () => {
    render(
      <Dialog defaultOpen>
        <DialogContent showCloseButton={false}>
          <DialogTitle>Archive this board</DialogTitle>
          <DialogClose render={<Button variant="outline" />}>Not now</DialogClose>
        </DialogContent>
      </Dialog>
    )

    expect(await screen.findByRole('dialog')).toBeInTheDocument()

    const close = screen.getByRole('button', { name: 'Not now' })
    expect(close.tagName).toBe('BUTTON')
    await userEvent.click(close)

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })
})
