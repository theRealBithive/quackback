// @vitest-environment happy-dom
/**
 * What the sign-in dialog shows when a popup attempt comes back failed.
 *
 * S3 The wire carries the outcome, not the sentence. What crosses from server
 *    to browser is the code; the sentence is chosen where it is shown, in the
 *    language of the person reading it. [V1, V2]
 * S4 A sign-in outcome the product does not know still produces a sentence in
 *    the reader's language -- never a blank, a bare code, or an English
 *    fallback inside a translated screen. [V6]
 *
 * The popup broadcasts a code to the window that opened it, and this is the
 * form that receives it. German rather than English: the `defaultMessage`
 * beside every id is the module's own English, so under `en` a form that never
 * reads the catalogue renders the same page.
 */
import type { ReactNode } from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import '@testing-library/jest-dom/vitest'
import { render as rtlRender, screen, cleanup, act } from '@testing-library/react'
import { GermanIntlWrapper } from '@/test/render-with-intl'
import germanMessages from '@/locales/de.json'
import { authBlockMessageId } from '@/lib/shared/auth-block-messages'

const hoisted = vi.hoisted(() => ({ useAuthBroadcast: vi.fn() }))

vi.mock('@tanstack/react-start', () => ({ useServerFn: () => vi.fn() }))

vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, children }: { to: string; children: ReactNode }) => <a href={to}>{children}</a>,
  useRouter: () => ({ navigate: vi.fn() }),
}))

vi.mock('@/lib/server/functions/auth', () => ({ lookupAuthMethodsFn: vi.fn() }))

vi.mock('@/lib/client/auth-client', () => ({
  authClient: {
    signIn: { email: vi.fn(), emailOtp: vi.fn(), oauth2: vi.fn(), social: vi.fn() },
    signUp: { email: vi.fn() },
    requestPasswordReset: vi.fn(),
  },
}))

vi.mock('@/components/auth/oauth-buttons', () => ({
  getEnabledOAuthProviders: () => [{ id: 'custom-oidc', name: 'Acme SSO', type: 'generic-oauth' }],
  getOAuthRedirectUrl: vi.fn(),
  hasRoutableOidcProvider: () => false,
}))

vi.mock('@/lib/client/hooks/use-auth-broadcast', () => ({
  usePopupTracker: () => ({
    trackPopup: vi.fn(),
    clearPopup: vi.fn(),
    hasPopup: () => false,
    focusPopup: vi.fn(),
  }),
  openAuthPopup: vi.fn(),
  postAuthSuccess: vi.fn(),
  postAuthError: vi.fn(),
  useAuthBroadcast: hoisted.useAuthBroadcast,
}))

vi.mock('@/components/ui/input-otp', () => ({
  InputOTP: ({ value, onChange }: { value?: string; onChange?: (v: string) => void }) => (
    <input value={value ?? ''} onChange={(e) => onChange?.(e.target.value)} />
  ),
  InputOTPGroup: ({ children }: { children?: ReactNode }) => <>{children}</>,
  InputOTPSlot: () => null,
  InputOTPSeparator: () => null,
  InputOTPSixSlots: () => null,
}))

import { PortalAuthFormInline } from '../portal-auth-form-inline'

const german = germanMessages as Record<string, string>

/** Renders the form and hands back the broadcast callback it registered, which
 *  is how a failed popup reaches it. */
function renderAndTakeOnError(): (code: string) => void {
  rtlRender(
    <PortalAuthFormInline
      mode="login"
      authConfig={{ found: true, oauth: { password: true, magicLink: true } }}
      callbackUrl="/board/ideas"
    />,
    { wrapper: GermanIntlWrapper }
  )
  const registered = hoisted.useAuthBroadcast.mock.calls.at(-1)?.[0] as {
    onError: (code: string) => void
  }
  expect(registered?.onError).toBeTypeOf('function')
  return registered.onError
}

beforeEach(() => vi.clearAllMocks())
afterEach(cleanup)

describe('the sentence the dialog shows for a failed popup (S3, S4)', () => {
  it('names the outcome in the reader’s language (S3)', () => {
    const onError = renderAndTakeOnError()

    act(() => onError('token_expired'))

    expect(screen.getByText(german[authBlockMessageId('token_expired')])).toBeInTheDocument()
  })

  it('says something rather than nothing for an outcome it does not know (S4)', () => {
    const onError = renderAndTakeOnError()

    act(() => onError('a_code_from_a_later_version'))

    expect(screen.getByText(german['portal.auth.error.signinFailed'])).toBeInTheDocument()
  })
})
