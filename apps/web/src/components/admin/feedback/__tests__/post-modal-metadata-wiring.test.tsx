// @vitest-environment happy-dom
/**
 * That the sidebar of the feedback modal is wired to the handlers that report.
 *
 * The guarantees themselves are held in
 * `detail/__tests__/use-metadata-handlers.test.tsx`, against the hook. They
 * only reach a user if the modal actually hands those handlers to the sidebar,
 * and that one line is the kind nothing notices when it goes wrong: the
 * controls keep working, they just stop saying anything when the server says
 * no — which is exactly the bug this branch is about.
 *
 * Contract:
 *
 *   V1 A metadata change the server rejects tells the person who made it, in
 *      words, that it did not happen — at every control of the sidebar, not
 *      just at some of them.
 *   V2 A rejected change leaves no unhandled rejection behind: the handler
 *      settles either way instead of passing the failure to the browser.
 *
 * The modal is 641 lines of Suspense, editor and router state, so everything
 * around the sidebar is stubbed. What is deliberately NOT stubbed is the path
 * under test: the real `useMetadataHandlers`, the real mutations, and the real
 * `sonner` call — only the server function at the end of it is a mock.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { PostStatusId, PostTagId } from '@quackback/ids'

const server = vi.hoisted(() => ({
  changePostStatusFn: vi.fn(),
  updatePostTagsFn: vi.fn(),
}))
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
const queries = vi.hoisted(() => ({ useQuery: vi.fn(), useSuspenseQuery: vi.fn() }))

vi.mock('sonner', () => ({ toast }))

vi.mock('@tanstack/react-query', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-query')>()),
  useQuery: queries.useQuery,
  useSuspenseQuery: queries.useSuspenseQuery,
}))

vi.mock('@/lib/server/functions/posts', () => ({
  changePostStatusFn: server.changePostStatusFn,
  changePostBoardFn: vi.fn(),
  updatePostFn: vi.fn(),
  setPostOwnerFn: vi.fn(),
  setPostEtaFn: vi.fn(),
  updatePostTagsFn: server.updatePostTagsFn,
  createPostFn: vi.fn(),
  toggleCommentsLockFn: vi.fn(),
  deletePostFn: vi.fn(),
  restorePostFn: vi.fn(),
  proxyVoteFn: vi.fn(),
  removeVoteFn: vi.fn(),
}))
vi.mock('@/lib/server/functions/public-posts', () => ({ toggleVoteFn: vi.fn() }))

// The sidebar stands in for every metadata control: two buttons that call the
// handlers the modal passed in, which is the wiring under test.
vi.mock('@/components/public/post-detail/metadata-sidebar', () => ({
  MetadataSidebar: (props: {
    onStatusChange?: (id: PostStatusId) => Promise<void>
    onTagsChange?: (ids: PostTagId[]) => Promise<void>
  }) => (
    <div>
      <button onClick={() => props.onStatusChange?.('post_status_planned' as PostStatusId)}>
        change status
      </button>
      <button onClick={() => props.onTagsChange?.(['post_tag_bug' as PostTagId])}>
        change tags
      </button>
    </div>
  ),
  MetadataSidebarSkeleton: () => <div />,
  ManagePostActions: () => <div />,
}))

vi.mock('@/components/public/post-detail/comments-section', () => ({
  CommentsSection: () => <div />,
  CommentsSectionSkeleton: () => <div />,
}))
vi.mock('@/components/admin/feedback/merge-section', () => ({
  MergeActions: () => <div />,
  MergeInfoBanner: () => <div />,
  MergeOthersDialog: () => <div />,
}))
vi.mock('@/components/admin/feedback/ai-summary-card', () => ({ AiSummaryCard: () => <div /> }))
vi.mock('@/components/admin/feedback/similar-posts-card', () => ({
  SimilarPostsCard: () => <div />,
}))
vi.mock('@/components/admin/feedback/detail/post-activity-timeline', () => ({
  PostActivityTimeline: () => <div />,
}))
vi.mock('@/components/admin/feedback/customer-context-panel', () => ({
  CustomerContextPanel: () => <div />,
}))
vi.mock('@/components/public/post-detail/delete-post-dialog', () => ({
  DeletePostDialog: () => <div />,
}))
vi.mock('@/components/ui/rich-text-editor', () => ({ RichTextEditor: () => <div /> }))
vi.mock('@/components/ui/scroll-area', () => ({
  ScrollArea: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))
vi.mock('@/components/shared/url-modal-shell', () => ({
  UrlModalShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))
vi.mock('@/components/shared/modal-header', () => ({
  ModalHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))
vi.mock('@/components/shared/modal-footer', () => ({ ModalFooter: () => <div /> }))
vi.mock('@/components/shared/inline-moderation-actions', () => ({
  InlineModerationActions: () => <div />,
}))

vi.mock('@tanstack/react-router', () => ({
  useRouterState: () => ({ pathname: '/admin/feedback', search: {} }),
}))
vi.mock('@/lib/client/hooks/use-url-modal', () => ({
  useUrlModal: () => ({
    open: true,
    validatedId: 'post_01m1s177v6e4erscr5qgckrdwm',
    close: vi.fn(),
    navigateTo: vi.fn(),
  }),
}))
vi.mock('@/lib/client/hooks/use-permission', () => ({ usePermission: () => true }))
vi.mock('@/lib/client/hooks/use-image-upload', () => ({
  usePostImageUpload: () => ({ upload: vi.fn() }),
  usePortalImageUpload: () => ({ upload: vi.fn() }),
}))
vi.mock('@/lib/client/mutations/load-more-comments', () => ({
  useLoadMoreAdminComments: () => ({ loadMore: vi.fn(), isLoading: false, hasMore: false }),
}))
vi.mock('@/lib/client/hooks/use-post-external-links-query', () => ({
  usePostExternalLinks: () => ({ data: [] }),
}))
vi.mock('@/lib/client/hooks/use-post-detail-keyboard', () => ({
  usePostDetailKeyboard: () => {},
}))
vi.mock('@/components/admin/feedback/detail/use-navigation-context', () => ({
  useNavigationContext: () => ({
    position: 0,
    total: 0,
    prevId: null,
    nextId: null,
    backUrl: '/admin/feedback',
  }),
}))

import { PostModal } from '../post-modal'

function shownModal() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <PostModal
        postId="post_01m1s177v6e4erscr5qgckrdwm"
        currentUser={{ id: 'user_1', name: 'A user' } as never}
      />
    </QueryClientProvider>
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  queries.useQuery.mockReturnValue({ data: [] })
  queries.useSuspenseQuery.mockReturnValue({
    data: {
      id: 'post_01m1s177v6e4erscr5qgckrdwm',
      title: 'A post',
      content: '',
      contentJson: null,
      statusId: null,
      ownerPrincipalId: null,
      board: { id: 'board_1', slug: 'general' },
      tags: [],
      comments: [],
      moderationState: 'approved',
    },
  })
})

describe('the sidebar of the feedback modal (V1, V2)', () => {
  it('reports a rejected status change to the user', async () => {
    server.changePostStatusFn.mockRejectedValue(new Error('the server said no'))
    shownModal()

    await userEvent.click(screen.getByText('change status'))

    expect(toast.error).toHaveBeenCalledWith('the server said no')
  })

  it('reports a rejected tag change to the user', async () => {
    server.updatePostTagsFn.mockRejectedValue(new Error('the server said no'))
    shownModal()

    await userEvent.click(screen.getByText('change tags'))

    expect(toast.error).toHaveBeenCalledWith('the server said no')
  })
})
