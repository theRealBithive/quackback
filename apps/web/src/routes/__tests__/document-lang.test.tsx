// @vitest-environment happy-dom
/**
 * What the SSR document declares its language to be.
 *
 * Contract, continuing the language card's numbering:
 *
 *   L14 The `lang` and `dir` on the document are the language its text is
 *       actually written in -- the one the request resolved on a surface we
 *       have translated, and English on one we have not. (V5)
 *   L15 The widget's own `?locale=` override wins for the widget document,
 *       because that is the language the widget itself renders in. (V5, V8)
 *
 * `documentLocale` and `htmlLangDir` each have their own suite; neither can
 * see the composition in the root document, which is where the resolved
 * locale, the widget override and the English default meet. This mounts the
 * real root component so that composition is what is measured -- a
 * `lang="de"` sitting over English text is the failure V5 names, and it lives
 * exactly here.
 */
import type { ReactNode } from 'react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import {
  RouterProvider,
  createMemoryHistory,
  createRoute,
  createRouter,
} from '@tanstack/react-router'
import { QueryClient } from '@tanstack/react-query'
import type { SupportedLocale } from '@/lib/shared/i18n'

const bootstrap = {
  resolvedLocale: 'de' as SupportedLocale | undefined,
}

vi.mock('@/lib/server/functions/bootstrap', () => ({
  getBootstrapData: async () => ({
    baseUrl: 'https://example.test',
    session: null,
    // The root redirects to /onboarding unless setup reads as finished, and
    // this suite is about the document, not that redirect.
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
    resolvedLocale: bootstrap.resolvedLocale,
    updateBannerDismissedVersion: null,
    billingEnabled: false,
    cloudEnabled: false,
  }),
}))

vi.mock('@/components/shared/ott-handler', () => ({ OttHandler: () => null }))
vi.mock('@/components/shared/visitor-beacon', () => ({ VisitorBeacon: () => null }))
vi.mock('@/components/ui/sonner', () => ({ Toaster: () => null }))
vi.mock('@/components/theme-provider', () => ({
  ThemeProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}))

import { Route as RootRoute } from '@/routes/__root'

/**
 * Mounts the real root document with one route matched.
 *
 * The route is asserted to have actually matched before anything is read off
 * the document. Without that a mistyped path renders the router's not-found
 * page under a document that still says `lang="en"` -- which is what several
 * of these expect, so the suite would go green on a test that mounted
 * nothing.
 */
async function documentAttributes(routeId: string, url: string) {
  const router = createRouter({
    routeTree: RootRoute.addChildren([
      createRoute({ getParentRoute: () => RootRoute, path: routeId, component: () => <div /> }),
    ]),
    context: { queryClient: new QueryClient() },
    history: createMemoryHistory({ initialEntries: [url] }),
  })
  await router.load()
  expect(router.state.matches.map((match) => match.routeId)).toContain(routeId)
  // React hoists the document's own `<html>` onto the real one, so the
  // attributes land on `document.documentElement` rather than inside the
  // container. Cleared first: a render that sets neither would otherwise read
  // back whatever the previous test left there.
  document.documentElement.removeAttribute('lang')
  document.documentElement.removeAttribute('dir')
  render(<RouterProvider router={router} />)
  return {
    lang: document.documentElement.getAttribute('lang'),
    dir: document.documentElement.getAttribute('dir'),
  }
}

afterEach(() => {
  cleanup()
  bootstrap.resolvedLocale = 'de'
})

describe('the language the document declares', () => {
  it('is the resolved one on a surface we have translated (L14)', async () => {
    // A standalone localized route. The portal layout takes the same branch
    // through a route id rather than a path; `documentLocale`'s own suite
    // holds that half.
    expect(await documentAttributes('/auth/recovery', '/auth/recovery')).toEqual({
      lang: 'de',
      dir: 'ltr',
    })
  })

  it('is English on a surface we have not translated (L14)', async () => {
    // The admin is not in the allowlist yet, and it must not be: `lang="de"`
    // over an English admin is the mislabeling V5 forbids, and worse than the
    // gap it would close.
    expect(await documentAttributes('/admin', '/admin')).toEqual({
      lang: 'en',
      dir: 'ltr',
    })
  })

  it('is English when the request resolved nothing (L14)', async () => {
    bootstrap.resolvedLocale = undefined

    expect(await documentAttributes('/auth/recovery', '/auth/recovery')).toEqual({
      lang: 'en',
      dir: 'ltr',
    })
  })

  it('follows the widget its own override, right to left and all (L15)', async () => {
    expect(await documentAttributes('/widget', '/widget?locale=ar')).toEqual({
      lang: 'ar',
      dir: 'rtl',
    })
  })

  it('ignores a locale param the widget cannot render (L15)', async () => {
    expect(await documentAttributes('/widget', '/widget?locale=klingon')).toEqual({
      lang: 'de',
      dir: 'ltr',
    })
  })

  it('ignores the widget override outside the widget (L15)', async () => {
    expect(await documentAttributes('/auth/recovery', '/auth/recovery?locale=ar')).toEqual({
      lang: 'de',
      dir: 'ltr',
    })
  })
})
