// @vitest-environment happy-dom
/**
 * A Switch wrapped in a <label> is a pattern this fork uses in about twenty
 * settings forms. Under happy-dom the label used to forward the hidden input's
 * click back onto the button until the stack overflowed, so whether a click
 * toggled the switch was a coin flip (see vitest.setup.ts). These tests pin the
 * browser-like behaviour the shared setup restores:
 *
 * - a click on the switch itself toggles it exactly once, every time;
 * - a click on the label's text still toggles it, exactly once;
 * - a Checkbox inside a <label> behaves the same way.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { Switch } from '@/components/ui/switch'
import { Checkbox } from '@/components/ui/checkbox'

const RENDERS = 25

describe('Switch inside a <label>', () => {
  it('toggles exactly once per click on the switch, across many fresh renders', () => {
    const errors: unknown[] = []
    const onError = (event: ErrorEvent) => {
      errors.push(event.error)
      event.preventDefault()
    }
    window.addEventListener('error', onError)
    const callsPerRender: number[] = []
    for (let i = 0; i < RENDERS; i++) {
      const onCheckedChange = vi.fn()
      render(
        <label>
          <Switch checked={false} onCheckedChange={onCheckedChange} aria-label="Reapply roles" />
          <span>Reapply roles</span>
        </label>
      )
      fireEvent.click(screen.getByRole('switch', { name: 'Reapply roles' }))
      callsPerRender.push(onCheckedChange.mock.calls.length)
      expect(onCheckedChange).toHaveBeenCalledWith(true, expect.anything())
      cleanup()
    }
    window.removeEventListener('error', onError)
    expect(callsPerRender).toEqual(Array.from({ length: RENDERS }, () => 1))
    expect(errors).toEqual([])
  })

  it('toggles exactly once when the label text is clicked', () => {
    const onCheckedChange = vi.fn()
    render(
      <label>
        <Switch checked={false} onCheckedChange={onCheckedChange} aria-label="Reapply roles" />
        <span>Reapply roles</span>
      </label>
    )
    fireEvent.click(screen.getByText('Reapply roles'))
    expect(onCheckedChange).toHaveBeenCalledTimes(1)
    expect(onCheckedChange).toHaveBeenCalledWith(true, expect.anything())
  })
})

describe('Checkbox inside a <label>', () => {
  it('toggles exactly once per click on the box and once per click on the text', () => {
    const onCheckedChange = vi.fn()
    render(
      <label>
        <Checkbox checked={false} onCheckedChange={onCheckedChange} aria-label="Remove branding" />
        <span>Remove branding</span>
      </label>
    )
    fireEvent.click(screen.getByRole('checkbox', { name: 'Remove branding' }))
    expect(onCheckedChange).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByText('Remove branding'))
    expect(onCheckedChange).toHaveBeenCalledTimes(2)
  })
})
