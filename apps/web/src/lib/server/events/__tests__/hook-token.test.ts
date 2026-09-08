/**
 * The access token an outbound delivery starts with (`hook-token.ts`).
 *
 * Contract, confirmed before implementation:
 *
 *   V1 An outbound delivery to GitLab never starts with an access token that is
 *      expired or within five minutes of expiry while a refresh token is
 *      stored; the token is renewed first.
 *   V4 A renewal that succeeded anywhere is what every later delivery uses: no
 *      path hands out the pre-renewal token afterwards.
 *   V5 A provider without a refresh capability, or a connection without a
 *      refresh token, is delivered exactly as before: same token, same result.
 *
 * The expiry check itself belongs to `getValidAccessToken` and is held in
 * `integrations/__tests__/token-refresh.test.ts`. What is held here is that the
 * worker asks it before the first attempt, and does the right thing with the
 * answer: a token replaces the stored one, an empty answer changes nothing.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import fc from 'fast-check'

vi.mock('@/lib/server/integrations/token-refresh', () => ({
  getValidAccessToken: vi.fn(),
}))

import { getValidAccessToken } from '@/lib/server/integrations/token-refresh'
import { integrationIdOf, renewedHookConfig, withRenewedToken } from '../hook-token'

const getValidAccessTokenMock = vi.mocked(getValidAccessToken)

/**
 * A target config as the integration resolver builds it: the provider's own
 * fields, the portal URL, the stored token when the row had one, and whatever
 * else the provider keeps in its config blob. `accessToken` is sometimes there
 * and sometimes not, because a row without secrets yields no token at all.
 */
const hookConfigArb: fc.Arbitrary<Record<string, unknown>> = fc
  .tuple(
    fc.record(
      {
        rootUrl: fc.webUrl(),
        instanceUrl: fc.webUrl(),
        accessToken: fc.string(),
        integrationId: fc.stringMatching(/^integration_[a-z0-9]{6,12}$/),
        channelId: fc.stringMatching(/^[0-9]{1,6}$/),
      },
      { requiredKeys: ['rootUrl'] }
    ),
    fc.dictionary(fc.stringMatching(/^[a-z][a-zA-Z]{0,11}$/), fc.jsonValue())
  )
  .map(([known, extra]) => ({ ...extra, ...known }))

function withoutAccessToken(config: Record<string, unknown>): Record<string, unknown> {
  const { accessToken: _accessToken, ...rest } = config
  return rest
}

describe('withRenewedToken', () => {
  it('hands the delivery the renewed token, whatever the resolver stored (V1, V4)', () => {
    fc.assert(
      fc.property(hookConfigArb, fc.string({ minLength: 1 }), (config, fresh) => {
        expect(withRenewedToken(config, fresh).accessToken).toBe(fresh)
      })
    )
  })

  it('changes nothing but the token — provider fields ride along untouched (V4, V5)', () => {
    fc.assert(
      fc.property(hookConfigArb, fc.string(), (config, fresh) => {
        const result = withRenewedToken(config, fresh)
        expect(withoutAccessToken(result)).toEqual(withoutAccessToken(config))
      })
    )
  })

  it('leaves the config exactly as it was when nothing better is available (V5)', () => {
    fc.assert(
      fc.property(hookConfigArb, (config) => {
        expect(withRenewedToken(config, '')).toBe(config)
      })
    )
  })

  /**
   * The one law that holds across both branches, with no guard in the test:
   * the token a delivery carries is the renewed one when there is one, and the
   * stored one otherwise. Together with the property above this is the whole
   * specification of the function.
   */
  it('carries the renewed token, or the stored one when the renewal yielded none (V1, V5)', () => {
    fc.assert(
      fc.property(hookConfigArb, fc.string(), (config, fresh) => {
        const expected = fresh === '' ? config.accessToken : fresh
        expect(withRenewedToken(config, fresh).accessToken).toBe(expected)
      })
    )
  })
})

describe('integrationIdOf', () => {
  it('reads the id the resolver attributed', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1 }), (id) => {
        expect(integrationIdOf({ integrationId: id, rootUrl: 'https://app.example' })).toBe(id)
      })
    )
  })

  it('treats anything that is not a non-empty string as no attribution (V5)', () => {
    const notAnId = fc.oneof(
      fc.constant(''),
      fc.constant(undefined),
      fc.constant(null),
      fc.integer(),
      fc.boolean(),
      fc.dictionary(fc.string(), fc.string())
    )
    fc.assert(
      fc.property(notAnId, (value) => {
        expect(integrationIdOf({ integrationId: value })).toBeUndefined()
      })
    )
  })

  it('finds no attribution on a config that never had the key', () => {
    expect(integrationIdOf({ secret: 'whsec', webhookId: 'wh_1' })).toBeUndefined()
  })
})

describe('renewedHookConfig', () => {
  beforeEach(() => {
    getValidAccessTokenMock.mockReset()
  })

  it('asks for a renewed token by the attributed id and delivers with it (V1)', async () => {
    getValidAccessTokenMock.mockResolvedValue('renewed')
    const config = { accessToken: 'stale', integrationId: 'integration_abc123', rootUrl: 'x' }

    const result = await renewedHookConfig(config)

    expect(getValidAccessTokenMock).toHaveBeenCalledTimes(1)
    expect(getValidAccessTokenMock).toHaveBeenCalledWith('integration_abc123')
    expect(result).toEqual({ ...config, accessToken: 'renewed' })
  })

  it('does not consult the renewal for a target without an attribution (V5)', async () => {
    const config = { secret: 'whsec', webhookId: 'wh_1' }

    const result = await renewedHookConfig(config)

    expect(getValidAccessTokenMock).not.toHaveBeenCalled()
    expect(result).toBe(config)
  })

  it('keeps the stored token when the row holds nothing better (V5)', async () => {
    getValidAccessTokenMock.mockResolvedValue('')
    const config = { accessToken: 'stored', integrationId: 'integration_abc123' }

    const result = await renewedHookConfig(config)

    expect(result).toBe(config)
    expect(result.accessToken).toBe('stored')
  })
})
