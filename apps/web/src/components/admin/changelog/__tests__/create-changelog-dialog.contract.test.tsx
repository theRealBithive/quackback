// @vitest-environment happy-dom
/**
 * Create-changelog dialog: what is sent, and what the visitor is told.
 *
 * Contract for the batch F pick (upstream 395821636, "save entries when the
 * editor has a body but markdown is empty") -- the confirmed list items this
 * suite pins:
 *
 *   F1 A changelog entry whose editor shows content is saved, even when the
 *      markdown projection of that content is empty or the serializer failed.
 *   F3 The error from a failed create stays visible until the author edits
 *      the entry or tries again; a successful create never shows an error.
 *
 * F3 was worded "until the next attempt" when first confirmed. The dialog
 * clears the error as soon as the author edits the entry, which is upstream's
 * behaviour; the owner kept that and the wording was corrected to match
 * (2026-10-02).
 *
 * (F2, the refusal of an entry with no content in any form, is pinned on the
 * server in `domains/changelog/__tests__/changelog-content-rule.contract.test.ts`.)
 *
 * "The next attempt" starts when the admin edits the entry again or presses
 * Save again; until then the banner stays, whatever else is touched.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const createChangelogFn = vi.hoisted(() => vi.fn())

vi.mock('@/lib/client/mutations/changelog', async () => {
  const { useMutation } = await import('@tanstack/react-query')
  return {
    useCreateChangelog: () => useMutation({ mutationFn: createChangelogFn }),
  }
})

const LIST_ONLY_DOCUMENT = {
  type: 'doc',
  content: [
    {
      type: 'bulletList',
      content: [
        {
          type: 'listItem',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Faster search' }] }],
        },
      ],
    },
  ],
}

// The editor stands in for TipTap: buttons that report what it would hold
// through the same (json, html, markdown) callback the real one uses.
vi.mock('@/components/ui/rich-text-editor', () => ({
  RichTextEditor: ({
    onChange,
  }: {
    onChange?: (json: unknown, html: string, markdown: string) => void
  }) => (
    <div>
      <button
        type="button"
        onClick={() => onChange?.(LIST_ONLY_DOCUMENT, '<ul><li>Faster search</li></ul>', '')}
      >
        Editor shows a list, markdown empty
      </button>
      <button
        type="button"
        onClick={() =>
          onChange?.({ type: 'doc', content: [{ type: 'paragraph' }] }, '<p></p>', 'More text')
        }
      >
        Editor shows more text
      </button>
    </div>
  ),
}))
vi.mock('../changelog-metadata-sidebar', () => ({ ChangelogMetadataSidebar: () => null }))
vi.mock('../changelog-metadata-sidebar-content', () => ({
  ChangelogMetadataSidebarContent: () => null,
}))
vi.mock('@/lib/client/hooks/use-image-upload', () => ({
  useImageUpload: () => ({ upload: vi.fn() }),
}))

import { CreateChangelogDialog } from '../create-changelog-dialog'

function renderDialog(onChangelogCreated = vi.fn()) {
  const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <CreateChangelogDialog onChangelogCreated={onChangelogCreated} />
    </QueryClientProvider>
  )
  return onChangelogCreated
}

async function openDialogWithTitle(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: /new entry/i }))
  await user.type(await screen.findByLabelText("What's new?"), 'Release')
}

async function pressSave(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Save Draft' }))
}

beforeEach(() => createChangelogFn.mockReset())
afterEach(cleanup)

describe('create changelog dialog', () => {
  it('(F1) sends the editor document when the markdown projection is empty', async () => {
    createChangelogFn.mockResolvedValue({ id: 'changelog_1' })
    const user = userEvent.setup()
    const onCreated = renderDialog()
    await openDialogWithTitle(user)

    await user.click(screen.getByText('Editor shows a list, markdown empty'))
    await pressSave(user)

    await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1))
    const sent = createChangelogFn.mock.calls[0][0]
    expect(sent.content).toBe('')
    expect(sent.contentJson).toEqual(LIST_ONLY_DOCUMENT)
  })

  it('(F3) shows the error of a failed create and keeps it until the next attempt', async () => {
    createChangelogFn.mockRejectedValueOnce(new Error('Content is required'))
    const user = userEvent.setup()
    renderDialog()
    await openDialogWithTitle(user)
    await user.click(screen.getByText('Editor shows a list, markdown empty'))
    await pressSave(user)

    expect(await screen.findByText('Content is required')).toBeTruthy()

    await user.click(screen.getByRole('button', { name: /settings/i }))
    expect(screen.queryByText('Content is required')).not.toBeNull()
  })

  it('(F3) clears the error when the author edits the entry', async () => {
    createChangelogFn.mockRejectedValueOnce(new Error('Content is required'))
    const user = userEvent.setup()
    renderDialog()
    await openDialogWithTitle(user)
    await user.click(screen.getByText('Editor shows a list, markdown empty'))
    await pressSave(user)
    await screen.findByText('Content is required')

    await user.click(screen.getByText('Editor shows more text'))

    expect(screen.queryByText('Content is required')).toBeNull()
  })

  it('(F3) shows no error while the retry runs and none after it succeeds', async () => {
    createChangelogFn.mockRejectedValueOnce(new Error('Content is required'))
    let finishRetry: (value: unknown) => void = () => {}
    createChangelogFn.mockReturnValueOnce(new Promise((resolve) => (finishRetry = resolve)))
    const user = userEvent.setup()
    const onCreated = renderDialog()
    await openDialogWithTitle(user)
    await user.click(screen.getByText('Editor shows a list, markdown empty'))
    await pressSave(user)
    await screen.findByText('Content is required')

    await pressSave(user)
    await screen.findByRole('button', { name: 'Saving...' })
    expect(screen.queryByText('Content is required')).toBeNull()

    finishRetry({ id: 'changelog_1' })
    await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1))
    expect(screen.queryByText('Content is required')).toBeNull()
  })

  it('(F3) a successful create never shows an error, even when the admin keeps editing while it saves', async () => {
    let finishCreate: (value: unknown) => void = () => {}
    createChangelogFn.mockReturnValueOnce(new Promise((resolve) => (finishCreate = resolve)))
    const user = userEvent.setup()
    const onCreated = renderDialog()
    await openDialogWithTitle(user)
    await user.click(screen.getByText('Editor shows a list, markdown empty'))
    await pressSave(user)
    await screen.findByRole('button', { name: 'Saving...' })

    await user.click(screen.getByText('Editor shows more text'))
    finishCreate({ id: 'changelog_1' })

    await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(createChangelogFn).toHaveBeenCalledTimes(1)
  })
})
