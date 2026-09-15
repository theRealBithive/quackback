// @vitest-environment happy-dom
/**
 * ## F — Forms
 * - F1 Typing in a post, changelog or help-center article editor updates the form's content as markdown and marks the form dirty, without running validation on each keystroke.
 * - F2 A checkbox that feeds a boolean setting (ticket field required, incident restores the status) stores true only for a checked box; an indeterminate box counts as unchecked.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const createArticle = vi.hoisted(() => ({ mutate: vi.fn(), reset: vi.fn() }))

// The editor stands in for TipTap: a textarea that reports what it holds
// through the same (json, html, markdown) callback the real one uses.
vi.mock('@/components/ui/rich-text-editor', () => ({
  RichTextEditor: ({
    onChange,
  }: {
    onChange?: (json: unknown, html: string, markdown: string) => void
  }) => (
    <textarea
      aria-label="Article body"
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

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
}))

vi.mock('@/lib/client/mutations/help-center', () => ({
  useCreateArticle: () => ({
    mutate: createArticle.mutate,
    reset: createArticle.reset,
    isPending: false,
    isError: false,
    error: null,
  }),
}))

vi.mock('@/lib/client/hooks/use-image-upload', () => ({
  useImageUpload: () => ({ upload: vi.fn() }),
}))

// The sidebar owns the category, which the create schema requires; a stub
// keeps the dialog's own content wiring the only thing under test.
vi.mock('../help-center-metadata-sidebar', () => ({
  HelpCenterMetadataSidebar: ({ onCategoryChange }: { onCategoryChange: (id: string) => void }) => (
    <button type="button" onClick={() => onCategoryChange('kb_category_account')}>
      pick category
    </button>
  ),
  HelpCenterMetadataSidebarContent: () => null,
}))

import { CreateArticleDialog } from '../create-article-dialog'

function renderDialog() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <CreateArticleDialog open onOpenChange={vi.fn()} />
    </QueryClientProvider>
  )
}

describe('CreateArticleDialog content editor', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })
  afterEach(cleanup)

  it('carries what was typed in the editor into the created article as markdown (F1)', async () => {
    renderDialog()

    await userEvent.type(screen.getByRole('textbox', { name: 'Article title' }), 'Reset password')
    await userEvent.type(screen.getByLabelText('Article body'), 'Open **Settings**')
    await userEvent.click(screen.getByRole('button', { name: 'pick category' }))

    await userEvent.click(screen.getByRole('button', { name: 'Save Draft' }))

    await waitFor(() => expect(createArticle.mutate).toHaveBeenCalledTimes(1))
    expect(createArticle.mutate.mock.calls[0]![0]).toMatchObject({
      title: 'Reset password',
      content: 'Open **Settings**',
    })
  })

  it('does not validate the article while it is being typed (F1)', async () => {
    renderDialog()

    // The content rule ("Content is required") would fire on an empty body if
    // each keystroke validated; typing and clearing must stay quiet.
    const body = screen.getByLabelText('Article body')
    await userEvent.type(body, 'Draft')
    await userEvent.clear(body)

    expect(screen.queryByText('Content is required')).toBeNull()
    expect(screen.queryByText('Title is required')).toBeNull()
    expect(createArticle.mutate).not.toHaveBeenCalled()
  })
})
