// @vitest-environment happy-dom
/**
 * The inbox list caches under one shared key prefix.
 *
 * `inboxKeys.lists()` is the PREFIX `['inbox','list']`, and the filter-facet
 * counts hang below it on purpose (`['inbox','list','facet-counts',filters]`)
 * so that invalidating the lists also refreshes the counts. `setQueriesData`
 * matches by prefix, so every optimistic list patch is handed the counts cache
 * as well — a payload with no `pages`. These tests hold the mutations to the
 * contract confirmed for that collision.
 *
 * Contract:
 *
 *   V1 A status, tag, or assignee change made in the detail sidebar reaches the
 *      server and is persisted, whatever else the inbox has already cached.
 *   V2 An optimistic patch of the inbox post lists changes post rows only.
 *      Every other cache the inbox holds under the same key prefix — the
 *      filter-facet counts above all — comes out of the patch unchanged.
 *   V3 A post that appears in several list caches at once (one per filter
 *      combination) is patched in all of them.
 *   V4 A patch does not create a list cache that held nothing.
 *   V5 When the server rejects the change, every cache the patch touched holds
 *      again what it held before the attempt.
 *   V6 Deleting or restoring a post removes its row from every list cache and
 *      leaves the facet counts to be refetched rather than rewritten.
 *
 * (An earlier V6 — "a cache the patch cannot handle never costs the user their
 * change" — was dropped by decision: the patch is required to handle every
 * cache it is handed, so there is no such case left to survive.)
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider, type InfiniteData } from '@tanstack/react-query'
import type { PostId, PostStatusId, PostTagId, PrincipalId } from '@quackback/ids'
import type { InboxPostListResult, PostListItem, PostTag } from '@/lib/shared/db-types'

const server = vi.hoisted(() => ({
  changePostStatusFn: vi.fn(),
  setPostOwnerFn: vi.fn(),
  updatePostTagsFn: vi.fn(),
  deletePostFn: vi.fn(),
  restorePostFn: vi.fn(),
  createCommentFn: vi.fn(),
}))

vi.mock('@/lib/server/functions/posts', () => ({
  changePostStatusFn: server.changePostStatusFn,
  changePostBoardFn: vi.fn(),
  updatePostFn: vi.fn(),
  setPostOwnerFn: server.setPostOwnerFn,
  setPostEtaFn: vi.fn(),
  updatePostTagsFn: server.updatePostTagsFn,
  createPostFn: vi.fn(),
  toggleCommentsLockFn: vi.fn(),
  deletePostFn: server.deletePostFn,
  restorePostFn: server.restorePostFn,
  proxyVoteFn: vi.fn(),
  removeVoteFn: vi.fn(),
}))

vi.mock('@/lib/server/functions/public-posts', () => ({
  toggleVoteFn: vi.fn(),
}))

vi.mock('@/lib/server/functions/comments', () => ({
  createCommentFn: server.createCommentFn,
  addReactionFn: vi.fn(),
  removeReactionFn: vi.fn(),
}))

import {
  useChangePostStatusId,
  useUpdatePostTags,
  useUpdatePostOwner,
  useDeletePost,
  useRestorePost,
} from '../posts'
import { useAddComment } from '../comments'
import { inboxKeys } from '@/lib/client/hooks/use-inbox-query'

const POST_ID = 'post_01m1s177v6e4erscr5qgckrdwm' as PostId
const OTHER_POST_ID = 'post_01m1s177v6e4erscr5qgckrdwn' as PostId
const NEW_STATUS = 'post_status_planned' as PostStatusId
const OWNER_ID = 'principal_owner1' as PrincipalId
const TAG_ID = 'post_tag_bug' as PostTagId

/** The counts payload the filter pane caches. Deliberately has no `pages`. */
function facetCounts() {
  return {
    boards: [{ id: 'board_1', count: 4 }],
    statuses: [{ id: NEW_STATUS, count: 2 }],
    tags: [],
  }
}

