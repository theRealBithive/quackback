// @vitest-environment happy-dom
/**
 * ## I — Widget install (upstream #538)
 * - I4 An async confirm dialog stays open until the action settles, ignores a
 *   second click while busy, and a synchronous throw in the action leaves it
 *   open.
 */
import { describe, expect, it, vi } from 'vitest'
import { useState } from 'react'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { ConfirmDialog } from '../confirm-dialog'

// Owns `open` as real state, unlike the other tests in this file that hardcode
// `open` to a literal. Needed for the one test below where whether the dialog
// dismisses is exactly the fact under test: a hardcoded `open` would make
// "still in the document" pass regardless of what the component does.
function StatefulConfirmDialog({ onConfirm }: { onConfirm: () => void | Promise<void> }) {
  const [open, setOpen] = useState(true)
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={setOpen}
      title="Rotate?"
      confirmLabel="Rotate now"
      onConfirm={onConfirm}
    />
  )
}

describe('ConfirmDialog', () => {
  it('keeps the dialog open for an async confirm and ignores a second click', async () => {
    let resolveConfirm: (() => void) | undefined
    const onConfirm = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveConfirm = resolve
        })
    )
    const onOpenChange = vi.fn()

    render(
      <ConfirmDialog
        open
        onOpenChange={onOpenChange}
        title="Rotate?"
        confirmLabel="Rotate now"
        onConfirm={onConfirm}
      />
    )

    const confirm = screen.getByRole('button', { name: 'Rotate now' })
    fireEvent.click(confirm)
    fireEvent.click(confirm)

    expect(onConfirm).toHaveBeenCalledOnce()
    expect(onOpenChange).not.toHaveBeenCalled()
    expect(confirm).toBeDisabled()

    resolveConfirm?.()
    await waitFor(() => {
      expect(confirm).not.toBeDisabled()
    })
  })

  it('does not reject when the async confirm fails', async () => {
    const onConfirm = vi.fn(() => Promise.reject(new Error('nope')))

    render(
      <ConfirmDialog
        open
        onOpenChange={vi.fn()}
        title="Rotate?"
        confirmLabel="Rotate now"
        onConfirm={onConfirm}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Rotate now' }))
    await waitFor(() => {
      expect(onConfirm).toHaveBeenCalledOnce()
    })
    expect(screen.getByText('Rotate?')).toBeInTheDocument()
  })

  it('lets a sync confirm close the dialog', () => {
    const onConfirm = vi.fn()

    render(
      <ConfirmDialog
        open
        onOpenChange={vi.fn()}
        title="Delete?"
        confirmLabel="Delete"
        onConfirm={onConfirm}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    expect(onConfirm).toHaveBeenCalledOnce()
  })

  it('ignores a second click that lands before the disabled state paints (I4)', async () => {
    let resolveConfirm: (() => void) | undefined
    const onConfirm = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveConfirm = resolve
        })
    )
    const onOpenChange = vi.fn()

    render(
      <ConfirmDialog
        open
        onOpenChange={onOpenChange}
        title="Rotate?"
        confirmLabel="Rotate now"
        onConfirm={onConfirm}
      />
    )

    const confirm = screen.getByRole('button', { name: 'Rotate now' })
    // A single fireEvent.click already flushes the resulting `disabled` state
    // before returning, and React itself then refuses to dispatch onClick to
    // a control it still considers disabled — so two separate fireEvent.click
    // calls exercise the DOM-level guard, not the handler's own busy check.
    // Firing both inside one `act()` defers that flush, so the second click
    // reaches the handler while `busy` is still false, the way a genuine
    // double-click can land before disabling paints in a real browser — and
    // it is caught there by the `startedRef` guard instead.
    act(() => {
      fireEvent.click(confirm)
      fireEvent.click(confirm)
    })

    expect(onConfirm).toHaveBeenCalledOnce()
    expect(onOpenChange).not.toHaveBeenCalled()
    expect(confirm).toBeDisabled()

    resolveConfirm?.()
    await waitFor(() => {
      expect(confirm).not.toBeDisabled()
    })
  })

  // Contract (I4): "a synchronous throw in the action leaves it open."
  //
  // RED, and left red per this repo's rule against softening a failing test:
  // the catch block for a synchronous throw (confirm-dialog.tsx:94-95) returns
  // without calling event.preventDefault(). AlertDialogAction is Radix's
  // Dialog.Close underneath, which composes the passed onClick with its own
  // `() => context.onOpenChange(false)` and only skips that second call when
  // the event's default was prevented. So an onConfirm that throws
  // synchronously does NOT leave the dialog open today: Radix dismisses it,
  // same as the non-throwing sync path one test up. onOpenChange(false) fires
  // and, with `open` as real state, the dialog unmounts.
  it('leaves the dialog open when the confirm action throws synchronously (I4)', () => {
    const onConfirm = vi.fn(() => {
      throw new Error('boom')
    })

    render(<StatefulConfirmDialog onConfirm={onConfirm} />)

    fireEvent.click(screen.getByRole('button', { name: 'Rotate now' }))

    expect(onConfirm).toHaveBeenCalledOnce()
    expect(screen.getByText('Rotate?')).toBeInTheDocument()
  })
})
