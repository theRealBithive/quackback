/**
 * The app's own Better Auth instance, as `createAuth` configures it, for the
 * parts of #689 that live in that configuration rather than in a module of
 * their own.
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
 * `http-disabled-paths.test.ts` proves the disabled list closes the endpoints
 * on a library instance built for the purpose; this suite proves the app's
 * instance is built with that list (E2). It also holds the hand-off from an
 * OIDC sign-in to the enforcing-provider vouch (E5), and that the codes the
 * confirmed flow depends on are mailed (E2). Same capture pattern as
 * `client-ip-wiring.test.ts`.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

if (!process.env.BASE_URL?.startsWith('http')) process.env.BASE_URL = 'http://localhost:3000'
process.env.SECRET_KEY ??= 'test-secret-key-with-at-least-32-characters'

type ProviderEmailHook = (registrationId: string, accountId: string, email: string) => Promise<void>
type SendOtp = (args: { email: string; otp: string; type: string }) => Promise<void>

const hoisted = vi.hoisted(() => ({
  options: null as null | { disabledPaths?: string[] },
  onProviderEmail: null as null | ProviderEmailHook,
  sendVerificationOTP: null as null | SendOtp,
  providerRows: [{ id: 'idp_acme', registrationId: 'oidc_acme', domains: [] }] as unknown[],
  vouchForEnforcedAddress: vi.fn(async (_opts: unknown) => {}),
  sendVerifyAddressCode: vi.fn(async (_email: string, _code: string) => {}),
}))

vi.mock('better-auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('better-auth')>()),
  betterAuth: vi.fn((options: typeof hoisted.options) => {
    hoisted.options = options
    return { api: {}, handler: vi.fn() }
  }),
}))
vi.mock('better-auth/plugins', async (importOriginal) => {
  const original = await importOriginal<typeof import('better-auth/plugins')>()
  return {
    ...original,
    emailOTP: (options: Parameters<typeof original.emailOTP>[0]) => {
      hoisted.sendVerificationOTP = options.sendVerificationOTP as unknown as SendOtp
      return original.emailOTP(options)
    },
  }
})
vi.mock('../build-oauth-configs', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../build-oauth-configs')>()),
  buildGenericOAuthConfigs: vi.fn(async (args: { onProviderEmail?: ProviderEmailHook }) => {
    hoisted.onProviderEmail = args.onProviderEmail ?? null
    return []
  }),
}))
vi.mock('@/lib/server/domains/settings/identity-providers.service', () => ({
  listIdentityProviders: vi.fn(async () => hoisted.providerRows),
  getIdentityProviderCredentials: vi.fn(async () => null),
}))
vi.mock('../enforcing-provider-email', () => ({
  vouchForEnforcedAddress: (opts: unknown) => hoisted.vouchForEnforcedAddress(opts),
}))
vi.mock('../verify-address-email', () => ({
  sendVerifyAddressCode: (email: string, code: string) =>
    hoisted.sendVerifyAddressCode(email, code),
}))
vi.mock('@/lib/server/domains/platform-credentials/platform-credential.service', () => ({
  getPlatformCredentials: vi.fn(async () => null),
  getConfiguredIntegrationTypes: vi.fn(async () => new Set()),
}))
vi.mock('@/lib/server/domains/settings/settings.service', () => ({
  getWorkspaceSettings: vi.fn(async () => ({
    settings: { authConfigVersion: 1 },
    authConfig: { oauth: {} },
    developerConfig: {},
  })),
}))
vi.mock('@/lib/server/domains/settings/tier-limits.service', () => ({
  getTierLimits: vi.fn(async () => ({ features: {} })),
}))
vi.mock('../ensure-mcp-oauth-resource', () => ({
  ensureMcpOauthResource: vi.fn(async () => undefined),
}))
vi.mock('../hooks', () => ({
  hooksBefore: vi.fn(),
  hooksAfter: vi.fn(),
}))

const { getAuth, resetAuth } = await import('../index')

beforeEach(async () => {
  resetAuth()
  hoisted.options = null
  hoisted.onProviderEmail = null
  hoisted.sendVerificationOTP = null
  hoisted.vouchForEnforcedAddress.mockReset()
  hoisted.sendVerifyAddressCode.mockReset()
  await getAuth()
})

describe('the email-change endpoints on the app instance (E2)', () => {
  it('closes both direct change endpoints to HTTP', () => {
    expect(hoisted.options?.disabledPaths).toEqual(
      expect.arrayContaining(['/email-otp/request-email-change', '/email-otp/change-email'])
    )
  })

  // The two codes the confirmed flow runs on: the one that proves a first
  // address and the one sent to the new address of a change.
  it.each(['email-verification', 'change-email'])(
    'mails the %s code with the prove-this-address email',
    async (type) => {
      await hoisted.sendVerificationOTP?.({ email: 'pat@example.com', otp: '123456', type })

      expect(hoisted.sendVerifyAddressCode).toHaveBeenCalledWith('pat@example.com', '123456')
    }
  )
})

describe('an OIDC sign-in hands its address to the enforcing-provider vouch (E5)', () => {
  it('passes the provider, subject, address and the registered providers', async () => {
    await hoisted.onProviderEmail?.('oidc_acme', 'sub-1', 'sam@acme.com')

    expect(hoisted.vouchForEnforcedAddress).toHaveBeenCalledWith({
      registrationId: 'oidc_acme',
      accountId: 'sub-1',
      email: 'sam@acme.com',
      providers: hoisted.providerRows,
    })
  })

  // The vouch is an addition to the sign-in, never a new way for it to fail:
  // when it throws, the sign-in goes on as it would have without it.
  it('lets the sign-in go on when the vouch fails', async () => {
    hoisted.vouchForEnforcedAddress.mockRejectedValueOnce(new Error('db down'))

    await expect(
      hoisted.onProviderEmail?.('oidc_acme', 'sub-1', 'sam@acme.com')
    ).resolves.toBeUndefined()
  })
})
