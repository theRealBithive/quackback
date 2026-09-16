/**
 * The audience a realtime stream token carries.
 *
 * EventSource cannot set a header, so the stream URL carries a short-lived
 * signed token instead of the session. Before this batch the token proved only
 * "this principal was authenticated"; now it also names the audience it was
 * minted for, because the stream's own authorization asks for it — a team
 * subscription on a widget token is exactly the promotion case this batch is
 * about.
 *
 * Contract (from the confirmed list for this batch; the full list is in
 * functions/__tests__/auth-scope.test.ts):
 *
 *   R8 A realtime stream token carries the audience of the session that minted
 *      it, and a token naming no audience is refused.
 */
import { createHmac } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import fc from 'fast-check'
import type { PrincipalId } from '@quackback/ids'
import { mintStreamToken, verifyStreamToken } from '../stream-token'

const TEST_KEY = 'test-secret-key-at-least-32-characters-long'

vi.mock('../../secret-key', () => ({
  activeSecretKey: () => TEST_KEY,
}))

/** The domain-separation tag the module mixes into every signature. */
const DOMAIN_TAG = 'chat-stream:v1\n'

/**
 * A token the module would accept, built here rather than minted.
 *
 * Minting can only produce payloads `mintStreamToken` is willing to write, and
 * half of what verification promises is about the ones it is not: a payload
 * with no audience, a payload naming no principal, a signature made with the
 * same key for another purpose.
 */
function signedToken(payload: string, tag: string = DOMAIN_TAG): string {
  const signature = createHmac('sha256', TEST_KEY)
    .update(tag + payload)
    .digest('base64url')
  return `${Buffer.from(payload).toString('base64url')}.${signature}`
}

/** Pre-scope token shape: `${principalId}.${expiry}`. */
function legacyStreamToken(principalId: string, ttlMs = 60_000): string {
  return signedToken(`${principalId}.${Date.now() + ttlMs}`)
}

const anyScope = fc.constantFrom('dashboard' as const, 'widget' as const, 'portal' as const)

describe('stream token audience (R8)', () => {
  it('round-trips the bound scope', () => {
    const token = mintStreamToken('principal_1' as PrincipalId, 'widget')

    expect(verifyStreamToken(token)).toEqual({ principalId: 'principal_1', scope: 'widget' })
  })

  it('hands back exactly the principal and audience it was minted for, for every audience', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1 }).filter((id) => !id.includes('.')),
        anyScope,
        (id, scope) => {
          const token = mintStreamToken(id as PrincipalId, scope)

          expect(verifyStreamToken(token)).toEqual({ principalId: id, scope })
        }
      ),
      { numRuns: 300 }
    )
  })

  it('rejects a tampered signature', () => {
    const token = mintStreamToken('principal_1' as PrincipalId, 'dashboard')

    expect(verifyStreamToken(`${token.slice(0, -2)}xx`)).toBeNull()
  })

  it('returns null for missing or malformed tokens', () => {
    expect(verifyStreamToken(null)).toBeNull()
    expect(verifyStreamToken('garbage')).toBeNull()
  })

  it('rejects audience-less legacy tokens', () => {
    // A correctly signed token from before this batch. Refused rather than
    // read as a dashboard token: they live two minutes and the client re-mints
    // on reconnect, so failing closed costs a handshake.
    expect(verifyStreamToken(legacyStreamToken('principal_1'))).toBeNull()
  })

  it('refuses a token signed for something else with the same key', () => {
    // The domain tag is the whole of that guarantee: without it, a token this
    // key signed for another purpose with a payload of this shape would be
    // accepted as a stream credential.
    const wrongDomain = signedToken(`principal_1.widget.${Date.now() + 60_000}`, '')

    expect(verifyStreamToken(wrongDomain)).toBeNull()
  })

  it('returns null rather than throwing when the signature is the wrong length', () => {
    // `timingSafeEqual` throws on buffers of different lengths, which is what
    // the length comparison in front of it is for. Anything reaching this
    // function is attacker-controlled, so a throw here is a 500 on a handshake.
    expect(verifyStreamToken('abc.def')).toBeNull()
  })

  it('refuses a token that names no principal', () => {
    const noPrincipal = signedToken(`.widget.${Date.now() + 60_000}`)

    expect(verifyStreamToken(noPrincipal)).toBeNull()
  })

  it('refuses a token whose life is already over', () => {
    const expired = mintStreamToken('principal_1' as PrincipalId, 'dashboard', -1_000)

    expect(verifyStreamToken(expired)).toBeNull()
  })

  it('is still good at the instant it expires, and not one millisecond later', () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2026-09-16T00:00:00.000Z'))
      const token = mintStreamToken('principal_1' as PrincipalId, 'dashboard', 60_000)

      vi.setSystemTime(new Date('2026-09-16T00:01:00.000Z'))
      expect(verifyStreamToken(token)).not.toBeNull()

      vi.advanceTimersByTime(1)
      expect(verifyStreamToken(token)).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not mint a dashboard token for a caller that named no audience', () => {
    // Upstream defaults the parameter to 'dashboard', so a forgotten argument
    // mints the most privileged token. Two things hold that here. The
    // directive is the first: `bun run typecheck` compiles the suites, so it
    // fails the build the day a default comes back. The second is what the
    // call does anyway, for a caller the compiler never saw — the audience
    // segment reads back as something, and it is not the dashboard.
    // @ts-expect-error the audience is a required argument
    const token = mintStreamToken('principal_1' as PrincipalId)

    expect(verifyStreamToken(token)?.scope).not.toBe('dashboard')
  })

  it('refuses a token whose audience segment was rewritten after signing', () => {
    fc.assert(
      fc.property(anyScope, fc.string(), (scope, forged) => {
        const token = mintStreamToken('principal_1' as PrincipalId, scope)
        const [payload, signature] = token.split('.')
        const decoded = Buffer.from(payload, 'base64url').toString('utf8')
        const [principalId, , expiry] = decoded.split('.')
        const rewritten = Buffer.from(`${principalId}.${forged}.${expiry}`).toString('base64url')

        // Either the forgery reproduced the original payload byte for byte, in
        // which case nothing was forged, or the signature no longer matches.
        if (rewritten === payload) return
        expect(verifyStreamToken(`${rewritten}.${signature}`)).toBeNull()
      }),
      { numRuns: 300 }
    )
  })
})
