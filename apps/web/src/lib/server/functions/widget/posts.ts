/**
 * Widget BFF for posts. Keep this file free of static imports from server
 * modules — the client graph loads these createServerFn exports.
 *
 * Every read and write of board content passes the private-portal gate the
 * portal site's wrappers apply, lifted only for a signed widget identity
 * (J22, `../widget-portal-gate.ts`). A refused caller gets the same answer the
 * portal site gives it.
 */
import { createServerFn } from '@tanstack/react-start'
import {
  listPublicPostsSchema,
  createPublicPostSchema,
  toggleVoteSchema,
  fetchPublicPostDetailSchema,
} from '@/lib/shared/schemas/posts'

export const widgetListPublicPostsFn = createServerFn({ method: 'GET' })
  .validator(listPublicPostsSchema)
  .handler(async ({ data }) => {
    const { getOptionalWidgetAuth } = await import('../widget-auth')
    const { resolveWidgetPortalAccess } = await import('../widget-portal-gate')
    const { runListPublicPosts } = await import('../public-posts')
    const auth = await getOptionalWidgetAuth()
    const access = await resolveWidgetPortalAccess(auth)
    if (!access.granted) {
      return { items: [], hasMore: false, total: 0 }
    }
    return runListPublicPosts(auth, data)
  })

export const widgetCreatePublicPostFn = createServerFn({ method: 'POST' })
  .validator(createPublicPostSchema)
  .handler(async ({ data }) => {
    const { requireWidgetAuth } = await import('../widget-auth')
    const { resolveWidgetPortalAccess } = await import('../widget-portal-gate')
    const { runCreatePublicPost } = await import('../public-posts')
    const auth = await requireWidgetAuth()
    const access = await resolveWidgetPortalAccess(auth)
    if (!access.granted) {
      throw new Error('Portal access required')
    }
    return runCreatePublicPost(auth, data)
  })

export const widgetToggleVoteFn = createServerFn({ method: 'POST' })
  .validator(toggleVoteSchema)
  .handler(async ({ data }): Promise<{ voted: boolean; voteCount: number }> => {
    const { requireWidgetAuth } = await import('../widget-auth')
    const { resolveWidgetPortalAccess } = await import('../widget-portal-gate')
    const { runToggleVote } = await import('../public-posts')
    const auth = await requireWidgetAuth()
    const access = await resolveWidgetPortalAccess(auth)
    if (!access.granted) {
      throw new Error('Portal access required')
    }
    return runToggleVote(auth, data)
  })

export const widgetGetVotedPostsFn = createServerFn({ method: 'GET' }).handler(
  async (): Promise<{ votedPostIds: string[] }> => {
    const { getOptionalWidgetAuth } = await import('../widget-auth')
    const { runGetVotedPosts } = await import('../public-posts')
    return runGetVotedPosts(await getOptionalWidgetAuth())
  }
)

export const widgetFetchPublicPostDetailFn = createServerFn({ method: 'GET' })
  .validator(fetchPublicPostDetailSchema)
  .handler(async ({ data }) => {
    const { getOptionalWidgetAuth } = await import('../widget-auth')
    const { resolveWidgetPortalAccess } = await import('../widget-portal-gate')
    const { runFetchPublicPostDetail } = await import('../portal')
    const auth = await getOptionalWidgetAuth()
    const access = await resolveWidgetPortalAccess(auth)
    if (!access.granted) {
      return null
    }
    return runFetchPublicPostDetail(auth, data)
  })

export const widgetFetchBoardCapabilitiesFn = createServerFn({ method: 'GET' }).handler(
  async () => {
    const { getOptionalWidgetAuth } = await import('../widget-auth')
    const { resolveWidgetPortalAccess } = await import('../widget-portal-gate')
    const { runFetchBoardCapabilities } = await import('../portal')
    const auth = await getOptionalWidgetAuth()
    const access = await resolveWidgetPortalAccess(auth)
    if (!access.granted) {
      return { permissions: {}, boards: [] }
    }
    return runFetchBoardCapabilities(auth)
  }
)
