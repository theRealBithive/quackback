// @vitest-environment happy-dom
/**
 * Contract for batch H, pasted verbatim as confirmed. Every test names the
 * guarantee it pins, e.g. "(H6)".
 *
 * # Batch H contract (confirmed 2026-10-08) — upstream #566 video uploads, #568 headings
 *
 * ## V — What can be uploaded
 *
 * H1 A feedback post, a comment, the widget and the admin editors accept an MP4, WebM, MOV or M4V video in addition to images, up to 100 MB per video. Images stay limited to 5 MB.
 * H2 What a file is decides whether it is stored, not what the browser says it is: a file is stored only when its bytes are the container it claims (an MP4 family file for MP4/MOV/M4V, WebM for WebM). An AVIF or HEIC image presented as a video is refused, and so is a video presented as an image.
 * H3 A file with no type or a generic one is judged by its extension, and then still by its bytes (H2).
 * H4 A refused upload stores nothing.
 *
 * ## A — Who can upload
 *
 * H5 Nobody without a session can upload.
 * H6 An anonymous portal visitor may upload only where the workspace lets anonymous visitors post; otherwise the upload is refused, as before.
 * H7 Uploads are limited per session (20 per minute). Because an anonymous session costs nothing to mint, anonymous uploads are additionally limited per client address, so one client cannot upload 2 GB a minute by rotating sessions.
 *
 * ## P — How a stored video is shown
 *
 * H8 A video in a post plays only from the workspace's own storage. A video pointing anywhere else is removed when the post is saved, so a post can never make the reader's browser contact a third party.
 * H9 A video source that is not http(s) (data:, javascript:, …) is removed, never rendered.
 * H10 Everything a person wrote into a video's attributes (title, type) reaches the page escaped; no attribute can break out of the video element.
 * H11 A stored video's type on the page is one of the accepted video types, whatever the stored attribute said.
 * H12 Videos saved before an editor offered videos stay visible and editable in every editor, including ones that do not offer video upload.
 *
 * ## S — Serving through the storage proxy
 *
 * H13 A video served through the storage proxy can be played from any point: a single byte range is answered with exactly those bytes (206), and the whole file with 200.
 * H14 A request for several ranges at once, or a malformed range, is answered with 416, never with the whole file.
 * H15 A range outside the file is answered with 416.
 * H16 A partial answer is never stored in, or served from, the proxy cache as if it were the whole file.
 * H17 Every proxied answer carries nosniff and the stored content type, so a browser never re-interprets an upload.
 *
 * ## L — Language and composer
 *
 * H18 Every control and message the video feature adds (menu item, toolbar button, remove button, failure message) reads in the page's language, in all nine languages, the German formal.
 * H19 The public feedback composer offers headings (#568; the fork already did, kept).
 */
