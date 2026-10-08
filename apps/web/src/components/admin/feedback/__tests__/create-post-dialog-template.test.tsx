// @vitest-environment happy-dom
/**
 * The admin "create post" dialog with description templates. The contract is
 * listed in full in `lib/shared/__tests__/post-template.test.ts`; this suite
 * holds what the dialog itself must do:
 *
 *   V1  A board with its own template prefills the description with that template.
 *   V2  A board without its own template prefills the workspace default template.
 *   V6  The template is never enforced: a post is accepted and stored unchanged
 *       whether the template was kept, edited, partly filled or deleted.
 *   V7  After a successful submit or cancel, the next empty form starts again
 *       with the template of the selected board.
 *   V8  For the same board, portal, widget and admin dialog show the same template.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { generateId } from '@quackback/ids'
import type { Board, PostStatusEntity, TiptapContent } from '@/lib/shared/db-types'
import type { CurrentUser } from '@/lib/shared/types/inbox'

const createPost = vi.hoisted(() => ({ mutate: vi.fn(), reset: vi.fn() }))
const { WORKSPACE_TEMPLATE } = vi.hoisted(() => ({
  WORKSPACE_TEMPLATE: {
    type: 'doc',
    content: [
      { type: 'paragraph', content: [{ type: 'text', text: 'What are you trying to do?' }] },
    ],
  },
}))

vi.mock('@tanstack/react-router', () => ({
  useRouteContext: () => ({
    settings: { publicPortalConfig: { postTemplate: WORKSPACE_TEMPLATE } },
  }),
}))

// The editor stands in for TipTap and shows the document it was handed.
vi.mock('@/components/ui/rich-text-editor', () => ({
  RichTextEditor: ({ value }: { value?: unknown }) => (
    <pre data-testid="post-body">{typeof value === 'object' ? JSON.stringify(value) : ''}</pre>
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

function docSaying(text: string): TiptapContent {
  return { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] }
}

const BUG_TEMPLATE = docSaying('Steps to reproduce:')

function renderDialog(boardTemplate: TiptapContent | undefined, open = true) {
  // TypeIDs are parsed by the create schema, so they have to be real ones.
  const boards = [
    {
      id: generateId('board'),
      name: 'Bugs',
      settings: { descriptionTemplate: boardTemplate },
    },
  ] as unknown as Board[]
  const statuses = [
    { id: generateId('post_status'), name: 'Open', isDefault: true },
  ] as unknown as PostStatusEntity[]
  const currentUser = {
    principalId: generateId('principal'),
    name: 'Ada',
  } as unknown as CurrentUser
  const onOpenChange = vi.fn()

  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  function dialogAt(isOpen: boolean) {
    return (
      <QueryClientProvider client={queryClient}>
        <CreatePostDialog
          boards={boards}
          tags={[]}
          statuses={statuses}
          currentUser={currentUser}
          open={isOpen}
          onOpenChange={onOpenChange}
        />
      </QueryClientProvider>
    )
  }
  const rendered = render(dialogAt(open))
  return {
    ...rendered,
    onOpenChange,
    reopen: () => rendered.rerender(dialogAt(true)),
    close: () => rendered.rerender(dialogAt(false)),
  }
}

async function bodyShows(): Promise<unknown> {
  const shown = (await screen.findByTestId('post-body')).textContent ?? ''
  if (shown === '') return null
  return JSON.parse(shown)
}

describe('CreatePostDialog and description templates', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })
  afterEach(cleanup)

  it('shows the board template in the description (V1, V8)', async () => {
    renderDialog(BUG_TEMPLATE)
    expect(await bodyShows()).toEqual(BUG_TEMPLATE)
  })

  it('shows the workspace default on a board without a template (V2, V8)', async () => {
    renderDialog(undefined)
    expect(await bodyShows()).toEqual(WORKSPACE_TEMPLATE)
  })

  it('creates the post with an untouched template as its description (V6)', async () => {
    renderDialog(BUG_TEMPLATE)
    await bodyShows()

    await userEvent.type(screen.getByRole('textbox', { name: /feedback about/i }), 'Export fails')
    await userEvent.click(screen.getByRole('button', { name: 'Create post' }))

    expect(createPost.mutate).toHaveBeenCalledTimes(1)
    expect(createPost.mutate.mock.calls[0]![0].contentJson).toEqual(BUG_TEMPLATE)
  })

  it('opens with the template again after the dialog was dismissed (V7)', async () => {
    const dialog = renderDialog(BUG_TEMPLATE)
    await bodyShows()

    await userEvent.keyboard('{Escape}')
    expect(dialog.onOpenChange).toHaveBeenCalledWith(false)
    dialog.close()
    dialog.reopen()

    await waitFor(async () => expect(await bodyShows()).toEqual(BUG_TEMPLATE))
  })

  it('opens with the template again after a post was created (V7)', async () => {
    const dialog = renderDialog(BUG_TEMPLATE)
    await bodyShows()
    await userEvent.type(screen.getByRole('textbox', { name: /feedback about/i }), 'Export fails')
    await userEvent.click(screen.getByRole('button', { name: 'Create post' }))
    const onSuccess = createPost.mutate.mock.calls[0]![1].onSuccess as () => void

    onSuccess()
    dialog.close()
    dialog.reopen()

    await waitFor(async () => expect(await bodyShows()).toEqual(BUG_TEMPLATE))
  })
})
