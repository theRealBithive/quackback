// @vitest-environment happy-dom
/**
 * What the metadata controls in the feedback sidebar promise.
 *
 * Every control here is one click that changes one field on a post. Two of
 * them — status and tags — used to run their mutation inside a `try/finally`
 * with no `catch`, so a rejection reached nobody: no message, and an unhandled
 * promise rejection in the browser, because the handler is `async` and the
 * click that starts it never awaits the result.
 *
 * Contract:
 *
 *   V1 A metadata change the server rejects tells the person who made it, in
 *      words, that it did not happen — at every control of the sidebar, not
 *      just at some of them.
 *   V2 A rejected change leaves no unhandled rejection behind: the handler
 *      settles either way instead of passing the failure to the browser.
 *   V3 The sidebar never stays stuck in its working state — after a change it
 *      is usable again, whether the change went through or not.
 *   V4 Whatever the failure carries — an Error, a bare string, nothing at all —
 *      the message shown is never empty and names what failed.
 *
 * (A fifth guarantee, "a change that goes through gains no confirmation it did
 * not have before", was dropped by decision. Status now confirms like board,
 * owner and ETA already did; tags stay quiet, because that control fires once
 * per ticked box.)
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import fc from 'fast-check'
import type { BoardId, PostId, PostStatusId, PostTagId, PrincipalId } from '@quackback/ids'
import type { PostTag } from '@/lib/shared/db-types'

const server = vi.hoisted(() => ({
  changePostStatusFn: vi.fn(),
  updatePostTagsFn: vi.fn(),
  changePostBoardFn: vi.fn(),
  setPostOwnerFn: vi.fn(),
  setPostEtaFn: vi.fn(),
}))

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))

vi.mock('@/lib/server/functions/posts', () => ({
  changePostStatusFn: server.changePostStatusFn,
  changePostBoardFn: server.changePostBoardFn,
  updatePostFn: vi.fn(),
  setPostOwnerFn: server.setPostOwnerFn,
  setPostEtaFn: server.setPostEtaFn,
  updatePostTagsFn: server.updatePostTagsFn,
  createPostFn: vi.fn(),
  toggleCommentsLockFn: vi.fn(),
  deletePostFn: vi.fn(),
  restorePostFn: vi.fn(),
  proxyVoteFn: vi.fn(),
  removeVoteFn: vi.fn(),
}))

vi.mock('@/lib/server/functions/public-posts', () => ({ toggleVoteFn: vi.fn() }))

vi.mock('sonner', () => ({ toast }))

import { useMetadataHandlers, type MetadataHandlers } from '../use-metadata-handlers'

const POST_ID = 'post_01m1s177v6e4erscr5qgckrdwm' as PostId
const STATUS_ID = 'post_status_planned' as PostStatusId
const TAG_ID = 'post_tag_bug' as PostTagId
const BOARD_ID = 'board_1' as BoardId
const OWNER_ID = 'principal_owner1' as PrincipalId

/**
 * One control of the sidebar: how it is operated, which server call it makes,
 * and what it says when that call fails without saying anything itself.
 */
interface Control {
  name: string
  serverFn: (typeof server)[keyof typeof server]
  operate: (handlers: MetadataHandlers) => Promise<void>
  fallback: string
}

const CONTROLS: Control[] = [
  {
    name: 'status',
    serverFn: server.changePostStatusFn,
    operate: (handlers) => handlers.handleStatusChange(STATUS_ID),
    fallback: 'Failed to update status',
  },
  {
    name: 'tags',
    serverFn: server.updatePostTagsFn,
    operate: (handlers) => handlers.handleTagsChange([TAG_ID]),
    fallback: 'Failed to update tags',
  },
  {
    name: 'board',
    serverFn: server.changePostBoardFn,
    operate: (handlers) => handlers.handleBoardChange(BOARD_ID),
    fallback: 'Failed to update board',
  },
  {
    name: 'owner',
    serverFn: server.setPostOwnerFn,
    operate: (handlers) => handlers.handleOwnerChange(OWNER_ID),
    fallback: 'Failed to update owner',
  },
  {
    name: 'ETA',
    serverFn: server.setPostEtaFn,
    operate: (handlers) => handlers.handleEtaChange('2026-10-01T00:00:00.000Z'),
    fallback: 'Failed to update ETA',
  },
]

function allTags(): PostTag[] {
  return [{ id: TAG_ID, name: 'bug', color: '#f00' }] as PostTag[]
}

