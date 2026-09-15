// @vitest-environment happy-dom
/**
 * ## F — Forms
 * - F1 Typing in a post, changelog or help-center article editor updates the form's content as markdown and marks the form dirty, without running validation on each keystroke.
 * - F2 A checkbox that feeds a boolean setting (ticket field required, incident restores the status) stores true for a checked box and false for an unchecked one.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { generateId } from '@quackback/ids'
import type { BoardId, PostId, PostStatusId } from '@quackback/ids'
import type { Board, PostStatusEntity, PostTag } from '@/lib/shared/db-types'

const updatePost = vi.hoisted(() => ({ mutateAsync: vi.fn() }))
const updateTags = vi.hoisted(() => ({ mutateAsync: vi.fn() }))

// The editor stands in for TipTap: a textarea that reports what it holds
// through the same (json, html, markdown) callback the real one uses.
vi.mock('@/components/ui/rich-text-editor', () => ({
  RichTextEditor: ({
    onChange,
  }: {
    onChange?: (json: unknown, html: string, markdown: string) => void
  }) => (
    <textarea
      aria-label="Post body"
      onChange={(event) =>
        onChange?.(
          { type: 'doc', content: [{ type: 'paragraph' }] },
          `<p>${event.target.value}</p>`,
          event.target.value
        )
      }
    />
  ),
}))

vi.mock('@/lib/client/mutations/posts', () => ({
  useUpdatePost: () => ({ mutateAsync: updatePost.mutateAsync, isPending: false }),
  useUpdatePostTags: () => ({ mutateAsync: updateTags.mutateAsync, isPending: false }),
}))

import { EditPostDialog } from '../edit-post-dialog'

function renderDialog() {
  // TypeIDs are parsed by the edit schema, so they have to be real ones.
  const boardId = generateId('board') as BoardId
  const statusId = generateId('post_status') as PostStatusId
  const boards = [{ id: boardId, name: 'Feature requests' }] as unknown as Board[]
  const statuses = [
    { id: statusId, name: 'Open', isDefault: true },
  ] as unknown as PostStatusEntity[]
  const tags: PostTag[] = []
  const post = {
    id: generateId('post') as PostId,
    title: 'Dark mode',
    content: 'Original body',
    statusId,
    board: { id: boardId, name: 'Feature requests', slug: 'feature-requests' },
    tags: [],
  }

  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <EditPostDialog
        post={post}
        boards={boards}
        tags={tags}
        statuses={statuses}
        open
        onOpenChange={vi.fn()}
      />
    </QueryClientProvider>
  )
}

describe('EditPostDialog content editor', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    updatePost.mutateAsync.mockResolvedValue(undefined)
    updateTags.mutateAsync.mockResolvedValue(undefined)
  })
  afterEach(cleanup)

  it('carries what was typed in the editor into the saved post as markdown (F1)', async () => {
    renderDialog()

    await userEvent.type(screen.getByLabelText('Post body'), 'Rewritten **body**')
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() => expect(updatePost.mutateAsync).toHaveBeenCalledTimes(1))
    expect(updatePost.mutateAsync.mock.calls[0]![0]).toMatchObject({
      title: 'Dark mode',
      content: 'Rewritten **body**',
    })
  })

  it('does not validate the post while it is being typed (F1)', async () => {
    renderDialog()

    await userEvent.clear(screen.getByRole('textbox', { name: /feedback about/i }))
    await userEvent.type(screen.getByLabelText('Post body'), 'Draft')

    expect(screen.queryByText('Title is required')).toBeNull()
    expect(updatePost.mutateAsync).not.toHaveBeenCalled()
  })
})
