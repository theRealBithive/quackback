// @vitest-environment happy-dom
/**
 * The portal's lazy anonymous sign-in, which every post card reaches through
 * useEnsureAnonSession.
 *
 * Contract (confirmed list for batch K, upstream #644; the full list is in
 * lib/server/auth/__tests__/session-audience.test.ts):
 *
 *   S8 The portal's sign-in sends the marker. The widget's does not.
 *
 * The widget half of S8 is held in
 * components/widget/__tests__/widget-auth-provider-audience.test.tsx.
 *
 * Upstream's version of this suite also pinned that a navigation does not
 * render the card again; that is a performance change this fork has not
 * picked, so the test is not carried here.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRouteWithContext,
  createRoute,
  createRouter,
} from '@tanstack/react-router'

const anonymousSignIn = vi.fn(async (_opts?: unknown) => ({ error: null }))
vi.mock('@/lib/client/auth-client', () => ({
  authClient: { signIn: { anonymous: (opts?: unknown) => anonymousSignIn(opts) } },
}))

const { useEnsureAnonSession } = await import('../use-ensure-anon-session')
const { SESSION_AUDIENCE_HEADER } = await import('@/lib/shared/roles')

afterEach(() => {
  cleanup()
  anonymousSignIn.mockClear()
})

let ensure: () => Promise<boolean> = async () => false

function Card() {
  ensure = useEnsureAnonSession()
  return <p>card</p>
}

function buildRouter(user: { id: string } | null) {
  const rootRoute = createRootRouteWithContext<object>()({
    // A fresh context object on every navigation, like the real root route.
    beforeLoad: () => ({ session: user ? { user: { ...user } } : null }),
    component: () => <Outlet />,
  })
  const listRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    validateSearch: (search: Record<string, unknown>) => search as { page?: string },
    component: Card,
  })
  return createRouter({
    routeTree: rootRoute.addChildren([listRoute]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
    context: {},
  })
}

describe('useEnsureAnonSession', () => {
  it('reports an existing session without signing in', async () => {
    const router = buildRouter({ id: 'user_1' })
    render(<RouterProvider router={router} />)
    await screen.findByText('card')

    await expect(ensure()).resolves.toBe(true)
    expect(anonymousSignIn).not.toHaveBeenCalled()
  })

  it('signs in anonymously when there is no session', async () => {
    const router = buildRouter(null)
    render(<RouterProvider router={router} />)
    await screen.findByText('card')

    await act(async () => {
      await expect(ensure()).resolves.toBe(true)
    })
    expect(anonymousSignIn).toHaveBeenCalledTimes(1)
  })

  // Without the marker the server tags the session for the widget, and every
  // portal write (post, vote, comment) is then refused by requireAuth.
  it('marks its anonymous mint as the portal audience (S8)', async () => {
    const router = buildRouter(null)
    render(<RouterProvider router={router} />)
    await screen.findByText('card')

    await act(async () => {
      await ensure()
    })
    const [opts] = anonymousSignIn.mock.calls[0] as [{ fetchOptions?: RequestInit } | undefined]
    expect(new Headers(opts?.fetchOptions?.headers).get(SESSION_AUDIENCE_HEADER)).toBe('portal')
  })
})
