// @vitest-environment happy-dom
/**
 * Compose board row, rendered: what the visitor sees and whether Submit works.
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
 * Texts are asserted against the German catalogue: English is also what
 * `defaultMessage` says, so an English assertion passes whether or not the
 * catalogue is consulted.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { ReactNode } from 'react'
import fc from 'fast-check'
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderInGerman } from '@/test/render-with-intl'
import de from '@/locales/de.json'
import type { WidgetHomeProps } from '../widget-home-animated'

const { createPost, auth } = vi.hoisted(() => ({
  createPost: vi.fn(),
  auth: {
    sessionVersion: 0,
    isIdentified: false,
    user: null as { name: string; email: string } | null,
  },
}))

vi.mock('../widget-auth-provider', () => ({
  useWidgetAuth: () => ({
    ensureSession: async () => true,
    ensureSessionThen: async (cb: () => void | Promise<void>) => cb(),
    isIdentified: auth.isIdentified,
    hmacRequired: true,
    user: auth.user,
    emitEvent: vi.fn(),
    metadata: null,
    getSessionVersion: () => auth.sessionVersion,
    sessionVersion: auth.sessionVersion,
  }),
}))
vi.mock('@/lib/client/widget-auth', () => ({
  getWidgetAuthHeaders: () => ({ Authorization: 'Bearer test' }),
}))
vi.mock('@/lib/client/widget-bridge', () => ({ sendToHost: vi.fn() }))
vi.mock('../use-widget-image-upload', () => ({
  useWidgetImageUpload: () => ({ upload: vi.fn() }),
  WidgetSessionError: class WidgetSessionError extends Error {},
}))
vi.mock('../widget-vote-button', () => ({ WidgetVoteButton: () => null }))
vi.mock('framer-motion', async () => {
  const { createElement, forwardRef } = await import('react')
  const MOTION_PROPS = new Set([
    'initial',
    'animate',
    'exit',
    'transition',
    'variants',
    'layout',
    'whileHover',
    'whileTap',
    'whileFocus',
    'whileInView',
  ])
  const make = (tag: string) =>
    forwardRef<HTMLElement, Record<string, unknown>>((props, ref) => {
      const { children, ...rest } = props
      const dom: Record<string, unknown> = { ref }
      for (const [key, value] of Object.entries(rest)) {
        if (!MOTION_PROPS.has(key)) dom[key] = value
      }
      return createElement(tag, dom, children as ReactNode)
    })
  return {
    AnimatePresence: ({ children }: { children?: ReactNode }) => children,
    motion: new Proxy(
      {},
      { get: (_target, prop) => (typeof prop === 'string' ? make(prop) : undefined) }
    ),
    useReducedMotion: () => true,
  }
})
vi.mock('@/components/ui/rich-text-editor', () => ({
  RichTextEditor: () => <div data-testid="editor" />,
}))
vi.mock('@/components/ui/select', async () => import('@/test/radix-select'))
vi.mock('@/lib/server/functions/public-posts', () => ({
  listPublicPostsFn: vi.fn(async () => ({ items: [], hasMore: false, total: 0 })),
  createPublicPostFn: (...args: unknown[]) => createPost(...args),
}))

import { WidgetHomeAnimated } from '../widget-home-animated'

const catalogue = de as Record<string, string>
const POSTING_TO = catalogue['widget.home.posting.postingTo']
const CHOOSE_BOARD = catalogue['widget.home.posting.chooseBoard']
const SUBMIT = catalogue['widget.home.form.submit']
const TITLE_LABEL = catalogue['widget.home.input.label']

interface Board {
  id: string
  name: string
  slug: string
}

const ideas: Board = { id: 'board_ideas', name: 'Feature Requests', slug: 'feature-requests-1' }
const bugs: Board = { id: 'board_bugs', name: 'Bug Reports', slug: 'bug-reports' }
const docs: Board = { id: 'board_docs', name: 'Docs', slug: 'docs' }
const members: Board = { id: 'board_members', name: 'Members', slug: 'members-only' }

function allowAll(boards: Board[]) {
  const permissions: Record<string, { canSubmit: boolean; canVote: boolean }> = {}
  for (const board of boards) {
    permissions[board.id] = { canSubmit: true, canVote: true }
  }
  return permissions
}

function homeFor(props: Partial<WidgetHomeProps>): ReactNode {
  const boards = props.boards ?? []
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return (
    <QueryClientProvider client={queryClient}>
      <WidgetHomeAnimated
        initialPosts={[]}
        statuses={[]}
        boards={boards}
        boardPermissions={props.boardPermissions ?? allowAll(boards)}
        defaultBoard={props.defaultBoard}
        confirmedBoardSlugs={props.confirmedBoardSlugs}
      />
    </QueryClientProvider>
  )
}

function typeTitle(value: string) {
  fireEvent.change(screen.getByRole('textbox', { name: TITLE_LABEL }), { target: { value } })
}

function submitButton() {
  return screen.getByRole('button', { name: SUBMIT })
}

function identify() {
  auth.sessionVersion = 1
  auth.isIdentified = true
  auth.user = { name: 'Ada Example', email: 'ada@example.com' }
}

beforeEach(() => {
  auth.sessionVersion = 0
  auth.isIdentified = false
  auth.user = null
  createPost.mockReset()
  createPost.mockResolvedValue({ id: 'post_1', title: 'Testing.', voteCount: 1, board: ideas })
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, json: async () => ({ data: { posts: [] } }) }))
  )
})
afterEach(cleanup)

describe('compose board, rendered', () => {
  it('(F5) shows the only board as the target and lets the post go out', async () => {
    renderInGerman(homeFor({ boards: [ideas] }))
    typeTitle('Testing.')

    expect(screen.getByText(POSTING_TO)).toBeTruthy()
    expect(screen.getByRole('combobox')).toHaveValue(ideas.id)
    expect(submitButton()).toBeEnabled()

    fireEvent.click(submitButton())
    await waitFor(() => expect(createPost).toHaveBeenCalled())
    expect(createPost.mock.calls[0]?.[0]).toMatchObject({ data: { boardId: ideas.id } })
  })

  it('(F5) adopts a board that only becomes visible after identify and posts to it', async () => {
    const view = renderInGerman(homeFor({ boards: [], confirmedBoardSlugs: null }))
    typeTitle('Testing.')
    expect(screen.queryByText(POSTING_TO)).toBeNull()
    expect(submitButton()).toBeDisabled()

    identify()
    view.rerender(
      homeFor({ boards: [members], confirmedBoardSlugs: [members.slug] }) as React.ReactElement
    )

    await waitFor(() => expect(screen.getByRole('combobox')).toHaveValue(members.id))
    expect(submitButton()).toBeEnabled()
    fireEvent.click(submitButton())
    await waitFor(() => expect(createPost).toHaveBeenCalled())
    expect(createPost.mock.calls[0]?.[0]).toMatchObject({ data: { boardId: members.id } })
  })

  it('(F5) falls back to the one board that is still visible after the session changes', async () => {
    identify()
    const view = renderInGerman(
      homeFor({ boards: [members, bugs], defaultBoard: members.slug, confirmedBoardSlugs: null })
    )
    typeTitle('Testing.')
    expect(screen.getByRole('combobox')).toHaveValue(members.id)

    auth.sessionVersion = 2
    view.rerender(
      homeFor({
        boards: [members, bugs],
        defaultBoard: members.slug,
        confirmedBoardSlugs: [bugs.slug],
      }) as React.ReactElement
    )

    await waitFor(() => expect(screen.getByRole('combobox')).toHaveValue(bugs.id))
    expect(submitButton()).toBeEnabled()
  })

  it('(F6) preselects the default board when several are available', () => {
    renderInGerman(homeFor({ boards: [ideas, bugs], defaultBoard: bugs.slug }))
    typeTitle('Testing.')

    expect(screen.getByRole('combobox')).toHaveValue(bugs.id)
    expect(screen.queryByText(CHOOSE_BOARD)).toBeNull()
    expect(submitButton()).toBeEnabled()
  })

  it('(F6) preselects nothing without a default and Submit waits for a choice', async () => {
    renderInGerman(homeFor({ boards: [ideas, bugs] }))
    typeTitle('Testing.')

    // The native <select> test double shows its first option when the value is
    // empty, so "nothing selected" is read from the prompt and from Submit.
    expect(screen.getByText(CHOOSE_BOARD)).toBeTruthy()
    expect(submitButton()).toBeDisabled()

    fireEvent.change(screen.getByRole('combobox'), { target: { value: ideas.id } })
    await waitFor(() => expect(submitButton()).toBeEnabled())
  })

  it('(F5)(F6) for any boards and default: selected board is the expected one and Submit follows', () => {
    const everyBoard = [ideas, bugs, docs, members]
    const defaultChoice = fc.option(fc.nat(10), { nil: undefined })

    fc.assert(
      fc.property(fc.integer({ min: 0, max: 4 }), defaultChoice, (count, position) => {
        cleanup()
        const boards = everyBoard.slice(0, count)
        const defaultBoard =
          position === undefined ? undefined : everyBoard[position % everyBoard.length].slug
        renderInGerman(homeFor({ boards, defaultBoard }))
        typeTitle('Testing.')

        const defaultIsListed = boards.some((board) => board.slug === defaultBoard)
        let expectedId = ''
        if (boards.length === 1) expectedId = boards[0].id
        if (boards.length > 1 && defaultIsListed) {
          expectedId = boards.find((board) => board.slug === defaultBoard)!.id
        }

        expect(screen.queryByText(POSTING_TO) !== null).toBe(boards.length > 0)
        if (expectedId !== '') {
          expect(screen.getByRole('combobox')).toHaveValue(expectedId)
        }
        const promptsForChoice = screen.queryByText(CHOOSE_BOARD) !== null
        expect(promptsForChoice).toBe(boards.length > 1 && expectedId === '')
        expect(submitButton().hasAttribute('disabled')).toBe(expectedId === '')
      }),
      { numRuns: 40 }
    )
  })
})
