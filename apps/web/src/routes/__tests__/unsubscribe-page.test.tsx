// @vitest-environment happy-dom
/**
 * The /unsubscribe page as a reader sees it, mounted under the real root.
 *
 * Contract (upstream #687), verbatim:
 *
 *   U1 Opening an unsubscribe link never unsubscribes anyone. It shows what would happen and asks for confirmation.
 *   U2 The unsubscribe happens only on an explicit confirmation, or on a one-click request from the mail provider.
 *   U3 A malformed, unknown, used or expired token shows the expired-link page, never a server error.
 *   U4 A one-click request in the RFC 8058 form is answered with success for every token, whether live, used, unknown or malformed. A request without the one-click body is refused. A body larger than 1 KB is refused without reading more than the chunk that crosses 1 KB.
 *   U5 A token is spent only once the opt-out has actually happened. If the opt-out fails, the link keeps working and a retry succeeds exactly once.
 *   U6 Unsubscribing from the changelog also stops the changelog mail that reaches a person through posts they follow, even if they never subscribed to the changelog.
 *   U7 Every notification email that has a tokenised unsubscribe link carries List-Unsubscribe. It offers one-click only when the link is HTTPS. An email without such a link carries neither header; a link to the notification preferences is not an unsubscribe link.
 *   U8 The unsubscribe page is in the language the rest of the site resolved for the request, in all nine languages, and the German addresses the reader formally.
 *   U9 The unsubscribe page's strings are not loaded into the portal or the widget.
 *
 * This module holds U1, U2, U3 and U8 at the surface a person reads. The
 * language comes from the bootstrap (the one place the fork resolves it), and
 * every assertion reads the shipped catalogue rather than the English written
 * beside an id: English would pass whether or not the page consults the
 * catalogue at all.
 *
 * The page mounts its own PortalIntlProvider from the loader's slice, so it is
 * rendered bare rather than under renderWithIntl: a provider supplied by the
 * test would mask a page that forgot to mount one.
 */
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import {
  RouterProvider,
  createMemoryHistory,
  createRoute,
  createRouter,
} from '@tanstack/react-router'
import { QueryClient } from '@tanstack/react-query'
import { SUPPORTED_LOCALES, type SupportedLocale } from '@/lib/shared/i18n'
import germanCatalogue from '@/locales/de.json'
import frenchCatalogue from '@/locales/fr.json'

const hoisted = vi.hoisted(() => ({
  resolvedLocale: 'de' as string,
  preview: vi.fn(),
  process: vi.fn(),
}))

vi.mock('@/lib/server/functions/bootstrap', () => ({
  getBootstrapData: async () => ({
    baseUrl: 'https://example.test',
    session: null,
    // The root redirects to /onboarding unless setup reads as finished.
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
    resolvedLocale: hoisted.resolvedLocale,
    updateBannerDismissedVersion: null,
    billingEnabled: false,
    cloudEnabled: false,
  }),
}))

vi.mock('@/lib/server/functions/subscriptions', () => ({
  previewUnsubscribeTokenFn: hoisted.preview,
  processUnsubscribeTokenFn: hoisted.process,
}))

vi.mock('@/components/shared/ott-handler', () => ({ OttHandler: () => null }))
vi.mock('@/components/shared/visitor-beacon', () => ({ VisitorBeacon: () => null }))
vi.mock('@/components/ui/sonner', () => ({ Toaster: () => null }))
vi.mock('@/components/theme-provider', () => ({
  ThemeProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}))

import { Route as RootRoute } from '@/routes/__root'
import { Route as UnsubscribeRoute } from '@/routes/unsubscribe'

const german = germanCatalogue as Record<string, string>
const french = frenchCatalogue as Record<string, string>

const LIVE_TOKEN = '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b'

/**
 * Mounts /unsubscribe under the real root, rebuilt from the file route's own
 * options (a file route already carries a parent, so it cannot be added to the
 * root directly). The path stays the same so `Route.useLoaderData()` resolves.
 */
async function openPage(search: string) {
  const router = createRouter({
    routeTree: RootRoute.addChildren([
      createRoute({
        getParentRoute: () => RootRoute,
        path: '/unsubscribe',
        validateSearch: UnsubscribeRoute.options.validateSearch,
        loaderDeps: UnsubscribeRoute.options.loaderDeps,
        loader: UnsubscribeRoute.options.loader,
        component: UnsubscribeRoute.options.component,
      }),
    ]),
    context: { queryClient: new QueryClient() },
    history: createMemoryHistory({ initialEntries: [`/unsubscribe${search}`] }),
  })
  await router.load()
  expect(router.state.matches.map((match) => match.routeId)).toContain('/unsubscribe')
  render(<RouterProvider router={router} />)
}

function openLiveLink() {
  return openPage(`?token=${LIVE_TOKEN}`)
}

