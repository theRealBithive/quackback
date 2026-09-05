// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { IntlProvider } from 'react-intl'

// The public changelog list renders an empty state when there are no entries.
// We mock the infinite query (entries) and the plain query (category filter
// chips) so the component takes the empty branch without a live data layer
// or a QueryClientProvider.
const mockUseInfiniteQuery = vi.fn()
const mockUseQuery = vi.fn(() => ({ data: [] }))
vi.mock('@tanstack/react-query', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-query')>()
  return {
    ...actual,
    useInfiniteQuery: () => mockUseInfiniteQuery(),
    useQuery: () => mockUseQuery(),
  }
})

vi.mock('../changelog-entry-card', () => ({
  ChangelogEntryCard: ({ title }: { title: string }) => <article>{title}</article>,
}))
vi.mock('../changelog-board-filter', () => ({ ChangelogBoardFilter: () => null }))

import { ChangelogListPublic } from '../changelog-list-public'

function renderEmpty(messages: Record<string, string>, boardIds?: string[]) {
  mockUseInfiniteQuery.mockReturnValue({
    data: { pages: [{ items: [] }] },
    fetchNextPage: vi.fn(),
    hasNextPage: false,
    isFetchingNextPage: false,
    isLoading: false,
  })
  return render(
    <IntlProvider locale="fr" defaultLocale="en" messages={messages}>
      <ChangelogListPublic boardIds={boardIds} />
    </IntlProvider>
  )
}

describe('ChangelogListPublic empty state', () => {
  it('renders the localized empty-state copy instead of hardcoded English', () => {
    renderEmpty({
      'portal.changelog.empty.title': 'Aucune actualité pour le moment',
      'portal.changelog.empty.description': 'Revenez bientôt pour les dernières nouveautés.',
    })

    expect(screen.getByText('Aucune actualité pour le moment')).toBeInTheDocument()
    expect(screen.getByText('Revenez bientôt pour les dernières nouveautés.')).toBeInTheDocument()
    expect(screen.queryByText('No updates yet')).not.toBeInTheDocument()
  })
})

describe('ChangelogListPublic empty state, with a product selected', () => {
  // An empty changelog and a product with nothing shipped yet look identical on
  // screen, and one of them is a filter the reader can undo. Saying which is the
  // difference between "this product is quiet" and "this page is broken".
  it('says the product is quiet, not that the changelog is (V3)', () => {
    renderEmpty(
      {
        'portal.changelog.emptyProduct.title': 'Rien pour ce produit pour le moment',
        'portal.changelog.empty.description': 'Revenez bientôt pour les dernières nouveautés.',
      },
      ['board_alpha']
    )

    expect(screen.getByText('Rien pour ce produit pour le moment')).toBeInTheDocument()
    expect(screen.queryByText('No updates yet')).not.toBeInTheDocument()
  })

  it('falls back to the plain empty state when no product is selected (V5)', () => {
    renderEmpty(
      {
        'portal.changelog.empty.title': 'Aucune actualité pour le moment',
        'portal.changelog.empty.description': 'Revenez bientôt.',
      },
      []
    )

    expect(screen.getByText('Aucune actualité pour le moment')).toBeInTheDocument()
  })
})

describe('ChangelogListPublic empty state, with a category chip still held down', () => {
  // Category chips filter the entries already on the page, so before this
  // change a chip could never produce an empty page: it was only ever offered
  // for a category some loaded entry carried. A product filter reloads the
  // list from the server while the chip stays pressed, which is how the page
  // can now end up empty with a category selected — and the reader has two
  // filters to undo, so the message has to name the one it names.
  it('names the category filter when a product filter empties the page (V3)', async () => {
    const user = userEvent.setup()
    const category = { id: 'changelog_category_fixes', name: 'Fixes', color: '#336699' }
    mockUseQuery.mockReturnValue({ data: [category] })
    mockUseInfiniteQuery.mockReturnValue({
      data: {
        pages: [{ items: [{ id: 'changelog_one', title: 'Shipped', categories: [category] }] }],
      },
      fetchNextPage: vi.fn(),
      hasNextPage: false,
      isFetchingNextPage: false,
      isLoading: false,
    })

    const view = render(
      <IntlProvider locale="en" defaultLocale="en" messages={{}}>
        <ChangelogListPublic />
      </IntlProvider>
    )

    await user.click(screen.getByRole('button', { name: 'Fixes' }))
    expect(screen.getByText('Shipped')).toBeInTheDocument()

    // Choosing a product reloads the list; this product shipped nothing in
    // that category, and the chip the reader pressed is still pressed.
    mockUseInfiniteQuery.mockReturnValue({
      data: { pages: [{ items: [] }] },
      fetchNextPage: vi.fn(),
      hasNextPage: false,
      isFetchingNextPage: false,
      isLoading: false,
    })
    view.rerender(
      <IntlProvider locale="en" defaultLocale="en" messages={{}}>
        <ChangelogListPublic boardIds={['board_alpha']} />
      </IntlProvider>
    )

    expect(screen.getByText('No updates in this category yet')).toBeInTheDocument()
    expect(screen.queryByText('No updates for this product yet')).not.toBeInTheDocument()
  })
})
