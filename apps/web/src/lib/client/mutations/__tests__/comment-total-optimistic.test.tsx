// @vitest-environment happy-dom
/**
 * The comment heading's total while a comment is being written.
 *
 * Contract (confirmed 2026-11-06; full list in
 * `lib/server/domains/posts/__tests__/comment-total-count.db.test.ts`):
 *
 * C6 Writing a comment or a reply raises the number by one immediately; if the
 *    server rejects it, the number goes back.
 *
 * Both composers are covered: the portal's (`useCreateComment`) and the admin
 * modal's (`useAddComment`). Only the server function at the end is a mock.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { PostCommentId, PostId } from '@quackback/ids'

const server = vi.hoisted(() => ({ createCommentFn: vi.fn() }))

vi.mock('@/lib/server/functions/comments', () => ({
  createCommentFn: server.createCommentFn,
  userEditCommentFn: vi.fn(),
  userDeleteCommentFn: vi.fn(),
  restoreCommentFn: vi.fn(),
  addReactionFn: vi.fn(),
  removeReactionFn: vi.fn(),
  pinCommentFn: vi.fn(),
  unpinCommentFn: vi.fn(),
}))

import { useCreateComment } from '../portal-comments'
import { useAddComment } from '../comments'
import { inboxKeys } from '@/lib/client/hooks/use-inbox-query'

const POST_ID = 'post_01m1s177v6e4erscr5qgckrdwm' as PostId
const ROOT_ID = 'post_comment_01m1s177v6e4erscr5qgckrdwn' as PostCommentId
const PORTAL_KEY = ['portal', 'post', POST_ID]
const ADMIN_KEY = inboxKeys.detail(POST_ID)

function rootComment() {
  return {
    id: ROOT_ID,
    content: 'First',
    contentJson: null,
    authorName: 'Ada',
    principalId: null,
    createdAt: '2026-11-01T00:00:00Z',
    parentId: null,
    isTeamMember: false,
    deletedAt: null,
    replies: [],
    reactions: [],
  }
}

function cachedDetail(totalCount: number) {
  return { id: POST_ID, comments: [rootComment()], commentsTotalCount: totalCount }
}

interface Deferred {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
}

function serverAnswersLater(): Deferred {
  const deferred = {} as Deferred
  server.createCommentFn.mockReturnValue(
    new Promise((resolve, reject) => {
      deferred.resolve = resolve
      deferred.reject = reject
    })
  )
  return deferred
}

function wrapperFor(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }
}

function totalIn(queryClient: QueryClient, key: readonly unknown[]): number | undefined {
  const detail = queryClient.getQueryData<{ commentsTotalCount?: number }>(key)
  return detail?.commentsTotalCount
}

const serverComment = { comment: { id: 'post_comment_new', createdAt: new Date() } }

afterEach(() => {
  cleanup()
  server.createCommentFn.mockReset()
})

describe('the portal composer (C6)', () => {
  function renderComposer(totalCount: number) {
    const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
    queryClient.setQueryData(PORTAL_KEY, cachedDetail(totalCount))
    const { result } = renderHook(
      () =>
        useCreateComment({ postId: POST_ID, author: { name: 'Ada', email: 'ada@example.com' } }),
      { wrapper: wrapperFor(queryClient) }
    )
    return { queryClient, result }
  }

  it('raises the total by one as soon as a comment is sent (C6)', async () => {
    const answer = serverAnswersLater()
    const { queryClient, result } = renderComposer(41)

    act(() => result.current.mutate({ content: 'Second' }))

    await waitFor(() => expect(totalIn(queryClient, PORTAL_KEY)).toBe(42))
    answer.resolve(serverComment)
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(totalIn(queryClient, PORTAL_KEY)).toBe(42)
  })

  it('raises the total by one for a reply too (C6)', async () => {
    serverAnswersLater()
    const { queryClient, result } = renderComposer(41)

    act(() => result.current.mutate({ content: 'A reply', parentId: ROOT_ID }))

    await waitFor(() => expect(totalIn(queryClient, PORTAL_KEY)).toBe(42))
  })

  it('puts the total back when the server rejects the comment (C6)', async () => {
    const answer = serverAnswersLater()
    const { queryClient, result } = renderComposer(41)

    act(() => result.current.mutate({ content: 'Second' }))
    await waitFor(() => expect(totalIn(queryClient, PORTAL_KEY)).toBe(42))
    answer.reject(new Error('the server said no'))

    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(totalIn(queryClient, PORTAL_KEY)).toBe(41)
  })
})

describe('the admin composer (C6)', () => {
  function renderComposer(totalCount: number) {
    const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
    queryClient.setQueryData(ADMIN_KEY, cachedDetail(totalCount))
    const { result } = renderHook(() => useAddComment(), { wrapper: wrapperFor(queryClient) })
    return { queryClient, result }
  }

  it('raises the total by one as soon as a comment is sent (C6)', async () => {
    const answer = serverAnswersLater()
    const { queryClient, result } = renderComposer(9)

    act(() => result.current.mutate({ postId: POST_ID, content: 'Internal note', isPrivate: true }))

    await waitFor(() => expect(totalIn(queryClient, ADMIN_KEY)).toBe(10))
    answer.resolve(serverComment)
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(totalIn(queryClient, ADMIN_KEY)).toBe(10)
  })

  it('puts the total back when the server rejects the comment (C6)', async () => {
    const answer = serverAnswersLater()
    const { queryClient, result } = renderComposer(9)

    act(() => result.current.mutate({ postId: POST_ID, content: 'A reply', parentId: ROOT_ID }))
    await waitFor(() => expect(totalIn(queryClient, ADMIN_KEY)).toBe(10))
    answer.reject(new Error('the server said no'))

    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(totalIn(queryClient, ADMIN_KEY)).toBe(9)
  })
})