function row(id: PostId, overrides: Partial<PostListItem> = {}): PostListItem {
  return {
    id,
    title: 'A post',
    statusId: null,
    ownerPrincipalId: null,
    commentCount: 0,
    tags: [],
    ...overrides,
  } as unknown as PostListItem
}

function listCache(...items: PostListItem[]): InfiniteData<InboxPostListResult> {
  return {
    pages: [{ items, nextCursor: null, hasMore: false }],
    pageParams: [undefined],
  }
}

/** A client with the caches the /admin/feedback route warms on every load. */
function seededClient(): QueryClient {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })
  client.setQueryData(inboxKeys.list({}), listCache(row(POST_ID), row(OTHER_POST_ID)))
  client.setQueryData(inboxKeys.facetCounts({}), facetCounts())
  client.setQueryData(inboxKeys.detail(POST_ID), {
    id: POST_ID,
    title: 'A post',
    statusId: null,
    ownerPrincipalId: null,
    tags: [],
    comments: [],
  })
  return client
}

function wrapper(client: QueryClient) {
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
}

function listRows(client: QueryClient, filters: Record<string, unknown> = {}): PostListItem[] {
  const cached = client.getQueryData<InfiniteData<InboxPostListResult>>(
    inboxKeys.list(filters as never)
  )
  return cached?.pages.flatMap((page) => page.items) ?? []
}

beforeEach(() => {
  vi.clearAllMocks()
  server.changePostStatusFn.mockResolvedValue({ id: POST_ID })
  server.setPostOwnerFn.mockResolvedValue({ id: POST_ID })
  server.updatePostTagsFn.mockResolvedValue({ id: POST_ID })
  server.deletePostFn.mockResolvedValue({ id: POST_ID })
  server.restorePostFn.mockResolvedValue({ id: POST_ID })
  server.createCommentFn.mockResolvedValue({
    comment: { id: 'post_comment_1', createdAt: new Date('2026-09-05T00:00:00.000Z') },
  })
})

describe('sidebar changes with the facet counts warmed (V1, V2)', () => {
  it('sends the assignee to the server and leaves the counts alone', async () => {
    const client = seededClient()
    const before = client.getQueryData(inboxKeys.facetCounts({}))
    const { result } = renderHook(() => useUpdatePostOwner(), { wrapper: wrapper(client) })

    await result.current.mutateAsync({ postId: POST_ID, ownerId: OWNER_ID })

    expect(server.setPostOwnerFn).toHaveBeenCalledWith({
      data: { id: POST_ID, ownerId: OWNER_ID },
    })
    expect(client.getQueryData(inboxKeys.facetCounts({}))).toBe(before)
    expect(listRows(client).find((p) => p.id === POST_ID)?.ownerPrincipalId).toBe(OWNER_ID)
  })

  it('sends the status to the server and leaves the counts alone', async () => {
    const client = seededClient()
    const before = client.getQueryData(inboxKeys.facetCounts({}))
    const { result } = renderHook(() => useChangePostStatusId(), { wrapper: wrapper(client) })

    await result.current.mutateAsync({ postId: POST_ID, statusId: NEW_STATUS })

    expect(server.changePostStatusFn).toHaveBeenCalledWith({
      data: { id: POST_ID, statusId: NEW_STATUS },
    })
    expect(client.getQueryData(inboxKeys.facetCounts({}))).toBe(before)
    expect(listRows(client).find((p) => p.id === POST_ID)?.statusId).toBe(NEW_STATUS)
  })

  it('sends the tags to the server and leaves the counts alone', async () => {
    const client = seededClient()
    const before = client.getQueryData(inboxKeys.facetCounts({}))
    const allTags = [{ id: TAG_ID, name: 'bug', color: '#f00' }] as PostTag[]
    const { result } = renderHook(() => useUpdatePostTags(), { wrapper: wrapper(client) })

    await result.current.mutateAsync({ postId: POST_ID, tagIds: [TAG_ID], allTags })

    expect(server.updatePostTagsFn).toHaveBeenCalledWith({
      data: { id: POST_ID, tagIds: [TAG_ID] },
    })
    expect(client.getQueryData(inboxKeys.facetCounts({}))).toBe(before)
    expect(listRows(client).find((p) => p.id === POST_ID)?.tags).toEqual([
      { id: TAG_ID, name: 'bug', color: '#f00' },
    ])
  })
})

