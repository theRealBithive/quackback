/**
 * Linking an integration's credentials is a dashboard-only act.
 *
 * Contract (from the confirmed list for this batch; the full list is in
 * lib/server/functions/__tests__/auth-scope.test.ts):
 *
 *   R2 Only a dashboard session satisfies a team or permission gate. A widget or
 *      portal session is refused whatever role its principal holds.
 *   R9 A widget or portal session is refused by the import and export API and by
 *      the onboarding administrator gates.
 *   R12 An unrecognised audience carries no dashboard authority: it reads as a
 *      non-dashboard audience, and its principal presents as an ordinary user.
 *
 * The OAuth callback is the third surface of the same shape. It does not go
 * through `requireAuth` — it reads the Better Auth session directly, because it
 * is a raw `Request` handler rather than a server function — so the audience
 * check is written out here and has to be held here.
 *
 * Trust boundary (OWASP A01, broken access control): everything in the callback
 * URL is attacker-controlled. The signed state and the state cookie are what
 * bind the redirect to a flow this workspace started; the audience check below
 * them is what stops a widget visitor's session completing that flow and having
 * a provider's credentials written against the workspace.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'

const hoisted = vi.hoisted(() => ({
  getSession: vi.fn(),
  principalFindFirst: vi.fn(),
  verifyOAuthState: vi.fn(),
}))

vi.mock('@/lib/server/integrations', () => ({
  getIntegration: () => ({
    oauth: { stateType: 'github_connect' },
    catalog: { settingsPath: '/admin/settings/channels' },
  }),
}))

vi.mock('@/lib/server/auth/oauth-state', () => ({
  verifyOAuthState: (...args: unknown[]) => hoisted.verifyOAuthState(...args),
}))

vi.mock('@/lib/server/auth', () => ({
  auth: { api: { getSession: (...args: unknown[]) => hoisted.getSession(...args) } },
}))

vi.mock('@/lib/server/db', () => ({
  db: {
    query: { principal: { findFirst: (...a: unknown[]) => hoisted.principalFindFirst(...a) } },
  },
  principal: { userId: 'principal.user_id' },
  eq: (column: unknown, value: unknown) => ({ kind: 'eq', column, value }),
}))

vi.mock('@/lib/server/logger', () => ({
  logger: { child: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }) },
}))

const STATE = 'signed-state-blob'
const PRINCIPAL = 'principal_1'

/** A callback the state cookie and the signed state both vouch for. */
function callbackRequest(): Request {
  return new Request(`http://ws.example.com/oauth/github/callback?code=abc&state=${STATE}`, {
    headers: { cookie: `github_oauth_state=${STATE}` },
  })
}

/** The Better Auth session the callback reads, stamped with `scope`. */
function sessionWithScope(scope: unknown) {
  return { user: { id: 'user_1' }, session: { id: 'sess_1', scope } }
}

async function runCallback(): Promise<Response> {
  const { handleOAuthCallback } = await import('../oauth-handlers')
  return handleOAuthCallback(callbackRequest(), 'github')
}

/** The `reason` the callback redirected with, or null when it did not redirect. */
function refusalReason(response: Response): string | null {
  const location = response.headers.get('location')
  if (!location) return null
  return new URL(location).searchParams.get('reason')
}

beforeEach(() => {
  hoisted.getSession.mockReset()
  hoisted.principalFindFirst.mockReset().mockResolvedValue({ id: PRINCIPAL })
  hoisted.verifyOAuthState.mockReset().mockReturnValue({
    type: 'github_connect',
    workspaceId: 'ws_1',
    returnDomain: 'ws.example.com',
    principalId: PRINCIPAL,
    nonce: 'n',
    ts: Date.now(),
  })
})

describe('the OAuth callback and the audience that reached it (R2, R9)', () => {
  it('refuses a widget session', async () => {
    hoisted.getSession.mockResolvedValue(sessionWithScope('widget'))

    expect(refusalReason(await runCallback())).toBe('auth_required')
  })

  it('refuses a portal session', async () => {
    hoisted.getSession.mockResolvedValue(sessionWithScope('portal'))

    expect(refusalReason(await runCallback())).toBe('auth_required')
  })

  it('refuses before it ever looks the principal up', async () => {
    // The order matters for what the refusal reveals: a widget visitor must not
    // be able to tell, from the reason they get back, whether the flow they
    // replayed belonged to a principal that exists.
    hoisted.getSession.mockResolvedValue(sessionWithScope('widget'))

    await runCallback()

    expect(hoisted.principalFindFirst).not.toHaveBeenCalled()
  })

  it('lets a dashboard session through to the principal check', async () => {
    // The unguarded half of the same assertion: the audience gate must refuse
    // the other audiences *because* they are not the dashboard, not because the
    // callback refuses everyone. Reaching the *next* gate is the evidence, so
    // this case hands it a principal that does not match the one the flow was
    // started for and reads the reason that gate gives back.
    hoisted.getSession.mockResolvedValue(sessionWithScope('dashboard'))
    hoisted.principalFindFirst.mockResolvedValue({ id: 'principal_somebody_else' })

    const response = await runCallback()

    expect(hoisted.principalFindFirst).toHaveBeenCalled()
    expect(refusalReason(response)).toBe('session_mismatch')
  })
})

describe('the OAuth callback and an audience no writer produced (R12)', () => {
  it('refuses a session whose audience is not one of the three', async () => {
    hoisted.getSession.mockResolvedValue(sessionWithScope('superuser'))

    expect(refusalReason(await runCallback())).toBe('auth_required')
    expect(hoisted.principalFindFirst).not.toHaveBeenCalled()
  })

  it('refuses a session carrying no audience at all', async () => {
    hoisted.getSession.mockResolvedValue(sessionWithScope(undefined))

    expect(refusalReason(await runCallback())).toBe('auth_required')
    expect(hoisted.principalFindFirst).not.toHaveBeenCalled()
  })
})
