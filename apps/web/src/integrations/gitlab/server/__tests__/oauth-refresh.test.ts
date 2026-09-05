/**
 * Renewing the GitLab access token before it expires.
 *
 * GitLab access tokens live two hours. The token exchange already hands back a
 * refresh token and an expiry, and `saveIntegration` already stores both — but
 * the integration declared no `refreshToken` capability, so the framework's
 * `getValidAccessToken` fell through to `return token` and handed out the
 * expired one. Every connection therefore died two hours after it was made,
 * and the only cure was a person reconnecting by hand.
 *
 * Contract:
 *
 *   V1 An integration whose access token has expired keeps working: the next
 *      thing that needs the token gets a valid one, without a person
 *      reconnecting.
 *   V2 A refreshed token replaces the stored one together with the refresh
 *      token the provider hands back with it — otherwise the refresh after
 *      that one fails. GitLab issues a refresh token only once.
 *   V5 Neither the old nor the new token, nor the client secret, appears in a
 *      log line or a message.
 *
 * V3 and V4 are about what happens when a refresh is refused or impossible;
 * they live in `lib/server/integrations/__tests__/token-refresh.test.ts`,
 * where the integration row that has to say so is in reach.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { refreshGitLabToken } from '@/integrations/gitlab/server/token-renewal'
import { gitlabIntegration } from '@/integrations/gitlab/server'

// GitLab requests go through the SSRF guard; route them to the stubbed global
// fetch so the assertions below see the same calls.
vi.mock('@/lib/server/content/ssrf-guard', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/content/ssrf-guard')>()),
  safeFetch: (url: string, init?: RequestInit) => globalThis.fetch(url, init),
}))

const CREDS = { clientId: 'app-id', clientSecret: 'app-secret' }
const OLD_REFRESH = 'refresh-token-in-store'

function answering(status: number, body: unknown) {
  // The parameters are declared so `mock.calls` is typed: without them vitest
  // infers an empty tuple and the assertions below cannot read the request.
  return vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  }))
}

function renewed() {
  return { access_token: 'new-access', refresh_token: 'new-refresh', expires_in: 7200 }
}

beforeEach(() => {
  vi.restoreAllMocks()
})

describe('the integration the framework asks to refresh (V1)', () => {
  it('declares that it can renew its own token', () => {
    // Without this the framework never calls the function below, and every
    // GitLab connection expires two hours after it was made.
    //
    // The `typeof` line is not redundant: when neither side exists, `toBe`
    // compares undefined with undefined and passes. That green is how the
    // capability went missing in the first place.
    expect(typeof gitlabIntegration.refreshToken).toBe('function')
    expect(gitlabIntegration.refreshToken).toBe(refreshGitLabToken)
  })
})

describe('renewing against the GitLab token endpoint (V1, V2)', () => {
  it('asks gitlab.com for a new token with the stored refresh token', async () => {
    const fetchMock = answering(200, renewed())
    vi.stubGlobal('fetch', fetchMock)

    const result = await refreshGitLabToken(OLD_REFRESH, CREDS)

    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toBe('https://gitlab.com/oauth/token')
    expect(JSON.parse(init?.body as string)).toMatchObject({
      grant_type: 'refresh_token',
      refresh_token: OLD_REFRESH,
      client_id: 'app-id',
      client_secret: 'app-secret',
    })
    expect(result.accessToken).toBe('new-access')
  })

  it('sends the renewal as a JSON POST, which is what the endpoint accepts', async () => {
    const fetchMock = answering(200, renewed())
    vi.stubGlobal('fetch', fetchMock)

    await refreshGitLabToken(OLD_REFRESH, CREDS)

    const [, init] = fetchMock.mock.calls[0]
    expect(init?.method).toBe('POST')
    expect(init?.headers).toEqual({ 'Content-Type': 'application/json' })
  })

  it('asks the self-hosted instance the connection was made against', async () => {
    const fetchMock = answering(200, renewed())
    vi.stubGlobal('fetch', fetchMock)

    await refreshGitLabToken(OLD_REFRESH, { ...CREDS, instanceUrl: 'https://gitlab.example.com/' })

    expect(String(fetchMock.mock.calls[0]?.[0])).toBe('https://gitlab.example.com/oauth/token')
  })

  it('hands back the new refresh token, because the old one is now spent', async () => {
    vi.stubGlobal('fetch', answering(200, renewed()))

    const result = await refreshGitLabToken(OLD_REFRESH, CREDS)

    expect(result.refreshToken).toBe('new-refresh')
    expect(result.refreshToken).not.toBe(OLD_REFRESH)
    expect(result.expiresIn).toBe(7200)
  })
})

describe('a renewal GitLab refuses (V3, V5)', () => {
  it('fails rather than reporting a token it does not have', async () => {
    vi.stubGlobal('fetch', answering(401, { error: 'invalid_grant' }))

    await expect(refreshGitLabToken(OLD_REFRESH, CREDS)).rejects.toThrow(/401/)
  })

  it('says nothing that could be replayed', async () => {
    vi.stubGlobal('fetch', answering(401, { error: 'invalid_grant' }))

    const error = await refreshGitLabToken(OLD_REFRESH, CREDS).catch((err: Error) => err)

    const said = `${(error as Error).message}`
    expect(said).not.toContain(OLD_REFRESH)
    expect(said).not.toContain('app-secret')
  })

  it('refuses to try at all without configured credentials', async () => {
    const fetchMock = answering(200, renewed())
    vi.stubGlobal('fetch', fetchMock)

    await expect(refreshGitLabToken(OLD_REFRESH, {})).rejects.toThrow(
      'GitLab credentials not configured'
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('says the same when no credentials were passed at all', async () => {
    // Not hypothetical: the framework passes `credentials ?? undefined`, so an
    // instance with no stored platform credentials arrives here as undefined.
    const fetchMock = answering(200, renewed())
    vi.stubGlobal('fetch', fetchMock)

    await expect(refreshGitLabToken(OLD_REFRESH, undefined)).rejects.toThrow(
      'GitLab credentials not configured'
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('refuses when only half the credentials are configured', async () => {
    const fetchMock = answering(200, renewed())
    vi.stubGlobal('fetch', fetchMock)

    await expect(refreshGitLabToken(OLD_REFRESH, { clientId: 'app-id' })).rejects.toThrow(
      'GitLab credentials not configured'
    )
    await expect(refreshGitLabToken(OLD_REFRESH, { clientSecret: 'app-secret' })).rejects.toThrow(
      'GitLab credentials not configured'
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
