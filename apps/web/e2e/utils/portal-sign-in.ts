import { expect, type Page } from '@playwright/test'
import { clearSigninRateLimit, enableMagicLinkMethod, getOtpCode } from './db-helpers'

export const DEMO_EMAIL = 'demo@example.com'

/**
 * Sign the page's context in as the seeded demo user through the email-OTP
 * API, the way a portal visitor completes the sign-in form.
 *
 * The sign-in rate limiter allows three requests per fifteen minutes for one
 * address, and several specs sign in as the same user. Each spec used to carry
 * its own copy of this helper with an exponential backoff of up to twenty
 * seconds per 429, which spent minutes per shard waiting. The buckets are
 * cleared instead, so a 429 here is a real failure.
 */
export async function signInAsDemoViaOtp(page: Page): Promise<void> {
  // The email code rides on the magic-link method, which a fresh seed leaves
  // off. Global setup turns it on, but only the admin project depends on
  // setup, so a shard holding no admin spec never runs it.
  enableMagicLinkMethod()
  clearSigninRateLimit()

  // A blocked sign-in method answers with a redirect, and following it would
  // read as a 200 with no code behind it. Not following it names the block.
  const sendResponse = await page.request.post('/api/auth/email-otp/send-verification-otp', {
    data: { email: DEMO_EMAIL, type: 'sign-in' },
    maxRedirects: 0,
  })
  const sendOutcome = `${sendResponse.status()} ${sendResponse.headers()['location'] ?? ''} ${await sendResponse.text()}`
  expect(sendResponse.status(), sendOutcome).toBe(200)

  const code = getOtpCode(DEMO_EMAIL)
  expect(code).toMatch(/^\d{6}$/)

  const verifyResponse = await page.request.post('/api/auth/sign-in/email-otp', {
    data: { email: DEMO_EMAIL, otp: code },
  })
  expect(verifyResponse.status(), await verifyResponse.text()).toBe(200)

  await page.goto('/')
  await page.waitForLoadState('networkidle')
}
