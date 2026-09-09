// @vitest-environment happy-dom
/**
 * Upstream #520 ("per-tag portal visibility") made the animated feedback
 * header drop the viewer-scoped react-query caches when the poster signs
 * out, so a team member's internal-tag view cannot leak into the next
 * anonymous visitor's read of the same board.
 *
 * Contract for this suite:
 *
 * V1 A signed-in, non-anonymous poster sees "Posting as <name>" and a
 *    "sign out" control, and the wording comes from the catalogue rather than
 *    the English text baked into the source — proven under German, since an
 *    English render looks identical whether or not the catalogue was
 *    consulted.
 * V2 Clicking "sign out" awaits `signOut`, and once it resolves, every
 *    viewer-scoped portal query is gone from the cache while an unrelated
 *    query is untouched.
 * V3 After signing out, the router is told to invalidate, so the surrounding
 *    loaders rebuild against the fresh (now anonymous) session instead of
 *    serving back the team-scoped data they already hold.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderInGerman } from '@/test/render-with-intl'
import type { ComponentProps, ReactNode } from 'react'

// vi.hoisted so these are ready before the vi.mock factories below run.
const { mockSignOut, mockInvalidate, mockRouteContext } = vi.hoisted(() => ({
  mockSignOut: vi.fn(() => Promise.resolve(undefined)),
  mockInvalidate: vi.fn(),
  mockRouteContext: vi.fn(),
}))

vi.mock('@/lib/client/auth-client', () => ({
  signOut: mockSignOut,
}))

vi.mock('@tanstack/react-router', () => ({
  useRouter: () => ({ invalidate: mockInvalidate }),
  useRouteContext: () => mockRouteContext(),
}))

vi.mock('@/lib/client/hooks/use-auth-broadcast', () => ({
  useAuthBroadcast: () => {},
}))

vi.mock('@/components/ui/rich-text-editor', () => ({
  RichTextEditor: () => <textarea data-testid="feedback-editor" />,
}))

vi.mock('sonner', () => ({
  toast: { success: vi.fn() },
}))

vi.mock('@/lib/client/hooks/use-image-upload', () => ({
  usePortalImageUpload: () => ({ upload: vi.fn() }),
}))

vi.mock('@/lib/client/mutations/portal-posts', () => ({
  useCreatePublicPost: () => ({ mutateAsync: vi.fn(), isPending: false }),
}))

vi.mock('@/components/auth/auth-popover-context', () => ({
  useAuthPopover: () => ({ openAuthPopover: vi.fn() }),
}))

vi.mock('@/lib/client/hooks/use-similar-posts', () => ({
  useSimilarPosts: () => ({ posts: [] }),
}))

vi.mock('@/lib/client/hooks/use-ensure-anon-session', () => ({
  useEnsureAnonSession: () => vi.fn(() => Promise.resolve(true)),
}))

// The header nests motion.div/motion.input inside AnimatePresence; neither
// animates in happy-dom, and both would otherwise pass unknown `initial` /
// `animate` / `exit` / `transition` props straight onto the DOM node.
vi.mock('framer-motion', () => {
  function MotionDiv({
    children,
    initial: _initial,
    animate: _animate,
    exit: _exit,
    transition: _transition,
    ...rest
  }: ComponentProps<'div'> & {
    initial?: unknown
    animate?: unknown
    exit?: unknown
    transition?: unknown
  }) {
    return <div {...rest}>{children}</div>
  }

  function MotionInput({
    initial: _initial,
    animate: _animate,
    exit: _exit,
    transition: _transition,
    ...rest
  }: ComponentProps<'input'> & {
    initial?: unknown
    animate?: unknown
    exit?: unknown
    transition?: unknown
  }) {
    return <input {...rest} />
  }

  return {
    motion: { div: MotionDiv, input: MotionInput },
    AnimatePresence: ({ children }: { children: ReactNode }) => <>{children}</>,
  }
})

import { FeedbackHeaderAnimated } from '../feedback-header-animated'
import { VIEWER_SCOPED_PORTAL_QUERY_KEYS } from '@/lib/client/queries/portal'

function renderHeader(queryClient: QueryClient) {
  return renderInGerman(
    <QueryClientProvider client={queryClient}>
      <FeedbackHeaderAnimated
        workspaceName="Acme"
        boards={[]}
        defaultBoardId="board_1"
        boardPermissions={{ board_1: { canSubmit: true, canVote: true } }}
      />
    </QueryClientProvider>
  )
}

/**
 * The sign-out footer only renders once the composer is expanded, which
 * happens on the title input's onChange handler. `boards={[]}` above keeps
 * the board-picker and custom-field sections from mounting at all, so
 * expanding needs nothing beyond typing a short title (short so
 * `SimilarPostsCard`'s `show` stays false).
 */
function expandComposer(container: HTMLElement) {
  const titleInput = container.querySelector('input[type="text"]') as HTMLInputElement
  fireEvent.change(titleInput, { target: { value: 'A' } })
}

describe('FeedbackHeaderAnimated — sign-out cache hygiene', () => {
  beforeEach(() => {
    mockSignOut.mockClear()
    mockInvalidate.mockClear()
    mockRouteContext.mockReturnValue({
      session: {
        user: { name: 'Ada Lovelace', email: 'ada@example.com', principalType: 'user' },
      },
    })
  })

  afterEach(() => cleanup())

  it('shows "Posting as <name>" and a German sign-out control for a signed-in poster (V1)', async () => {
    const { container } = renderHeader(new QueryClient())
    expandComposer(container)

    const signOutButton = await screen.findByRole('button', { name: 'abmelden' })
    const paragraph = signOutButton.closest('p')
    expect(paragraph?.textContent).toContain('Sie posten als')
    expect(paragraph?.textContent).toContain('Ada Lovelace')
  })

  it('signing out drops the viewer-scoped portal caches and refreshes the route (V2, V3)', async () => {
    const queryClient = new QueryClient()
    const [scopedKey] = VIEWER_SCOPED_PORTAL_QUERY_KEYS
    queryClient.setQueryData(scopedKey, ['internal-tag'])
    queryClient.setQueryData(['votedPosts'], ['post_1'])

    const { container } = renderHeader(queryClient)
    expandComposer(container)

    const signOutButton = await screen.findByRole('button', { name: 'abmelden' })
    fireEvent.click(signOutButton)

    expect(mockSignOut).toHaveBeenCalled()
    // (V2) The reset runs after `await signOut()` resolves, in a microtask
    // this test has to wait for rather than assert on synchronously.
    await waitFor(() => expect(queryClient.getQueryData(scopedKey)).toBeUndefined())
    expect(queryClient.getQueryData(['votedPosts'])).toEqual(['post_1'])
    // (V3)
    await waitFor(() => expect(mockInvalidate).toHaveBeenCalled())
  })
})
