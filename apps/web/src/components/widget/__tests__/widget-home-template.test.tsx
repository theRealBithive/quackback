// @vitest-environment happy-dom
/**
 * The widget composer with description templates. The contract is listed in
 * full in `lib/shared/__tests__/post-template.test.ts`; this suite holds what
 * the widget itself must do:
 *
 *   V1  A board with its own template prefills the description with that template.
 *   V2  A board without its own template prefills the workspace default template.
 *   V5  Switching boards replaces the description only while the author has not
 *       changed it; once they have typed, a board switch never discards their text.
 *   V6  The template is never enforced: a post is accepted and stored unchanged
 *       whether the template was kept, edited, partly filled or deleted.
 *   V8  For the same board, portal, widget and admin dialog show the same template.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ReactNode } from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { IntlProvider } from 'react-intl'
import type { TiptapContent } from '@/lib/shared/db-types'

const { mockCreatePublicPost } = vi.hoisted(() => ({ mockCreatePublicPost: vi.fn() }))

vi.mock('../widget-auth-provider', () => ({
  useWidgetAuth: () => ({
    ensureSession: vi.fn(async () => true),
    ensureSessionThen: async (cb: () => void | Promise<void>) => cb(),
    isIdentified: true,
    hmacRequired: false,
    user: null,
    emitEvent: vi.fn(),
    metadata: null,
    getSessionVersion: () => 0,
    sessionVersion: 0,
  }),
}))
vi.mock('@/lib/client/widget-auth', () => ({ getWidgetAuthHeaders: () => ({}) }))
vi.mock('@/lib/client/widget-bridge', () => ({ sendToHost: vi.fn() }))
vi.mock('@/components/ui/select', async () => import('@/test/radix-select'))
vi.mock('@/components/ui/rich-text-editor', () => ({
  RichTextEditor: ({ value }: { value?: unknown }) => (
    <div data-testid="editor">{typeof value === 'object' ? JSON.stringify(value) : ''}</div>
  ),
}))
vi.mock('../use-widget-image-upload', () => ({
  useWidgetImageUpload: () => ({ upload: vi.fn() }),
  useWidgetMediaUpload: () => ({ upload: vi.fn() }),
  WidgetSessionError: class WidgetSessionError extends Error {},
}))
vi.mock('../widget-vote-button', () => ({ WidgetVoteButton: () => null }))
vi.mock('@/lib/client/hooks/use-infinite-scroll', () => ({
  useInfiniteScroll: () => ({ current: null }),
}))
vi.mock('@/lib/server/functions/public-posts', () => ({
  listPublicPostsFn: vi.fn(async () => ({ items: [], total: 0, hasMore: false })),
  createPublicPostFn: mockCreatePublicPost,
}))

import { WidgetHomeAnimated } from '../widget-home-animated'

function docSaying(text: string): TiptapContent {
  return { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] }
}

const BUG_TEMPLATE = docSaying('Steps to reproduce:')
const WORKSPACE_TEMPLATE = docSaying('What are you trying to do?')

const BOARDS = [
  { id: 'board_bugs', name: 'Bugs', slug: 'bugs', descriptionTemplate: BUG_TEMPLATE },
  { id: 'board_ideas', name: 'Ideas', slug: 'ideas' },
]

const PERMISSIONS = {
  board_bugs: { canSubmit: true, canVote: true },
  board_ideas: { canSubmit: true, canVote: true },
}

let queryClient: QueryClient
function wrapper({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <IntlProvider locale="en" messages={{}}>
        {children}
      </IntlProvider>
    </QueryClientProvider>
  )
}

function renderComposer(defaultBoard: string) {
  return render(
    <WidgetHomeAnimated
      initialPosts={[]}
      statuses={[]}
      boards={BOARDS}
      workspacePostTemplate={WORKSPACE_TEMPLATE}
      boardPermissions={PERMISSIONS}
      defaultBoard={defaultBoard}
      composeRequest={{ nonce: 1, title: 'Export fails' }}
    />,
    { wrapper }
  )
}

function editorShows(): unknown {
  const shown = screen.getByTestId('editor').textContent ?? ''
  if (shown === '') return null
  return JSON.parse(shown)
}

function boardSelect(container: HTMLElement): HTMLSelectElement {
  const select = container.querySelector('select')
  if (!select) throw new Error('compose board picker is not rendered')
  return select
}

describe('the widget composer and description templates', () => {
  beforeEach(() => {
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    mockCreatePublicPost.mockReset()
    mockCreatePublicPost.mockResolvedValue({
      id: 'post_1',
      title: 'Export fails',
      board: { id: 'board_bugs', name: 'Bugs', slug: 'bugs' },
      statusId: null,
    })
  })

  it('shows the board template in the description (V1, V8)', async () => {
    renderComposer('bugs')
    await waitFor(() => expect(editorShows()).toEqual(BUG_TEMPLATE))
  })

  it('shows the workspace default on a board without a template (V2, V8)', async () => {
    renderComposer('ideas')
    await waitFor(() => expect(editorShows()).toEqual(WORKSPACE_TEMPLATE))
  })

  it('swaps an untouched template when another board is picked (V5)', async () => {
    const { container } = renderComposer('bugs')
    await waitFor(() => expect(editorShows()).toEqual(BUG_TEMPLATE))

    fireEvent.change(boardSelect(container), { target: { value: 'board_ideas' } })

    await waitFor(() => expect(editorShows()).toEqual(WORKSPACE_TEMPLATE))
  })

  it('submits an untouched template as the description, without complaint (V6)', async () => {
    renderComposer('bugs')
    await waitFor(() => expect(editorShows()).toEqual(BUG_TEMPLATE))

    const form = screen.getByLabelText('Feedback title').closest('form')
    if (!form) throw new Error('composer form is not rendered')
    fireEvent.submit(form)

    await waitFor(() => expect(mockCreatePublicPost).toHaveBeenCalledTimes(1))
    expect(mockCreatePublicPost.mock.calls[0][0].data.contentJson).toEqual(BUG_TEMPLATE)
  })
})