function confirmButton() {
  return screen.getByRole('button', { name: german['unsubscribe.confirm.button'] })
}

beforeEach(() => {
  hoisted.resolvedLocale = 'de'
  hoisted.preview.mockReset()
  hoisted.process.mockReset()
})

afterEach(cleanup)

describe('opening the link', () => {
  it.each([
    ['unsubscribe_post', 'post'],
    ['unsubscribe_all', 'all'],
    ['unsubscribe_changelog', 'changelog'],
    ['unsubscribe_status', 'status'],
    ['mute_post', 'default'],
  ])('(U1) asks before %s, saying what would happen, and writes nothing', async (action, copy) => {
    hoisted.preview.mockResolvedValue({ status: 'confirm', action })

    await openLiveLink()

    expect(await screen.findByText(german[`unsubscribe.confirm.${copy}.title`])).toBeInTheDocument()
    expect(screen.getByText(german[`unsubscribe.confirm.${copy}.message`])).toBeInTheDocument()
    expect(confirmButton()).toBeEnabled()
    expect(hoisted.preview).toHaveBeenCalledWith({ data: { token: LIVE_TOKEN } })
    expect(hoisted.process).not.toHaveBeenCalled()
  })

  it('(U1) names the post the link would unsubscribe from', async () => {
    hoisted.preview.mockResolvedValue({
      status: 'confirm',
      action: 'unsubscribe_post',
      postTitle: 'Dark mode',
    })

    await openLiveLink()

    const label = await screen.findByText('Dark mode')
    const [prefix] = german['unsubscribe.postLabel'].split('{title}')
    expect(label.parentElement).toHaveTextContent(`${prefix}Dark mode`)
    expect(hoisted.process).not.toHaveBeenCalled()
  })
})

describe('confirming', () => {
  it.each([
    ['unsubscribe_post', 'unsubscribe.success.title', 'unsubscribe.success.post.message'],
    ['mute_post', 'unsubscribe.success.mute.title', 'unsubscribe.success.mute.message'],
    ['unsubscribe_all', 'unsubscribe.success.all.title', 'unsubscribe.success.all.message'],
    ['unsubscribe_changelog', 'unsubscribe.success.title', 'unsubscribe.success.changelog.message'],
    ['unsubscribe_status', 'unsubscribe.success.title', 'unsubscribe.success.status.message'],
    ['a_later_action', 'unsubscribe.success.default.title', 'unsubscribe.success.default.message'],
  ])('(U2) unsubscribes from %s only on the button, once', async (action, titleId, messageId) => {
    hoisted.preview.mockResolvedValue({ status: 'confirm', action })
    hoisted.process.mockResolvedValue({ success: true, action })

    await openLiveLink()
    fireEvent.click(await screen.findByRole('button'))

    expect(await screen.findByText(german[titleId])).toBeInTheDocument()
    expect(screen.getByText(german[messageId])).toBeInTheDocument()
    expect(screen.getByRole('link', { name: german['unsubscribe.goHome'] })).toBeInTheDocument()
    expect(hoisted.process).toHaveBeenCalledTimes(1)
    expect(hoisted.process).toHaveBeenCalledWith({ data: { token: LIVE_TOKEN } })
  })

  it('(U2) leads back to the post when the result names one', async () => {
    hoisted.preview.mockResolvedValue({ status: 'confirm', action: 'unsubscribe_post' })
    hoisted.process.mockResolvedValue({
      success: true,
      action: 'unsubscribe_post',
      postTitle: 'Dark mode',
      boardSlug: 'ideas',
      postId: 'post_1',
    })

    await openLiveLink()
    fireEvent.click(await screen.findByRole('button'))

    const viewPost = await screen.findByRole('link', { name: german['unsubscribe.viewPost'] })
    expect(viewPost).toHaveAttribute('href', '/b/ideas/posts/post_1')
    expect(screen.queryByRole('link', { name: german['unsubscribe.goHome'] })).toBeNull()
    expect(screen.getByText('Dark mode')).toBeInTheDocument()
  })

  it('(U2) a second press while the first is in flight sends nothing more', async () => {
    hoisted.preview.mockResolvedValue({ status: 'confirm', action: 'unsubscribe_all' })
    let finish: (value: unknown) => void = () => undefined
    hoisted.process.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve
      })
    )

    await openLiveLink()
    const button = await screen.findByRole('button')
    fireEvent.click(button)

    const pending = await screen.findByRole('button', {
      name: german['unsubscribe.confirm.pending'],
    })
    expect(pending).toBeDisabled()
    fireEvent.click(pending)
    expect(hoisted.process).toHaveBeenCalledTimes(1)

    finish({ success: true, action: 'unsubscribe_all' })
    expect(await screen.findByText(german['unsubscribe.success.all.title'])).toBeInTheDocument()
  })
})