/*
 * The portal post page's half of H1, H5 and H6: which uploads it wires into
 * the post editor and the comment editor, and that every upload first mints
 * the anonymous session the server then judges. Everything the page renders
 * is a stub that records its props; only the page's own wiring is real.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup } from '@testing-library/react'
import { renderInGerman } from '@/test/render-with-intl'

const hoisted = vi.hoisted(() => ({
  routeContext: vi.fn(),
  postContentProps: [] as Array<Record<string, unknown>>,
  commentsProps: [] as Array<Record<string, unknown>>,
  ensureAnonSession: vi.fn(),
  uploadMedia: vi.fn(),
  canEdit: false,
  Stub: () => null,
  mutation: () => ({ mutate: () => {}, isPending: false }),
}))

const POST_ID = 'post_01kzf9848he8h86ct48hanask6'

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: Record<string, unknown>) => ({
    options,
    useLoaderData: () => ({ postId: POST_ID, slug: 'ideas' }),
  }),
  notFound: () => new Error('not found'),
  useRouteContext: () => hoisted.routeContext(),
}))

vi.mock('@tanstack/react-query', () => ({
  useSuspenseQuery: (query: { data: unknown }) => ({ data: query.data }),
}))

vi.mock('@/lib/client/queries/portal-detail', () => ({
  portalDetailQueries: {
    postDetail: () => ({
      data: {
        id: POST_ID,
        title: 'Dark mode',
        statusId: null,
        board: { id: 'board_1', name: 'Ideas', slug: 'ideas' },
        comments: [],
        voteCount: 0,
        createdAt: '2026-10-01T00:00:00Z',
        tags: [],
        commentsTotalRootCount: 0,
      },
    }),
  },
}))
vi.mock('@/lib/client/queries/portal', () => ({
  portalQueries: { statuses: () => ({ data: [] }) },
}))

vi.mock('@/components/ui/back-link', () => ({ BackLink: hoisted.Stub }))
vi.mock('@/components/public/unsubscribe-banner', () => ({ UnsubscribeBanner: hoisted.Stub }))
vi.mock('@/components/public/post-detail/vote-sidebar', () => ({
  VoteSidebar: hoisted.Stub,
  VoteSidebarSkeleton: hoisted.Stub,
}))
vi.mock('@/components/public/post-detail/post-content-section', () => ({
  PostContentSection: (props: Record<string, unknown>) => {
    hoisted.postContentProps.push(props)
    return null
  },
}))
vi.mock('@/components/public/post-detail/metadata-sidebar', () => ({
  MetadataSidebar: hoisted.Stub,
  MetadataSidebarSkeleton: hoisted.Stub,
}))
vi.mock('@/components/public/post-detail/comments-section', () => ({
  CommentsSection: (props: Record<string, unknown>) => {
    hoisted.commentsProps.push(props)
    return null
  },
  CommentsSectionSkeleton: hoisted.Stub,
}))
vi.mock('@/components/public/post-detail/delete-post-dialog', () => ({
  DeletePostDialog: hoisted.Stub,
}))
vi.mock('@/components/admin/feedback/merge-section', () => ({
  MergeIntoDialog: hoisted.Stub,
  MergeOthersDialog: hoisted.Stub,
}))
vi.mock('@/components/public/post-detail/merge-banner', () => ({ PortalMergeBanner: hoisted.Stub }))
vi.mock('@/components/public/post-detail/similar-posts-section', () => ({
  similarPostsQuery: vi.fn(),
}))
vi.mock('@/lib/client/hooks/use-portal-posts-query', () => ({
  usePostPermissions: () => ({ data: { canEdit: hoisted.canEdit, canDelete: false } }),
  postPermissionsKeys: { detail: () => [] },
}))
vi.mock('@/lib/server/functions/public-posts', () => ({ getPostPermissionsFn: vi.fn() }))
vi.mock('@/lib/client/mutations', () => ({
  usePostActions: () => ({ editPost: vi.fn(), deletePost: vi.fn() }),
}))
vi.mock('@/lib/client/mutations/portal-team-post-actions', () => ({
  usePortalTeamPostActions: () => ({}),
}))
vi.mock('@/lib/client/hooks/use-image-upload', () => ({
  usePortalMediaUpload: () => ({ upload: hoisted.uploadMedia }),
}))
vi.mock('@/lib/client/hooks/use-ensure-anon-session', () => ({
  useEnsureAnonSession: () => hoisted.ensureAnonSession,
}))
vi.mock('@/lib/client/mutations/portal-comments', () => ({
  useDeleteComment: hoisted.mutation,
  usePinComment: hoisted.mutation,
  useUnpinComment: hoisted.mutation,
  useRestoreComment: hoisted.mutation,
}))
vi.mock('@/lib/client/mutations/load-more-comments', () => ({
  useLoadMorePortalComments: () => ({ loadMore: vi.fn(), isLoading: false, hasMore: false }),
}))
vi.mock('@/lib/client/mutations/moderation', () => ({
  useApprovePost: hoisted.mutation,
  useRejectPost: hoisted.mutation,
}))
vi.mock('@/lib/client/hooks/use-portal-permissions', () => ({
  usePortalPermissions: () => ({ can: () => false }),
}))
vi.mock('sonner', () => ({ toast: { error: vi.fn() } }))

import { Route } from '../_portal.b.$slug.posts.$postId'

type UploadProp = ((file: File) => Promise<string>) | undefined

function renderPostPage() {
  const PostDetailPage = (Route as unknown as { options: { component: () => null } }).options
    .component
  renderInGerman(<PostDetailPage />)
  return {
    post: hoisted.postContentProps[hoisted.postContentProps.length - 1],
    comments: hoisted.commentsProps[hoisted.commentsProps.length - 1],
  }
}

const recording = new File([new Uint8Array([0, 0, 0, 0x18])], 'clip.mov', {
  type: 'video/quicktime',
})

beforeEach(() => {
  hoisted.postContentProps.length = 0
  hoisted.commentsProps.length = 0
  hoisted.canEdit = false
  hoisted.ensureAnonSession.mockReset()
  hoisted.uploadMedia.mockReset()
  hoisted.uploadMedia.mockResolvedValue('/api/storage/portal-media/clip.mov')
  hoisted.routeContext.mockReturnValue({ session: null })
})

afterEach(() => cleanup())

describe('the portal post page wires uploads (H1, H5, H6)', () => {
  it('a comment upload mints the anonymous session before it uploads (H1, H6)', async () => {
    hoisted.ensureAnonSession.mockResolvedValue(true)
    const { comments } = renderPostPage()
    const upload = comments.onImageUpload as UploadProp
    await expect(upload?.(recording)).resolves.toBe('/api/storage/portal-media/clip.mov')
    expect(hoisted.ensureAnonSession).toHaveBeenCalledBefore(hoisted.uploadMedia)
  })

  it('a comment upload without a session it could get uploads nothing (H5, H6)', async () => {
    hoisted.ensureAnonSession.mockResolvedValue(false)
    const { comments } = renderPostPage()
    const upload = comments.onImageUpload as UploadProp
    await expect(upload?.(recording)).rejects.toThrow()
    expect(hoisted.uploadMedia).not.toHaveBeenCalled()
  })

  it('the post editor uploads only for a signed-in author who may edit (H1, H5)', () => {
    expect(renderPostPage().post.onImageUpload).toBeUndefined()
    cleanup()

    hoisted.canEdit = true
    expect(renderPostPage().post.onImageUpload).toBeUndefined()
    cleanup()

    hoisted.routeContext.mockReturnValue({ session: { user: { id: 'user_1' } } })
    expect(typeof renderPostPage().post.onImageUpload).toBe('function')
  })
})
