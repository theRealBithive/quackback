/**
 * The private-portal gate on the widget's own endpoints.
 *
 * Upstream #572 moved the portal-access check out of the shared `run*`
 * helpers into the portal site's wrappers, so a widget visitor identified by
 * the host app could post on a private portal without portal access of its
 * own. That also dropped the gate for every other widget caller: a page with
 * no widget session, an anonymous widget visitor, and a session whose identity
 * the host app never signed. This fork lifts the gate only where #572 meant it
 * to (contract J22): the widget secret vouched for who the visitor is.
 *
 * Trust boundary (OWASP A01, broken access control): the Bearer token and the
 * workspace's private-portal setting both arrive with the request. The check
 * sits in each widget BFF wrapper (`functions/widget/*.ts`) and in the four
 * visitor gates of `conversation.ts`, before any `run*` helper reads data.
 *
 * No static server imports: `conversation.ts` and the widget BFF modules load
 * this file, and both are part of the client graph.
 */
import type { AuthContext } from './auth-helpers'
import type { PortalAccessDecision } from './portal-access'

/** The part of an auth context the gate decision reads. */
type WidgetGateCaller = Pick<AuthContext, 'scope' | 'signedWidgetIdentity'>

/**
 * Whether the private-portal gate is lifted for this caller: only a widget
 * session whose identity the host app signed. No caller, a portal or dashboard
 * session, an anonymous widget visitor and an unsigned identity all meet the
 * gate exactly as on the portal site.
 */
export function isPortalGateLiftedForWidget(caller: WidgetGateCaller | null): boolean {
  if (caller === null) return false
  if (caller.scope !== 'widget') return false
  return caller.signedWidgetIdentity === true
}

/**
 * The portal-access decision for a widget endpoint: granted outright for a
 * signed widget identity, otherwise the same resolver the portal site runs.
 */
export async function resolveWidgetPortalAccess(
  caller: WidgetGateCaller | null
): Promise<PortalAccessDecision> {
  if (isPortalGateLiftedForWidget(caller)) {
    return { granted: true, reason: 'widget' }
  }
  const { resolvePortalAccessForRequest } = await import('./portal-access')
  return resolvePortalAccessForRequest()
}

/**
 * Whether a session was minted by a signed widget identify: it has a
 * `widget_identified_session` row with `hmac_verified = true`. A missing row,
 * an unverified row and a failed lookup all answer false, so an outage never
 * lifts the gate and never earns a portal session.
 *
 * The one place this is decided: the widget endpoints ask it before lifting
 * the private-portal gate (J22), and the widget-to-portal handoff asks it
 * before installing a portal session (J11).
 */
export async function hasSignedWidgetIdentity(sessionId: string): Promise<boolean> {
  try {
    const { db, widgetIdentifiedSession, eq } = await import('@/lib/server/db')
    const row = await db.query.widgetIdentifiedSession.findFirst({
      where: eq(widgetIdentifiedSession.sessionId, sessionId),
      columns: { hmacVerified: true },
    })
    return row?.hmacVerified === true
  } catch (error) {
    const { logger } = await import('@/lib/server/logger')
    logger
      .child({ component: 'widget-signed-identity' })
      .error({ err: error }, 'signed identity lookup failed; treating the session as unsigned')
    return false
  }
}
