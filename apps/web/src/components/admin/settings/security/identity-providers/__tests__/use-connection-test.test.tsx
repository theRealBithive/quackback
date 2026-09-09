// @vitest-environment happy-dom
/**
 * `useConnectionTest` — the "Test again" / "Test sign-in" button's success
 * action. On a disabled provider it offers "Enable sign-in" from the test
 * result view; `save()` (from `useProviderSave`) never throws on its own —
 * it swallows the server error and returns `false` — so the `if (!ok) throw`
 * here is what turns that into a rejection the modal shows as a failure.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { IdentityProviderId } from '@quackback/ids'
import type { IdentityProvider } from '@/lib/server/domains/settings/identity-providers.service'
import { useConnectionTest } from '../use-connection-test'

const { openSpy } = vi.hoisted(() => ({ openSpy: vi.fn() }))

vi.mock('../../sso/use-sso-test-sign-in', () => ({
  useSsoTestSignIn: () => ({ open: openSpy }),
}))

vi.mock('@tanstack/react-start', () => ({ useServerFn: (fn: unknown) => fn }))

const { upsertSpy } = vi.hoisted(() => ({
  upsertSpy: vi.fn(async (_args: { data: { id: string; enabled?: boolean } }) => undefined),
}))

vi.mock('@/lib/server/functions/sso', () => ({
  upsertIdentityProviderFn: upsertSpy,
  saveIdentityProviderClaimMappingFn: vi.fn(),
}))

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

function makeProvider(over: Partial<IdentityProvider>): IdentityProvider {
  return {
    id: 'idp_x' as IdentityProviderId,
    registrationId: 'oidc_x',
    label: 'Acme SSO',
    kind: 'okta',
    discoveryUrl: 'https://acme.okta.com/.well-known/openid-configuration',
    authorizationUrl: null,
    tokenUrl: null,
    userInfoUrl: null,
    jwksUri: null,
    issuer: null,
    clientId: 'client-id',
    scopes: null,
    prompt: null,
    tokenEndpointAuthMethod: null,
    enabled: false,
    configured: true,
    autoCreateUsers: true,
    autoProvisionRole: 'user',
    claimMapping: null,
    showButton: false,
    logoKey: null,
    logoUrl: null,
    detailsChangedAt: null,
    lastSuccessfulTestAt: null,
    lastTestCapture: null,
    createdAt: '2026-05-01T00:00:00.000Z',
    domains: [],
    visibility: 'button',
    ...over,
  }
}

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>
}

beforeEach(() => {
  upsertSpy.mockClear()
  openSpy.mockClear()
})

describe('useConnectionTest', () => {
  it('enables sign-in when the admin accepts the offer after a passing test', async () => {
    const provider = makeProvider({ enabled: false })
    const { result } = renderHook(() => useConnectionTest(provider), { wrapper })

    act(() => result.current.openTest())
    expect(openSpy).toHaveBeenCalledWith(expect.objectContaining({ registrationId: 'oidc_x' }))
    const successAction = openSpy.mock.calls[0][0].successAction
    expect(successAction.label).toBe('Enable sign-in')

    await act(async () => {
      await successAction.run()
    })
    expect(upsertSpy).toHaveBeenCalledTimes(1)
    expect(upsertSpy.mock.calls[0][0].data).toMatchObject({ id: 'idp_x', enabled: true })
  })

  it('reports that sign-in could not be enabled instead of leaving it silently off', async () => {
    upsertSpy.mockRejectedValueOnce(new Error('server unreachable'))
    const provider = makeProvider({ enabled: false })
    const { result } = renderHook(() => useConnectionTest(provider), { wrapper })

    act(() => result.current.openTest())
    const successAction = openSpy.mock.calls[0][0].successAction

    await expect(successAction.run()).rejects.toThrow('Could not enable sign-in.')
  })

  it('offers no enable action for a provider whose sign-in is already on', () => {
    const provider = makeProvider({ enabled: true })
    const { result } = renderHook(() => useConnectionTest(provider), { wrapper })

    expect(result.current.successAction).toBeUndefined()
    act(() => result.current.openTest())
    expect(openSpy).toHaveBeenCalledWith({ registrationId: 'oidc_x', successAction: undefined })
  })
})
