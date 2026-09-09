// @vitest-environment happy-dom
/**
 * `useProviderLogo` — upload and remove for a custom OIDC provider's logo.
 * Both flows are a thin try/catch/finally around a server fn call: they must
 * flip their busy flag while in flight, invalidate the shared providers query
 * on success, and turn any failure into a toast without leaving the busy flag
 * stuck on.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ReactNode } from 'react'
import { act, renderHook } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { IdentityProviderId } from '@quackback/ids'
import type { IdentityProvider } from '@/lib/server/domains/settings/identity-providers.service'
import { IDENTITY_PROVIDERS_KEY } from '../provider-shared'
import { useProviderLogo } from '../use-provider-logo'

const { getUploadUrlSpy, saveLogoSpy, deleteLogoSpy } = vi.hoisted(() => ({
  getUploadUrlSpy: vi.fn(
    async (_args: { data: { filename: string; contentType: string; fileSize: number } }) => ({
      uploadUrl: 'https://storage.example.com/put',
      key: 'logos/idp_x.png',
    })
  ),
  saveLogoSpy: vi.fn(async (_args: { data: { providerId: string; key: string } }) => undefined),
  deleteLogoSpy: vi.fn(async (_args: { data: { providerId: string } }) => undefined),
}))

const { toastSuccess, toastError } = vi.hoisted(() => ({
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}))

// useServerFn just unwraps the server fn in the browser — return it as-is so
// the hook calls our spies directly, same pattern as provider-detail-page.test.tsx.
vi.mock('@tanstack/react-start', () => ({ useServerFn: (fn: unknown) => fn }))

vi.mock('@/lib/server/functions/uploads', () => ({
  getIdentityProviderLogoUploadUrlFn: getUploadUrlSpy,
}))

vi.mock('@/lib/server/functions/sso', () => ({
  saveIdentityProviderLogoFn: saveLogoSpy,
  deleteIdentityProviderLogoFn: deleteLogoSpy,
}))

vi.mock('sonner', () => ({ toast: { success: toastSuccess, error: toastError } }))

function makeProvider(): IdentityProvider {
  return {
    id: 'idp_x' as IdentityProviderId,
    registrationId: 'oidc_x',
    label: 'Acme SSO',
    kind: null,
    configured: true,
    discoveryUrl: null,
    authorizationUrl: null,
    tokenUrl: null,
    userInfoUrl: null,
    jwksUri: null,
    issuer: null,
    clientId: 'client-id',
    scopes: null,
    prompt: null,
    tokenEndpointAuthMethod: null,
    enabled: true,
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
  }
}

/** Fresh QueryClient per test, with `invalidateQueries` spied so a test can
 *  assert the shared providers cache was actually invalidated. */
function renderProviderLogoHook(provider: IdentityProvider) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')
  function wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }
  const hook = renderHook(() => useProviderLogo(provider), { wrapper })
  return { ...hook, invalidateSpy }
}

beforeEach(() => {
  getUploadUrlSpy.mockClear()
  saveLogoSpy.mockClear()
  deleteLogoSpy.mockClear()
  toastSuccess.mockClear()
  toastError.mockClear()
  getUploadUrlSpy.mockResolvedValue({
    uploadUrl: 'https://storage.example.com/put',
    key: 'logos/idp_x.png',
  })
  saveLogoSpy.mockResolvedValue(undefined)
  deleteLogoSpy.mockResolvedValue(undefined)
  vi.unstubAllGlobals()
})

