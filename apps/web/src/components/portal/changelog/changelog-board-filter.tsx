import { useNavigate } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { FormattedMessage, useIntl } from 'react-intl'
import { portalQueries } from '@/lib/client/queries/portal'
import { cn } from '@/lib/shared/utils'

interface ChangelogBoardFilterProps {
  /** Currently selected product ids, straight from the URL. */
  selected: string[] | undefined
}

/**
 * Product (board) chips above the public changelog, the changelog's half of
 * the filter the roadmap already has.
 *
 * The selection lives in the URL rather than in component state, so a
 * per-product changelog is a link somebody can send. The options come from the
 * public boards query, which is already scoped to what this reader may see —
 * a board they cannot view is never named here.
 *
 * Selecting is exclusive (one product at a time), which is what a reader
 * following their own product wants; the underlying filter takes a list, and
 * the address accepts several, so `?board=a&board=b` still works.
 */
export function ChangelogBoardFilter({ selected }: ChangelogBoardFilterProps) {
  const intl = useIntl()
  const navigate = useNavigate()
  const { data: boards = [] } = useQuery(portalQueries.boards())

  // One product is not a choice. Showing a lone chip would suggest the
  // changelog is narrower than it is.
  if (boards.length < 2) return null

  const activeId = selected?.length === 1 ? selected[0] : null

  function select(boardId: string | null) {
    void navigate({
      to: '/changelog',
      search: boardId ? { board: [boardId] } : {},
      replace: true,
    })
  }

  return (
    <div
      role="region"
      aria-label={intl.formatMessage({
        id: 'portal.changelog.filter.product.label',
        defaultMessage: 'Filter by product',
      })}
      className="mb-6 flex flex-wrap items-center gap-1.5"
    >
      <button
        type="button"
        onClick={() => select(null)}
        aria-pressed={activeId === null}
        className={cn(
          'rounded-full px-3 py-1 text-xs font-medium transition-colors',
          activeId === null
            ? 'bg-foreground text-background'
            : 'bg-muted text-muted-foreground hover:bg-muted/70'
        )}
      >
        <FormattedMessage id="portal.changelog.filter.product.all" defaultMessage="All products" />
      </button>

      {boards.map((board) => (
        <button
          key={board.id}
          type="button"
          onClick={() => select(board.id)}
          aria-pressed={activeId === board.id}
          className={cn(
            'rounded-full px-3 py-1 text-xs font-medium transition-colors',
            activeId === board.id
              ? 'bg-foreground text-background'
              : 'bg-muted text-muted-foreground hover:bg-muted/70'
          )}
        >
          {board.name}
        </button>
      ))}
    </div>
  )
}
