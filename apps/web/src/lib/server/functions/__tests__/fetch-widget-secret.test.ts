/**
 * ## I — Widget install (upstream #538)
 * - I1 The signing secret is minted on first admin fetch and returned unchanged
 *   afterwards; a mint that leaves no secret behind is an error, and a database
 *   failure is reported as such, not as a missing secret.
 *
 * Pins the `fetchWidgetSecret` server-fn boundary: it requires SETTINGS_MANAGE
 * before touching the domain, and it delegates to `ensureWidgetSecret` rather
 * than reimplementing the mint-or-return logic (that logic is pinned on its
 * own module, see settings-cache.test.ts).
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

const mockEnsureWidgetSecret = vi.fn()
vi.mock('@/lib/server/domains/settings/settings.widget', () => ({
  ensureWidgetSecret: (...args: unknown[]) => mockEnsureWidgetSecret(...args),
}))

// settings.ts pulls in a wide surface of settings-domain reads/writes at module
// scope; none of it runs for fetchWidgetSecret, so every export here is a stub.
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

type FetchWidgetSecretFn = () => Promise<string>
let fetchWidgetSecret: FetchWidgetSecretFn

beforeEach(async () => {
  vi.clearAllMocks()
  const settingsModule = await import('../settings')
  fetchWidgetSecret = settingsModule.fetchWidgetSecret as unknown as FetchWidgetSecretFn
})

describe('fetchWidgetSecret', () => {
  it('requires SETTINGS_MANAGE before minting or reading the secret (I1)', async () => {
    mockRequireAuth.mockRejectedValueOnce(new Error('Access denied'))

    await expect(fetchWidgetSecret()).rejects.toThrow('Access denied')

    expect(mockRequireAuth).toHaveBeenCalledWith(
      expect.objectContaining({ permission: PERMISSIONS.SETTINGS_MANAGE })
    )
    expect(mockEnsureWidgetSecret).not.toHaveBeenCalled()
  })

  it('delegates to ensureWidgetSecret for an authorized admin (I1)', async () => {
    mockRequireAuth.mockResolvedValueOnce({
      user: { id: 'usr_admin' },
      principal: { id: 'prn_admin', role: 'admin' },
    })
    mockEnsureWidgetSecret.mockResolvedValueOnce('wgt_minted')

    await expect(fetchWidgetSecret()).resolves.toBe('wgt_minted')

    expect(mockEnsureWidgetSecret).toHaveBeenCalledTimes(1)
  })
})
