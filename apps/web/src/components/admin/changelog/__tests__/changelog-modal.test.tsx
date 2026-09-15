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
import type { ChangelogId } from '@quackback/ids'

const updateChangelog = vi.hoisted(() => ({ mutate: vi.fn() }))

// The editor stands in for TipTap: a textarea that reports what it holds
// through the same (json, html, markdown) callback the real one uses.
vi.mock('@/components/ui/rich-text-editor', () => ({
  RichTextEditor: ({
    onChange,
  }: {
    onChange?: (json: unknown, html: string, markdown: string) => void
  }) => (
    <textarea
      aria-label="Entry body"
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

// The modal reads its search params off the route; the id under test comes in
// as a prop, so an empty search is all the hook needs.
vi.mock('@/routes/admin/changelog', () => ({
  Route: { useSearch: () => ({}) },
}))

vi.mock('@/lib/client/mutations/changelog', () => ({
  useUpdateChangelog: () => ({
    mutate: updateChangelog.mutate,
    isPending: false,
    isError: false,
    error: null,
  }),
}))

vi.mock('@/lib/client/hooks/use-image-upload', () => ({
  useImageUpload: () => ({ upload: vi.fn() }),
  usePostImageUpload: () => ({ upload: vi.fn() }),
}))

vi.mock('../changelog-metadata-sidebar', () => ({
  ChangelogMetadataSidebar: () => null,
}))

vi.mock('../changelog-metadata-sidebar-content', () => ({
  ChangelogMetadataSidebarContent: () => null,
}))

import { ChangelogModal } from '../changelog-modal'
import { changelogKeys } from '@/lib/client/queries/changelog'

function renderModal() {
  const entryId = generateId('changelog') as ChangelogId
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  queryClient.setQueryData(changelogKeys.detail(entryId), {
    id: entryId,
    title: 'March release',
    content: 'Original body',
    contentJson: null,
    status: 'draft',
    publishedAt: null,
    displayDate: null,
    featuredImageUrl: null,
    linkedPosts: [],
    categories: [],
    boards: [],
    segmentIds: [],
    author: { name: 'Ada' },
  })

  render(
    <QueryClientProvider client={queryClient}>
      <ChangelogModal entryId={entryId} />
    </QueryClientProvider>
  )
  return entryId
}

describe('ChangelogModal content editor', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })
  afterEach(cleanup)

  it('carries what was typed in the editor into the saved entry as markdown (F1)', async () => {
    const entryId = renderModal()

    await userEvent.type(await screen.findByLabelText('Entry body'), 'Now with **dark mode**')
    await userEvent.click(await screen.findByRole('button', { name: 'Save Draft' }))

    await waitFor(() => expect(updateChangelog.mutate).toHaveBeenCalledTimes(1))
    expect(updateChangelog.mutate.mock.calls[0]![0]).toMatchObject({
      id: entryId,
      title: 'March release',
      content: 'Now with **dark mode**',
    })
  })

  it('does not validate the entry while it is being typed (F1)', async () => {
    renderModal()

    await userEvent.clear(await screen.findByRole('textbox', { name: /what's new/i }))
    await userEvent.type(screen.getByLabelText('Entry body'), 'Draft')

    expect(screen.queryByRole('alert')).toBeNull()
    expect(updateChangelog.mutate).not.toHaveBeenCalled()
  })
})
