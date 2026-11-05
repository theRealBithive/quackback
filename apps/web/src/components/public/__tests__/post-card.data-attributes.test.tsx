// @vitest-environment happy-dom
/**
 * <PostCard> exposes the status slug and every tag name on its root element.
 *
 * The e2e filter suite reads these to check that a filtered list holds only
 * posts the filter admits. Text is not enough for that: the card shows at most
 * three tags, and a status name such as "Open" also occurs in post bodies.
 */
import { describe, expect, it, vi } from 'vitest'
import type { PostId, PostStatusId } from '@quackback/ids'
import { renderWithIntl } from '@/test/render-with-intl'
import type { PostStatusEntity } from '@/lib/shared/db-types'
import { PostCard } from '../post-card'

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, ...props }: { children: React.ReactNode }) => {
    const { to: _to, params: _params, ...rest } = props as Record<string, unknown>
    return <a {...(rest as object)}>{children}</a>
  },
}))

vi.mock('@/lib/client/hooks/use-post-vote', () => ({
  usePostVote: ({ voteCount }: { voteCount: number }) => ({
    voteCount,
    hasVoted: false,
    isPending: false,
    handleVote: () => {},
  }),
}))

vi.mock('@/lib/client/hooks/use-ensure-anon-session', () => ({
  useEnsureAnonSession: () => async () => true,
}))

vi.mock('@/components/auth/auth-popover-context', () => ({
  useAuthPopoverSafe: () => null,
}))

const STATUS_ID = 'status_planned' as PostStatusId
const STATUSES = [
  { id: STATUS_ID, name: 'Planned', slug: 'planned', color: '#3b82f6' },
] as unknown as PostStatusEntity[]

const FOUR_TAGS = [
  { id: 'tag_a', name: 'API' },
  { id: 'tag_b', name: 'Bug' },
  { id: 'tag_c', name: 'UX' },
  { id: 'tag_d', name: 'Performance' },
]

function renderCard(overrides: { onClick?: () => void; statusId?: PostStatusId | null } = {}) {
  return renderWithIntl(
    <PostCard
      id={'post_1' as PostId}
      title="A post"
      content="Body"
      statusId={overrides.statusId === undefined ? STATUS_ID : overrides.statusId}
      statuses={STATUSES}
      voteCount={3}
      commentCount={0}
      authorName="Ada"
      createdAt={new Date('2026-01-01T00:00:00Z')}
      boardSlug="feedback"
      tags={FOUR_TAGS}
      onClick={overrides.onClick}
    />
  )
}

function cardRoot(container: HTMLElement): HTMLElement {
  const root = container.querySelector<HTMLElement>('[data-post-id="post_1"]')
  if (!root) throw new Error('post card root not rendered')
  return root
}

describe('<PostCard> filter attributes', () => {
  it('a linked card carries its status slug and all tag names, including truncated ones', () => {
    const { container } = renderCard()
    const root = cardRoot(container)

    expect(root.tagName).toBe('A')
    expect(root.getAttribute('data-status')).toBe('planned')
    expect(JSON.parse(root.getAttribute('data-tag-names') ?? 'null')).toEqual([
      'API',
      'Bug',
      'UX',
      'Performance',
    ])
  })

  it('a clickable card carries the same attributes', () => {
    const { container } = renderCard({ onClick: () => {} })
    const root = cardRoot(container)

    expect(root.tagName).toBe('DIV')
    expect(root.getAttribute('data-status')).toBe('planned')
    expect(JSON.parse(root.getAttribute('data-tag-names') ?? 'null')).toEqual([
      'API',
      'Bug',
      'UX',
      'Performance',
    ])
  })

  it('a card without a status has no status attribute', () => {
    const { container } = renderCard({ statusId: null })

    expect(cardRoot(container).hasAttribute('data-status')).toBe(false)
  })
})