describe('useProviderLogo upload', () => {
  it('uploads a cropped blob, persists the key, and invalidates the providers cache', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true }) as Response)
    vi.stubGlobal('fetch', fetchMock)
    const provider = makeProvider()
    const { result, invalidateSpy } = renderProviderLogoHook(provider)
    const blob = new Blob(['fake-png-bytes'], { type: 'image/png' })

    let ok: boolean | undefined
    await act(async () => {
      ok = await result.current.upload(blob)
    })

    expect(ok).toBe(true)
    expect(getUploadUrlSpy).toHaveBeenCalledWith({
      data: { filename: 'logo.png', contentType: 'image/png', fileSize: blob.size },
    })
    expect(fetchMock).toHaveBeenCalledWith(
      'https://storage.example.com/put',
      expect.objectContaining({
        method: 'PUT',
        body: blob,
        headers: { 'Content-Type': 'image/png' },
      })
    )
    expect(saveLogoSpy).toHaveBeenCalledWith({
      data: { providerId: 'idp_x', key: 'logos/idp_x.png' },
    })
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: IDENTITY_PROVIDERS_KEY })
    expect(toastSuccess).toHaveBeenCalledWith('Logo updated.')
    expect(result.current.uploading).toBe(false)
  })

  it('falls back to image/png when the cropped blob carries no content type', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true }) as Response)
    vi.stubGlobal('fetch', fetchMock)
    const provider = makeProvider()
    const { result } = renderProviderLogoHook(provider)
    const blob = new Blob(['fake-png-bytes'])

    await act(async () => {
      await result.current.upload(blob)
    })

    expect(getUploadUrlSpy).toHaveBeenCalledWith({
      data: expect.objectContaining({ contentType: 'image/png' }),
    })
    expect(fetchMock).toHaveBeenCalledWith(
      'https://storage.example.com/put',
      expect.objectContaining({ headers: { 'Content-Type': 'image/png' } })
    )
  })

  it('reports a failed PUT to storage and never persists the key', async () => {
    const fetchMock = vi.fn(async () => ({ ok: false }) as Response)
    vi.stubGlobal('fetch', fetchMock)
    const provider = makeProvider()
    const { result, invalidateSpy } = renderProviderLogoHook(provider)

    let ok: boolean | undefined
    await act(async () => {
      ok = await result.current.upload(new Blob(['x'], { type: 'image/png' }))
    })

    expect(ok).toBe(false)
    expect(saveLogoSpy).not.toHaveBeenCalled()
    expect(invalidateSpy).not.toHaveBeenCalled()
    expect(toastError).toHaveBeenCalledWith('Failed to upload the logo to storage.')
    expect(result.current.uploading).toBe(false)
  })

  it('shows a generic message when the upload rejects with no Error', async () => {
    getUploadUrlSpy.mockRejectedValueOnce('boom')
    const provider = makeProvider()
    const { result } = renderProviderLogoHook(provider)

    let ok: boolean | undefined
    await act(async () => {
      ok = await result.current.upload(new Blob(['x'], { type: 'image/png' }))
    })

    expect(ok).toBe(false)
    expect(toastError).toHaveBeenCalledWith('Could not upload the logo.')
    expect(result.current.uploading).toBe(false)
  })

  it('flips uploading on while the request is in flight and off once it settles', async () => {
    let resolveUploadUrl: (v: { uploadUrl: string; key: string }) => void = () => {}
    getUploadUrlSpy.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveUploadUrl = resolve
        })
    )
    const fetchMock = vi.fn(async () => ({ ok: true }) as Response)
    vi.stubGlobal('fetch', fetchMock)
    const provider = makeProvider()
    const { result } = renderProviderLogoHook(provider)

    let uploadPromise: Promise<boolean> = Promise.resolve(false)
    act(() => {
      uploadPromise = result.current.upload(new Blob(['x'], { type: 'image/png' }))
    })
    expect(result.current.uploading).toBe(true)

    await act(async () => {
      resolveUploadUrl({ uploadUrl: 'https://storage.example.com/put', key: 'logos/idp_x.png' })
      await uploadPromise
    })
    expect(result.current.uploading).toBe(false)
  })
})

describe('useProviderLogo remove', () => {
  it('removes the logo and invalidates the providers cache', async () => {
    const provider = makeProvider()
    const { result, invalidateSpy } = renderProviderLogoHook(provider)

    let ok: boolean | undefined
    await act(async () => {
      ok = await result.current.remove()
    })

    expect(ok).toBe(true)
    expect(deleteLogoSpy).toHaveBeenCalledWith({ data: { providerId: 'idp_x' } })
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: IDENTITY_PROVIDERS_KEY })
    expect(toastSuccess).toHaveBeenCalledWith('Logo removed.')
    expect(result.current.removing).toBe(false)
  })

  it('leaves the logo unchanged and tells the admin when the delete call fails', async () => {
    deleteLogoSpy.mockRejectedValueOnce(new Error('Provider is locked.'))
    const provider = makeProvider()
    const { result, invalidateSpy } = renderProviderLogoHook(provider)

    let ok: boolean | undefined
    await act(async () => {
      ok = await result.current.remove()
    })

    expect(ok).toBe(false)
    expect(invalidateSpy).not.toHaveBeenCalled()
    expect(toastError).toHaveBeenCalledWith('Provider is locked.')
    expect(result.current.removing).toBe(false)
  })

  it('shows a generic message when the remove call rejects with no Error', async () => {
    deleteLogoSpy.mockRejectedValueOnce('nope')
    const provider = makeProvider()
    const { result } = renderProviderLogoHook(provider)

    let ok: boolean | undefined
    await act(async () => {
      ok = await result.current.remove()
    })

    expect(ok).toBe(false)
    expect(toastError).toHaveBeenCalledWith('Could not remove the logo.')
    expect(result.current.removing).toBe(false)
  })
})
