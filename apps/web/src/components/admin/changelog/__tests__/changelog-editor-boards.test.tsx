// @vitest-environment happy-dom
/**
 * The products an editor picks have to reach the server.
 *
 * V1 A changelog entry can be assigned to any number of products: none, one,
 *    or several.
 * V2 An entry assigned to no product is a cross-product announcement — it
 *    appears under every product filter, and in the unfiltered list.
 *
 * `changelog-board-select.test.tsx` holds the picker itself and
 * `changelog-board-write.db.test.ts` holds what the server then does. This file
 * holds the stretch between them, which is the one nothing else covers: a
 * picker that works and a service that works still ship nothing if the editor's
 * choice never makes it into the request. Both editors are here together
 * because they are the same guarantee reached two ways, and because create and
 * edit disagree about what an empty list means.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { ReactNode } from 'react'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { UseFormReturn } from 'react-hook-form'
import type { BoardId, ChangelogId } from '@quackback/ids'

const ALPHA = 'board_alpha' as BoardId
const BETA = 'board_beta' as BoardId
const ENTRY_ID = 'changelog_existing' as ChangelogId

const mockCreate = vi.hoisted(() => vi.fn())
const mockUpdate = vi.hoisted(() => vi.fn())
const entryFixture = vi.hoisted(() => ({ current: null as Record<string, unknown> | null }))

vi.mock('@/lib/client/mutations/changelog', () => ({
  useCreateChangelog: () => ({
    mutate: mockCreate,
    reset: vi.fn(),
    isPending: false,
    isError: false,
    error: null,
  }),
  useUpdateChangelog: () => ({
    mutate: mockUpdate,
    reset: vi.fn(),
    isPending: false,
    isError: false,
    error: null,
  }),
}))
vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({ data: entryFixture.current, isLoading: false }),
}))
vi.mock('@/lib/client/queries/changelog', () => ({
  changelogQueries: { detail: (id: string) => ({ queryKey: ['changelog', id] }) },
}))
vi.mock('@/routes/admin/changelog', () => ({ Route: { useSearch: () => ({}) } }))
vi.mock('@/lib/client/hooks/use-url-modal', () => ({
  useUrlModal: () => ({ open: true, validatedId: ENTRY_ID, close: vi.fn() }),
}))
vi.mock('@/components/shared/url-modal-shell', () => ({
  UrlModalShell: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))
vi.mock('@/components/shared/modal-header', () => ({
  ModalHeader: ({ title }: { title: string }) => <h2>{title}</h2>,
}))
vi.mock('@/components/shared/modal-footer', () => ({
  ModalFooter: ({ submitLabel, children }: { submitLabel: string; children?: ReactNode }) => (
    <div>
      <button type="submit">{submitLabel}</button>
      {children}
    </div>
  ),
}))

// The editor body and the metadata sidebar are stood in for, so the assertions
// are about what the editor sends rather than about a rich-text field.
type FieldsProps = {
  form: UseFormReturn<{ title: string; content: string }>
  onContentChange: (json: unknown, html: string, markdown: string) => void
}
vi.mock('../changelog-form-fields', () => ({
  ChangelogFormFields: ({ form, onContentChange }: FieldsProps) => (
    <button
      type="button"
      onClick={() => {
        form.setValue('title', 'Release', { shouldValidate: true })
        onContentChange({ type: 'doc' }, '<p>Body</p>', 'Body')
      }}
    >
      write the entry
    </button>
  ),
}))

type SidebarProps = { boardIds: BoardId[]; onBoardsChange: (ids: BoardId[]) => void }
function sidebarStub({ boardIds, onBoardsChange }: SidebarProps) {
  return (
    <div>
      <span data-testid="assigned">{boardIds.join(',')}</span>
      <button type="button" onClick={() => onBoardsChange([ALPHA, BETA])}>
        pick two products
      </button>
      <button type="button" onClick={() => onBoardsChange([])}>
        clear the products
      </button>
    </div>
  )
}
vi.mock('../changelog-metadata-sidebar', () => ({ ChangelogMetadataSidebar: sidebarStub }))
vi.mock('../changelog-metadata-sidebar-content', () => ({
  ChangelogMetadataSidebarContent: () => null,
}))

import { CreateChangelogDialog } from '../create-changelog-dialog'
import { ChangelogModal } from '../changelog-modal'

/** What the editor sent, whichever editor it was. */
function payload(mutation: typeof mockCreate) {
  return mutation.mock.calls.at(-1)?.[0] as { boardIds?: BoardId[] }
}

