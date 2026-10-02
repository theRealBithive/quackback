/**
 * Compose board choice, as a function of the boards a visitor can see.
 *
 * Contract for the batch F picks (upstream 38b4612f3 #577, with the fork's
 * b18861a4e on top) -- the confirmed list items this suite pins:
 *
 *   F5 When exactly one board is available, the composer shows it as the
 *      target and the post can be submitted, also when that board only becomes
 *      visible after identify.
 *   F6 With several boards, a default board is preselected; with no default,
 *      nothing is preselected and Submit waits for a choice.
 *
 * The rendered half of F5/F6 is in `widget-home-compose-board.contract.test.tsx`.
 */
import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import { resolveComposeBoardId, shouldResetComposeBoard } from '../widget-compose'

interface Board {
  id: string
  slug: string
}

// 0..4 boards with distinct ids and slugs.
const boardsArbitrary: fc.Arbitrary<Board[]> = fc.integer({ min: 0, max: 4 }).map((count) =>
  Array.from({ length: count }, (_, index) => ({
    id: `board_${index}`,
    slug: `slug-${index}`,
  }))
)

// No default, a default that is one of the boards (picked by position, wrapped
// onto the list), or a default naming a board the visitor cannot see.
const defaultChoice = fc.oneof(
  fc.constant({ kind: 'none' as const }),
  fc.nat(10).map((position) => ({ kind: 'listed' as const, position })),
  fc.constant({ kind: 'unknown' as const })
)

function defaultSlugFor(boards: Board[], choice: fc.ValueOf<typeof defaultChoice>) {
  if (choice.kind === 'none') return undefined
  if (choice.kind === 'unknown' || boards.length === 0) return 'slug-not-visible'
  return boards[choice.position % boards.length].slug
}

describe('compose board preselection', () => {
  it('(F5)(F6) preselects a visible board or nothing, never a board the visitor cannot see', () => {
    fc.assert(
      fc.property(boardsArbitrary, defaultChoice, (boards, choice) => {
        const selected = resolveComposeBoardId(boards, undefined, defaultSlugFor(boards, choice))

        const visibleIds = boards.map((board) => board.id)
        expect(['', ...visibleIds]).toContain(selected)
      })
    )
  })

  it('(F5) selects the one available board, whatever the default says', () => {
    fc.assert(
      fc.property(defaultChoice, (choice) => {
        const boards = [{ id: 'board_only', slug: 'only' }]
        const defaultSlug = choice.kind === 'none' ? undefined : 'something-else'

        expect(resolveComposeBoardId(boards, undefined, defaultSlug)).toBe('board_only')
      })
    )
  })

  it('(F6) preselects the default board when several boards are available', () => {
    fc.assert(
      fc.property(boardsArbitrary, fc.nat(10), (boards, position) => {
        fc.pre(boards.length >= 2)
        const chosen = boards[position % boards.length]

        expect(resolveComposeBoardId(boards, undefined, chosen.slug)).toBe(chosen.id)
      })
    )
  })

  it('(F6) preselects nothing when several boards are available and there is no usable default', () => {
    fc.assert(
      fc.property(boardsArbitrary, defaultChoice, (boards, choice) => {
        fc.pre(boards.length >= 2 && choice.kind !== 'listed')

        expect(resolveComposeBoardId(boards, undefined, defaultSlugFor(boards, choice))).toBe('')
      })
    )
  })

  it('(F5) a board that appears only after identify is adopted by an empty selection', () => {
    const appeared = [{ id: 'board_members', slug: 'members' }]

    expect(shouldResetComposeBoard('', appeared, ['members'])).toBe(true)
    expect(resolveComposeBoardId(appeared, undefined, undefined)).toBe('board_members')
  })

  it('(F5) keeps an empty selection untouched until the session list has arrived', () => {
    fc.assert(
      fc.property(boardsArbitrary, (boards) => {
        expect(shouldResetComposeBoard('', boards, null)).toBe(false)
        expect(shouldResetComposeBoard('', boards, undefined)).toBe(false)
      })
    )
  })
})