describe('a link that cannot unsubscribe', () => {
  it('(U3) a link with no token says the token is missing', async () => {
    await openPage('')

    expect(await screen.findByText(german['unsubscribe.error.missing.title'])).toBeInTheDocument()
    expect(screen.getByText(german['unsubscribe.error.missing.message'])).toBeInTheDocument()
    expect(hoisted.preview).not.toHaveBeenCalled()
  })

  it('(U3) a malformed token shows the expired-link page without a lookup', async () => {
    await openPage('?token=12345678-1234-0234-8234-123456789abc')

    expect(await screen.findByText(german['unsubscribe.error.expired.title'])).toBeInTheDocument()
    expect(screen.getByText(german['unsubscribe.error.expired.message'])).toBeInTheDocument()
    expect(hoisted.preview).not.toHaveBeenCalled()
  })

  it('(U3) an unknown, used or expired token shows the expired-link page', async () => {
    hoisted.preview.mockResolvedValue({ status: 'error', error: 'invalid' })

    await openLiveLink()

    expect(await screen.findByText(german['unsubscribe.error.expired.title'])).toBeInTheDocument()
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('(U3) a lookup that failed says so instead of erroring', async () => {
    hoisted.preview.mockResolvedValue({ status: 'error', error: 'failed' })

    await openLiveLink()

    expect(await screen.findByText(german['unsubscribe.error.failed.title'])).toBeInTheDocument()
    expect(screen.getByText(german['unsubscribe.error.failed.message'])).toBeInTheDocument()
  })

  it.each([
    ['used', { success: false, error: 'used' }],
    ['expired', { success: false, error: 'expired' }],
    ['no reason', { success: false }],
  ])(
    '(U3) a token spent between opening and confirming (%s) shows the expired-link page',
    async (_reason, result) => {
      hoisted.preview.mockResolvedValue({ status: 'confirm', action: 'unsubscribe_all' })
      hoisted.process.mockResolvedValue(result)

      await openLiveLink()
      fireEvent.click(await screen.findByRole('button'))

      expect(await screen.findByText(german['unsubscribe.error.expired.title'])).toBeInTheDocument()
    }
  )

  it('(U3) a confirmation whose request throws shows the failure page, not a crash', async () => {
    hoisted.preview.mockResolvedValue({ status: 'confirm', action: 'unsubscribe_all' })
    hoisted.process.mockRejectedValue(new Error('network down'))

    await openLiveLink()
    fireEvent.click(await screen.findByRole('button'))

    expect(await screen.findByText(german['unsubscribe.error.failed.title'])).toBeInTheDocument()
    expect(screen.getByRole('link', { name: german['unsubscribe.goHome'] })).toBeInTheDocument()
  })
})

describe('the language of the page', () => {
  it('(U8) the German and French catalogues differ, so the next test can tell them apart', () => {
    expect(german['unsubscribe.confirm.all.title']).not.toEqual(
      french['unsubscribe.confirm.all.title']
    )
  })

  it('(U8) follows the language the bootstrap resolved, not a fixed one', async () => {
    hoisted.resolvedLocale = 'fr'
    hoisted.preview.mockResolvedValue({ status: 'confirm', action: 'unsubscribe_all' })

    await openLiveLink()

    expect(await screen.findByText(french['unsubscribe.confirm.all.title'])).toBeInTheDocument()
    expect(screen.queryByText(german['unsubscribe.confirm.all.title'])).toBeNull()
  })

  it.each(SUPPORTED_LOCALES.map((locale) => [locale]))(
    '(U8) renders in %s from that language’s own catalogue',
    async (locale: SupportedLocale) => {
      const catalogue = (await import(`@/locales/${locale}.json`)).default as Record<string, string>
      hoisted.resolvedLocale = locale
      hoisted.preview.mockResolvedValue({ status: 'confirm', action: 'unsubscribe_changelog' })

      await openLiveLink()

      expect(
        await screen.findByText(catalogue['unsubscribe.confirm.changelog.title'])
      ).toBeInTheDocument()
      expect(
        screen.getByText(catalogue['unsubscribe.confirm.changelog.message'])
      ).toBeInTheDocument()
      expect(
        screen.getByRole('button', { name: catalogue['unsubscribe.confirm.button'] })
      ).toBeInTheDocument()
    }
  )

  it('(U8) the German page addresses the reader formally', async () => {
    hoisted.preview.mockResolvedValue({ status: 'confirm', action: 'unsubscribe_all' })

    await openLiveLink()

    const message = await screen.findByText(german['unsubscribe.confirm.all.message'])
    expect(message.textContent).toMatch(/\bSie\b/)
    expect(message.textContent).toMatch(/\bIhren\b/)
  })
})
