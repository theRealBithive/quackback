/**
 * The server function that mints a realtime stream token, driven for real.
 *
 * Contract (from the confirmed list for this batch; the full list is in
 * functions/__tests__/auth-scope.test.ts):
 *
 *   R8 A realtime stream token carries the audience of the session that minted
 *      it, and a token naming no audience is refused.
 *
 * `stream-token.ts` is graded beside itself, so what is left to hold here is the
 * one line that joins the two: the mint call has to pass the audience the caller
 * authenticated with rather than a constant. The signing module is therefore
 * kept real and the token is read back through `verifyStreamToken` — a test that
 * only looked at the arguments would pass just as happily if the token never
 * carried them.
 *
 * Trust boundary (OWASP A01, broken access control): the token ends up in a URL
 * the browser hands back on the SSE handshake, and the audience inside it is
 * what stops a widget subscription asking for a team stream.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { PrincipalId } from '@quackback/ids'
import { verifyStreamToken } from '@/lib/server/realtime/stream-token'

const TEST_KEY = 'test-secret-key-at-least-32-characters-long'

vi.mock('@/lib/server/secret-key', () => ({ activeSecretKey: () => TEST_KEY }))

const hoisted = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  conversationsEnabled: vi.fn(),
  portalAccess: vi.fn(),
}))

vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => {
    const chain: Record<string, unknown> = {}
    chain.validator = () => chain
    chain.middleware = () => chain
    chain.handler = (handler: (args: { data?: unknown }) => Promise<unknown>) =>
      Object.assign((args?: { data?: unknown }) => handler(args ?? {}), chain)
    return chain
  },
  createServerOnlyFn: (fn: unknown) => fn,
}))

vi.mock('@/lib/server/functions/auth-helpers', () => ({
  requireAuth: hoisted.requireAuth,
  getOptionalAuth: vi.fn(),
  assertPermission: vi.fn(),
  policyActorFromAuth: vi.fn(),
  hasAuthCredentials: vi.fn(),
  isAuthDenialError: vi.fn(() => false),
}))

vi.mock('@/lib/server/domains/settings/settings.support', () => ({
  isConversationsEnabled: hoisted.conversationsEnabled,
}))

vi.mock('@/lib/server/functions/portal-access', () => ({
  resolvePortalAccessForRequest: hoisted.portalAccess,
}))

const PRINCIPAL = 'principal_stream_1' as PrincipalId

/** An auth context for a caller the conversation gates let through. */
function agentOn(scope: 'dashboard' | 'widget' | 'portal') {
  return {
    principal: { id: PRINCIPAL, role: scope === 'dashboard' ? 'admin' : 'user', type: 'user' },
    scope,
    permissions: [],
    user: { id: 'user_1', email: 'a@b.c', name: 'A', image: null },
    settings: { id: 'ws_1', slug: 'ws', name: 'WS', logoKey: null },
  }
}

async function mintToken(): Promise<string> {
  const { mintConversationStreamTokenFn } = await import('../conversation')
  const fn = mintConversationStreamTokenFn as unknown as () => Promise<{ token: string }>
  const { token } = await fn()
  return token
}

beforeEach(() => {
  hoisted.requireAuth.mockReset()
  hoisted.conversationsEnabled.mockReset().mockResolvedValue(true)
  hoisted.portalAccess.mockReset().mockResolvedValue({ granted: true })
})

describe('the minted stream token (R8)', () => {
  it('carries the widget audience when a widget session asked for it', async () => {
    hoisted.requireAuth.mockResolvedValue(agentOn('widget'))

    const verified = verifyStreamToken(await mintToken())

    expect(verified).toEqual({ principalId: PRINCIPAL, scope: 'widget' })
  })

  it('carries the portal audience when a portal session asked for it', async () => {
    hoisted.requireAuth.mockResolvedValue(agentOn('portal'))

    const verified = verifyStreamToken(await mintToken())

    expect(verified).toEqual({ principalId: PRINCIPAL, scope: 'portal' })
  })

  it('carries the dashboard audience only when the session really was one', async () => {
    hoisted.requireAuth.mockResolvedValue(agentOn('dashboard'))

    const verified = verifyStreamToken(await mintToken())

    expect(verified).toEqual({ principalId: PRINCIPAL, scope: 'dashboard' })
  })
})

describe('the gates around the mint (R8)', () => {
  it('mints nothing for a visitor the portal refuses', async () => {
    // The audience only matters on a token that was minted at all; the shared
    // visitor gate runs first, and a refusal must not leave a token behind.
    hoisted.requireAuth.mockResolvedValue(agentOn('widget'))
    hoisted.portalAccess.mockResolvedValue({ granted: false })

    await expect(mintToken()).rejects.toThrow(/Portal access required/)
  })

  it('mints nothing while conversations are switched off', async () => {
    hoisted.requireAuth.mockResolvedValue(agentOn('dashboard'))
    hoisted.conversationsEnabled.mockResolvedValue(false)

    await expect(mintToken()).rejects.toThrow(/Conversations are not enabled/)
  })
})
