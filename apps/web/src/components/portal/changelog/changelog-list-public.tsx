import { useMemo, useState } from 'react'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { useIntl, FormattedMessage } from 'react-intl'
import { Button } from '@/components/ui/button'
import { ChangelogEntryCard } from './changelog-entry-card'
import { EmptyState } from '@/components/shared/empty-state'
import { cn } from '@/lib/shared/utils'
import { publicChangelogQueries, changelogCategoryQueries } from '@/lib/client/queries/changelog'
import { ChangelogBoardFilter } from './changelog-board-filter'
import { DocumentTextIcon } from '@heroicons/react/24/outline'
import type { ChangelogCategoryId } from '@quackback/ids'

interface ChangelogListPublicProps {
  /**
   * Products to narrow to, from the URL. Applied server-side, unlike the
   * category chips below: the product filter has to agree with the cursor, and
   * filtering a fetched page would hand back short pages and drop matches at
   * every page boundary.
   */
  boardIds?: string[]
}

/**
 * Which "nothing here" the reader is looking at. A product filter that matches
 * nothing reads as a broken page unless the message says a filter is on.
 */
function emptyStateTitle(
  activeCategoryId: ChangelogCategoryId | null,
  boardIds: string[] | undefined
) {
  if (activeCategoryId) {
    return {
      id: 'portal.changelog.emptyFiltered.title',
      defaultMessage: 'No updates in this category yet',
    }
  }
  if (boardIds?.length) {
    return {
      id: 'portal.changelog.emptyProduct.title',
      defaultMessage: 'No updates for this product yet',
    }
  }
  return { id: 'portal.changelog.empty.title', defaultMessage: 'No updates yet' }
}

export function ChangelogListPublic({ boardIds }: ChangelogListPublicProps = {}) {
  const intl = useIntl()
  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading } = useInfiniteQuery(
    publicChangelogQueries.list(boardIds)
  )
  const { data: categories = [] } = useQuery(changelogCategoryQueries.list())
  const [activeCategoryId, setActiveCategoryId] = useState<ChangelogCategoryId | null>(null)

  const allEntries = data?.pages.flatMap((page) => page.items) ?? []

  // Only offer chips for categories that actually appear on a loaded entry,
  // so the filter row never shows a label with nothing to show for it.
  const categoriesInUse = useMemo(() => {
    const usedIds = new Set(allEntries.flatMap((e) => e.categories.map((c) => c.id)))
    return categories.filter((c) => usedIds.has(c.id))
  }, [categories, allEntries])

  const entries = activeCategoryId
    ? allEntries.filter((e) => e.categories.some((c) => c.id === activeCategoryId))
    : allEntries

  if (isLoading) {
    return (
      <div>
        <ChangelogBoardFilter selected={boardIds} />
        <div className="flex items-center justify-center py-16">
          <div className="text-muted-foreground">
            <FormattedMessage id="portal.changelog.loading" defaultMessage="Loading changelog..." />
          </div>
        </div>
      </div>
    )
  }

  return (
    <div>
      <ChangelogBoardFilter selected={boardIds} />
      {categoriesInUse.length > 0 && (
        <div className="mb-8 flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => setActiveCategoryId(null)}
            className={cn(
              'rounded-full px-3 py-1 text-xs font-medium transition-colors',
              activeCategoryId === null
                ? 'bg-foreground text-background'
                : 'bg-muted text-muted-foreground hover:bg-muted/70'
            )}
          >
            {intl.formatMessage({ id: 'portal.changelog.filter.all', defaultMessage: 'All' })}
          </button>
          {categoriesInUse.map((category) => (
            <button
              key={category.id}
              type="button"
              onClick={() => setActiveCategoryId(category.id)}
              className={cn(
                'rounded-full px-3 py-1 text-xs font-medium transition-colors',
                activeCategoryId === category.id ? 'text-white' : 'hover:opacity-80'
              )}
              style={{
                backgroundColor:
                  activeCategoryId === category.id ? category.color : category.color + '1a',
                color: activeCategoryId === category.id ? '#fff' : category.color,
              }}
            >
              {category.name}
            </button>
          ))}
        </div>
      )}

      {entries.length === 0 ? (
        <EmptyState
          icon={DocumentTextIcon}
          title={intl.formatMessage(emptyStateTitle(activeCategoryId, boardIds))}
          description={intl.formatMessage({
            id: 'portal.changelog.empty.description',
            defaultMessage: 'Check back soon for the latest product updates and shipped features.',
          })}
        />
      ) : (
        <div className="divide-y divide-border/40">
          {entries.map((entry, index) => (
            <div
              key={entry.id}
              className="py-10 first:pt-0 animate-in fade-in duration-200 fill-mode-backwards"
              style={{ animationDelay: `${index * 50}ms` }}
            >
              <ChangelogEntryCard
                id={entry.id}
                title={entry.title}
                content={entry.content}
                contentJson={entry.contentJson}
                publishedAt={entry.publishedAt}
                linkedPosts={entry.linkedPosts}
                categories={entry.categories}
              />
            </div>
          ))}
        </div>
      )}

      {/* Load more */}
      {hasNextPage && (
        <div className="flex justify-center pt-8">
          <Button variant="outline" onClick={() => fetchNextPage()} disabled={isFetchingNextPage}>
            {isFetchingNextPage ? (
              <FormattedMessage id="portal.changelog.loadingMore" defaultMessage="Loading..." />
            ) : (
              <FormattedMessage id="portal.changelog.loadMore" defaultMessage="Load more" />
            )}
          </Button>
        </div>
      )}
    </div>
  )
}
