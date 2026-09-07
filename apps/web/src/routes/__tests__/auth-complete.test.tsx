// @vitest-environment happy-dom
/**
 * The popup landing, in the language of the person reading it.
 *
 * S3 The wire carries the outcome, not the sentence. What crosses from server
 *    to browser is the code; the sentence is chosen where it is shown, in the
 *    language of the person reading it. [V1, V2]
 * S4 A sign-in outcome the product does not know still produces a sentence in
 *    the reader's language -- never a blank, a bare code, or an English
 *    fallback inside a translated screen. [V6]
 *
 * This is the surface those two are easiest to lose on: `/auth/auth-complete`
 * is a route of its own, outside every layout that mounts a provider, so until
 * this batch it was the one sign-in surface with no catalogue at all. Mounting
 * it for real is the only way to see that -- a component rendered under a
 * provider a test supplied would pass whether or not the route mounts one.
 */
import type { ReactNode } from 'react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import '@testing-library/jest-dom/vitest'
import { render, cleanup, screen } from '@testing-library/react'
import {
  RouterProvider,
  createMemoryHistory,
  createRoute,
  createRouter,
} from '@tanstack/react-router'
import { QueryClient } from '@tanstack/react-query'
import germanMessages from '@/locales/de.json'
import { authBlockMessageId } from '@/lib/shared/auth-block-messages'

vi.mock('@/lib/server/functions/bootstrap', () => ({
  getBootstrapData: async () => ({
    baseUrl: 'https://example.test',
    session: null,
    // The root redirects to /onboarding unless setup reads as finished, and
    // this suite is about the popup, not that redirect.
    settings: {
      settings: {
        setupState: JSON.stringify({
          version: 2,
          steps: {
            core: true,
            workspace: true,
            startingPoint: {
              outcome: 'product_feedback',
              resourceType: 'board',
              source: 'wizard',
              resolution: 'created',
              completedAt: '2026-01-01T00:00:00.000Z',
            },
          },
        }),
      },
    },
    userRole: null,
    themeCookie: 'light',
    prefersColorScheme: 'light',
    managedFieldPaths: [],
    registeredAuthProviders: [],
    resolvedLocale: 'de',
    updateBannerDismissedVersion: null,
    billingEnabled: false,
    cloudEnabled: false,
  }),
}))

vi.mock('@/lib/client/hooks/use-auth-broadcast', () => ({
  postAuthSuccess: vi.fn(),
  postAuthError: vi.fn(),
}))

vi.mock('@/components/shared/ott-handler', () => ({ OttHandler: () => null }))
vi.mock('@/components/shared/visitor-beacon', () => ({ VisitorBeacon: () => null }))
vi.mock('@/components/ui/sonner', () => ({ Toaster: () => null }))
vi.mock('@/components/theme-provider', () => ({
  ThemeProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}))

import { Route as RootRoute } from '@/routes/__root'
import { Route as AuthCompleteRoute } from '@/routes/auth.auth-complete'

const german = germanMessages as Record<string, string>

/**
 * Mounts the popup under the real root at a given `?error=`.
 *
 * The route is rebuilt from the file route's own options rather than added to
 * the root directly: a file route already carries a parent, and
 * `RootRoute.addChildren([AuthCompleteRoute])` fails with `Duplicate routes
 * found with id: __root__`. Importing `routeTree.gen` instead does work when
 * that file happens to be on disk, and it is generated and gitignored, so a
 * suite that depends on it is a suite that fails wherever nobody built first.
 *
 * The component still calls the file route's `Route.useLoaderData()`, which
 * resolves by route id -- so the rebuilt route has to keep the same path.
 */
async function mountPopup(search: string) {
  const router = createRouter({
    routeTree: RootRoute.addChildren([
      createRoute({
        getParentRoute: () => RootRoute,
        path: '/auth/auth-complete',
        validateSearch: AuthCompleteRoute.options.validateSearch,
        loader: AuthCompleteRoute.options.loader,
        component: AuthCompleteRoute.options.component,
      }),
    ]),
    context: { queryClient: new QueryClient() },
    history: createMemoryHistory({ initialEntries: [`/auth/auth-complete${search}`] }),
  })
  await router.load()
  // A mistyped path renders the not-found page inside the same document, so
  // the assertions below would read a page this suite never mounted.
  expect(router.state.matches.map((match) => match.routeId)).toContain('/auth/auth-complete')
  render(<RouterProvider router={router} />)
}

afterEach(cleanup)

describe('the popup landing after a failed sign-in (S3, S4)', () => {
  it('names the outcome in the reader’s language (S3)', async () => {
    await mountPopup('?error=token_expired')

    expect(await screen.findByText(german[authBlockMessageId('token_expired')])).toBeInTheDocument()
    expect(screen.getByText(german['portal.auth.complete.failedTitle'])).toBeInTheDocument()
  })

  it('says something of its own for an outcome it does not know (S4)', async () => {
    await mountPopup('?error=a_code_from_a_later_version')

    // Not the generic sign-in sentence: this window knows the reader has
    // another one to go back to.
    expect(
      await screen.findByText(german['portal.auth.complete.failedGeneric'])
    ).toBeInTheDocument()
    expect(screen.queryByText(german['portal.auth.error.signinFailed'])).toBeNull()
  })

  it('translates the success path too (S3)', async () => {
    await mountPopup('')

    expect(await screen.findByText(german['portal.auth.complete.success'])).toBeInTheDocument()
    expect(screen.getByText(german['portal.auth.complete.closing'])).toBeInTheDocument()
  })
})
