// @vitest-environment happy-dom
/**
 * ## F — Forms
 * - F1 Typing in a post, changelog or help-center article editor updates the form's content as markdown and marks the form dirty, without running validation on each keystroke.
 * - F2 A checkbox that feeds a boolean setting (ticket field required, incident restores the status) stores true only for a checked box; an indeterminate box counts as unchecked.
 */
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { generateId } from '@quackback/ids'
import type { KbArticleId } from '@quackback/ids'

const updateArticle = vi.hoisted(() => ({ mutate: vi.fn() }))

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
  Link: ({ children, to }: { children: ReactNode; to: string }) => <a href={to}>{children}</a>,
}))

vi.mock('@/lib/client/mutations/help-center', () => ({
  useUpdateArticle: () => ({
    mutate: updateArticle.mutate,
    isPending: false,
    isError: false,
    error: null,
  }),
  usePublishArticle: () => ({ mutate: vi.fn(), isPending: false }),
  useUnpublishArticle: () => ({ mutate: vi.fn(), isPending: false }),
}))

vi.mock('@/lib/server/functions/admin', () => ({
  listSegmentsFn: vi.fn().mockResolvedValue([]),
  listPortalUsersFn: vi.fn().mockResolvedValue({ items: [] }),
}))

vi.mock('@/lib/client/hooks/use-image-upload', () => ({
  useImageUpload: () => ({ upload: vi.fn() }),
}))

vi.mock('@/components/admin/help-center/article-translations-dialog', () => ({
  ArticleTranslationsDialog: () => null,
}))

vi.mock('@/components/admin/help-center/article-feedback-reasons-dialog', () => ({
  ArticleFeedbackReasonsDialog: () => null,
}))

import { HelpCenterArticleEditor } from '../help-center-article-editor'
import { helpCenterKeys } from '@/lib/client/queries/help-center'

function renderEditor() {
  const articleId = generateId('article') as KbArticleId
  const categoryId = generateId('kb_category')
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  queryClient.setQueryData(helpCenterKeys.articleDetail(articleId), {
    id: articleId,
    title: 'Resetting your password',
    description: '',
    content: 'Original body',
    contentJson: null,
    categoryId,
    category: { id: categoryId, name: 'Account', slug: 'account' },
    slug: 'resetting-your-password',
    publishedAt: null,
    segmentIds: [],
  })
  queryClient.setQueryData(helpCenterKeys.categoriesList({}), [
    { id: categoryId, name: 'Account', slug: 'account', icon: null },
  ])

  render(
    <QueryClientProvider client={queryClient}>
      <HelpCenterArticleEditor articleId={articleId} />
    </QueryClientProvider>
  )
}

describe('HelpCenterArticleEditor content editor', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })
  afterEach(cleanup)

  it('marks the article dirty as soon as the editor reports a change (F1)', async () => {
    renderEditor()

    const save = await screen.findByRole('button', { name: 'Save changes' })
    expect(save).toBeDisabled()

    await userEvent.type(await screen.findByLabelText('Article body'), 'Rewritten body')

    await waitFor(() => expect(save).toBeEnabled())
  })

  it('saves what was typed in the editor as markdown (F1)', async () => {
    renderEditor()

    await userEvent.type(await screen.findByLabelText('Article body'), 'Step **one**')
    await userEvent.click(await screen.findByRole('button', { name: 'Save changes' }))

    await waitFor(() => expect(updateArticle.mutate).toHaveBeenCalledTimes(1))
    expect(updateArticle.mutate.mock.calls[0]![0]).toMatchObject({
      title: 'Resetting your password',
      content: 'Step **one**',
    })
  })
})
