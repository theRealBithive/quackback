// @vitest-environment happy-dom
/**
 * The product chips above the public changelog.
 *
 * V6 A reader is only ever offered products they are allowed to see; a product
 *    they may not see is never named in the filter options.
 * V9 The filter survives sharing: the chosen products are part of the page
 *    address, and opening that address reproduces the same list.
 *
 * V6 is held here only as far as a component can hold it — the options come
 * from the public boards query, which is already audience-scoped server-side
 * (`changelog-board.db.test.ts` holds that end). What this file pins is that
 * the component names nothing the query did not give it, and that a selection
 * goes into the address rather than into component state.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { IntlProvider } from 'react-intl'

const mockUseQuery = vi.fn()
const mockNavigate = vi.fn()

vi.mock('@tanstack/react-query', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-query')>()
  return { ...actual, useQuery: () => mockUseQuery() }
})
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => mockNavigate,
}))

import { ChangelogBoardFilter } from '../changelog-board-filter'

const ALPHA = { id: 'board_alpha', name: 'Datenschutzkulpix' }
const BETA = { id: 'board_beta', name: 'ASBS-Kulpix' }

function renderFilter(boards: unknown[], selected?: string[]) {
  mockUseQuery.mockReturnValue({ data: boards })
  return render(
    <IntlProvider locale="en" defaultLocale="en">
      <ChangelogBoardFilter selected={selected} />
    </IntlProvider>
  )
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('ChangelogBoardFilter', () => {
  it('names every product the reader was offered, and no others (V6)', () => {
    renderFilter([ALPHA, BETA])

    expect(screen.getByRole('button', { name: 'Datenschutzkulpix' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'ASBS-Kulpix' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Kulpix intern' })).not.toBeInTheDocument()
  })

  it('stays out of the way when the workspace has only one product', () => {
    const { container } = renderFilter([ALPHA])
    expect(container).toBeEmptyDOMElement()
  })

  it('stays out of the way when the reader may see no product at all (V6)', () => {
    const { container } = renderFilter([])
    expect(container).toBeEmptyDOMElement()
  })

  it('puts a chosen product in the address rather than in component state (V9)', async () => {
    const user = userEvent.setup()
    renderFilter([ALPHA, BETA])

    await user.click(screen.getByRole('button', { name: 'ASBS-Kulpix' }))

    expect(mockNavigate).toHaveBeenCalledWith({
      to: '/changelog',
      search: { board: ['board_beta'] },
      replace: true,
    })
  })

  it('clears the product out of the address again (V9)', async () => {
    const user = userEvent.setup()
    renderFilter([ALPHA, BETA], ['board_beta'])

    await user.click(screen.getByRole('button', { name: 'All products' }))

    expect(mockNavigate).toHaveBeenCalledWith({
      to: '/changelog',
      search: {},
      replace: true,
    })
  })

  it('shows which product is selected, reading it back out of the address (V9)', () => {
    renderFilter([ALPHA, BETA], ['board_alpha'])

    expect(screen.getByRole('button', { name: 'Datenschutzkulpix' })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
    expect(screen.getByRole('button', { name: 'ASBS-Kulpix' })).toHaveAttribute(
      'aria-pressed',
      'false'
    )
    expect(screen.getByRole('button', { name: 'All products' })).toHaveAttribute(
      'aria-pressed',
      'false'
    )
  })

  it('treats a multi-product address as "no single product selected" (V9)', () => {
    // The chips are exclusive; the address is not. Two products in the URL is a
    // valid filter the server honours, and the chip row must not claim one of
    // them is the selection.
    renderFilter([ALPHA, BETA], ['board_alpha', 'board_beta'])

    expect(screen.getByRole('button', { name: 'All products' })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
    expect(screen.getByRole('button', { name: 'Datenschutzkulpix' })).toHaveAttribute(
      'aria-pressed',
      'false'
    )
  })
})
