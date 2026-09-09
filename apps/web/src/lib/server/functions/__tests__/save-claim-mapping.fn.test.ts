/**
 * `saveIdentityProviderClaimMappingFn` in `sso.ts`.
 *
 * What an operator relies on: only a teammate holding `auth.manage` can edit
 * a provider's claim mapping, editing a provider that no longer exists is
 * refused rather than silently creating one, and the audit trail records
 * that the mapping changed WITHOUT leaking the claim values it matches on
 * (upstream PR #508: "stop leaking claim values" — the audit projection
 * carries `whenContains` for no rule, only its role and position).
 *
 * Follows the pattern of `identity-provider-logo.fn.test.ts`: mock
 * `createServerFn` so the export is the plain handler, mock `auth-helpers`,
 * `audit/log`, and the service module. `diffProviderAudit` and
 * `applyClaimMappingEdits` run for real (pure functions) so the audit
 * assertions are against production behaviour, not a stub.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { IdentityProvider } from '@/lib/server/domains/settings/identity-providers.service'

type AnyHandler = (args: { data: Record<string, unknown> }) => Promise<unknown>

vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => {
    const chain = {
      validator() {
        return chain
      },
      handler: (fn: AnyHandler) => fn,
    }
    return chain
  },
}))

vi.mock('@tanstack/react-start/server', () => ({
  getRequestHeaders: () => new Headers(),
}))

const hoisted = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  requireEntitlement: vi.fn(),
  auditSpecs: [] as Array<Record<string, unknown>>,
  listIdentityProviders: vi.fn(),
  saveIdentityProviderClaimMapping: vi.fn(),
}))

vi.mock('@/lib/server/functions/auth-helpers', () => ({
  requireAuth: hoisted.requireAuth,
}))

vi.mock('@/lib/server/audit/log', () => ({
  actorFromAuth: (auth: { user: { id: string } }) => ({ userId: auth.user.id }),
  withAuditEvent: async (spec: Record<string, unknown>, run: () => Promise<unknown>) => {
    hoisted.auditSpecs.push(spec)
    return run()
  },
}))

vi.mock('@/lib/server/domains/settings/cloud/entitlements', () => ({
  requireEntitlement: hoisted.requireEntitlement,
}))

vi.mock('@/lib/server/domains/settings/identity-providers.service', () => ({
  listIdentityProviders: hoisted.listIdentityProviders,
  saveIdentityProviderClaimMapping: hoisted.saveIdentityProviderClaimMapping,
}))

import { saveIdentityProviderClaimMappingFn } from '../sso'
import { PERMISSIONS } from '@/lib/shared/permissions'

const saveClaimMapping = saveIdentityProviderClaimMappingFn as unknown as AnyHandler

const ADMIN = {
  user: { id: 'user_admin', email: 'admin@example.com' },
  principal: { role: 'admin' },
}

function makeProvider(overrides: Partial<IdentityProvider> = {}): IdentityProvider {
  return {
    id: 'idp_acme',
    registrationId: 'oidc_acme',
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
    configured: true,
    autoCreateUsers: true,
    autoProvisionRole: null,
    claimMapping: null,
    showButton: false,
    logoKey: null,
    logoUrl: null,
    detailsChangedAt: null,
    lastSuccessfulTestAt: null,
    lastTestCapture: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    domains: [],
    visibility: 'hidden',
    ...overrides,
  } as unknown as IdentityProvider
}

beforeEach(() => {
  hoisted.requireAuth.mockReset().mockResolvedValue(ADMIN)
  hoisted.requireEntitlement.mockReset().mockResolvedValue(undefined)
  hoisted.auditSpecs.length = 0
  hoisted.listIdentityProviders.mockReset().mockResolvedValue([makeProvider()])
  hoisted.saveIdentityProviderClaimMapping.mockReset().mockResolvedValue(makeProvider())
})

describe('saveIdentityProviderClaimMappingFn', () => {
  it('refuses a caller without auth.manage before anything is read, changed, or audited', async () => {
    hoisted.requireAuth.mockRejectedValue(new Error('Forbidden'))

    await expect(
      saveClaimMapping({
        data: { id: 'idp_acme', expectedClaimMapping: null, operations: [] },
      })
    ).rejects.toThrow('Forbidden')

    expect(hoisted.requireAuth).toHaveBeenCalledWith({ permission: PERMISSIONS.AUTH_MANAGE })
    expect(hoisted.listIdentityProviders).not.toHaveBeenCalled()
    expect(hoisted.saveIdentityProviderClaimMapping).not.toHaveBeenCalled()
    expect(hoisted.auditSpecs).toEqual([])
  })

  it('refuses to edit a provider that no longer exists (IDP_NOT_FOUND)', async () => {
    hoisted.listIdentityProviders.mockResolvedValue([])

    await expect(
      saveClaimMapping({
        data: { id: 'idp_gone', expectedClaimMapping: null, operations: [] },
      })
    ).rejects.toMatchObject({ code: 'IDP_NOT_FOUND' })

    expect(hoisted.saveIdentityProviderClaimMapping).not.toHaveBeenCalled()
    expect(hoisted.auditSpecs).toEqual([])
  })

  it('applies the edit, forwards it to the service, and audits the mapping change without the matched claim value', async () => {
    const result = await saveClaimMapping({
      data: {
        id: 'idp_acme',
        expectedClaimMapping: null,
        operations: [
          {
            op: 'insertRoleRule',
            index: 0,
            rule: { whenContains: 'engineering-team', role: 'member' },
          },
        ],
      },
    })

    expect(hoisted.saveIdentityProviderClaimMapping).toHaveBeenCalledWith('idp_acme', {
      expectedClaimMapping: null,
      operations: [
        {
          op: 'insertRoleRule',
          index: 0,
          rule: { whenContains: 'engineering-team', role: 'member' },
        },
      ],
      acknowledgeIdentifierChange: undefined,
      acknowledgeAdminRules: undefined,
    })
    expect(result).toEqual(makeProvider())

    expect(hoisted.auditSpecs).toHaveLength(1)
    const spec = hoisted.auditSpecs[0]
    expect(spec).toMatchObject({
      event: 'idp.updated',
      actor: { userId: 'user_admin' },
      target: { type: 'identity_provider', id: 'idp_acme' },
    })
    // The role rule's matched value ("engineering-team") must never appear in
    // the audit trail — only its position and assigned role do.
    const auditJson = JSON.stringify(spec)
    expect(auditJson).not.toContain('engineering-team')
    expect(spec.after).toEqual({
      claimMapping: {
        role: { claimPath: 'groups', ruleCount: 1, rules: [{ index: 0, role: 'member' }] },
      },
    })
    expect(spec.before).toEqual({ claimMapping: null })
  })

  it('passes acknowledgement flags through to the service unchanged', async () => {
    await saveClaimMapping({
      data: {
        id: 'idp_acme',
        expectedClaimMapping: null,
        operations: [{ op: 'setProfileClaim', field: 'id', path: 'oid' }],
        acknowledgeIdentifierChange: true,
        acknowledgeAdminRules: true,
      },
    })

    expect(hoisted.saveIdentityProviderClaimMapping).toHaveBeenCalledWith(
      'idp_acme',
      expect.objectContaining({
        acknowledgeIdentifierChange: true,
        acknowledgeAdminRules: true,
      })
    )
  })
})
