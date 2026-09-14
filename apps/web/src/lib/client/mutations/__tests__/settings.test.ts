/**
 * ## P — Widget install pairing (upstream 98b18e3ee)
 * - P1 The install prompt an admin copies carries a short-lived pairing code and
 *   never the signing secret; the code is minted on copy by an admin with
 *   settings.manage, and a mint failure toasts and copies nothing.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const invalidateQueries = vi.fn()
const setQueryData = vi.fn()
const updateThemeFn = vi.fn(async () => ({ ok: true }))
const updateCustomCssFn = vi.fn(async () => ({ ok: true }))
const mintWidgetInstallCodeFn = vi.fn(async () => ({ code: 'qbi_mintedbyhook' }))

vi.mock('@tanstack/react-query', async () => {
  const actual =
    await vi.importActual<typeof import('@tanstack/react-query')>('@tanstack/react-query')
  return {
    ...actual,
    useMutation: vi.fn((options: unknown) => options),
    useQueryClient: vi.fn(() => ({ invalidateQueries, setQueryData })),
  }
})

vi.mock('@/lib/server/functions/settings', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/functions/settings')>()),
  updateThemeFn,
  updateCustomCssFn,
  mintWidgetInstallCodeFn,
}))

describe('settings config mutations cache invalidation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // invalidateQueries returns a promise; onSuccess must return it so the
    // mutation stays pending until the refetch settles (otherwise a fast
    // navigate-away/back can re-read the still-stale cache via ensureQueryData).
    invalidateQueries.mockResolvedValue(undefined)
  })

  it('useUpdatePortalConfig.onSuccess awaits invalidation of the portalConfig query', async () => {
    const { useUpdatePortalConfig } = await import('../settings')
    const mutation = useUpdatePortalConfig() as { onSuccess?: () => unknown }

    const result = mutation.onSuccess?.()

    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['settings', 'portalConfig'] })
    expect(result).toBeInstanceOf(Promise)
  })

  it('useUpdateModerationDefault.onSuccess awaits invalidation of the portalConfig query', async () => {
    const { useUpdateModerationDefault } = await import('../settings')
    const mutation = useUpdateModerationDefault() as { onSuccess?: () => unknown }

    const result = mutation.onSuccess?.()

    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['settings', 'portalConfig'] })
    expect(result).toBeInstanceOf(Promise)
  })

  it('useUpdateWidgetConfig.onSuccess awaits invalidation of the widgetConfig query', async () => {
    const { useUpdateWidgetConfig } = await import('../settings')
    const mutation = useUpdateWidgetConfig() as { onSuccess?: () => unknown }

    const result = mutation.onSuccess?.()

    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['settings', 'widgetConfig'] })
    expect(result).toBeInstanceOf(Promise)
  })

  it('useRegenerateWidgetSecret.onSuccess writes the new secret then awaits invalidation', async () => {
    const { useRegenerateWidgetSecret } = await import('../settings')
    const mutation = useRegenerateWidgetSecret() as { onSuccess?: (secret: string) => unknown }

    const result = mutation.onSuccess?.('wgt_new')

    expect(setQueryData).toHaveBeenCalledWith(['settings', 'widgetSecret'], 'wgt_new')
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['settings', 'widgetSecret'] })
    expect(result).toBeInstanceOf(Promise)
  })

  it('useUpdateHelpCenterConfig.onSuccess awaits invalidation of the helpCenterConfig query', async () => {
    const { useUpdateHelpCenterConfig } = await import('../settings')
    const mutation = useUpdateHelpCenterConfig() as { onSuccess?: () => unknown }

    const result = mutation.onSuccess?.()

    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['settings', 'helpCenterConfig'] })
    expect(result).toBeInstanceOf(Promise)
  })

  it('useSaveBrandingTheme persist/clear/rewrite customCss writes', async () => {
    const { useSaveBrandingTheme } = await import('../settings')
    const mutation = useSaveBrandingTheme() as unknown as {
      mutationFn: (input: {
        brandingConfig: Record<string, unknown>
        customCss: string
        customCssWrite: 'persist' | 'clear' | 'rewrite'
      }) => Promise<unknown>
    }

    await mutation.mutationFn({
      brandingConfig: { preset: 'default' },
      customCss: '.brand { color: red; }',
      customCssWrite: 'rewrite',
    })
    expect(updateThemeFn).toHaveBeenCalledOnce()
    expect(updateCustomCssFn).toHaveBeenCalledWith({
      data: { customCss: '.brand { color: red; }' },
    })

    await mutation.mutationFn({
      brandingConfig: { preset: 'default' },
      customCss: ':root { --primary: red; }',
      customCssWrite: 'clear',
    })
    expect(updateCustomCssFn).toHaveBeenCalledWith({ data: { customCss: '' } })

    await mutation.mutationFn({
      brandingConfig: { preset: 'default' },
      customCss: '.brand { color: red; }',
      customCssWrite: 'persist',
    })
    expect(updateCustomCssFn).toHaveBeenCalledWith({
      data: { customCss: '.brand { color: red; }' },
    })
  })

  it('useSaveBrandingTheme.onSuccess awaits invalidation of branding and customCss queries', async () => {
    const { useSaveBrandingTheme } = await import('../settings')
    const mutation = useSaveBrandingTheme() as { onSuccess?: () => unknown }

    const result = mutation.onSuccess?.()

    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['settings', 'branding'] })
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['settings', 'customCss'] })
    expect(result).toBeInstanceOf(Promise)
  })
})

describe('useMintWidgetInstallCode', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mintWidgetInstallCodeFn.mockResolvedValue({ code: 'qbi_mintedbyhook' })
  })

  it('mints through the server function and returns the pairing code (P1)', async () => {
    const { useMintWidgetInstallCode } = await import('../settings')
    const mutation = useMintWidgetInstallCode() as {
      mutationFn?: () => Promise<{ code: string }>
      onSuccess?: unknown
    }

    await expect(mutation.mutationFn?.()).resolves.toEqual({ code: 'qbi_mintedbyhook' })

    expect(mintWidgetInstallCodeFn).toHaveBeenCalledTimes(1)
    // Minting is a one-shot credential, not cached state: nothing is written
    // to or invalidated in the query cache.
    expect(setQueryData).not.toHaveBeenCalled()
    expect(invalidateQueries).not.toHaveBeenCalled()
  })

  it('surfaces a mint failure to the caller (P1)', async () => {
    mintWidgetInstallCodeFn.mockRejectedValue(new Error('Access denied'))
    const { useMintWidgetInstallCode } = await import('../settings')
    const mutation = useMintWidgetInstallCode() as { mutationFn?: () => Promise<{ code: string }> }

    await expect(mutation.mutationFn?.()).rejects.toThrow('Access denied')
  })
})
