import { createFileRoute, notFound } from '@tanstack/react-router'
import { useIntl } from 'react-intl'
import { z } from 'zod'
import { RssIcon } from '@heroicons/react/24/outline'
import { Button } from '@/components/ui/button'
import { PageHeader } from '@/components/shared/page-header'
import { ChangelogListPublic, ChangelogSubscribeButton } from '@/components/portal/changelog'
import { isProductEnabled } from '@/lib/shared/types/settings'
import { setPublicDocumentCacheHeaders } from '@/lib/server/functions/public-cache'

/**
 * The product filter lives in the address so a per-product changelog can be
 * shared and bookmarked (V9). Same `board` param name and array shape the
 * roadmap uses, so `/roadmap?board=x` and `/changelog?board=x` read alike.
 */
const searchSchema = z.object({
  board: z.array(z.string()).optional(),
})

export const Route = createFileRoute('/_portal/changelog/')({
  validateSearch: searchSchema,
  loader: async ({ context }) => {
    if (!isProductEnabled(context.settings?.featureFlags, 'changelog')) throw notFound()
    if (typeof window === 'undefined') await setPublicDocumentCacheHeaders()
    return {
      workspaceName: context.settings?.name ?? 'Quackback',
      baseUrl: context.baseUrl ?? '',
    }
  },
  head: ({ loaderData }) => {
    if (!loaderData) return {}
    const { workspaceName, baseUrl } = loaderData
    const title = `Changelog - ${workspaceName}`
    const description = `Stay up to date with the latest ${workspaceName} product updates and shipped features.`
    const canonicalUrl = baseUrl ? `${baseUrl}/changelog` : ''
    return {
      meta: [
        { title },
        { name: 'description', content: description },
        { property: 'og:title', content: title },
        { property: 'og:description', content: description },
        ...(canonicalUrl ? [{ property: 'og:url', content: canonicalUrl }] : []),
        { name: 'twitter:title', content: title },
        { name: 'twitter:description', content: description },
      ],
      links: canonicalUrl ? [{ rel: 'canonical', href: canonicalUrl }] : [],
    }
  },
  component: ChangelogPage,
})

function ChangelogPage() {
  const intl = useIntl()
  const { session } = Route.useRouteContext()
  const { board } = Route.useSearch()
  const isIdentified = !!session?.user && session.user.principalType !== 'anonymous'

  // The feed follows the page: subscribing while a product is selected
  // subscribes to that product (V11).
  const feedHref = board?.length
    ? `/changelog/feed?${board.map((id: string) => `board=${encodeURIComponent(id)}`).join('&')}`
    : '/changelog/feed'

  return (
    <div className="mx-auto max-w-6xl w-full px-4 sm:px-6 py-8">
      <PageHeader
        size="large"
        title={intl.formatMessage({ id: 'portal.changelog.title', defaultMessage: 'Changelog' })}
        description={intl.formatMessage({
          id: 'portal.changelog.description',
          defaultMessage: 'Stay up to date with the latest product updates and shipped features.',
        })}
        action={
          <div className="flex items-center gap-2">
            <ChangelogSubscribeButton enabled={isIdentified} />
            <Button variant="outline" size="sm" asChild className="shrink-0 gap-1.5">
              <a href={feedHref} target="_blank" rel="noopener noreferrer">
                <RssIcon className="h-4 w-4" />
                <span className="hidden sm:inline">
                  {intl.formatMessage({
                    id: 'portal.changelog.rssFeed',
                    defaultMessage: 'RSS Feed',
                  })}
                </span>
              </a>
            </Button>
          </div>
        }
        animate
        className="mb-8"
      />

      <div
        className="animate-in fade-in duration-300 fill-mode-backwards"
        style={{ animationDelay: '100ms' }}
      >
        <ChangelogListPublic boardIds={board} />
      </div>
    </div>
  )
}