function mounted() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return renderHook(() => useMetadataHandlers({ postId: POST_ID, allTags: allTags() }), {
    wrapper: ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  for (const fn of Object.values(server)) fn.mockResolvedValue({ id: POST_ID })
})

describe('a change the server rejects (V1, V2)', () => {
  for (const control of CONTROLS) {
    it(`tells the user when ${control.name} fails, and settles`, async () => {
      control.serverFn.mockRejectedValue(new Error('the server said no'))
      const { result } = mounted()

      await act(async () => {
        await expect(control.operate(result.current)).resolves.toBeUndefined()
      })

      expect(toast.error).toHaveBeenCalledWith('the server said no')
      expect(toast.success).not.toHaveBeenCalled()
    })

    it(`falls back to a message of its own when ${control.name} fails silently`, async () => {
      control.serverFn.mockRejectedValue(new Error(''))
      const { result } = mounted()

      await act(async () => {
        await control.operate(result.current)
      })

      expect(toast.error).toHaveBeenCalledWith(control.fallback)
    })
  }
})

describe('the working state of the sidebar (V3)', () => {
  for (const control of CONTROLS) {
    it(`is idle again after ${control.name} succeeded`, async () => {
      const { result } = mounted()

      await act(async () => {
        await control.operate(result.current)
      })

      await waitFor(() => expect(result.current.isUpdating).toBe(false))
    })

    it(`is idle again after ${control.name} failed`, async () => {
      control.serverFn.mockRejectedValue(new Error('the server said no'))
      const { result } = mounted()

      await act(async () => {
        await control.operate(result.current)
      })

      await waitFor(() => expect(result.current.isUpdating).toBe(false))
    })
  }

  it('reports itself as working while a change is in flight', async () => {
    let release: (value: unknown) => void = () => {}
    server.changePostStatusFn.mockReturnValue(
      new Promise((resolve) => {
        release = resolve
      })
    )
    const { result } = mounted()

    let inFlight: Promise<void> = Promise.resolve()
    await act(async () => {
      inFlight = result.current.handleStatusChange(STATUS_ID)
    })

    expect(result.current.isUpdating).toBe(true)

    await act(async () => {
      release({ id: POST_ID })
      await inFlight
    })

    expect(result.current.isUpdating).toBe(false)
  })
})

describe('what a change confirms when it goes through (V1)', () => {
  it('confirms a status change', async () => {
    const { result } = mounted()

    await act(async () => {
      await result.current.handleStatusChange(STATUS_ID)
    })

    expect(toast.success).toHaveBeenCalledWith('Status updated')
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('says whether an owner was assigned or unassigned', async () => {
    const { result } = mounted()

    await act(async () => {
      await result.current.handleOwnerChange(OWNER_ID)
      await result.current.handleOwnerChange(null)
    })

    expect(toast.success).toHaveBeenNthCalledWith(1, 'Owner assigned')
    expect(toast.success).toHaveBeenNthCalledWith(2, 'Owner unassigned')
  })

  it('says whether an ETA was set or cleared', async () => {
    const { result } = mounted()

    await act(async () => {
      await result.current.handleEtaChange('2026-10-01T00:00:00.000Z')
      await result.current.handleEtaChange(null)
    })

    expect(toast.success).toHaveBeenNthCalledWith(1, 'ETA updated')
    expect(toast.success).toHaveBeenNthCalledWith(2, 'ETA cleared')
  })

  it('stays quiet when a tag was ticked, because that fires once per box', async () => {
    const { result } = mounted()

    await act(async () => {
      await result.current.handleTagsChange([TAG_ID])
    })

    expect(toast.success).not.toHaveBeenCalled()
    expect(server.updatePostTagsFn).toHaveBeenCalled()
  })
})

describe('whatever the failure carries (V4)', () => {
  it('always shows a message that says something', async () => {
    const thrown = fc.oneof(
      fc.string().map((message) => new Error(message)),
      fc.string(),
      fc.constant(undefined),
      fc.constant(null),
      fc.record({ message: fc.string() }),
      fc.integer()
    )

    await fc.assert(
      fc.asyncProperty(thrown, async (failure) => {
        toast.error.mockClear()
        server.changePostStatusFn.mockRejectedValue(failure)
        const { result, unmount } = mounted()

        await act(async () => {
          await result.current.handleStatusChange(STATUS_ID)
        })

        expect(toast.error).toHaveBeenCalledTimes(1)
        const shown = toast.error.mock.calls[0]?.[0]
        expect(typeof shown).toBe('string')
        expect(shown.trim().length).toBeGreaterThan(0)
        unmount()
      })
    )
  })
})
