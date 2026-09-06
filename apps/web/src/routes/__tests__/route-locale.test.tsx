// @vitest-environment happy-dom
/**
 * The locale each surface loads its catalogue under.
 *
 * Contract, continuing the language card's numbering:
 *
 *   L12 Every surface loads its messages under the locale the request
 *       resolved -- the one the SSR document's `<html lang>` is built from --
 *       and never from a second reading of the browser header. (V1, V5)
 *   L13 A surface reached without a resolved locale renders in English rather
 *       than not at all. (V6)
 *
 * L12 is what the portal rewiring is for, and it is the kind of guarantee
 * that holds by accident until it does not: while nobody had picked a
 * language, a second resolver read the same header and agreed. These call the
 * real loaders, so a surface that goes back to resolving its own locale is
 * caught here rather than by a reader seeing `lang="de"` over French.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const accessResult = {
  granted: false as boolean,
  reason: 'unauthenticated' as string,
}

vi.mock('@/lib/server/functions/portal', () => ({
  fetchUserAvatar: async () => ({ avatarUrl: null }),
}))

vi.mock('@/lib/server/functions/version', () => ({
  getLatestVersion: async () => null,
  isNewerVersion: () => false,
}))

vi.mock('@/lib/server/functions/plan-notice', () => ({
  getPlanNotice: async () => null,
}))

vi.mock('@/lib/server/functions/portal-access', () => ({
  evaluateMyPortalAccessFn: async () => accessResult,
  recordPortalAccessDeniedFn: async () => undefined,
}))

vi.mock('@/lib/server/functions/portal-permissions', () => ({
  getMyPortalPermissionsFn: async () => [],
}))

vi.mock('@/lib/server/functions/instant-sso', () => ({
  resolveInstantSsoRedirectFn: async () => null,
}))

import { Route as AdminRoute } from '@/routes/admin'
import { Route as PortalRoute } from '@/routes/_portal'
import { Route as RecoveryRoute } from '@/routes/auth.recovery'
import { Route as ResetPasswordRoute } from '@/routes/auth.reset-password'

/** Calls a route's loader with just the parts of the context it reads. */
async function load(route: { options: { loader?: unknown } }, context: unknown, extra = {}) {
  const loader = route.options.loader as (args: unknown) => Promise<unknown>
  return await loader({ context, location: { pathname: '/' }, deps: {}, ...extra })
}

beforeEach(() => {
  accessResult.granted = false
  accessResult.reason = 'unauthenticated'
})

describe('the locale a surface loads its catalogue under', () => {
  it('is the one the request resolved, for the admin (L12)', async () => {
    const loaded = (await load(AdminRoute, {
      resolvedLocale: 'de',
      user: { id: 'user_1', name: 'A', email: 'a@example.com', image: null },
      principal: { chatAvailability: 'online' },
    })) as { locale: string; messages: Record<string, string> }

    expect(loaded.locale).toBe('de')
    expect(loaded.messages['common.cancel']).toBeTruthy()
  })

  it('falls back to English when the admin context carries none (L13)', async () => {
    const loaded = (await load(AdminRoute, {
      user: { id: 'user_1', name: 'A', email: 'a@example.com', image: null },
      principal: { chatAvailability: 'online' },
    })) as { locale: string }

    expect(loaded.locale).toBe('en')
  })

  it('is the one the request resolved, for the portal sign-in wall (L12)', async () => {
    // The denied path is the one that carries a locale of its own into what it
    // returns, so it is where a second resolver would show up first.
    const loaded = (await load(
      PortalRoute,
      { resolvedLocale: 'de', settings: { name: 'Acme' } },
      { deps: { error: 'access_denied' } }
    )) as { gate: { locale: string } }

    expect(loaded.gate.locale).toBe('de')
  })

  it('falls back to English when the portal context carries none (L13)', async () => {
    const loaded = (await load(
      PortalRoute,
      { settings: { name: 'Acme' } },
      { deps: { error: 'access_denied' } }
    )) as { gate: { locale: string } }

    expect(loaded.gate.locale).toBe('en')
  })

  it('is the one the request resolved, for the standalone auth pages (L12)', async () => {
    for (const route of [RecoveryRoute, ResetPasswordRoute]) {
      const loaded = (await load(route, { resolvedLocale: 'de' })) as {
        locale: string
        messages: Record<string, string>
      }

      expect(loaded.locale).toBe('de')
      expect(loaded.messages['common.cancel']).toBeTruthy()
    }
  })

  it('falls back to English on the standalone auth pages (L13)', async () => {
    for (const route of [RecoveryRoute, ResetPasswordRoute]) {
      const loaded = (await load(route, {})) as { locale: string }

      expect(loaded.locale).toBe('en')
    }
  })
})
