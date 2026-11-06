// @vitest-environment happy-dom
/**
 * The comment heading reads the server's total.
 *
 * Contract (confirmed 2026-11-06; full list in
 * `lib/server/domains/posts/__tests__/comment-total-count.db.test.ts`):
 *
 * C1 The heading names how many comments the viewer can read on this post,
 *    replies included — however many of them are loaded on the page so far.
 * C5 Loading more comments never changes the number.
 *
 * Asserted in German: the English catalogue text equals the defaultMessage,
 * so an English assertion could not tell a catalogue lookup from none.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { PostCommentId, PostId } from '@quackback/ids'
import { renderInGerman } from '@/test/render-with-intl'
import type { PublicCommentView } from '@/lib/client/queries/portal-detail'

vi.mock('@/components/public/auth-comments-section', () => ({
  AuthCommentsSection: () => null,
}))

import { CommentsSection } from '../comments-section'

const POST_ID = 'post_01m1s177v6e4erscr5qgckrdwm' as PostId

function comment(id: string, replies: PublicCommentView[] = []): PublicCommentView {
  return {
    id: id as PostCommentId,
    content: 'A comment',
    contentJson: null,
    authorName: 'Ada',
    principalId: null,
    createdAt: '2026-11-01T00:00:00Z',
    parentId: null,
    isTeamMember: false,
    deletedAt: null,
    replies,
    reactions: [],
  } as unknown as PublicCommentView
}

function renderSection(comments: PublicCommentView[], totalCommentCount?: number) {
  const queryClient = new QueryClient()
  return renderInGerman(
    <QueryClientProvider client={queryClient}>
      <CommentsSection
        postId={POST_ID}
        comments={comments}
        adminUser={{ name: 'Admin', email: 'admin@example.com' }}
        totalCommentCount={totalCommentCount}
      />
    </QueryClientProvider>
  )
}

afterEach(() => cleanup())

describe('the comment heading', () => {
  it('names the server total when only part of the thread is loaded (C1)', () => {
    renderSection([comment('post_comment_a', [comment('post_comment_b')])], 42)

    expect(screen.getByRole('heading', { name: '42 Kommentare' })).toBeTruthy()
  })

  it('keeps the number when another page of comments arrives (C5)', () => {
    const firstPage = [comment('post_comment_a')]
    const view = renderSection(firstPage, 42)
    const secondPage = [...firstPage, comment('post_comment_c'), comment('post_comment_d')]

    view.rerender(
      <QueryClientProvider client={new QueryClient()}>
        <CommentsSection
          postId={POST_ID}
          comments={secondPage}
          adminUser={{ name: 'Admin', email: 'admin@example.com' }}
          totalCommentCount={42}
        />
      </QueryClientProvider>
    )

    expect(screen.getByRole('heading', { name: '42 Kommentare' })).toBeTruthy()
  })

  it('counts the loaded comments and their replies when no total was reported (C1)', () => {
    renderSection([comment('post_comment_a', [comment('post_comment_b')])])

    expect(screen.getByRole('heading', { name: '2 Kommentare' })).toBeTruthy()
  })
})
