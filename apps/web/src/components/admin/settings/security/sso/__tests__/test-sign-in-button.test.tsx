// @vitest-environment happy-dom
/**
 * `<TestSignInButton>` — the standalone "Test sign-in" button. The modal
 * itself lives in `<SsoTestSignInProvider>` (covered separately); this
 * button is a thin wrapper whose only job is to open it with the right
 * registrationId and, optionally, a success action.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { TestSignInButton } from '../test-sign-in-button'

const { openSpy } = vi.hoisted(() => ({ openSpy: vi.fn() }))

vi.mock('../use-sso-test-sign-in', () => ({
  useSsoTestSignIn: () => ({ open: openSpy }),
}))

describe('<TestSignInButton>', () => {
  it('opens the modal for this provider with no success action by default', () => {
    render(<TestSignInButton registrationId="oidc_x" />)
    fireEvent.click(screen.getByRole('button', { name: 'Test sign-in' }))
    expect(openSpy).toHaveBeenCalledWith({ registrationId: 'oidc_x', successAction: undefined })
  })

  it('carries a success action through to the modal', () => {
    const successAction = {
      label: 'Enable sign-in',
      doneMessage: 'Sign-in is enabled.',
      run: vi.fn(),
    }
    render(<TestSignInButton registrationId="oidc_x" successAction={successAction} />)
    fireEvent.click(screen.getByRole('button', { name: 'Test sign-in' }))
    expect(openSpy).toHaveBeenCalledWith({ registrationId: 'oidc_x', successAction })
  })

  it('is disabled while the connection has no client secret to test', () => {
    render(<TestSignInButton registrationId="oidc_x" disabled />)
    expect(screen.getByRole('button', { name: 'Test sign-in' })).toBeDisabled()
  })
})
