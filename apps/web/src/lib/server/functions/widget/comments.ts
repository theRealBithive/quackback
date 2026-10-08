/**
 * Widget BFF for comments and reactions. Every write passes the private-portal
 * gate the portal site's wrappers apply, lifted only for a signed widget
 * identity (J22, `../widget-portal-gate.ts`).
 */
import { createServerFn } from '@tanstack/react-start'
import { createCommentSchema, reactionSchema } from '@/lib/shared/schemas/comments'

export const widgetCreateCommentFn = createServerFn({ method: 'POST' })
  .validator(createCommentSchema)
  .handler(async ({ data }) => {
    const { requireWidgetAuth } = await import('../widget-auth')
    const { resolveWidgetPortalAccess } = await import('../widget-portal-gate')
    const { runCreateComment } = await import('../comments')
    const auth = await requireWidgetAuth()
    const access = await resolveWidgetPortalAccess(auth)
    if (!access.granted) {
      throw new Error('Portal access required')
    }
    return runCreateComment(auth, data)
  })

export const widgetAddReactionFn = createServerFn({ method: 'POST' })
  .validator(reactionSchema)
  .handler(async ({ data }) => {
    const { requireWidgetAuth } = await import('../widget-auth')
    const { resolveWidgetPortalAccess } = await import('../widget-portal-gate')
    const { runAddReaction } = await import('../comments')
    const auth = await requireWidgetAuth()
    const access = await resolveWidgetPortalAccess(auth)
    if (!access.granted) {
      throw new Error('Portal access required')
    }
    return runAddReaction(auth, data)
  })

export const widgetRemoveReactionFn = createServerFn({ method: 'POST' })
  .validator(reactionSchema)
  .handler(async ({ data }) => {
    const { requireWidgetAuth } = await import('../widget-auth')
    const { resolveWidgetPortalAccess } = await import('../widget-portal-gate')
    const { runRemoveReaction } = await import('../comments')
    const auth = await requireWidgetAuth()
    const access = await resolveWidgetPortalAccess(auth)
    if (!access.granted) {
      throw new Error('Portal access required')
    }
    return runRemoveReaction(auth, data)
  })