beforeEach(() => {
  vi.clearAllMocks()
  entryFixture.current = {
    id: ENTRY_ID,
    title: 'Shipped',
    content: 'Body',
    contentJson: null,
    status: 'published',
    publishedAt: new Date('2026-01-01T00:00:00Z').toISOString(),
    displayDate: null,
    featuredImageUrl: null,
    segmentIds: [],
    linkedPosts: [],
    categories: [],
    boards: [{ id: ALPHA, name: 'Datenschutzkulpix', slug: 'dsk' }],
  }
})
afterEach(cleanup)

describe('creating an entry', () => {
  async function openDialog() {
    const user = userEvent.setup()
    render(<CreateChangelogDialog />)
    await user.click(screen.getByRole('button', { name: 'New Entry' }))
    await user.click(await screen.findByRole('button', { name: 'write the entry' }))
    return user
  }

  it('sends the products the editor picked (V1)', async () => {
    const user = await openDialog()

    await user.click(screen.getByRole('button', { name: 'pick two products' }))
    await user.click(screen.getByRole('button', { name: /save draft/i }))

    await waitFor(() => expect(mockCreate).toHaveBeenCalled())
    expect(payload(mockCreate).boardIds).toEqual([ALPHA, BETA])
  })

  it('sends an empty assignment when the editor picked nothing, rather than omitting it (V2)', async () => {
    // Omitting the field would leave the server guessing; an empty list is the
    // editor saying "this one is for everyone".
    const user = await openDialog()

    await user.click(screen.getByRole('button', { name: /save draft/i }))

    await waitFor(() => expect(mockCreate).toHaveBeenCalled())
    expect(payload(mockCreate).boardIds).toEqual([])
  })
})

describe('editing an entry', () => {
  it('opens showing the products the entry already has (V1)', async () => {
    render(<ChangelogModal entryId={ENTRY_ID} />)

    await waitFor(() => expect(screen.getByTestId('assigned')).toHaveTextContent(ALPHA))
  })

  it('opens showing no product for a cross-product announcement (V2)', async () => {
    entryFixture.current = { ...entryFixture.current!, boards: [] }

    render(<ChangelogModal entryId={ENTRY_ID} />)

    await waitFor(() => expect(screen.getByTestId('assigned')).toHaveTextContent(''))
  })

  it('sends the products unchanged when the editor did not touch them (V1)', async () => {
    const user = userEvent.setup()
    render(<ChangelogModal entryId={ENTRY_ID} />)

    await user.click(await screen.findByRole('button', { name: /update & publish/i }))

    await waitFor(() => expect(mockUpdate).toHaveBeenCalled())
    expect(payload(mockUpdate).boardIds).toEqual([ALPHA])
  })

  it('sends the new set when the editor changed it (V1)', async () => {
    const user = userEvent.setup()
    render(<ChangelogModal entryId={ENTRY_ID} />)

    await user.click(await screen.findByRole('button', { name: 'pick two products' }))
    await user.click(screen.getByRole('button', { name: /update & publish/i }))

    await waitFor(() => expect(mockUpdate).toHaveBeenCalled())
    expect(payload(mockUpdate).boardIds).toEqual([ALPHA, BETA])
  })

  it('sends an empty list when the editor takes the entry off every product (V2)', async () => {
    const user = userEvent.setup()
    render(<ChangelogModal entryId={ENTRY_ID} />)

    await user.click(await screen.findByRole('button', { name: 'clear the products' }))
    await user.click(screen.getByRole('button', { name: /update & publish/i }))

    await waitFor(() => expect(mockUpdate).toHaveBeenCalled())
    expect(payload(mockUpdate).boardIds).toEqual([])
  })
})
