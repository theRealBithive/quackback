// @vitest-environment happy-dom
/**
 * `/admin/settings/security/sso_/$providerId` — the provider detail route.
 * `beforeLoad` (permission gate) and the data-prefetching `loader` are not
 * under test here (no diff-coverage lines land in them); this covers the
 * three lines that are: `validateSearch`'s `?test=` coercion, and the
 * component reading `providerId` / `test` off the route and clearing the
 * search once the auto-test it requested has been consumed.
 *
 * Built on a fake root rather than the real one (see
 * `onboarding-intl.test.tsx`): this page is English-only and needs neither
 * `IntlProvider` nor bootstrap/session context, only `queryClient`.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
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
import { Route as ProviderDetailRouteFile } from '@/routes/admin/settings.security.sso_.$providerId'

vi.mock('@/components/admin/settings/security/identity-providers/provider-detail-page', () => ({
  ProviderDetailPage: ({
    providerId,
    autoTest,
    onAutoTestConsumed,
  }: {
    providerId: string
    autoTest: boolean
    onAutoTestConsumed: () => void
  }) => (
    <div>
      <div data-testid="provider-id">{providerId}</div>
      <div data-testid="auto-test">{String(autoTest)}</div>
      <button type="button" onClick={onAutoTestConsumed}>
        consume
      </button>
    </div>
  ),
}))

function buildRouter(initialEntry: string) {
  const rootRoute = createRootRouteWithContext<RouterContext>()({
    component: () => <Outlet />,
  })
  const providerRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/admin/settings/security/sso_/$providerId',
    validateSearch: ProviderDetailRouteFile.options.validateSearch,
    component: ProviderDetailRouteFile.options.component,
  })
  return createRouter({
    routeTree: rootRoute.addChildren([providerRoute]),
    context: { queryClient: new QueryClient() },
    history: createMemoryHistory({ initialEntries: [initialEntry] }),
  })
}

afterEach(cleanup)

describe('/admin/settings/security/sso_/$providerId', () => {
  it('reads the providerId from the URL with no auto-test when there is no ?test', async () => {
    const router = buildRouter('/admin/settings/security/sso_/idp_1')
    await router.load()
    render(<RouterProvider router={router} />)
    expect(screen.getByTestId('provider-id').textContent).toBe('idp_1')
    expect(screen.getByTestId('auto-test').textContent).toBe('false')
  })

  it('treats ?test=1 as an auto-test request', async () => {
    const router = buildRouter('/admin/settings/security/sso_/idp_1?test=1')
    await router.load()
    render(<RouterProvider router={router} />)
    expect(screen.getByTestId('auto-test').textContent).toBe('true')
  })

  it('treats ?test=true the same way', async () => {
    const router = buildRouter('/admin/settings/security/sso_/idp_1?test=true')
    await router.load()
    render(<RouterProvider router={router} />)
    expect(screen.getByTestId('auto-test').textContent).toBe('true')
  })

  it('ignores an unrelated search param instead of treating it as a test request', async () => {
    const router = buildRouter('/admin/settings/security/sso_/idp_1?foo=bar')
    await router.load()
    render(<RouterProvider router={router} />)
    expect(screen.getByTestId('auto-test').textContent).toBe('false')
  })

  it('clears the test search param once the auto-test has been consumed', async () => {
    const router = buildRouter('/admin/settings/security/sso_/idp_1?test=1')
    await router.load()
    render(<RouterProvider router={router} />)
    fireEvent.click(screen.getByText('consume'))
    await waitFor(() => expect(router.state.location.search).toEqual({}))
  })
})
