/**
 * Widget Bearers must not hit Better Auth's mounted account-mutation
 * endpoints. `emailOTP.changeEmail` has verifyCurrentEmail: false, so the
 * current-address proof in contact-email.ts is skipped on these paths.
 */
import { describe, expect, it, vi } from 'vitest'
import { APIError } from 'better-auth/api'

vi.mock('@tanstack/react-start/server', () => ({
  getRequestHeaders: () => new Headers(),
}))

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: { query: {} },
}))

vi.mock('@/lib/server/domains/settings/settings.service', () => ({
  getWorkspaceSettings: vi.fn(),
  getPublicPortalConfig: vi.fn(),
}))

vi.mock('@/lib/server/auth/signin-rate-limit', () => ({
  checkCredentialSignInRateLimit: vi.fn(),
  checkMagicLinkSendRateLimit: vi.fn(),
}))

vi.mock('@/lib/server/auth/widget-rate-limit', () => ({
  checkAnonMintRateLimit: vi.fn(),
}))

vi.mock('@/lib/server/audit/log', () => ({
  recordAuditEvent: vi.fn(),
}))

vi.mock('@/lib/server/domains/principals/bootstrap-admin', () => ({
  findHumanAdmin: vi.fn(),
  isOpenToBootstrapClaim: vi.fn(),
}))

vi.mock('@/lib/server/domains/settings/identity-providers.service', () => ({
  listIdentityProviders: vi.fn(),
}))

vi.mock('@/lib/server/auth/registered-providers', () => ({
  getRegisteredOidcProviderIds: vi.fn(),
}))

const { handleWidgetAccountMutationGate, hooksBefore } = await import('../hooks')

function ctx(opts: { path: string; token?: string; cookie?: string; scope?: string | null }) {
  const headers = new Headers()
  if (opts.token) headers.set('authorization', `Bearer ${opts.token}`)
  if (opts.cookie) headers.set('cookie', opts.cookie)
  return {
    path: opts.path,
    headers,
    context: {
      internalAdapter: {
        findSession: vi.fn(async (token: string) => {
          if (opts.scope === null) return null
          if (opts.token && token !== opts.token.split('.')[0]) return null
          return { session: { scope: opts.scope } }
        }),
      },
    },
  }
}

