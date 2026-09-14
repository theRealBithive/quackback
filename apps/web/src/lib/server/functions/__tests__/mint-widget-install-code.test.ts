/**
 * ## P — Widget install pairing (upstream 98b18e3ee)
 * - P1 The install prompt an admin copies carries a short-lived pairing code and
 *   never the signing secret; the code is minted on copy by an admin with
 *   settings.manage, and a mint failure toasts and copies nothing.
 *
 * Pins the `mintWidgetInstallCodeFn` server-fn boundary: it requires
 * SETTINGS_MANAGE before it mints anything, and it delegates to the pairing
 * domain rather than reimplementing the code/TTL/hash rules (those are pinned
 * on the domain module, see domains/settings/__tests__/widget-install-pairing).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { PERMISSIONS } from '@/lib/shared/permissions'

const mockRequireAuth = vi.fn()
vi.mock('./auth-helpers', () => ({
  requireAuth: (...args: unknown[]) => mockRequireAuth(...args),
}))
vi.mock('@/lib/server/functions/auth-helpers', () => ({
  requireAuth: (...args: unknown[]) => mockRequireAuth(...args),
}))

const mockMintWidgetInstallCode = vi.fn()
vi.mock('@/lib/server/domains/settings/widget-install-pairing', () => ({
  mintWidgetInstallCode: (...args: unknown[]) => mockMintWidgetInstallCode(...args),
}))

// settings.ts pulls in a wide surface of settings-domain reads/writes at module
// scope; none of it runs for mintWidgetInstallCodeFn, so every export here is a
// stub (same harness as fetch-widget-secret.test.ts).
vi.mock('@/lib/server/domains/settings', () => ({
  DEFAULT_PORTAL_CONFIG: {
    oauth: {},
    features: {},
    moderationDefault: { requireApproval: 'none' },
  },
}))
vi.mock('@/lib/server/domains/settings/settings.service', () => ({
  getPortalConfig: vi.fn(),
  getPublicPortalConfig: vi.fn(),
  getPublicAuthConfig: vi.fn(),
  updatePortalConfig: vi.fn(),
  getDeveloperConfig: vi.fn(),
  updateDeveloperConfig: vi.fn(),
}))
vi.mock('@/lib/server/domains/settings/settings.media', () => ({
  getBrandingConfig: vi.fn(),
  updateBrandingConfig: vi.fn(),
  saveLogoKey: vi.fn(),
  deleteLogoKey: vi.fn(),
  saveHeaderLogoKey: vi.fn(),
  deleteHeaderLogoKey: vi.fn(),
  saveFaviconKey: vi.fn(),
  deleteFaviconKey: vi.fn(),
  updateHeaderDisplayMode: vi.fn(),
  updateHeaderDisplayName: vi.fn(),
  updateWorkspaceName: vi.fn(),
  getCustomCss: vi.fn(),
  updateCustomCss: vi.fn(),
}))
vi.mock('@/lib/server/storage/s3', () => ({ getPublicUrlOrNull: vi.fn() }))
vi.mock('@/lib/server/audit/log', () => ({
  actorFromAuth: vi.fn(),
  recordAuditEvent: vi.fn(),
}))
vi.mock('@/lib/server/domains/principals/principal.service', () => ({
  teamMemberWhere: vi.fn(),
}))
vi.mock('@/lib/server/domains/principals/principal-display', () => ({
  resolveUserAvatarUrl: vi.fn(),
}))
vi.mock('@/lib/server/auth/session', () => ({ getSession: vi.fn() }))
vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: {
    query: { principal: { findMany: vi.fn(), findFirst: vi.fn() } },
    select: vi.fn(() => ({ from: vi.fn(() => ({ where: vi.fn() })) })),
  },
}))

// createServerFn({...}).validator(schema).handler(fn) normally wraps `fn` into
// an RPC-callable server function; here it hands back `fn` itself so the
// exported const IS the handler and can be invoked directly in a test.
vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => {
    const chain = {
      validator: () => chain,
      handler: (fn: (...args: unknown[]) => unknown) => fn,
    }
    return chain
  },
}))

type MintWidgetInstallCodeFn = () => Promise<{ code: string }>
let mintWidgetInstallCodeFn: MintWidgetInstallCodeFn

beforeEach(async () => {
  vi.clearAllMocks()
  const settingsModule = await import('../settings')
  mintWidgetInstallCodeFn =
    settingsModule.mintWidgetInstallCodeFn as unknown as MintWidgetInstallCodeFn
})

describe('mintWidgetInstallCodeFn', () => {
  it('refuses to mint for a caller without settings.manage (P1)', async () => {
    mockRequireAuth.mockRejectedValueOnce(new Error('Access denied'))

    await expect(mintWidgetInstallCodeFn()).rejects.toThrow('Access denied')

    expect(mockRequireAuth).toHaveBeenCalledWith(
      expect.objectContaining({ permission: PERMISSIONS.SETTINGS_MANAGE })
    )
    expect(mockMintWidgetInstallCode).not.toHaveBeenCalled()
  })

  it('returns the pairing code the domain minted for an authorized admin (P1)', async () => {
    mockRequireAuth.mockResolvedValueOnce({
      user: { id: 'usr_admin' },
      principal: { id: 'prn_admin', role: 'admin' },
    })
    mockMintWidgetInstallCode.mockResolvedValueOnce({ code: 'qbi_pairingcode' })

    await expect(mintWidgetInstallCodeFn()).resolves.toEqual({ code: 'qbi_pairingcode' })

    expect(mockMintWidgetInstallCode).toHaveBeenCalledTimes(1)
  })

  it('never hands the caller a signing secret alongside the code (P1)', async () => {
    mockRequireAuth.mockResolvedValueOnce({
      user: { id: 'usr_admin' },
      principal: { id: 'prn_admin', role: 'admin' },
    })
    mockMintWidgetInstallCode.mockResolvedValueOnce({ code: 'qbi_pairingcode' })

    const minted = await mintWidgetInstallCodeFn()

    expect(Object.keys(minted)).toEqual(['code'])
    expect(JSON.stringify(minted)).not.toContain('wgt_')
  })
})
