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
 *
 * Upstream #532 let Enter insert a newline in a comment instead of submitting
 * the form around it. This module holds the second half of that promise — the
 * explicit button:
 *
 * E — Editor (upstream #532)
 *
 * E1 Enter in a comment inserts a line break and never submits the surrounding
 *    form; the submit button still does.
 * E2 A resizable image with a numeric width renders with that width as its
 *    max-width and keeps its ratio; without one only keep-ratio is set.
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

// The editor stands in for TipTap. It keeps the one contract the form reads off
// it -- `onChange(json, html, markdown)`, which is what fills the `content`
// field -- behind a control a test can press, because a submit button on an
// empty form is stopped by validation and would prove nothing about E1.
vi.mock('@/components/ui/rich-text-editor', () => ({
  RichTextEditor: ({
    onChange,
  }: {
    onChange?: (json: unknown, html: string, markdown: string) => void
  }) => (
    <>
      <textarea data-testid="comment-editor" readOnly />
      <button
        type="button"
        data-testid="type-a-comment"
        onClick={() =>
          onChange?.(
            {
              type: 'doc',
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Looks good' }] }],
            },
            '<p>Looks good</p>',
            'Looks good'
          )
        }
      >
        type
      </button>
    </>
  ),
}))

import { CommentForm, type CreateCommentMutation } from '../comment-form'
import { VIEWER_SCOPED_PORTAL_QUERY_KEYS } from '@/lib/client/queries/portal'
import germanMessages from '@/locales/de.json'

const german = germanMessages as Record<string, string>

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

describe('CommentForm — the explicit submit button still submits (E1)', () => {
  beforeEach(() => {
    mockRouteContext.mockReturnValue({
      session: {
        user: { name: 'Ada Lovelace', email: 'ada@example.com', principalType: 'user' },
      },
    })
  })

  afterEach(() => cleanup())

  /** A stand-in for the create-comment mutation the portal passes in. */
  function createCommentStub() {
    const mutate = vi.fn()
    return {
      mutate,
      mutation: { mutate, isPending: false } as unknown as CreateCommentMutation,
    }
  }

  it('the default composer’s button posts the comment the editor holds (E1)', async () => {
    const { mutate, mutation } = createCommentStub()
    renderInGerman(
      <QueryClientProvider client={new QueryClient()}>
        <CommentForm postId={'post_1' as PostId} createComment={mutation} />
      </QueryClientProvider>
    )

    fireEvent.click(screen.getByTestId('type-a-comment'))
    fireEvent.click(screen.getByRole('button', { name: german['portal.commentForm.submit'] }))

    await waitFor(() => expect(mutate).toHaveBeenCalledOnce())
    expect(mutate.mock.calls[0]![0]).toMatchObject({
      content: 'Looks good',
      postId: 'post_1',
      contentJson: {
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Looks good' }] }],
      },
    })
  })

  it('the team composer’s button posts the comment too (E1)', async () => {
    const { mutate, mutation } = createCommentStub()
    renderInGerman(
      <QueryClientProvider client={new QueryClient()}>
        <CommentForm
          postId={'post_1' as PostId}
          createComment={mutation}
          isTeamMember
          statuses={[{ id: 'status_1', name: 'Planned', color: '#22c55e' }]}
          currentStatusId="status_1"
        />
      </QueryClientProvider>
    )

    fireEvent.click(screen.getByTestId('type-a-comment'))
    fireEvent.click(screen.getByRole('button', { name: german['portal.commentForm.submit'] }))

    await waitFor(() => expect(mutate).toHaveBeenCalledOnce())
    expect(mutate.mock.calls[0]![0]).toMatchObject({ content: 'Looks good', statusId: null })
  })
})
