// @vitest-environment happy-dom
/**
 * The two admin surfaces whose heavy half is fetched only when it is actually
 * wanted: the feedback post modal and the workflow builder.
 *
 * Both are code-split behind `lazy()`, and a code-split boundary is only worth
 * anything if the wait is furnished — an empty region reads as a broken page,
 * which is the failure that sends someone back to a synchronous import.
 *
 * Contract for the batch E pick (upstream #553, `f8062929a`) — the confirmed
 * list; the whole of it is in
 * `lib/client/conversation/__tests__/reconcile-cached-thread.contract.test.ts`:
 *
 *   E13 The heavy parts of the admin — the post modal, the workflow builder,
 *       the rich text editor — are not part of the first load. While one is
 *       still on its way, a skeleton holds its place rather than an empty
 *       area.
 *
 * Each chunk is held behind a gate the test opens, so the waiting state is a
 * state the test can stand in rather than a race it has to win.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

const gates = vi.hoisted(() => {
  function gate() {
    let open!: () => void
    const arrived = new Promise<void>((resolve) => {
      open = resolve
    })
    return { arrived, open }
  }
  return { postModal: gate(), workflowBuilder: gate() }
})

const router = vi.hoisted(() => ({
  navigate: vi.fn(),
  postId: '' as string,
}))

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: unknown) => ({
    options,
    useParams: () => ({ workflowId: 'workflow_1' }),
    useRouteContext: () => routeContext,
    useLoaderData: () => loaderData,
  }),
  useRouteContext: () => routeContext,
  useRouterState: ({ select }: { select: (state: unknown) => unknown }) =>
    select({ location: { pathname: '/admin/feedback', search: { post: router.postId } } }),
  useNavigate: () => router.navigate,
  Outlet: () => null,
  Navigate: () => null,
  Link: ({ children }: { children?: React.ReactNode }) => children,
}))

vi.mock('@/components/admin/feedback/post-modal', async () => {
  await gates.postModal.arrived
  return { PostModal: () => <div>the post modal itself</div> }
})

vi.mock('@/components/admin/automation/workflow-builder/workflow-builder', async () => {
  await gates.workflowBuilder.arrived
  return { WorkflowBuilder: () => <div>the workflow builder itself</div> }
})

// Everything the admin shell hangs around the boundary under test. None of it
// is what this suite is about, and all of it reaches for a router.
vi.mock('@/components/admin/admin-sidebar', () => ({ AdminSidebar: () => <nav /> }))
vi.mock('@/components/admin/update-banner', () => ({ UpdateBanner: () => null }))
vi.mock('@/components/admin/plan-notice-banner', () => ({ PlanNoticeBanner: () => null }))
vi.mock('@/lib/client/hooks/use-admin-presence', () => ({ useAdminPresence: () => {} }))

const routeContext = {
  settings: { featureFlags: { feedback: true, supportInbox: true, supportTickets: true } },
  userRole: 'admin',
}

const loaderData = {
  initialUserData: {
    name: 'Team member',
    email: 'member@example.com',
    avatarUrl: null,
    chatAvailability: 'online',
  },
  latestVersion: null,
  updateBannerDismissedVersion: null,
  planNotice: null,
  currentUser: { name: 'Team member', email: 'member@example.com', principalId: 'principal_1' },
  locale: 'en',
  messages: {},
}

beforeEach(() => {
  router.navigate.mockReset()
})

describe('the feedback post modal (E13)', () => {
  it('holds the modal’s place with a skeleton until the chunk arrives', async () => {
    router.postId = 'post_01JDEFERRED'
    const { Route } = await import('../admin')
    const AdminLayout = (Route as unknown as { options: { component: () => React.ReactElement } })
      .options.component

    render(<AdminLayout />)

    // The wait is a dialog of the same size, not an empty page — and the
    // modal's own content is provably not there yet.
    expect(screen.getByText('Edit post')).toBeInTheDocument()
    expect(screen.queryByText('the post modal itself')).not.toBeInTheDocument()

    // Closing while the chunk is still on its way drops `?post=` rather than
    // leaving a dialog nobody can dismiss.
    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(router.navigate).toHaveBeenCalledWith(
      expect.objectContaining({ to: '/admin/feedback', search: {}, replace: true })
    )

    gates.postModal.open()
    expect(await screen.findByText('the post modal itself')).toBeInTheDocument()
  })
})

describe('the workflow builder (E13)', () => {
  it('holds the builder’s place with a skeleton until the chunk arrives', async () => {
    const { Route } = await import('../admin/automation_.workflows.$workflowId')
    const WorkflowBuilderPage = (
      Route as unknown as { options: { component: () => React.ReactElement } }
    ).options.component

    const { container } = render(<WorkflowBuilderPage />)

    expect(screen.queryByText('the workflow builder itself')).not.toBeInTheDocument()
    // Two skeleton bars stand in for the toolbar and the canvas.
    expect(container.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(0)

    gates.workflowBuilder.open()
    expect(await screen.findByText('the workflow builder itself')).toBeInTheDocument()
  })
})
