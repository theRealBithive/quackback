/**
 * The two provider-logo server functions in `sso.ts`.
 *
 * What an operator relies on: only a teammate holding `auth.manage` can set
 * or clear a provider's logo, the write goes to the provider that was named
 * and no other, and every change leaves an `idp.updated` audit entry saying
 * what happened to the logo.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

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
  auditSpecs: [] as Array<Record<string, unknown>>,
  saveLogoKey: vi.fn(),
  deleteLogoKey: vi.fn(),
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

vi.mock('@/lib/server/domains/settings/identity-provider-logo.service', () => ({
  saveIdentityProviderLogoKey: hoisted.saveLogoKey,
  deleteIdentityProviderLogoKey: hoisted.deleteLogoKey,
}))

import { saveIdentityProviderLogoFn, deleteIdentityProviderLogoFn } from '../sso'
import { PERMISSIONS } from '@/lib/shared/permissions'

const saveLogo = saveIdentityProviderLogoFn as unknown as AnyHandler
const deleteLogo = deleteIdentityProviderLogoFn as unknown as AnyHandler

const ADMIN = {
  user: { id: 'user_admin', email: 'admin@example.com' },
  principal: { role: 'admin' },
}
const KEY = 'idp-logos/2026/09/acme.png'

beforeEach(() => {
  hoisted.requireAuth.mockReset().mockResolvedValue(ADMIN)
  hoisted.auditSpecs.length = 0
  hoisted.saveLogoKey.mockReset().mockResolvedValue({ success: true, key: KEY })
  hoisted.deleteLogoKey.mockReset().mockResolvedValue({ success: true })
})

describe('saveIdentityProviderLogoFn', () => {
  it('refuses a caller without auth.manage before anything is written or audited', async () => {
    hoisted.requireAuth.mockRejectedValue(new Error('Forbidden'))

    await expect(saveLogo({ data: { providerId: 'idp_acme', key: KEY } })).rejects.toThrow(
      'Forbidden'
    )

    expect(hoisted.requireAuth).toHaveBeenCalledWith({ permission: PERMISSIONS.AUTH_MANAGE })
    expect(hoisted.saveLogoKey).not.toHaveBeenCalled()
    expect(hoisted.auditSpecs).toEqual([])
  })

  it('stores the uploaded key on the named provider and records that its logo was set', async () => {
    const result = await saveLogo({ data: { providerId: 'idp_acme', key: KEY } })

    expect(hoisted.saveLogoKey).toHaveBeenCalledWith('idp_acme', KEY)
    expect(result).toEqual({ success: true, key: KEY })
    expect(hoisted.auditSpecs).toEqual([
      expect.objectContaining({
        event: 'idp.updated',
        actor: { userId: 'user_admin' },
        target: { type: 'identity_provider', id: 'idp_acme' },
        after: { logo: 'set' },
      }),
    ])
  })
})

describe('deleteIdentityProviderLogoFn', () => {
  it('refuses a caller without auth.manage before anything is removed or audited', async () => {
    hoisted.requireAuth.mockRejectedValue(new Error('Forbidden'))

    await expect(deleteLogo({ data: { providerId: 'idp_acme' } })).rejects.toThrow('Forbidden')

    expect(hoisted.requireAuth).toHaveBeenCalledWith({ permission: PERMISSIONS.AUTH_MANAGE })
    expect(hoisted.deleteLogoKey).not.toHaveBeenCalled()
    expect(hoisted.auditSpecs).toEqual([])
  })

  it('clears the logo of the named provider and records that it was cleared', async () => {
    const result = await deleteLogo({ data: { providerId: 'idp_acme' } })

    expect(hoisted.deleteLogoKey).toHaveBeenCalledWith('idp_acme')
    expect(result).toEqual({ success: true })
    expect(hoisted.auditSpecs).toEqual([
      expect.objectContaining({
        event: 'idp.updated',
        actor: { userId: 'user_admin' },
        target: { type: 'identity_provider', id: 'idp_acme' },
        after: { logo: 'cleared' },
      }),
    ])
  })
})
