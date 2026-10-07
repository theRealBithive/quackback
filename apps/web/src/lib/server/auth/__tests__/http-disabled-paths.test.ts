/**
 * The email-change endpoints are closed to HTTP and still callable in process,
 * asked of the real library.
 *
 * `functions/contact-email.ts` proves the current address and applies the
 * domain rules before it calls these endpoints through `auth.api.*`. Routed,
 * they need only a session, so a request straight to them skipped all of that.
 * Closing them relies on one fact about the installed dependency: that
 * `disabledPaths` is enforced by the HTTP router and not by the endpoint, so
 * in-process calls still reach the handler. That is asserted here rather than
 * described, so a version that moves the check fails this instead of quietly
 * breaking the email change.
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
 * This suite holds E2's second sentence against the library itself; that the
 * app's own instance is configured with this list is
 * `email-change-wiring.test.ts`.
 */
import { describe, it, expect } from 'vitest'
import { betterAuth } from 'better-auth'
import { memoryAdapter } from 'better-auth/adapters/memory'
import { emailOTP, jwt } from 'better-auth/plugins'
import { HTTP_DISABLED_AUTH_PATHS } from '../http-disabled-paths'

const ORIGIN = 'https://acme.quackback.io'

const auth = betterAuth({
  baseURL: ORIGIN,
  secret: 'test-secret-not-used-for-anything-real',
  database: memoryAdapter({ user: [], session: [], account: [], verification: [] }),
  emailAndPassword: { enabled: true },
  disabledPaths: HTTP_DISABLED_AUTH_PATHS,
  plugins: [
    emailOTP({
      async sendVerificationOTP() {},
      otpLength: 6,
      expiresIn: 600,
      changeEmail: { enabled: true, verifyCurrentEmail: false },
    }),
  ],
})

function post(path: string, body: unknown): Request {
  return new Request(`${ORIGIN}/api/auth${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: ORIGIN },
    body: JSON.stringify(body),
  })
}

describe('email-change endpoints', () => {
  it.each(['/email-otp/request-email-change', '/email-otp/change-email'])(
    'answers 404 to an HTTP request for %s (E2)',
    async (path) => {
      const res = await auth.handler(post(path, { newEmail: 'new@example.com', otp: '123456' }))

      expect(res.status).toBe(404)
    }
  )

  // The control: the same router still serves a sibling path, so the 404s
  // above are the disabled list and not a wrong base path.
  it('still serves a sibling email-OTP path over HTTP (E2)', async () => {
    const res = await auth.handler(
      post('/email-otp/send-verification-otp', { email: 'someone@example.com', type: 'sign-in' })
    )

    expect(res.status).not.toBe(404)
  })

  // In process the endpoint runs: with no session it refuses as unauthorized,
  // which only the handler itself can say.
  it('still reaches the handler in process (E2)', async () => {
    await expect(
      auth.api.requestEmailChangeEmailOTP({ body: { newEmail: 'new@example.com' } })
    ).rejects.toMatchObject({ status: 'UNAUTHORIZED' })
  })
})

/** An instance with the JWT plugin, whose `/token` collides with OAuth's `/oauth2/token`. */
function jwtAuth(disabledPaths: string[]) {
  return betterAuth({
    baseURL: ORIGIN,
    secret: 'test-secret-not-used-for-anything-real',
    database: memoryAdapter({ user: [], session: [], account: [], verification: [], jwks: [] }),
    disabledPaths,
    plugins: [jwt()],
  })
}

function get(path: string): Request {
  return new Request(`${ORIGIN}/api/auth${path}`, { headers: { origin: ORIGIN } })
}

// No contract number: closing `/token` predates batch K. The list's own
// header gives the reason, and this holds it against the library.
describe('the JWT token endpoint', () => {
  it('answers 404 over HTTP', async () => {
    const res = await jwtAuth(HTTP_DISABLED_AUTH_PATHS).handler(get('/token'))

    expect(res.status).toBe(404)
  })

  // The control: without the list the same request reaches the endpoint.
  it('is served by an instance that does not close it', async () => {
    const res = await jwtAuth([]).handler(get('/token'))

    expect(res.status).not.toBe(404)
  })
})
