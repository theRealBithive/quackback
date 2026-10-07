// @vitest-environment happy-dom
/**
 * The portal's "submit feedback" form with description templates. The
 * contract is listed in full in `lib/shared/__tests__/post-template.test.ts`;
 * this suite holds what the portal form itself must do:
 *
 *   V1  A board with its own template prefills the description with that template.
 *   V2  A board without its own template prefills the workspace default template.
 *   V6  The template is never enforced: a post is accepted and stored unchanged
 *       whether the template was kept, edited, partly filled or deleted.
 *   V7  After a successful submit or cancel, the next empty form starts again
 *       with the template of the selected board.
 *   V8  For the same board, portal, widget and admin dialog show the same template.
 *
 * The editor is replaced by a stub that shows the document it was handed, so
 * the assertions read what the author would see in the editor.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderInGerman } from '@/test/render-with-intl'
import type { ComponentProps, ReactNode } from 'react'
import type { TiptapContent } from '@/lib/shared/db-types'

const { mockRouteContext, mockCreatePost } = vi.hoisted(() => ({
  mockRouteContext: vi.fn(),
  mockCreatePost: vi.fn(),
}))

vi.mock('@tanstack/react-router', () => ({
  useRouter: () => ({ invalidate: vi.fn(), navigate: vi.fn() }),
  useRouteContext: () => mockRouteContext(),
}))

vi.mock('@/lib/client/hooks/use-auth-broadcast', () => ({
  useAuthBroadcast: () => {},
}))

vi.mock('@/components/ui/rich-text-editor', () => ({
  RichTextEditor: ({ value }: { value?: unknown }) => (
    <pre data-testid="feedback-editor">
      {typeof value === 'object' ? JSON.stringify(value) : ''}
    </pre>
  ),
}))

vi.mock('sonner', () => ({
  toast: { success: vi.fn() },
}))

vi.mock('@/lib/client/hooks/use-image-upload', () => ({
  usePortalImageUpload: () => ({ upload: vi.fn() }),
}))

vi.mock('@/lib/client/mutations/portal-posts', () => ({
  useCreatePublicPost: () => ({ mutateAsync: mockCreatePost, isPending: false }),
}))

vi.mock('@/components/auth/auth-popover-context', () => ({
  useAuthPopover: () => ({ openAuthPopover: vi.fn() }),
}))

vi.mock('@/lib/client/hooks/use-similar-posts', () => ({
  useSimilarPosts: () => ({ posts: [] }),
}))

vi.mock('@/lib/client/hooks/use-ensure-anon-session', () => ({
  useEnsureAnonSession: () => vi.fn(() => Promise.resolve(true)),
}))

// The header nests motion.div/motion.input inside AnimatePresence; neither
// animates in happy-dom, and both would otherwise pass unknown `initial` /
// `animate` / `exit` / `transition` props straight onto the DOM node.
vi.mock('framer-motion', () => {
  function MotionDiv({
    children,
    initial: _initial,
    animate: _animate,
    exit: _exit,
    transition: _transition,
    ...rest
  }: ComponentProps<'div'> & {
    initial?: unknown
    animate?: unknown
    exit?: unknown
    transition?: unknown
  }) {
    return <div {...rest}>{children}</div>
  }

  function MotionInput({
    initial: _initial,
    animate: _animate,
    exit: _exit,
    transition: _transition,
    ...rest
  }: ComponentProps<'input'> & {
    initial?: unknown
    animate?: unknown
    exit?: unknown
    transition?: unknown
  }) {
    return <input {...rest} />
  }

  return {
    motion: { div: MotionDiv, input: MotionInput },
    AnimatePresence: ({ children }: { children: ReactNode }) => <>{children}</>,
  }
})

import { FeedbackHeaderAnimated } from '../feedback-header-animated'

function docSaying(text: string): TiptapContent {
  return { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] }
}

const BUG_TEMPLATE = docSaying('Steps to reproduce:')
const WORKSPACE_TEMPLATE = docSaying('What are you trying to do?')

function renderPortalForm(boardTemplate: TiptapContent | undefined) {
  return renderInGerman(
    <QueryClientProvider client={new QueryClient()}>
      <FeedbackHeaderAnimated
        workspaceName="Acme"
        boards={[
          {
            id: 'board_1',
            name: 'Bugs',
            slug: 'bugs',
            settings: { descriptionTemplate: boardTemplate },
          },
        ]}
        defaultBoardId="board_1"
        boardLocked
        boardPermissions={{ board_1: { canSubmit: true, canVote: true } }}
      />
    </QueryClientProvider>
  )
}

function expandWithTitle(container: HTMLElement, title: string) {
  const titleInput = container.querySelector('input[type="text"]') as HTMLInputElement
  fireEvent.change(titleInput, { target: { value: title } })
}

function editorShows(): unknown {
  const shown = screen.getByTestId('feedback-editor').textContent ?? ''
  if (shown === '') return null
  return JSON.parse(shown)
}

describe('the portal form and description templates', () => {
  beforeEach(() => {
    mockCreatePost.mockReset()
    mockCreatePost.mockResolvedValue({ id: 'post_1', board: { slug: 'bugs' } })
    mockRouteContext.mockReturnValue({
      session: { user: { name: 'Ada', email: 'ada@example.com', principalType: 'user' } },
      settings: { publicPortalConfig: { postTemplate: WORKSPACE_TEMPLATE } },
    })
  })

  afterEach(() => cleanup())

  it('shows the board template in the description (V1, V8)', () => {
    const { container } = renderPortalForm(BUG_TEMPLATE)
    expandWithTitle(container, 'Export fails')
    expect(editorShows()).toEqual(BUG_TEMPLATE)
  })

  it('shows the workspace default on a board without a template (V2, V8)', () => {
    const { container } = renderPortalForm(undefined)
    expandWithTitle(container, 'Export fails')
    expect(editorShows()).toEqual(WORKSPACE_TEMPLATE)
  })

  it('submits an untouched template as the description, without complaint (V6)', async () => {
    const { container } = renderPortalForm(BUG_TEMPLATE)
    expandWithTitle(container, 'Export fails')

    fireEvent.click(screen.getByRole('button', { name: 'Absenden' }))

    await waitFor(() => expect(mockCreatePost).toHaveBeenCalledTimes(1))
    expect(mockCreatePost.mock.calls[0][0].contentJson).toEqual(BUG_TEMPLATE)
  })

  it('starts the next post with the template again after submitting (V7)', async () => {
    const { container } = renderPortalForm(BUG_TEMPLATE)
    expandWithTitle(container, 'Export fails')
    fireEvent.click(screen.getByRole('button', { name: 'Absenden' }))
    await waitFor(() => expect(mockCreatePost).toHaveBeenCalledTimes(1))

    expandWithTitle(container, 'Second one')

    await waitFor(() => expect(editorShows()).toEqual(BUG_TEMPLATE))
  })

  it('starts the next post with the template again after cancelling (V7)', async () => {
    const { container } = renderPortalForm(BUG_TEMPLATE)
    expandWithTitle(container, 'Export fails')
    fireEvent.click(screen.getByRole('button', { name: 'Abbrechen' }))

    expandWithTitle(container, 'Again')

    await waitFor(() => expect(editorShows()).toEqual(BUG_TEMPLATE))
  })
})
