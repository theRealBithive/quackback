// @vitest-environment happy-dom
/**
 * ## F — Forms
 * - F1 Typing in a post, changelog or help-center article editor updates the form's content as markdown and marks the form dirty, without running validation on each keystroke.
 * - F2 A checkbox that feeds a boolean setting (ticket field required, incident restores the status) stores true for a checked box and false for an unchecked one.
 *
 * ## E — Editor
 * - E5 A post can be created and saved without a description; an editor nobody typed in never makes the server reject the submit. (Contract list: `components/ui/__tests__/form-control.contract.test.tsx`.)
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { generateId } from '@quackback/ids'
import type { Board, PostStatusEntity, PostTag } from '@/lib/shared/db-types'
import type { CurrentUser } from '@/lib/shared/types/inbox'
import { tiptapContentSchema } from '@/lib/shared/schemas/posts'

const createPost = vi.hoisted(() => ({ mutate: vi.fn(), reset: vi.fn() }))

// The dialog reads the workspace's default post template from the root route.
vi.mock('@tanstack/react-router', () => ({
  useRouteContext: () => ({ settings: null }),
}))

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
  useCreatePost: () => ({
    mutate: createPost.mutate,
    reset: createPost.reset,
    isPending: false,
    isError: false,
    error: null,
  }),
}))

vi.mock('@/lib/client/hooks/use-similar-posts', () => ({
  useSimilarPosts: () => ({ posts: [], isLoading: false }),
}))

vi.mock('@/lib/client/hooks/use-image-upload', () => ({
  usePostImageUpload: () => ({ upload: vi.fn() }),
  usePostMediaUpload: () => ({ upload: vi.fn() }),
}))

vi.mock('@/lib/client/mutations', () => ({
  useCreatePortalUser: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdatePortalUser: () => ({ mutateAsync: vi.fn(), isPending: false }),
}))

vi.mock('@/components/public/similar-posts-card', () => ({
  SimilarPostsCard: () => null,
}))

import { CreatePostDialog } from '../create-post-dialog'

function renderDialog() {
  // TypeIDs are parsed by the create schema, so they have to be real ones.
  const boards = [{ id: generateId('board'), name: 'Feature requests' }] as unknown as Board[]
  const statuses = [
    { id: generateId('post_status'), name: 'Open', isDefault: true },
  ] as unknown as PostStatusEntity[]
  const tags: PostTag[] = []
  const currentUser = {
    principalId: generateId('principal'),
    name: 'Ada',
  } as unknown as CurrentUser

  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <CreatePostDialog
        boards={boards}
        tags={tags}
        statuses={statuses}
        currentUser={currentUser}
        open
        onOpenChange={vi.fn()}
      />
    </QueryClientProvider>
  )
}

/**
 * The post body arrives through a `lazy()` boundary (upstream #553), so it is
 * awaited rather than read straight after the render. Before the await this
 * file passed only in order: the second test found the editor because the
 * first had already resolved the chunk, and on its own it found nothing.
 */
describe('CreatePostDialog content editor', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })
  afterEach(cleanup)

  it('carries what was typed in the editor into the created post as markdown (F1)', async () => {
    renderDialog()

    await userEvent.type(screen.getByRole('textbox', { name: /feedback about/i }), 'Dark mode')
    await userEvent.type(await screen.findByLabelText('Post body'), 'Please add **dark mode**')

    await userEvent.click(screen.getByRole('button', { name: 'Create post' }))

    expect(createPost.mutate).toHaveBeenCalledTimes(1)
    expect(createPost.mutate.mock.calls[0]![0]).toMatchObject({
      title: 'Dark mode',
      content: 'Please add **dark mode**',
    })
  })

  it('does not validate the post while it is being typed (F1)', async () => {
    renderDialog()

    // Every keystroke goes through the same setValue; none of them may raise
    // the title rule that a submit would.
    await userEvent.type(await screen.findByLabelText('Post body'), 'Draft')

    expect(screen.queryByText('Title is required')).toBeNull()
    expect(createPost.mutate).not.toHaveBeenCalled()
  })

  it('creates a post with a title and no body (E5)', async () => {
    // A post may be created without a description. An editor nobody typed in
    // holds no document, and the create must send no body rather than null,
    // which the server's `tiptapContentSchema.optional()` rejects.
    renderDialog()
    await screen.findByLabelText('Post body')

    await userEvent.type(screen.getByRole('textbox', { name: /feedback about/i }), 'Dark mode')
    await userEvent.click(screen.getByRole('button', { name: 'Create post' }))

    expect(createPost.mutate).toHaveBeenCalledTimes(1)
    const payload = createPost.mutate.mock.calls[0]![0]
    expect(payload.title).toBe('Dark mode')
    expect(tiptapContentSchema.optional().safeParse(payload.contentJson).success).toBe(true)
  })
})
