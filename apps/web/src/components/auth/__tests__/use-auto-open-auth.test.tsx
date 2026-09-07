// @vitest-environment happy-dom
/**
 * The toast the portal raises when it is reached with a failed sign-in.
 *
 * S3 The wire carries the outcome, not the sentence. What crosses from server
 *    to browser is the code; the sentence is chosen where it is shown, in the
 *    language of the person reading it. [V1, V2]
 * S4 A sign-in outcome the product does not know still produces a sentence in
 *    the reader's language -- never a blank, a bare code, or an English
 *    fallback inside a translated screen. [V6]
 *
 * The redirect that lands here carries `?error=<code>` and nothing else, so
 * this surface never had a server sentence to render. What it can lose is the
 * catalogue: it used to read the English map directly, which under German is
 * an English toast over a German page.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { GermanIntlWrapper } from '@/test/render-with-intl'
import germanMessages from '@/locales/de.json'
import { authBlockMessageId } from '@/lib/shared/auth-block-messages'

const hoisted = vi.hoisted(() => ({ error: vi.fn() }))

vi.mock('sonner', () => ({ toast: { error: hoisted.error } }))
vi.mock('@tanstack/react-router', () => ({ useRouter: () => ({ navigate: vi.fn() }) }))
vi.mock('@/components/auth/auth-popover-context', () => ({ useAuthPopoverSafe: () => null }))
vi.mock('@/lib/client/post-auth-navigation', () => ({ navigateAfterAuth: vi.fn() }))
vi.mock('@/lib/client/sso-attempt-stash', () => ({ takeSsoAttempt: () => null }))

import { useAutoOpenAuthDialog } from '../use-auto-open-auth'

const german = germanMessages as Record<string, string>

function landOn(error: string) {
  renderHook(() => useAutoOpenAuthDialog({ error, isAuthenticated: false }), {
    wrapper: GermanIntlWrapper,
  })
}

beforeEach(() => vi.clearAllMocks())

describe('the toast for a sign-in that came back failed (S3, S4)', () => {
  it('names the outcome in the reader’s language (S3)', () => {
    landOn('rate_limited')

    expect(hoisted.error).toHaveBeenCalledWith(german[authBlockMessageId('rate_limited')])
  })

  it('says something rather than the bare code for one it does not know (S4)', () => {
    landOn('a_code_from_a_later_version')

    expect(hoisted.error).toHaveBeenCalledWith(german['portal.auth.error.signinFailed'])
  })

  it('stays quiet for the outcome the dialog handles itself (S3)', () => {
    // `account_not_linked` opens link-conflict recovery instead of a toast.
    landOn('account_not_linked')

    expect(hoisted.error).not.toHaveBeenCalled()
  })
})
