// @vitest-environment happy-dom
/**
 * The onboarding tree renders react-intl consumers (the stepper in the layout,
 * every step's copy), so an `IntlProvider` has to sit above it. Without one
 * react-intl throws "Could not find required `intl` object", and
 * `/onboarding/account` is the first screen a freshly provisioned workspace
 * lands on.
 *
 * The test mounts the real route components (`routes/onboarding.tsx`, then
 * `routes/onboarding/_layout.tsx`, then a step-level probe) in a memory router with
 * the same ids the generated tree gives them, and asserts both levels can
 * resolve intl. Nothing here wraps the tree in a provider, and the shared vitest
 * setup mounts no React providers at all, so the only provider in play is the
 * one the onboarding route itself mounts.
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
import { useIntl } from 'react-intl'
import deMessages from '@/locales/de.json'
import type { SupportedLocale } from '@/lib/shared/i18n'
import type { RouterContext } from '@/routes/__root'
import { Route as OnboardingRoute } from '@/routes/onboarding'
import { Route as OnboardingLayoutRoute } from '@/routes/onboarding/_layout'

const german = deMessages as Record<string, string>

/** Stands in for a step route: any onboarding step calls useIntl like this. */
function StepProbe() {
  const intl = useIntl()
  return (
    <div data-testid="step" data-locale={intl.locale}>
      {intl.formatMessage({
        id: 'onboarding.account.title',
        defaultMessage: 'Create your account',
      })}
    </div>
  )
}

function buildRouter(locale: SupportedLocale | undefined) {
  const rootRoute = createRootRouteWithContext<RouterContext>()({
    component: () => <Outlet />,
  })

  // Same shape the generated tree builds: /onboarding (routes/onboarding.tsx)
  // is the parent of the pathless /onboarding/_layout, which parents the steps.
  const onboardingRoute = createRoute({
    // The app registers its own router type, so a hand-built test tree can't
    // satisfy the registered root's inferred shape; the cast keeps the tree
    // buildable without weakening the route options below.
    getParentRoute: () => rootRoute as never,
    path: '/onboarding',
    loader: OnboardingRoute.options.loader,
    component: OnboardingRoute.options.component,
  })
  const layoutRoute = createRoute({
    getParentRoute: () => onboardingRoute,
    id: '_layout',
    component: OnboardingLayoutRoute.options.component,
  })
  const stepRoute = createRoute({
    getParentRoute: () => layoutRoute,
    path: '/account',
    component: StepProbe,
  })

  return createRouter({
    routeTree: rootRoute.addChildren([
      onboardingRoute.addChildren([layoutRoute.addChildren([stepRoute])]),
    ]),
    context: { queryClient: new QueryClient(), resolvedLocale: locale },
    history: createMemoryHistory({ initialEntries: ['/onboarding/account'] }),
    defaultErrorComponent: ({ error }) => (
      <div data-testid="route-error">{error instanceof Error ? error.message : String(error)}</div>
    ),
  })
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('onboarding intl provider', () => {
  it('resolves intl in the layout and the step, on the request locale', async () => {
    // A thrown render error surfaces via console.error before the router's
    // boundary catches it; silence it so a RED run reads as an assertion.
    vi.spyOn(console, 'error').mockImplementation(() => {})

    const router = buildRouter('de')
    await router.load()
    render(<RouterProvider router={router} />)

    expect(screen.queryByTestId('route-error')?.textContent ?? null).toBeNull()

    // Read back from the catalogue rather than repeated here, so a reworded
    // string moves the test with it. Asserted German first: against an empty
    // catalogue both would be the English written beside the id, and the test
    // would prove nothing about the provider.
    const label = german['onboarding.progress.label']
    const title = german['onboarding.account.title']
    expect(label).not.toBe('Setup progress')
    expect(title).not.toBe('Create your account')

    // The layout's stepper label goes through intl.formatMessage.
    expect(await screen.findByLabelText(label)).toBeInTheDocument()

    // And the step names inside it, which are the one part of this screen
    // whose ids are built at runtime (`onboarding.step.${index + 1}`). Nothing
    // else asserts them: the gate can only see that *some* key answers the
    // pattern, and the console.error mock above would swallow the missing
    // translation react-intl logs for the ones that do not.
    const firstStep = german['onboarding.step.1']
    expect(firstStep).not.toBe('Account')
    expect(await screen.findByText(firstStep)).toBeInTheDocument()

    const step = await screen.findByTestId('step')
    // The locale the request carried reaches the provider, and the catalogue
    // for that locale reaches it with them. This last line used to assert the
    // inline English default on the grounds that no catalogue carried
    // onboarding keys; nine of them do now, and a visitor sent here in German
    // reads German.
    expect(step.dataset.locale).toBe('de')
    expect(step.textContent).toBe(title)
  })

  it('falls back to the default locale when the request carried none', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const router = buildRouter(undefined)
    await router.load()
    render(<RouterProvider router={router} />)

    expect(screen.queryByTestId('route-error')?.textContent ?? null).toBeNull()
    expect((await screen.findByTestId('step')).dataset.locale).toBe('en')
    // Falling back has to be silent: onIntlError only swallows missing
    // translations, so an unresolved locale reaching the provider would log.
    expect(errorSpy).not.toHaveBeenCalled()
  })
})
