// @vitest-environment happy-dom
/**
 * ## F — Forms
 * - F1 Typing in a post, changelog or help-center article editor updates the form's content as markdown and marks the form dirty, without running validation on each keystroke.
 * - F2 A checkbox that feeds a boolean setting (ticket field required, incident restores the status) stores true for a checked box and false for an unchecked one.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FieldsEditor } from '../fields-editor'
import type { TicketFormField } from '@/lib/shared/tickets'

type FieldsChange = (next: TicketFormField[]) => void

async function openAddFieldDialog(onChange: FieldsChange) {
  render(<FieldsEditor category="customer" fields={[]} onChange={onChange} />)
  await userEvent.click(screen.getByRole('button', { name: /Add field/ }))
  await userEvent.type(screen.getByLabelText('Field name'), 'Order number')
}

function requiredCheckbox(): HTMLElement {
  return screen.getByRole('checkbox', { name: 'Required' })
}

describe('FieldsEditor required checkbox', () => {
  afterEach(cleanup)

  it('stores a boolean true once the box is checked (F2)', async () => {
    const onChange = vi.fn<FieldsChange>()
    await openAddFieldDialog(onChange)

    await userEvent.click(requiredCheckbox())
    await userEvent.click(screen.getByRole('button', { name: 'Add field' }))

    expect(onChange).toHaveBeenCalledTimes(1)
    const [saved] = onChange.mock.calls[0]![0] as Array<{ required: unknown }>
    expect(saved!.required).toBe(true)
  })

  it('stores a boolean false again once the box is cleared (F2)', async () => {
    const onChange = vi.fn<FieldsChange>()
    await openAddFieldDialog(onChange)

    const box = requiredCheckbox()
    await userEvent.click(box)
    await userEvent.click(box)
    await userEvent.click(screen.getByRole('button', { name: 'Add field' }))

    expect(onChange).toHaveBeenCalledTimes(1)
    const [saved] = onChange.mock.calls[0]![0] as Array<{ required: unknown }>
    expect(saved!.required).toBe(false)
  })

  it('leaves an untouched box as a boolean false (F2)', async () => {
    const onChange = vi.fn<FieldsChange>()
    await openAddFieldDialog(onChange)

    await userEvent.click(screen.getByRole('button', { name: 'Add field' }))

    expect(onChange).toHaveBeenCalledTimes(1)
    const [saved] = onChange.mock.calls[0]![0] as Array<{ required: unknown }>
    expect(saved!.required).toBe(false)
  })
})
