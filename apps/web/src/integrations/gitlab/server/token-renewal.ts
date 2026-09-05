/**
 * Renewing a GitLab access token.
 *
 * Its own module rather than a third function in `oauth.ts`, so the mutation
 * gate can grade it: an entry in the manifest asserts that the named suites
 * hold the whole file, and `oauth.ts` carries an authorization-URL builder and
 * a code exchange this change never touched.
 */
import { normalizeGitLabInstanceUrl } from '@/integrations/gitlab/server/url'
import { gitlabFetch } from '@/integrations/gitlab/server/fetch'

/**
 * Renew an expiring access token.
 *
 * GitLab access tokens live two hours, and the refresh token is spent by the
 * exchange — GitLab hands back a new one, and reusing the old one fails. So the
 * value returned here has to reach storage; the framework's `getValidAccessToken`
 * owns that, together with the expiry check and the resolver-cache invalidation.
 *
 * The message on failure names the status and nothing else: the request body
 * carries the refresh token and the client secret, and an error that quotes the
 * response is one log line away from handing both to whoever reads it.
 */
export async function refreshGitLabToken(
  refreshToken: string,
  credentials?: Record<string, string>
): Promise<{ accessToken: string; refreshToken?: string; expiresIn: number }> {
  // Destructured through `?? {}` because the framework passes `undefined` when
  // no platform credentials are stored (`credentials ?? undefined` in
  // token-refresh.ts), and reading a field off that throws before the check
  // below can say what is actually wrong.
  const { clientId, clientSecret, instanceUrl } = credentials ?? {}

  if (!clientId || !clientSecret) {
    throw new Error('GitLab credentials not configured')
  }

  const response = await gitlabFetch(`${normalizeGitLabInstanceUrl(instanceUrl)}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  })

  if (!response.ok) {
    throw new Error(`GitLab token refresh failed: ${response.status}`)
  }

  const data = (await response.json()) as {
    access_token: string
    refresh_token?: string
    expires_in: number
  }

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresIn: data.expires_in,
  }
}
