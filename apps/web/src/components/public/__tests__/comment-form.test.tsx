// @vitest-environment happy-dom
/**
 * Upstream #520 ("per-tag portal visibility") made the default comment
 * composer drop the viewer-scoped react-query caches when the commenter
 * signs out, so a team member's internal-tag view cannot leak into the next
 * anonymous visitor's read of the same thread.
 *
 * Contract for this suite:
 *
 * V1 A signed-in, non-anonymous commenter sees "Posting as <name>" and a
 *    "sign out" control, and the wording comes from the catalogue rather than
 *    the English text baked into the source — proven under German, since an
 *    English render looks identical whether or not the catalogue was
 *    consulted.
 * V2 Clicking "sign out" calls `signOut` with a success callback, and once
 *    that callback runs, every viewer-scoped portal query is gone from the
 *    cache while an unrelated query is untouched.
 * V3 After signing out, the router is told to invalidate, so the surrounding
 *    loaders rebuild against the fresh (now anonymous) session instead of
 *    serving back the team-scoped data they already hold.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderInGerman } from '@/test/render-with-intl'
import type { PostId } from '@quackback/ids'

interface SignOutOptions {
  fetchOptions: { onSuccess: () => void }
}

// vi.hoisted so these are ready before the vi.mock factories below run.
const { mockSignOut, mockInvalidate, mockRouteContext } = vi.hoisted(() => ({
  mockSignOut: vi.fn((options: SignOutOptions) => {
    options.fetchOptions.onSuccess()
    return Promise.resolve()
  }),
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
  RichTextEditor: () => <textarea data-testid="comment-editor" />,
}))

import { CommentForm } from '../comment-form'
import { VIEWER_SCOPED_PORTAL_QUERY_KEYS } from '@/lib/client/queries/portal'

function renderCommentForm(queryClient: QueryClient) {
  return renderInGerman(
    <QueryClientProvider client={queryClient}>
      <CommentForm postId={'post_1' as PostId} />
    </QueryClientProvider>
  )
}

describe('CommentForm — sign-out cache hygiene', () => {
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

  it('shows "Posting as <name>" and a German sign-out control for a signed-in commenter (V1)', () => {
    renderCommentForm(new QueryClient())

    const signOutButton = screen.getByRole('button', { name: 'abmelden' })
    const paragraph = signOutButton.closest('p')
    expect(paragraph?.textContent).toContain('Sie kommentieren als')
    expect(paragraph?.textContent).toContain('Ada Lovelace')
  })

  it('signing out drops the viewer-scoped portal caches and refreshes the route (V2, V3)', async () => {
    const queryClient = new QueryClient()
    const [scopedKey] = VIEWER_SCOPED_PORTAL_QUERY_KEYS
    queryClient.setQueryData(scopedKey, ['internal-tag'])
    queryClient.setQueryData(['votedPosts'], ['post_1'])

    renderCommentForm(queryClient)

    fireEvent.click(screen.getByRole('button', { name: 'abmelden' }))

    // (V2) signOut is called with a fetchOptions.onSuccess the real client
    // invokes once the sign-out request completes.
    expect(mockSignOut).toHaveBeenCalledWith(
      expect.objectContaining({
        fetchOptions: expect.objectContaining({ onSuccess: expect.any(Function) }),
      })
    )
    await waitFor(() => expect(queryClient.getQueryData(scopedKey)).toBeUndefined())
    expect(queryClient.getQueryData(['votedPosts'])).toEqual(['post_1'])
    // (V3)
    await waitFor(() => expect(mockInvalidate).toHaveBeenCalled())
  })
})
