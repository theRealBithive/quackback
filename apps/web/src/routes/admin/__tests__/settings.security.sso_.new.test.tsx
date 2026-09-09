// @vitest-environment happy-dom
/**
 * `/admin/settings/security/sso_/new` — the create-connection route.
 * `beforeLoad` (permission gate) is not under test here; this exercises the
 * loader's entitlement check plus registrationId generation, and the
 * component's choice between the create page and the upgrade screen.
 *
 * Fake root, same reasoning as `settings.security.sso_.providerId.test.tsx`:
 * English-only page, no IntlProvider or bootstrap context needed.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRouteWithContext,
  createRoute,
  createRouter,
} from '@tanstack/react-router'
import { QueryClient } from '@tanstack/react-query'
import type { RouterContext } from '@/routes/__root'
import { Route as SsoCreateRouteFile } from '@/routes/admin/settings.security.sso_.new'

const { hasEntitlementSpy } = vi.hoisted(() => ({
  hasEntitlementSpy: vi.fn(async () => true),
}))

vi.mock('@/lib/server/functions/entitlement-status', () => ({
  hasEntitlementFn: hasEntitlementSpy,
}))

vi.mock('@/lib/client/queries/billing', () => ({
  ensureBillingCatalogue: vi.fn(async () => null),
}))

vi.mock('@/components/admin/settings/security/identity-providers/provider-create-page', () => ({
  ProviderCreatePage: ({ registrationId }: { registrationId: string }) => (
    <div data-testid="registration-id">{registrationId}</div>
  ),
}))

vi.mock('@/components/admin/upgrade', () => ({
  UpgradeScreen: () => <div data-testid="upgrade-screen" />,
}))

function buildRouter() {
  const rootRoute = createRootRouteWithContext<RouterContext>()({
    component: () => <Outlet />,
  })
  const createRouteNode = createRoute({
    getParentRoute: () => rootRoute as never,
    path: '/admin/settings/security/sso_/new',
    loader: SsoCreateRouteFile.options.loader,
    component: SsoCreateRouteFile.options.component,
  })
  return createRouter({
    routeTree: rootRoute.addChildren([createRouteNode]),
    context: { queryClient: new QueryClient(), billingEnabled: false },
    history: createMemoryHistory({ initialEntries: ['/admin/settings/security/sso_/new'] }),
  })
}

afterEach(cleanup)

describe('/admin/settings/security/sso_/new', () => {
  it('hands an entitled admin the create page seeded with a freshly generated registrationId', async () => {
    hasEntitlementSpy.mockResolvedValueOnce(true)
    const router = buildRouter()
    await router.load()
    render(<RouterProvider router={router} />)
    expect(screen.getByTestId('registration-id').textContent).toMatch(/^oidc_[a-z0-9]+$/)
  })

  it('shows the upgrade screen instead of the create page when SSO is not entitled', async () => {
    hasEntitlementSpy.mockResolvedValueOnce(false)
    const router = buildRouter()
    await router.load()
    render(<RouterProvider router={router} />)
    expect(screen.getByTestId('upgrade-screen')).toBeInTheDocument()
    expect(screen.queryByTestId('registration-id')).not.toBeInTheDocument()
  })
})
