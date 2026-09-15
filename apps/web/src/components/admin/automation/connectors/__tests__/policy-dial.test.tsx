// @vitest-environment happy-dom
/**
 * ## M — Admin menus moved to dropdown items
 * - M1 Every entry of the migrated admin menus does what its label says: workflow Edit navigates and View runs opens the runs; a saved view applies its filters and Save is offered only with active filters; Link existing issue opens the picker and Create new issue creates one; Merge opens the merge dialog; Block, Unblock and Remove act or open their confirmation; a connector policy entry changes the policy.
 * - M2 A menu entry that opens a confirmation (workflow Delete) does so after the menu has closed, so the dialog, not the menu, receives focus.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PolicyDial, PolicyDefaultSelect } from '../policy-dial'

describe('PolicyDial', () => {
  afterEach(cleanup)

  it('exposes the three mockup states as radios', async () => {
    const onChange = vi.fn()
    render(<PolicyDial value="approval" onChange={onChange} labelledBy="extend_trial" />)
    expect(screen.getByRole('radio', { name: 'Always allow' })).toHaveAttribute(
      'aria-checked',
      'false'
    )
    expect(screen.getByRole('radio', { name: 'Needs approval' })).toHaveAttribute(
      'aria-checked',
      'true'
    )
    await userEvent.click(screen.getByRole('radio', { name: 'Never' }))
    expect(onChange).toHaveBeenCalledWith('never')
  })
})

describe('PolicyDefaultSelect', () => {
  afterEach(cleanup)

  it('changes the default policy to the entry that was chosen (M1)', async () => {
    const onChange = vi.fn()
    render(<PolicyDefaultSelect value="approval" onChange={onChange} />)

    await userEvent.click(screen.getByRole('button', { name: /Needs approval/ }))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Never' }))

    expect(onChange).toHaveBeenCalledWith('never')
  })

  it('offers every policy, not only the one already in force (M1)', async () => {
    const onChange = vi.fn()
    render(<PolicyDefaultSelect value="never" onChange={onChange} />)

    await userEvent.click(screen.getByRole('button', { name: /Never/ }))

    expect(await screen.findByRole('menuitem', { name: 'Always allow' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Needs approval' })).toBeInTheDocument()

    await userEvent.click(screen.getByRole('menuitem', { name: 'Always allow' }))
    expect(onChange).toHaveBeenCalledWith('always')
  })
})
