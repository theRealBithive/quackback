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
import { createPortal } from 'react-dom'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

/**
 * The trigger's own text, with the chevron/indicator glyphs stripped, so an
 * assertion reads the label the user sees and nothing else.
 */
function triggerText(): string {
  const trigger = screen.getByLabelText('Letter')
  return (trigger.textContent ?? '').trim()
}

describe('Select', () => {
  afterEach(cleanup)

  it('picks up an item that mounts after the trigger, follows its label, and forgets it on unmount (U1)', async () => {
    function Harness({ label, showItem }: { label: string; showItem: boolean }) {
      return (
        <Select value="a">
          <SelectTrigger aria-label="Letter">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectLabel>Letters</SelectLabel>
              {showItem ? <SelectItem value="a">{label}</SelectItem> : null}
            </SelectGroup>
          </SelectContent>
        </Select>
      )
    }

    const view = render(<Harness label="Alpha" showItem={false} />)

    // Nothing is registered for "a" yet, so the trigger falls back to the value.
    expect(triggerText()).toBe('a')

    await userEvent.click(screen.getByLabelText('Letter'))
    view.rerender(<Harness label="Alpha" showItem />)
    await waitFor(() => expect(triggerText()).toBe('Alpha'))

    view.rerender(<Harness label="Alpha (renamed)" showItem />)
    await waitFor(() => expect(triggerText()).toBe('Alpha (renamed)'))

    view.rerender(<Harness label="Alpha (renamed)" showItem={false} />)
    await waitFor(() => expect(triggerText()).toBe('a'))
  })

  it('shows the label of the selected item once the list has been opened (U1)', async () => {
    render(
      <Select value="b">
        <SelectTrigger aria-label="Letter">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            <SelectLabel>Letters</SelectLabel>
            <SelectItem value="a">Alpha</SelectItem>
            <SelectItem value="b">Bravo</SelectItem>
          </SelectGroup>
        </SelectContent>
      </Select>
    )

    expect(triggerText()).toBe('Bravo')

    await userEvent.click(screen.getByLabelText('Letter'))
    expect(await screen.findByRole('option', { name: 'Alpha' })).toBeInTheDocument()
    expect(triggerText()).toBe('Bravo')
  })

  it('shows an item that carries no readable text as itself, never as its raw value (U1)', async () => {
    render(
      <Select value="starred">
        <SelectTrigger aria-label="Letter">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            <SelectLabel>Letters</SelectLabel>
            <SelectItem value="starred">
              <svg data-testid="star-glyph" aria-hidden />
            </SelectItem>
          </SelectGroup>
        </SelectContent>
      </Select>
    )

    expect(triggerText()).toBe('')
    expect(screen.getAllByTestId('star-glyph').length).toBeGreaterThan(0)
  })

  it('forgets a value once, even when two items claimed it (U1)', async () => {
    function Harness({ showItems }: { showItems: boolean }) {
      return (
        <Select value="a">
          <SelectTrigger aria-label="Letter">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectLabel>Letters</SelectLabel>
              {showItems ? (
                <>
                  <SelectItem value="a">Alpha</SelectItem>
                  <SelectItem value="a">Alternative alpha</SelectItem>
                </>
              ) : null}
            </SelectGroup>
          </SelectContent>
        </Select>
      )
    }

    const view = render(<Harness showItems />)
    await userEvent.click(screen.getByLabelText('Letter'))
    await waitFor(() => expect(triggerText()).toBe('Alternative alpha'))

    view.rerender(<Harness showItems={false} />)
    await waitFor(() => expect(triggerText()).toBe('a'))
  })

  it('treats a label that renders through a portal as carrying no readable text (U1)', async () => {
    function Harness() {
      return (
        <Select value="portaled">
          <SelectTrigger aria-label="Letter">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectLabel>Letters</SelectLabel>
              <SelectItem value="portaled">
                {createPortal(<span data-testid="portaled-label">Elsewhere</span>, document.body)}
              </SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>
      )
    }

    render(<Harness />)

    expect(triggerText()).toBe('')
    expect(screen.getAllByTestId('portaled-label').length).toBeGreaterThan(0)
  })
})
