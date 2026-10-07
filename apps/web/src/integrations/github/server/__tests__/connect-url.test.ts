/**
 * Connecting GitHub before its platform credentials exist is a setup step the
 * admin has not done yet, not a server fault: it must fail as a typed 4xx so
 * the server-function log records it at warn.
 *
 * Upstream drives this through a helper module this fork does not have
 * (`@/test/server-fns-in-process`); here `createServerFn` is replaced by a
 * chain whose `.handler(fn)` returns a callable, so the exported const runs
 * the real handler body.
 *
 * Contract (confirmed list for batch K, upstream #688; every connect function
 * is covered in integrations/__tests__/connect-url-platform-credentials.test.ts):
 *
 *   L5 Connecting an integration whose platform credentials are missing is
 *      refused with a clear 400 and logged as a warning.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ValidationError } from '@/lib/shared/errors'
import { classifyServerFnError } from '@/lib/server/middleware/server-fn-log'

const hasPlatformCredentials = vi.hoisted(() => vi.fn<(type: string) => Promise<boolean>>())

vi.mock('@tanstack/react-start', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-start')>()),
  createServerFn: () => {
    const chain = {
      validator: () => chain,
      handler: (fn: (args: unknown) => unknown) =>
        Object.assign((args: unknown) => fn(args ?? {}), chain),
    }
    return chain
  },
}))
vi.mock('@/lib/server/functions/auth-helpers', () => ({
  requireAuth: vi.fn(async () => ({
    settings: { id: 'workspace_1' },
    principal: { id: 'principal_1' },
  })),
}))
vi.mock('@/lib/server/domains/platform-credentials/platform-credential.service', () => ({
  hasPlatformCredentials: (type: string) => hasPlatformCredentials(type),
}))
vi.mock('@/lib/server/config', () => ({ config: { baseUrl: 'https://feedback.example.com' } }))
vi.mock('@/lib/server/auth/oauth-state', () => ({ signOAuthState: () => 'signed-state' }))

type ConnectFn = (args?: unknown) => Promise<string>

async function getGitHubConnectUrl(): Promise<string> {
  const { getGitHubConnectUrl: connect } = await import('../functions')
  return (connect as unknown as ConnectFn)()
}

describe('getGitHubConnectUrl', () => {
  beforeEach(() => hasPlatformCredentials.mockReset())

  it('rejects with a typed 4xx when the platform credentials are not configured (L5)', async () => {
    hasPlatformCredentials.mockResolvedValue(false)

    const error = await getGitHubConnectUrl().then(
      () => undefined,
      (e: unknown) => e
    )

    expect(hasPlatformCredentials).toHaveBeenCalledWith('github')
    expect(error).toBeInstanceOf(ValidationError)
    expect((error as ValidationError).statusCode).toBe(400)
    expect((error as ValidationError).code).toBe('PLATFORM_CREDENTIALS_NOT_CONFIGURED')
    expect(classifyServerFnError(error)).toBe('warn')
  })

  it('returns the connect URL once they are (L5)', async () => {
    hasPlatformCredentials.mockResolvedValue(true)
    await expect(getGitHubConnectUrl()).resolves.toBe('/oauth/github/connect?state=signed-state')
  })
})
