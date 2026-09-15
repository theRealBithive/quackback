// @vitest-environment happy-dom
/**
 * ## U — Base UI wrappers
 * - U1 A Select shows the label of its selected item, also when the item mounts after the trigger or changes its label later, and forgets the label when the item unmounts; an item without readable text shows nothing rather than its raw value.
 * - U2 A Slider reports its value as a list with one entry per thumb, for one thumb and for several.
 * - U3 An overlay trigger (dialog, alert dialog, popover) given an explicit render element attaches open and close to that element; a design-system Button in that place is flattened to a native button that keeps its styles, so the overlay actually opens.
 * - U4 A ref passed to a popover trigger or anchor reaches the DOM node, whether it is a callback ref or an object ref, and the popover's own positioning receives the same node.
 * - U5 Dropdown-menu groups and context-menu submenus render their children.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Slider } from '@/components/ui/slider'

function thumbs(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>('[data-slot="slider-thumb"]'))
}

describe('Slider', () => {
  afterEach(cleanup)

  it('reports a single-thumb value as a one-entry list (U2)', async () => {
    const onValueChange = vi.fn()
    render(<Slider defaultValue={[10]} onValueChange={onValueChange} aria-label="Volume" />)

    expect(thumbs()).toHaveLength(1)

    const control = screen.getByRole('slider')
    control.focus()
    await userEvent.keyboard('{ArrowRight}')

    await waitFor(() => expect(onValueChange).toHaveBeenCalled())
    const reported = onValueChange.mock.calls[0]![0] as unknown
    expect(Array.isArray(reported)).toBe(true)
    expect(reported).toEqual([11])
  })

  it('reports a list even when the value was never declared as one (U2)', async () => {
    const onValueChange = vi.fn()
    render(<Slider onValueChange={onValueChange} aria-label="Opacity" />)

    expect(thumbs()).toHaveLength(1)

    screen.getByRole('slider').focus()
    await userEvent.keyboard('{ArrowRight}')

    await waitFor(() => expect(onValueChange).toHaveBeenCalled())
    const reported = onValueChange.mock.calls[0]![0] as unknown
    expect(Array.isArray(reported)).toBe(true)
    expect(reported).toEqual([1])
  })

  it('reports a two-thumb value as a two-entry list (U2)', async () => {
    const onValueChange = vi.fn()
    render(<Slider value={[10, 20]} onValueChange={onValueChange} aria-label="Range" />)

    expect(thumbs()).toHaveLength(2)

    const controls = screen.getAllByRole('slider')
    expect(controls).toHaveLength(2)
    controls[1]!.focus()
    await userEvent.keyboard('{ArrowRight}')

    await waitFor(() => expect(onValueChange).toHaveBeenCalled())
    const reported = onValueChange.mock.calls[0]![0] as unknown
    expect(Array.isArray(reported)).toBe(true)
    expect(reported).toEqual([10, 21])
  })

  it('stays silent, rather than failing, when nobody is listening (U2)', async () => {
    render(<Slider defaultValue={[10, 20, 30]} aria-label="Bands" />)

    expect(thumbs()).toHaveLength(3)

    const controls = screen.getAllByRole('slider')
    controls[0]!.focus()
    await userEvent.keyboard('{ArrowRight}')

    expect(thumbs()).toHaveLength(3)
  })
})
