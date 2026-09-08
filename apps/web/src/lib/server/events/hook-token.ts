/**
 * The access token an outbound delivery starts with.
 *
 * The resolver copies the stored access token into every target's config when
 * it builds the job, and that copy can be up to 300 seconds old from its cache
 * on top of however long the job waited. GitLab's tokens live two hours, so a
 * delivery after a quiet night used to start with a token that had expired
 * hours earlier — and the only thing that could renew it, `getValidAccessToken`,
 * was consulted after the 401, and only when the hook said so.
 *
 * This module is what the worker asks before the first attempt. It lives in its
 * own file rather than inside `hook-job.ts` so the mutation gate can grade it
 * on its own: an entry in the manifest asserts that the named suite holds the
 * whole file, and `hook-job.ts` carries the rest of the queue handler.
 */
import type { IntegrationId } from '@quackback/ids'
import { getValidAccessToken } from '@/lib/server/integrations/token-refresh'

/**
 * The config with the renewed token in place of the stored one.
 *
 * An empty token means nothing better was available — no secrets on the row,
 * or the row is gone — and the config is handed back as it was, so a provider
 * without a refresh capability delivers exactly as before.
 */
export function withRenewedToken(
  hookConfig: Record<string, unknown>,
  freshToken: string
): Record<string, unknown> {
  if (freshToken === '') return hookConfig
  return { ...hookConfig, accessToken: freshToken }
}

/**
 * The integration this target belongs to, when the resolver said which.
 *
 * Only the integration resolver attributes a target; a webhook or a
 * notification channel carries no id and is delivered with its config as is.
 */
export function integrationIdOf(hookConfig: Record<string, unknown>): IntegrationId | undefined {
  const integrationId = hookConfig.integrationId
  if (typeof integrationId !== 'string' || integrationId === '') return undefined
  return integrationId as IntegrationId
}

/**
 * The config a delivery should start with: the stored token renewed if it is
 * expired or about to be, otherwise unchanged.
 */
export async function renewedHookConfig(
  hookConfig: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const integrationId = integrationIdOf(hookConfig)
  if (!integrationId) return hookConfig
  const freshToken = await getValidAccessToken(integrationId)
  return withRenewedToken(hookConfig, freshToken)
}
