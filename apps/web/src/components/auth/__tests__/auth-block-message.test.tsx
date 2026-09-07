// @vitest-environment happy-dom
/**
 * What a surface renders when a sign-in does not go through.
 *
 * These hold the two guarantees from this batch that are about display rather
 * than about the catalogue. The rest are in
 * `lib/shared/__tests__/auth-block-messages.test.ts`.
 *
 * S3 The wire carries the outcome, not the sentence. What crosses from server
 *    to browser is the code; the sentence is chosen where it is shown, in the
 *    language of the person reading it. A surface that displays a
 *    server-supplied sentence is a surface that cannot be translated.
 *    [V1, V2]
 * S4 A sign-in outcome the product does not know still produces a sentence in
 *    the reader's language -- never a blank, a bare code, or an English
 *    fallback inside a translated screen. [V6]
 *
 * Everything renders in German, because English cannot tell the two apart: the
 * `defaultMessage` beside every id is English, so a surface that passes the
 * server's sentence straight through still reads correctly under `en`.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useIntl } from 'react-intl'
import { GermanIntlWrapper } from '@/test/render-with-intl'
import germanMessages from '@/locales/de.json'
import { authBlockMessage } from '../auth-block-message'
import { authBlockMessageId } from '@/lib/shared/auth-block-messages'

const hoisted = vi.hoisted(() => ({ emailOtp: vi.fn() }))
vi.mock('@/lib/client/auth-client', () => ({
  authClient: { signIn: { emailOtp: hoisted.emailOtp } },
}))

import { useEmailSignin } from '../use-email-signin'

const german = germanMessages as Record<string, string>

/** The English a server might put in a response beside the code. Written out
 *  rather than imported, so the assertion still means something if the module
 *  is reworded. */
const SERVER_ENGLISH = 'Too many sign-in attempts. Please wait a moment and try again.'

function signinHook() {
  return renderHook(() => useEmailSignin({ callbackUrl: '/', onSuccess: vi.fn() }), {
    wrapper: GermanIntlWrapper,
  })
}

beforeEach(() => vi.clearAllMocks())
afterEach(() => vi.unstubAllGlobals())

describe('the sentence a rejected sign-in shows (S3)', () => {
  it('shows the reader’s language, not the sentence the server sent (S3)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({ error: SERVER_ENGLISH, code: 'rate_limited' }),
      })
    )
    const { result } = signinHook()

    await act(async () => {
      await result.current.requestEmail('someone@example.com')
    })

    await waitFor(() =>
      expect(result.current.error).toBe(german[authBlockMessageId('rate_limited')])
    )
    expect(result.current.error).not.toBe(SERVER_ENGLISH)
  })

  it('shows the reader’s language when a code is rejected (S3)', async () => {
    hoisted.emailOtp.mockResolvedValue({
      data: null,
      error: { message: 'Invalid or expired code', code: 'INVALID_OTP' },
    })
    const { result } = signinHook()

    await act(async () => {
      await result.current.verify('someone@example.com', '123456')
    })

    await waitFor(() => expect(result.current.error).toBe(german['portal.auth.otp.invalid']))
    expect(result.current.error).not.toBe('Invalid or expired code')
  })

  it('carries a German sentence for that outcome at all, so S3 is not vacuous (S3)', () => {
    // If the German entry happened to equal the English one, the assertions
    // above would hold against a surface that passes the server text through.
    expect(german[authBlockMessageId('rate_limited')]).not.toBe(SERVER_ENGLISH)
  })
})

describe('the sentence an unknown outcome shows (S4)', () => {
  it('gives an outcome the product does not know a sentence in the reader’s language (S4)', () => {
    const { result } = renderHook(() => useIntl(), { wrapper: GermanIntlWrapper })

    const message = authBlockMessage(result.current, 'a_code_from_a_later_version')

    expect(message).toBe(german['portal.auth.error.signinFailed'])
  })

  it('gives a missing outcome the same sentence rather than a blank (S4)', () => {
    const { result } = renderHook(() => useIntl(), { wrapper: GermanIntlWrapper })

    expect(authBlockMessage(result.current, undefined)).toBe(
      german['portal.auth.error.signinFailed']
    )
    expect(authBlockMessage(result.current, '')).toBe(german['portal.auth.error.signinFailed'])
  })

  it('lets a surface say something the generic sentence cannot (S4)', () => {
    // The popup landing knows the reader has another window to go back to.
    const { result } = renderHook(() => useIntl(), { wrapper: GermanIntlWrapper })

    const message = authBlockMessage(result.current, 'a_code_from_a_later_version', {
      id: 'portal.auth.complete.failedGeneric',
      defaultMessage: 'Sign-in failed. Return to the original window and try again.',
    })

    expect(message).toBe(german['portal.auth.complete.failedGeneric'])
    expect(message).not.toBe(german['portal.auth.error.signinFailed'])
  })

  it('reads a known outcome from the same key the catalogue suite checks (S3)', () => {
    // The display path spells the id inline so the i18n gate can see it, and
    // the suite over the closed set builds it with `authBlockMessageId`. This
    // is what keeps the two spellings the same one.
    const { result } = renderHook(() => useIntl(), { wrapper: GermanIntlWrapper })

    expect(authBlockMessage(result.current, 'token_expired')).toBe(
      german[authBlockMessageId('token_expired')]
    )
  })
})
