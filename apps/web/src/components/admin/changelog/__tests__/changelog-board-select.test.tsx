// @vitest-environment happy-dom
/**
 * The "Products" picker in the changelog editor.
 *
 * V1 A changelog entry can be assigned to any number of products: none, one,
 *    or several.
 * V2 An entry assigned to no product is a cross-product announcement — it
 *    appears under every product filter, and in the unfiltered list.
 *
 * V2 is a rule about the reader, so the picker cannot enforce it — but it can
 * fail to say it. An empty picker that looks like an omission invites an editor
 * to tag every entry with every product, which is the one thing that would make
 * the filter useless. That is why "All products" is asserted here.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { BoardId } from '@quackback/ids'

const mockUseBoards = vi.fn()
vi.mock('@/lib/client/hooks/use-boards-query', () => ({
  useBoards: () => mockUseBoards(),
}))

import { ChangelogBoardSelect } from '../changelog-board-select'

const ALPHA = { id: 'board_alpha' as BoardId, name: 'Datenschutzkulpix' }
const BETA = { id: 'board_beta' as BoardId, name: 'ASBS-Kulpix' }

function renderSelect(value: BoardId[], boards: unknown[] = [ALPHA, BETA]) {
  const onChange = vi.fn()
  mockUseBoards.mockReturnValue({ data: boards })
  render(<ChangelogBoardSelect value={value} onChange={onChange} />)
  return { onChange }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('ChangelogBoardSelect', () => {
  it('says an unassigned entry goes to all products rather than to none (V2)', () => {
    renderSelect([])
    expect(screen.getByText('All products')).toBeInTheDocument()
  })

  it('shows the products already assigned, and drops the hint once there is one (V1)', () => {
    renderSelect([ALPHA.id])
    expect(screen.getByText('Datenschutzkulpix')).toBeInTheDocument()
    expect(screen.queryByText('All products')).not.toBeInTheDocument()
  })

  it('adds a product without dropping the ones already there (V1)', async () => {
    const user = userEvent.setup()
    const { onChange } = renderSelect([ALPHA.id])

    await user.click(screen.getByRole('button', { name: /add/i }))
    await user.click(screen.getByRole('button', { name: 'ASBS-Kulpix' }))

    expect(onChange).toHaveBeenCalledWith([ALPHA.id, BETA.id])
  })

  it('takes a product away again (V1)', async () => {
    const user = userEvent.setup()
    const { onChange } = renderSelect([ALPHA.id, BETA.id])

    await user.click(screen.getByRole('button', { name: 'Remove Datenschutzkulpix' }))

    expect(onChange).toHaveBeenCalledWith([BETA.id])
  })

  it('offers only the products not already assigned', async () => {
    const user = userEvent.setup()
    renderSelect([ALPHA.id, BETA.id])

    await user.click(screen.getByRole('button', { name: /add/i }))

    expect(screen.getByText('All products added')).toBeInTheDocument()
  })

  it('offers nothing to add when the workspace has no products at all', () => {
    renderSelect([], [])
    expect(screen.queryByRole('button', { name: /add/i })).not.toBeInTheDocument()
    expect(screen.getByText('All products')).toBeInTheDocument()
  })
})
