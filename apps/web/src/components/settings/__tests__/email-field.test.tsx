// @vitest-environment happy-dom
/**
 * The email row of the profile page, for an address at a domain that requires
 * SSO and for the end of a confirmed change.
 *
 * Contract (upstream #689), confirmed:
 *
 * E1 When an address's domain requires SSO, the person cannot sign in by email link or code either. The refusal depends only on the domain, never on whether an account exists.
 * E2 A person changes their email address only through the confirmed flow. The library's direct change endpoints cannot be reached over HTTP.
 * E3 An address at a domain that requires SSO cannot be taken by the person's own change or by an admin's edit, unless the account already signs in through that domain's provider. Renaming someone whose address stays the same still works.
 * E4 When an admin enters a new address, it is not treated as verified. An unchanged address keeps its verification.
 * E5 When a domain's enforcing provider signs someone in with an address at that domain, that sign-in verifies the account it lands on, so the account links instead of staying stuck. Whoever held an unlinked account before loses their sessions.
 * E6 An admin's edit that crosses with a concurrent change to the same address is refused, not silently overwritten.
 * E7 An address at a domain that requires SSO cannot be given up for one the provider does not manage.
 *
 * The server refuses on its own (`contact-email-change.test.ts`); this page's
 * part of E3 is to say so in the shared words rather than as a wrong code.
 * Hiding the Change button for a managed address is this page's part of E7.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import '@testing-library/jest-dom/vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { SSO_MANAGED_EMAIL_MESSAGE } from '@/lib/shared/sso-managed-email'

const hoisted = vi.hoisted(() => ({
  getEmailChangeStateFn: vi.fn(),
  sendCurrentAddressCodeFn: vi.fn(),
  requestEmailChangeFn: vi.fn(),
  confirmEmailChangeFn: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn() },
}))

vi.mock('@/lib/server/functions/contact-email', () => ({
  getEmailChangeStateFn: hoisted.getEmailChangeStateFn,
  sendCurrentAddressCodeFn: hoisted.sendCurrentAddressCodeFn,
  requestEmailChangeFn: hoisted.requestEmailChangeFn,
  confirmEmailChangeFn: hoisted.confirmEmailChangeFn,
}))
vi.mock('sonner', () => ({ toast: hoisted.toast }))

import { EmailField } from '../email-field'

function renderField(props: Parameters<typeof EmailField>[0] = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <EmailField {...props} />
    </QueryClientProvider>
  )
}

/** Walk a placeholder account through naming an address and entering its code. */
async function confirmNewAddress(address: string) {
  fireEvent.click(await screen.findByRole('button', { name: 'Add email' }))
  fireEvent.change(screen.getByLabelText('New email address'), { target: { value: address } })
  fireEvent.click(screen.getByRole('button', { name: 'Send verification code' }))
  fireEvent.change(await screen.findByLabelText('Code sent to the new address'), {
    target: { value: '123456' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))
}

beforeEach(() => {
  vi.clearAllMocks()
  hoisted.getEmailChangeStateFn.mockResolvedValue({
    currentEmail: null,
    requiresCurrentCode: false,
  })
  hoisted.requestEmailChangeFn.mockResolvedValue({ ok: true })
})

describe('EmailField', () => {
  it('names the SSO rule when the server refuses a managed address at confirm (E3)', async () => {
    hoisted.confirmEmailChangeFn.mockResolvedValue({ ok: false, reason: 'sso_managed' })
    renderField()

    await confirmNewAddress('new@acme.com')

    await waitFor(() => expect(hoisted.toast.error).toHaveBeenCalledWith(SSO_MANAGED_EMAIL_MESSAGE))
    expect(hoisted.toast.success).not.toHaveBeenCalled()
  })

  // The control: any other refusal keeps the wording that does not say which
  // of "wrong code" and "address taken" it was.
  it('keeps the undifferentiated wording for every other refusal (E3)', async () => {
    hoisted.confirmEmailChangeFn.mockResolvedValue({ ok: false, reason: 'invalid_or_taken' })
    renderField()

    await confirmNewAddress('new@example.com')

    await waitFor(() =>
      expect(hoisted.toast.error).toHaveBeenCalledWith(
        'That code is not right, or the address is no longer available.'
      )
    )
  })

  it('lets the page re-read what depends on the address once the change is confirmed (E2)', async () => {
    hoisted.confirmEmailChangeFn.mockResolvedValue({ ok: true, email: 'new@example.com' })
    const onChanged = vi.fn()
    renderField({ onChanged })

    await confirmNewAddress('new@example.com')

    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1))
    expect(hoisted.toast.success).toHaveBeenCalledWith('Email updated.')
  })

  it('offers no way to start a change for a managed address (E7)', async () => {
    hoisted.getEmailChangeStateFn.mockResolvedValue({
      currentEmail: 'sam@acme.com',
      requiresCurrentCode: true,
    })
    renderField({ ssoManaged: true })

    expect(await screen.findByDisplayValue('sam@acme.com')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Change' })).toBeNull()
  })

  it('offers the change for an address no provider manages (no number: control)', async () => {
    hoisted.getEmailChangeStateFn.mockResolvedValue({
      currentEmail: 'pat@example.com',
      requiresCurrentCode: true,
    })
    renderField()

    expect(await screen.findByRole('button', { name: 'Change' })).toBeInTheDocument()
  })
})
