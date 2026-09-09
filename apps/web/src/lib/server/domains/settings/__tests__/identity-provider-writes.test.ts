/**
 * `persistTestResult` and `saveIdentityProviderClaimMapping` — the two write
 * paths on `identity-providers.service.ts` that were previously exercised
 * only by a `typeof === 'function'` smoke check. Follows the DB-mocking
 * pattern established in `upsert-identity-provider.test.ts`, extended with
 * `.for('update')` support (the row-lock select `saveIdentityProviderClaimMapping`
 * takes) and pass-through `and`/`isNull` helpers (the conditional-update guard
 * `persistTestResult` builds).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ValidationError, ConflictError } from '@/lib/shared/errors'

const hoisted = vi.hoisted(() => ({
  mockBumpAuthConfigVersionInTx: vi.fn(),
  mockResetAuth: vi.fn(),
  mockInvalidateSettingsCache: vi.fn(),
  mockHasPlatformCredentials: vi.fn(),
  // Row(s) returned by `tx.update(...).set(...).where(...).returning(...)`.
  txUpdateReturning: [] as object[],
  // Row(s) returned by `tx.select(...).from(...).where(...).for('update')`.
  txSelectForUpdateRows: [] as object[],
  // When set, `db.transaction` rejects with this error instead of running fn.
  txRejectsWith: null as Error | null,
  capturedSetPatch: null as Record<string, unknown> | null,
}))

vi.mock('@/lib/server/auth/config-version', () => ({
  bumpAuthConfigVersionInTx: hoisted.mockBumpAuthConfigVersionInTx,
}))
vi.mock('@/lib/server/auth', () => ({
  resetAuth: hoisted.mockResetAuth,
}))
vi.mock('@/lib/server/domains/settings/settings.helpers', () => ({
  invalidateSettingsCache: hoisted.mockInvalidateSettingsCache,
  wrapDbError: (_msg: string, err: unknown) => {
    throw err
  },
}))
vi.mock('@/lib/server/domains/platform-credentials/platform-credential.service', () => ({
  hasPlatformCredentials: hoisted.mockHasPlatformCredentials,
  getConfiguredIntegrationTypes: vi.fn().mockResolvedValue(new Set<string>()),
}))
vi.mock('@/lib/server/auth/auth-providers', () => ({
  AUTH_CREDENTIAL_PREFIX: 'auth_',
}))
vi.mock('@/lib/server/auth/provider-ids', () => ({
  verifiedDomainCount: () => 0,
  shouldRenderPublicButton: () => false,
}))
vi.mock('@/lib/server/logger', () => ({
  logger: { child: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn() }) },
}))

vi.mock('@/lib/server/db', () => ({
  db: {
    // Used by listDomainsForProvider, called after the transaction commits.
    select: vi.fn(() => ({
      from: () => ({
        where: () => ({
          orderBy: () => Promise.resolve([]),
        }),
      }),
    })),
    transaction: async (fn: (tx: object) => Promise<unknown>) => {
      if (hoisted.txRejectsWith) throw hoisted.txRejectsWith
      const tx = {
        select: () => ({
          from: () => ({
            where: () => ({
              for: () => Promise.resolve(hoisted.txSelectForUpdateRows),
            }),
          }),
        }),
        update: () => ({
          set: (patch: Record<string, unknown>) => {
            hoisted.capturedSetPatch = patch
            return {
              where: () => ({
                returning: () => Promise.resolve(hoisted.txUpdateReturning),
              }),
            }
          },
        }),
      }
      return fn(tx)
    },
  },
  identityProvider: { id: 'id_col', detailsChangedAt: 'details_changed_at_col' },
  ssoVerifiedDomain: {},
  eq: vi.fn((...args: unknown[]) => ({ op: 'eq', args })),
  and: vi.fn((...args: unknown[]) => ({ op: 'and', args })),
  isNull: vi.fn((...args: unknown[]) => ({ op: 'isNull', args })),
}))

import { persistTestResult, saveIdentityProviderClaimMapping } from '../identity-providers.service'

const EXISTING_ROW = {
  id: 'idp_existing' as `idp_${string}`,
  registrationId: 'oidc_x',
  label: 'Acme IdP',
  kind: null,
  discoveryUrl: 'https://idp.example/.well-known/openid-configuration',
  authorizationUrl: null,
  tokenUrl: null,
  userInfoUrl: null,
  jwksUri: null,
  issuer: null,
  clientId: 'client-abc',
  scopes: null,
  prompt: null,
  tokenEndpointAuthMethod: null,
  enabled: true,
  autoCreateUsers: true,
  autoProvisionRole: null,
  claimMapping: null,
  showButton: false,
  logoKey: null,
  detailsChangedAt: null,
  lastSuccessfulTestAt: null,
  lastTestCapture: null,
  createdAt: new Date('2026-01-01'),
}

beforeEach(() => {
  vi.clearAllMocks()
  hoisted.txUpdateReturning = []
  hoisted.txSelectForUpdateRows = []
  hoisted.txRejectsWith = null
  hoisted.capturedSetPatch = null
  hoisted.mockHasPlatformCredentials.mockResolvedValue(false)
  hoisted.mockInvalidateSettingsCache.mockResolvedValue(undefined)
  hoisted.mockBumpAuthConfigVersionInTx.mockResolvedValue(undefined)
})

describe('persistTestResult', () => {
  it('stamps lastSuccessfulTestAt and bumps the auth config version on a matching, successful test (664-694)', async () => {
    hoisted.txUpdateReturning = [{ id: EXISTING_ROW.id }]

    const result = await persistTestResult(EXISTING_ROW.id, {
      expectedDetailsChangedAt: null,
      outcome: 'success',
      capture: { registrationId: 'oidc_x', capturedAt: '2026-09-07T00:00:00.000Z', claims: {} },
    })

    expect(result).toBe('stamped')
    expect(hoisted.mockBumpAuthConfigVersionInTx).toHaveBeenCalledTimes(1)
    expect(hoisted.mockResetAuth).toHaveBeenCalledTimes(1)
    expect(hoisted.mockInvalidateSettingsCache).toHaveBeenCalledTimes(1)
    expect(hoisted.capturedSetPatch?.lastSuccessfulTestAt).toBeInstanceOf(Date)
  })

  it('records a mapping-failure capture without bumping the auth config version or resetting auth', async () => {
    hoisted.txUpdateReturning = [{ id: EXISTING_ROW.id }]

    const result = await persistTestResult(EXISTING_ROW.id, {
      expectedDetailsChangedAt: '2026-01-01T00:00:00.000Z',
      outcome: 'mapping_failed',
      capture: { registrationId: 'oidc_x', capturedAt: '2026-09-07T00:00:00.000Z', claims: {} },
    })

    expect(result).toBe('stamped')
    expect(hoisted.mockBumpAuthConfigVersionInTx).not.toHaveBeenCalled()
    expect(hoisted.mockResetAuth).not.toHaveBeenCalled()
    expect(hoisted.mockInvalidateSettingsCache).toHaveBeenCalledTimes(1)
    expect(hoisted.capturedSetPatch?.lastSuccessfulTestAt).toBeUndefined()
  })

  it('reports stale when the conditional update matches no row (provider details changed mid-test) (683)', async () => {
    hoisted.txUpdateReturning = []

    const result = await persistTestResult(EXISTING_ROW.id, {
      expectedDetailsChangedAt: null,
      outcome: 'success',
      capture: { registrationId: 'oidc_x', capturedAt: '2026-09-07T00:00:00.000Z', claims: {} },
    })

    expect(result).toBe('stale')
    expect(hoisted.mockBumpAuthConfigVersionInTx).not.toHaveBeenCalled()
    expect(hoisted.mockResetAuth).not.toHaveBeenCalled()
    expect(hoisted.mockInvalidateSettingsCache).not.toHaveBeenCalled()
  })

  it('wraps and rethrows a database error instead of swallowing it (696-698)', async () => {
    hoisted.txRejectsWith = new Error('connection reset')

    await expect(
      persistTestResult(EXISTING_ROW.id, {
        expectedDetailsChangedAt: null,
        outcome: 'success',
        capture: { registrationId: 'oidc_x', capturedAt: '2026-09-07T00:00:00.000Z', claims: {} },
      })
    ).rejects.toThrow('connection reset')
  })
})

describe('saveIdentityProviderClaimMapping', () => {
  it('throws IDP_NOT_FOUND when the row-locked select finds nothing (722-723)', async () => {
    hoisted.txSelectForUpdateRows = []

    let caught: unknown
    try {
      await saveIdentityProviderClaimMapping(EXISTING_ROW.id, {
        expectedClaimMapping: null,
        operations: [],
      })
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(ValidationError)
    expect(caught).toMatchObject({ code: 'IDP_NOT_FOUND' })
    expect(hoisted.capturedSetPatch).toBeNull()
  })

  it('throws MAPPING_CONFLICT when the stored mapping no longer matches what the editor started from (725-726)', async () => {
    hoisted.txSelectForUpdateRows = [
      { ...EXISTING_ROW, claimMapping: { profile: { claims: { email: 'upn' } } } },
    ]

    let caught: unknown
    try {
      await saveIdentityProviderClaimMapping(EXISTING_ROW.id, {
        expectedClaimMapping: { profile: { claims: { email: 'different_upn' } } },
        operations: [],
      })
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(ConflictError)
    expect(caught).toMatchObject({ code: 'MAPPING_CONFLICT' })
    expect(hoisted.capturedSetPatch).toBeNull()
  })

  it('applies the edit, restamps on a profile-signature change, and returns the saved provider (711-733)', async () => {
    hoisted.txSelectForUpdateRows = [{ ...EXISTING_ROW, claimMapping: null }]
    hoisted.txUpdateReturning = [
      {
        ...EXISTING_ROW,
        claimMapping: { profile: { claims: { email: 'upn' } } },
        detailsChangedAt: new Date('2026-09-07T00:00:00.000Z'),
      },
    ]

    const result = await saveIdentityProviderClaimMapping(EXISTING_ROW.id, {
      expectedClaimMapping: null,
      operations: [{ op: 'setProfileClaim', field: 'email', path: 'upn' }],
    })

    expect(hoisted.capturedSetPatch?.claimMapping).toEqual({
      profile: { claims: { email: 'upn' } },
    })
    // A profile-affecting edit changes the effective signature, so it must
    // restamp detailsChangedAt (production behaviour this test pins).
    expect(hoisted.capturedSetPatch?.detailsChangedAt).toBeInstanceOf(Date)
    expect(hoisted.mockBumpAuthConfigVersionInTx).toHaveBeenCalledTimes(1)
    expect(hoisted.mockResetAuth).toHaveBeenCalledTimes(1)
    expect(result.id).toBe(EXISTING_ROW.id)
    expect(result.claimMapping).toEqual({ profile: { claims: { email: 'upn' } } })
  })

  it('does not restamp for a role-only edit (profile signature unchanged) and requires no acknowledgement for a non-admin rule', async () => {
    hoisted.txSelectForUpdateRows = [{ ...EXISTING_ROW, claimMapping: null }]
    hoisted.txUpdateReturning = [{ ...EXISTING_ROW, claimMapping: null }]

    await saveIdentityProviderClaimMapping(EXISTING_ROW.id, {
      expectedClaimMapping: null,
      operations: [
        { op: 'insertRoleRule', index: 0, rule: { whenContains: 'eng', role: 'member' } },
      ],
    })

    expect(hoisted.capturedSetPatch?.detailsChangedAt).toBeUndefined()
  })

  it('throws MAPPING_IDENTIFIER_ACK_REQUIRED when the edit changes the identifier without acknowledgement', async () => {
    hoisted.txSelectForUpdateRows = [{ ...EXISTING_ROW, claimMapping: null }]

    await expect(
      saveIdentityProviderClaimMapping(EXISTING_ROW.id, {
        expectedClaimMapping: null,
        operations: [{ op: 'setProfileClaim', field: 'id', path: 'oid' }],
      })
    ).rejects.toMatchObject({ code: 'MAPPING_IDENTIFIER_ACK_REQUIRED' })
    expect(hoisted.capturedSetPatch).toBeNull()
  })

  it('throws MAPPING_ADMIN_ACK_REQUIRED when an operation adds an admin rule without acknowledgement', async () => {
    hoisted.txSelectForUpdateRows = [{ ...EXISTING_ROW, claimMapping: null }]

    await expect(
      saveIdentityProviderClaimMapping(EXISTING_ROW.id, {
        expectedClaimMapping: null,
        operations: [
          { op: 'insertRoleRule', index: 0, rule: { whenContains: 'admins', role: 'admin' } },
        ],
      })
    ).rejects.toMatchObject({ code: 'MAPPING_ADMIN_ACK_REQUIRED' })
    expect(hoisted.capturedSetPatch).toBeNull()
  })

  it('wraps and rethrows a database error rather than swallowing it (768-770)', async () => {
    hoisted.txSelectForUpdateRows = [{ ...EXISTING_ROW, claimMapping: null }]
    hoisted.txRejectsWith = new Error('connection reset')

    await expect(
      saveIdentityProviderClaimMapping(EXISTING_ROW.id, {
        expectedClaimMapping: null,
        operations: [],
      })
    ).rejects.toThrow('connection reset')
  })
})
