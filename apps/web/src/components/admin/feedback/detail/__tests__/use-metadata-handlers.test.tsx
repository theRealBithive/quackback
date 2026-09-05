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
 *   V4 Whatever the failure carries — an Error, a bare string, blanks, nothing
 *      at all — the message shown is never empty and names what failed.
 *   V5 The change that is sent is the change that was made: the control puts
 *      the picked value on this post, and nothing else on its way out.
 *   V6 After a change goes through, the post shows it without a reload.
 *
 * (An earlier guarantee, "a change that goes through gains no confirmation it
 * did not have before", was dropped by decision. Status now confirms like
 * board, owner and ETA already did; tags stay quiet, because that control
 * fires once per ticked box. V5 and V6 were added afterwards: the mutation
 * gate showed that nothing here held the payload or the refresh, so a handler
 * could have sent an empty change and every test would still have passed.)
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import fc from 'fast-check'
import type { BoardId, PostId, PostStatusId, PostTagId, PrincipalId } from '@quackback/ids'
import type { PostTag } from '@/lib/shared/db-types'
import { inboxKeys } from '@/lib/client/hooks/use-inbox-query'

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
const ETA = '2026-10-01T00:00:00.000Z'

/**
 * One control of the sidebar: how it is operated, which server call it makes,
 * and what it says when that call fails without saying anything itself.
 */
interface Control {
  name: string
  serverFn: (typeof server)[keyof typeof server]
  operate: (handlers: MetadataHandlers) => Promise<void>
  /** What the server has to be handed when that control is operated. */
  sent: unknown
  /** What it says when the change goes through, or nothing when it stays quiet. */
  confirms: string | null
  fallback: string
}

const CONTROLS: Control[] = [
  {
    name: 'status',
    serverFn: server.changePostStatusFn,
    operate: (handlers) => handlers.handleStatusChange(STATUS_ID),
    sent: { data: { id: POST_ID, statusId: STATUS_ID } },
    confirms: 'Status updated',
    fallback: 'Failed to update status',
  },
  {
    name: 'tags',
    serverFn: server.updatePostTagsFn,
    operate: (handlers) => handlers.handleTagsChange([TAG_ID]),
    sent: { data: { id: POST_ID, tagIds: [TAG_ID] } },
    confirms: null,
    fallback: 'Failed to update tags',
  },
  {
    name: 'board',
    serverFn: server.changePostBoardFn,
    operate: (handlers) => handlers.handleBoardChange(BOARD_ID),
    sent: { data: { id: POST_ID, boardId: BOARD_ID } },
    confirms: 'Board updated',
    fallback: 'Failed to update board',
  },
  {
    name: 'owner',
    serverFn: server.setPostOwnerFn,
    operate: (handlers) => handlers.handleOwnerChange(OWNER_ID),
    sent: { data: { id: POST_ID, ownerId: OWNER_ID } },
    confirms: 'Owner assigned',
    fallback: 'Failed to update owner',
  },
  {
    name: 'ETA',
    serverFn: server.setPostEtaFn,
    operate: (handlers) => handlers.handleEtaChange(ETA),
    sent: { data: { id: POST_ID, eta: ETA } },
    confirms: 'ETA updated',
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
  const refreshed = vi.spyOn(client, 'invalidateQueries')
  const rendered = renderHook(() => useMetadataHandlers({ postId: POST_ID, allTags: allTags() }), {
    wrapper: ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  })
  return { ...rendered, refreshed }
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

  it('is idle before anything was changed', () => {
    const { result } = mounted()

    expect(result.current.isUpdating).toBe(false)
  })

  for (const control of CONTROLS) {
    it(`reports itself as working while ${control.name} is in flight`, async () => {
      let release: (value: unknown) => void = () => {}
      control.serverFn.mockReturnValue(
        new Promise((resolve) => {
          release = resolve
        })
      )
      const { result } = mounted()

      let inFlight: Promise<void> = Promise.resolve()
      await act(async () => {
        inFlight = control.operate(result.current)
      })

      expect(result.current.isUpdating).toBe(true)

      await act(async () => {
        release({ id: POST_ID })
        await inFlight
      })

      expect(result.current.isUpdating).toBe(false)
    })
  }
})

describe('the change that is sent (V5)', () => {
  for (const control of CONTROLS) {
    it(`puts the picked ${control.name} on this post and nothing else`, async () => {
      const { result } = mounted()

      await act(async () => {
        await control.operate(result.current)
      })

      expect(control.serverFn).toHaveBeenCalledWith(control.sent)
    })
  }
})

describe('what a change says when it goes through (V1)', () => {
  for (const control of CONTROLS) {
    const says = control.confirms
    const title = says ? `confirms a ${control.name} change` : `stays quiet about ${control.name}`
    it(title, async () => {
      const { result } = mounted()

      await act(async () => {
        await control.operate(result.current)
      })

      if (says) {
        expect(toast.success).toHaveBeenCalledWith(says)
      } else {
        expect(toast.success).not.toHaveBeenCalled()
      }
      expect(toast.error).not.toHaveBeenCalled()
    })
  }

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
      await result.current.handleEtaChange(ETA)
      await result.current.handleEtaChange(null)
    })

    expect(toast.success).toHaveBeenNthCalledWith(1, 'ETA updated')
    expect(toast.success).toHaveBeenNthCalledWith(2, 'ETA cleared')
  })
})

describe('what the post shows afterwards (V6)', () => {
  it('refreshes this post after its ETA changed, and not the whole cache', async () => {
    const { result, refreshed } = mounted()

    await act(async () => {
      await result.current.handleEtaChange(ETA)
    })

    expect(refreshed).toHaveBeenCalledWith({ queryKey: inboxKeys.detail(POST_ID) })
  })
})

describe('whatever the failure carries (V4)', () => {
  it('always shows a message that says something', async () => {
    const blanks = fc.array(fc.constantFrom(' ', '\t', '\n'), { minLength: 1 })
    const thrown = fc.oneof(
      fc.string().map((message) => new Error(message)),
      blanks.map((chars) => new Error(chars.join(''))),
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
