// @vitest-environment happy-dom
/**
 * ## S — Sign-in devices (upstream #525/#529)
 * - S2 Changing or first-setting a password signs out every other session and
 *   says so.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { PasswordForm } from '../password-form'

const { mockChangePassword, mockSetPasswordFn, toast } = vi.hoisted(() => ({
  mockChangePassword: vi.fn(),
  mockSetPasswordFn: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn() },
}))

vi.mock('@/lib/client/auth-client', () => ({
  authClient: { changePassword: mockChangePassword },
}))

vi.mock('@/lib/server/functions/invitations', () => ({
  setPasswordFn: mockSetPasswordFn,
}))

vi.mock('sonner', () => ({ toast }))

function fillNewAndConfirm(password: string) {
  fireEvent.change(screen.getByLabelText('New password'), { target: { value: password } })
  fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: password } })
}

beforeEach(() => {
  mockChangePassword.mockReset()
  mockSetPasswordFn.mockReset()
  toast.success.mockReset()
  toast.error.mockReset()
  mockChangePassword.mockResolvedValue({ error: null })
  mockSetPasswordFn.mockResolvedValue(undefined)
})

describe('PasswordForm', () => {
  it('signs out other sessions and says so when changing an existing password (S2)', async () => {
    render(<PasswordForm hasPassword />)

    fireEvent.change(screen.getByLabelText('Current password'), {
      target: { value: 'old-password-1' },
    })
    fillNewAndConfirm('new-password-1')
    fireEvent.click(screen.getByRole('button', { name: /change password/i }))

    await waitFor(() => {
      expect(mockChangePassword).toHaveBeenCalledWith({
        currentPassword: 'old-password-1',
        newPassword: 'new-password-1',
        revokeOtherSessions: true,
      })
    })
    expect(toast.success).toHaveBeenCalledWith(
      'Password changed. Other devices have been signed out.'
    )
  })

  it('signs out other sessions and says so when setting a first password (S2)', async () => {
    render(<PasswordForm hasPassword={false} />)

    fillNewAndConfirm('brand-new-password')
    fireEvent.click(screen.getByRole('button', { name: /set password/i }))

    await waitFor(() => {
      expect(mockSetPasswordFn).toHaveBeenCalledWith({
        data: { newPassword: 'brand-new-password', revokeOtherSessions: true },
      })
    })
    expect(toast.success).toHaveBeenCalledWith('Password set. Other devices have been signed out.')
  })
})