describe('every list cache the post appears in (V3, V4)', () => {
  it('patches the row under each filter combination', async () => {
    const client = seededClient()
    client.setQueryData(inboxKeys.list({ status: ['open'] }), listCache(row(POST_ID)))
    const { result } = renderHook(() => useChangePostStatusId(), { wrapper: wrapper(client) })

    await result.current.mutateAsync({ postId: POST_ID, statusId: NEW_STATUS })

    expect(listRows(client, { status: ['open'] })[0]?.statusId).toBe(NEW_STATUS)
    expect(listRows(client).find((p) => p.id === POST_ID)?.statusId).toBe(NEW_STATUS)
  })

  it('does not invent a list cache that held nothing', async () => {
    const client = seededClient()
    const emptyKey = inboxKeys.list({ search: 'nothing here' })
    const { result } = renderHook(() => useChangePostStatusId(), { wrapper: wrapper(client) })

    await result.current.mutateAsync({ postId: POST_ID, statusId: NEW_STATUS })

    expect(client.getQueryData(emptyKey)).toBeUndefined()
  })
})

describe('a rejected change (V5)', () => {
  it('puts the list row and the detail back', async () => {
    const client = seededClient()
    server.changePostStatusFn.mockRejectedValue(new Error('nope'))
    const detailBefore = client.getQueryData(inboxKeys.detail(POST_ID))
    const { result } = renderHook(() => useChangePostStatusId(), { wrapper: wrapper(client) })

    await expect(
      result.current.mutateAsync({ postId: POST_ID, statusId: NEW_STATUS })
    ).rejects.toThrow('nope')

    await waitFor(() => {
      expect(listRows(client).find((p) => p.id === POST_ID)?.statusId).toBeNull()
    })
    expect(client.getQueryData(inboxKeys.detail(POST_ID))).toEqual(detailBefore)
  })
})

describe('delete and restore (V6)', () => {
  it('drops the row from the lists and leaves the counts alone', async () => {
    const client = seededClient()
    const before = client.getQueryData(inboxKeys.facetCounts({}))
    const { result } = renderHook(() => useDeletePost(), { wrapper: wrapper(client) })

    await result.current.mutateAsync({ postId: POST_ID, cascadeChoices: [] })

    expect(listRows(client).map((p) => p.id)).toEqual([OTHER_POST_ID])
    expect(client.getQueryData(inboxKeys.facetCounts({}))).toBe(before)
  })

  it('drops the restored row from the deleted list and leaves the counts alone', async () => {
    const client = seededClient()
    const before = client.getQueryData(inboxKeys.facetCounts({}))
    const { result } = renderHook(() => useRestorePost(), { wrapper: wrapper(client) })

    await result.current.mutateAsync(POST_ID)

    expect(listRows(client).map((p) => p.id)).toEqual([OTHER_POST_ID])
    expect(client.getQueryData(inboxKeys.facetCounts({}))).toBe(before)
  })
})

describe('the comment count on a list row (V1, V2)', () => {
  it('counts the new comment without touching the facet counts', async () => {
    const client = seededClient()
    const before = client.getQueryData(inboxKeys.facetCounts({}))
    const { result } = renderHook(() => useAddComment(), { wrapper: wrapper(client) })

    await result.current.mutateAsync({
      postId: POST_ID,
      content: 'Looking into it',
      principalId: 'principal_agent1',
    })

    expect(server.createCommentFn).toHaveBeenCalled()
    expect(client.getQueryData(inboxKeys.facetCounts({}))).toBe(before)
    expect(listRows(client).find((p) => p.id === POST_ID)?.commentCount).toBe(1)
  })
})
