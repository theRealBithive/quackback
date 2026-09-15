// @vitest-environment happy-dom
/**
 * ## U — Base UI wrappers
 * - U1 A Select shows the label of its selected item, also when the item mounts after the trigger or changes its label later, and forgets the label when the item unmounts; an item without readable text shows nothing rather than its raw value.
 * - U2 A Slider reports its value as a list with one entry per thumb, for one thumb and for several.
 * - U3 An overlay trigger (dialog, alert dialog, popover) given an explicit render element attaches open and close to that element; a design-system Button in that place is flattened to a native button that keeps its styles, so the overlay actually opens.
 * - U4 A ref passed to a popover trigger or anchor reaches the DOM node, whether it is a callback ref or an object ref, and the popover's own positioning receives the same node.
 * - U5 Dropdown-menu groups and context-menu submenus render their children.
 */
import { createRef, useState } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Button } from '@/components/ui/button'
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from '@/components/ui/popover'

describe('Popover', () => {
  afterEach(cleanup)

  it('opens from a design-system Button flattened into a native button (U3)', async () => {
    render(
      <>
        <Button variant="outline" size="sm">
          Reference
        </Button>
        <Popover>
          <PopoverTrigger render={<Button variant="outline" size="sm" />}>Filters</PopoverTrigger>
          <PopoverContent>Only open posts</PopoverContent>
        </Popover>
      </>
    )

    const trigger = screen.getByRole('button', { name: 'Filters' })
    expect(trigger.tagName).toBe('BUTTON')
    expect(trigger.className).toBe(screen.getByRole('button', { name: 'Reference' }).className)

    await userEvent.click(trigger)
    expect(await screen.findByText('Only open posts')).toBeInTheDocument()

    // The same element carries the close half of the toggle.
    await userEvent.click(trigger)
    await waitFor(() => expect(screen.queryByText('Only open posts')).toBeNull())
  })

  it('hands the trigger node to a callback ref (U4)', async () => {
    let captured: HTMLElement | null = null

    render(
      <Popover>
        <PopoverTrigger
          ref={(node: HTMLElement | null) => {
            captured = node
          }}
        >
          Filters
        </PopoverTrigger>
        <PopoverContent>Only open posts</PopoverContent>
      </Popover>
    )

    const trigger = screen.getByRole('button', { name: 'Filters' })
    expect(captured).toBe(trigger)

    // The same node is what the popover opens against.
    await userEvent.click(trigger)
    expect(await screen.findByText('Only open posts')).toBeInTheDocument()
  })

  it('hands the trigger node to an object ref (U4)', () => {
    const ref = createRef<HTMLButtonElement>()

    render(
      <Popover>
        <PopoverTrigger ref={ref}>Filters</PopoverTrigger>
        <PopoverContent>Only open posts</PopoverContent>
      </Popover>
    )

    expect(ref.current).toBe(screen.getByRole('button', { name: 'Filters' }))
  })

  it('hands the anchor node to the anchored element own object ref (U4)', async () => {
    const ref = createRef<HTMLDivElement>()

    render(
      <Popover>
        <PopoverAnchor asChild>
          <div ref={ref} data-testid="anchor-child">
            Selection
          </div>
        </PopoverAnchor>
        <PopoverTrigger>Filters</PopoverTrigger>
        <PopoverContent>Only open posts</PopoverContent>
      </Popover>
    )

    const anchored = screen.getByTestId('anchor-child')
    expect(ref.current).toBe(anchored)

    // The node the ref saw is the node the popover positions against: opening
    // the popover with that element as the anchor still resolves.
    await userEvent.click(screen.getByRole('button', { name: 'Filters' }))
    expect(await screen.findByText('Only open posts')).toBeInTheDocument()
  })

  it('hands the anchor node to the anchored element own callback ref (U4)', () => {
    function Harness() {
      const [seen, setSeen] = useState<string | null>(null)
      return (
        <Popover>
          <PopoverAnchor asChild>
            <div
              ref={(node: HTMLElement | null) =>
                setSeen(node ? (node.dataset.testid ?? null) : null)
              }
              data-testid="anchor-child"
            >
              Selection
            </div>
          </PopoverAnchor>
          <PopoverTrigger>Filters</PopoverTrigger>
          <PopoverContent>Only open posts</PopoverContent>
          <output data-testid="seen">{seen ?? 'nothing'}</output>
        </Popover>
      )
    }

    render(<Harness />)

    expect(screen.getByTestId('seen')).toHaveTextContent('anchor-child')
  })

  it('wraps a plain anchor in its own element when no child is nominated (U4)', async () => {
    render(
      <Popover>
        <PopoverAnchor className="anchor-box">Selection</PopoverAnchor>
        <PopoverTrigger>Filters</PopoverTrigger>
        <PopoverContent>Only open posts</PopoverContent>
      </Popover>
    )

    const anchor = document.querySelector('[data-slot="popover-anchor"]')
    expect(anchor).not.toBeNull()
    expect(anchor).toHaveTextContent('Selection')
    expect(anchor).toHaveClass('anchor-box')

    await userEvent.click(screen.getByRole('button', { name: 'Filters' }))
    expect(await screen.findByText('Only open posts')).toBeInTheDocument()
  })
})
