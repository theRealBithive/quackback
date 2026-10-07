// @vitest-environment happy-dom
/**
 * How the profile page hands its SSO posture to the email row.
 *
 * Contract (upstream #689), confirmed:
 *
 * E1 When an address's domain requires SSO, the person cannot sign in by email link or code either. The refusal depends only on the domain, never on whether an account exists.
 * E2 A person changes their email address only through the confirmed flow. The library's direct change endpoints cannot be reached over HTTP.
 * E3 An address at a domain that requires SSO cannot be taken by the person's own change or by an admin's edit. Renaming someone whose address stays the same still works.
 * E4 When an admin enters a new address, it is not treated as verified. An unchanged address keeps its verification.
 * E5 When a domain's enforcing provider signs someone in with an address at that domain, that sign-in verifies the account it lands on, so the account links instead of staying stuck. Whoever held an unlinked account before loses their sessions.
 * E6 An admin's edit that crosses with a concurrent change to the same address is refused, not silently overwritten.
 *
 * None of these is decided on this page: the server refuses on its own. What
 * the page owns is wiring, so these tests carry no number — the row is told
 * the address is SSO-managed, and a confirmed change re-reads the page.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render } from '@testing-library/react'

const hoisted = vi.hoisted(() => ({
  emailFieldProps: [] as Array<{ ssoManaged?: boolean; onChanged?: () => unknown }>,
  invalidate: vi.fn(),
  ssoEnforced: false,
}))

vi.mock('@/components/settings/email-field', () => ({
  EmailField: (props: { ssoManaged?: boolean; onChanged?: () => unknown }) => {
    hoisted.emailFieldProps.push(props)
    return null
  },
}))
vi.mock('@/components/settings/password-form', () => ({ PasswordForm: () => null }))
vi.mock('@/components/ui/image-cropper', () => ({ ImageCropper: () => null }))
vi.mock('@tanstack/react-router', () => ({
  useRouter: () => ({ invalidate: hoisted.invalidate }),
}))
vi.mock('@tanstack/react-query', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-query')>()),
  useSuspenseQuery: () => ({
    data: {
      avatarUrl: null,
      hasCustomAvatar: false,
      hasPassword: false,
      ssoEnforced: hoisted.ssoEnforced,
    },
  }),
}))
vi.mock('@/lib/client/mutations/avatar', () => ({
  useUploadAvatar: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteAvatar: () => ({ mutateAsync: vi.fn(), isPending: false }),
}))
vi.mock('@/lib/client/queries/settings', () => ({
  settingsQueries: { userProfile: () => ({ queryKey: ['profile'] }) },
}))
vi.mock('@/lib/client/auth-client', () => ({ authClient: { updateUser: vi.fn() } }))
vi.mock('@/lib/server/functions/user', () => ({ updateProfileNameFn: vi.fn() }))

import { ProfileForm } from '../profile-form'

const USER = { id: 'user_1', name: 'Sam', email: 'sam@acme.com' }

beforeEach(() => {
  hoisted.emailFieldProps.length = 0
  hoisted.invalidate.mockClear()
})

describe('ProfileForm: the email row', () => {
  it.each([true, false])('tells the row whether the address is SSO-managed (%s)', (enforced) => {
    hoisted.ssoEnforced = enforced

    render(<ProfileForm user={USER} />)

    expect(hoisted.emailFieldProps.at(-1)?.ssoManaged).toBe(enforced)
  })

  it('re-reads the page once the row reports a confirmed change', async () => {
    hoisted.ssoEnforced = false
    render(<ProfileForm user={USER} />)

    await hoisted.emailFieldProps.at(-1)?.onChanged?.()

    expect(hoisted.invalidate).toHaveBeenCalledTimes(1)
  })
})
