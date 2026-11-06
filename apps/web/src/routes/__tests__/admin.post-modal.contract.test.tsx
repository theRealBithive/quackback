// @vitest-environment happy-dom
/**
 * The admin layout's half of the post-modal contract: whether it mounts the
 * feedback post modal for `?post=` on the page it is showing.
 *
 * Contract (confirmed 2026-11-06), a partial port of upstream #563 — the full
 * list and the path rule's own tests are in
 * `lib/shared/__tests__/admin-post-modal.test.ts`:
 *
 * R1 On the roadmap, a post opens exactly one modal: the roadmap's.
 * R2 On every other admin page, ?post= still opens the feedback post modal.
 *
 * Everything the layout renders around the modal is a stub; the layout's own
 * decision and the lazy modal import are real.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

const hoisted = vi.hoisted(() => ({
  location: { pathname: '/admin/feedback', search: {} as Record<string, unknown> },
  Stub: () => null,
}))

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: Record<string, unknown>) => ({
    options,
    useLoaderData: () => ({
      initialUserData: { name: 'Admin', email: 'admin@example.com' },
      latestVersion: null,
      updateBannerDismissedVersion: null,
      planNotice: null,
      currentUser: { name: 'Admin', email: 'admin@example.com', principalId: 'principal_1' },
      locale: 'en',
      messages: {},
    }),
  }),
  Outlet: () => null,
  useNavigate: () => vi.fn(),
  useRouterState: ({ select }: { select: (state: unknown) => unknown }) =>
    select({ location: hoisted.location }),
  useRouteContext: () => ({ settings: { featureFlags: { feedback: true } } }),
  redirect: vi.fn(),
}))

vi.mock('@/lib/client/hooks/use-admin-presence', () => ({ useAdminPresence: vi.fn() }))
vi.mock('@/lib/server/functions/portal', () => ({ fetchUserAvatar: vi.fn() }))
vi.mock('@/lib/server/functions/version', () => ({
  getLatestVersion: vi.fn(),
  isNewerVersion: vi.fn(),
}))
vi.mock('@/lib/server/functions/plan-notice', () => ({ getPlanNotice: vi.fn() }))
vi.mock('@/lib/server/functions/workspace-utils', () => ({ requireWorkspaceRole: vi.fn() }))
vi.mock('@/components/admin/admin-sidebar', () => ({ AdminSidebar: hoisted.Stub }))
vi.mock('@/components/admin/update-banner', () => ({ UpdateBanner: hoisted.Stub }))
vi.mock('@/components/admin/plan-notice-banner', () => ({ PlanNoticeBanner: hoisted.Stub }))
vi.mock('@/components/admin/feedback/post-modal', () => ({
  PostModal: ({ postId }: { postId: string }) => <div>feedback modal for {postId}</div>,
}))

import { Route } from '../admin'

const POST_ID = 'post_01m1s177v6e4erscr5qgckrdwm'

function renderLayoutAt(pathname: string) {
  hoisted.location = { pathname, search: { post: POST_ID } }
  const AdminLayout = (Route as unknown as { options: { component: () => null } }).options.component
  render(<AdminLayout />)
}

afterEach(() => cleanup())

describe('the admin layout and ?post=', () => {
  it('opens the feedback modal on the feedback inbox (R2)', async () => {
    renderLayoutAt('/admin/feedback')

    expect(await screen.findByText(`feedback modal for ${POST_ID}`)).toBeTruthy()
  })

  it('leaves the roadmap to its own modal (R1)', async () => {
    renderLayoutAt('/admin/roadmap')

    // The lazy modal would resolve within the same wait the R2 case uses.
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(screen.queryByText(/feedback modal for/)).toBeNull()
  })
})