describe('handleWidgetAccountMutationGate', () => {
  it('rejects a widget Bearer on request-email-change (J6)', async () => {
    await expect(
      handleWidgetAccountMutationGate(
        ctx({ path: '/email-otp/request-email-change', token: 'widget-tok', scope: 'widget' })
      )
    ).rejects.toBeInstanceOf(APIError)
  })

  it('rejects a widget Bearer on change-email OTP confirm (J6)', async () => {
    await expect(
      handleWidgetAccountMutationGate(
        ctx({ path: '/email-otp/change-email', token: 'widget-tok', scope: 'widget' })
      )
    ).rejects.toThrow(/Widget sessions/)
  })

  it('allows a portal-scoped Bearer so handoff customers can still change email', async () => {
    await expect(
      handleWidgetAccountMutationGate(
        ctx({ path: '/email-otp/request-email-change', token: 'portal-tok', scope: 'portal' })
      )
    ).resolves.toBeUndefined()
  })

  it('allows a dashboard-scoped Bearer', async () => {
    await expect(
      handleWidgetAccountMutationGate(
        ctx({ path: '/change-email', token: 'dash-tok', scope: 'dashboard' })
      )
    ).resolves.toBeUndefined()
  })

  it('rejects a widget Bearer on session-revocation routes (J6)', async () => {
    await expect(
      handleWidgetAccountMutationGate(
        ctx({ path: '/revoke-sessions', token: 'widget-tok', scope: 'widget' })
      )
    ).rejects.toThrow(/Widget sessions/)
    await expect(
      handleWidgetAccountMutationGate(
        ctx({ path: '/revoke-other-sessions', token: 'widget-tok', scope: 'widget' })
      )
    ).rejects.toThrow(/Widget sessions/)
  })

  it('rejects a widget Bearer on OAuth account-link routes (J6)', async () => {
    await expect(
      handleWidgetAccountMutationGate(
        ctx({ path: '/link-social', token: 'widget-tok', scope: 'widget' })
      )
    ).rejects.toThrow(/Widget sessions/)
    await expect(
      handleWidgetAccountMutationGate(
        ctx({ path: '/oauth2/link', token: 'widget-tok', scope: 'widget' })
      )
    ).rejects.toThrow(/Widget sessions/)
  })

  it('allows widget Bearers on the session/OTT allowlist', async () => {
    await expect(
      handleWidgetAccountMutationGate(
        ctx({ path: '/get-session', token: 'widget-tok', scope: 'widget' })
      )
    ).resolves.toBeUndefined()
    await expect(
      handleWidgetAccountMutationGate(
        ctx({ path: '/one-time-token/generate', token: 'widget-tok', scope: 'widget' })
      )
    ).resolves.toBeUndefined()
  })

  it('rejects a widget Bearer on any other Better Auth path (J6)', async () => {
    await expect(
      handleWidgetAccountMutationGate(
        ctx({ path: '/sign-out', token: 'widget-tok', scope: 'widget' })
      )
    ).rejects.toThrow(/Widget sessions/)
  })

  it('rejects a widget session carried in the signed session cookie (J6)', async () => {
    const gateCtx = ctx({
      path: '/change-email',
      cookie: `theme=dark; better-auth.session_token=${encodeURIComponent('widget-tok.sig/+=')}`,
      scope: 'widget',
    })

    await expect(handleWidgetAccountMutationGate(gateCtx)).rejects.toThrow(/Widget sessions/)
    // The signature after the dot is not part of the session token.
    expect(gateCtx.context.internalAdapter.findSession).toHaveBeenCalledWith('widget-tok')
  })

  it('reads a session cookie whose value is not percent-encoded as it stands (J6)', async () => {
    const gateCtx = ctx({
      path: '/change-email',
      cookie: 'better-auth.session_token=widget%tok',
      scope: 'widget',
    })

    await expect(handleWidgetAccountMutationGate(gateCtx)).rejects.toThrow(/Widget sessions/)
    expect(gateCtx.context.internalAdapter.findSession).toHaveBeenCalledWith('widget%tok')
  })

  it('looks up nothing for an empty session cookie (J6)', async () => {
    const gateCtx = ctx({
      path: '/change-email',
      cookie: 'better-auth.session_token=',
      scope: 'widget',
    })

    await expect(handleWidgetAccountMutationGate(gateCtx)).resolves.toBeUndefined()
    expect(gateCtx.context.internalAdapter.findSession).not.toHaveBeenCalled()
  })

  it('no-ops when there is no session token', async () => {
    await expect(
      handleWidgetAccountMutationGate(ctx({ path: '/change-email' }))
    ).resolves.toBeUndefined()
  })
})

describe('the before-hook Better Auth runs on every request (J6)', () => {
  it('applies the widget gate, so a widget Bearer is refused on a mutation path (J6)', async () => {
    const run = hooksBefore as unknown as (c: unknown) => Promise<unknown>

    await expect(
      run(ctx({ path: '/change-email', token: 'widget-tok', scope: 'widget' }))
    ).rejects.toThrow(/Widget sessions/)
  })

  it('lets a portal Bearer through on the same path (J6)', async () => {
    const run = hooksBefore as unknown as (c: unknown) => Promise<unknown>

    const portalCtx = ctx({ path: '/change-email', token: 'portal-tok', scope: 'portal' })

    await run(portalCtx)
    expect(portalCtx.context.internalAdapter.findSession).toHaveBeenCalledWith('portal-tok')
  })
})
