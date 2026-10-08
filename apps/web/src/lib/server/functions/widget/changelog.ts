/**
 * Widget BFF for the changelog. Both reads pass the private-portal gate the
 * portal site's wrappers apply, lifted only for a signed widget identity
 * (J22, `../widget-portal-gate.ts`). A refused caller cannot tell a private
 * entry from a missing one, exactly as on the portal site.
 */
import { createServerFn } from '@tanstack/react-start'
import { getChangelogSchema, listPublicChangelogsSchema } from '@/lib/shared/schemas/changelog'
import { NotFoundError } from '@/lib/shared/errors'

export const widgetGetPublicChangelogFn = createServerFn({ method: 'GET' })
  .validator(getChangelogSchema)
  .handler(async ({ data }) => {
    const { getOptionalWidgetAuth } = await import('../widget-auth')
    const { resolveWidgetPortalAccess } = await import('../widget-portal-gate')
    const { runGetPublicChangelog } = await import('../changelog')
    const auth = await getOptionalWidgetAuth()
    const access = await resolveWidgetPortalAccess(auth)
    if (!access.granted) {
      throw new NotFoundError(
        'CHANGELOG_NOT_FOUND',
        `Published changelog entry with ID ${data.id} not found`
      )
    }
    return runGetPublicChangelog(auth, data)
  })

export const widgetListPublicChangelogsFn = createServerFn({ method: 'GET' })
  .validator(listPublicChangelogsSchema)
  .handler(async ({ data }) => {
    const { getOptionalWidgetAuth } = await import('../widget-auth')
    const { resolveWidgetPortalAccess } = await import('../widget-portal-gate')
    const { runListPublicChangelogs } = await import('../changelog')
    const auth = await getOptionalWidgetAuth()
    const access = await resolveWidgetPortalAccess(auth)
    if (!access.granted) {
      return { items: [], nextCursor: null, hasMore: false }
    }
    return runListPublicChangelogs(auth, data)
  })
