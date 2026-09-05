/**
 * Integration sink resolver (EVENTING-V2 WO-8b) — the DomainEvent-native port of
 * getIntegrationTargets(). Reads the cached integration_event_mappings, applies
 * the board filter, dedupes by (integrationType, channelId), decrypts the
 * per-integration access token, and emits one target per channel. Behavior +
 * target shape are preserved; only the event access (payload vs data) changes.
 */
import { db, integrations, integrationEventMappings, posts, eq, and } from '@/lib/server/db'
import { cacheGet, cacheSet, CACHE_KEYS } from '@/lib/server/cache'
import { decryptSecrets } from '@/lib/server/integrations/encryption'
import { buildHookContext } from '../hook-context'
import { logger } from '@/lib/server/logger'
import { getEventDefinition } from '../catalogue'
import { boardIdsFromEvent } from './webhook.resolver'
import type { SinkResolver } from './registry'
import type { DomainEvent } from '../envelope'
import type { HookTarget } from '../hook-types'

const log = logger.child({ component: 'integration-resolver' })

export interface CachedMapping {
  eventType: string
  integrationType: string
  /** Integration row id — lets the worker refresh an expired token by id. */
  integrationId?: string
  secrets: string | null
  integrationConfig: unknown
  actionConfig: unknown
  filters: unknown
}

async function loadMappings(): Promise<CachedMapping[]> {
  const cached = await cacheGet<CachedMapping[]>(CACHE_KEYS.INTEGRATION_MAPPINGS)
  if (cached) return cached
  const rows = await db
    .select({
      eventType: integrationEventMappings.eventType,
      integrationType: integrations.integrationType,
      integrationId: integrations.id,
      secrets: integrations.secrets,
      integrationConfig: integrations.config,
      actionConfig: integrationEventMappings.actionConfig,
      filters: integrationEventMappings.filters,
    })
    .from(integrationEventMappings)
    .innerJoin(integrations, eq(integrationEventMappings.integrationId, integrations.id))
    .where(and(eq(integrationEventMappings.enabled, true), eq(integrations.status, 'active')))
  await cacheSet(CACHE_KEYS.INTEGRATION_MAPPINGS, rows, 300)
  return rows
}

interface MappingFilters {
  boardIds?: string[]
  statusIds?: string[]
}

/**
 * A mapping that names statuses is a per-board routing rule: it says which
 * project this one board's issues belong in. Nothing else writes `statusIds`,
 * which is what makes it a safe discriminator — chat mappings are unaffected
 * by everything that keys off it.
 */
function isBoardRoutingRule(filters: MappingFilters | null): boolean {
  return (filters?.statusIds?.length ?? 0) > 0
}

/**
 * Whether a mapping's board filter lets this event through.
 *
 * No board filter matches every board — that is how one chat channel
 * subscribes to a whole instance. A board filter matches when the event names
 * one of its boards.
 *
 * The third case is the one that matters. An event that names no board at all
 * passes every board filter, and for chat that is deliberate: a conversation
 * or ticket event has no board, and a channel filtered to a board should keep
 * receiving them. A routing rule must not get that exception. It names the one
 * project this board's issues belong in, so "no board" would mean "every
 * project" — one post opening an issue in every product's tracker, which is
 * what the code did before this line existed.
 */
function boardFilterAllows(filters: MappingFilters | null, boardIds: string[]): boolean {
  const declared = filters?.boardIds
  if (!declared?.length) return true
  if (boardIds.some((id) => declared.includes(id))) return true
  if (isBoardRoutingRule(filters)) return false
  return boardIds.length === 0
}

/**
 * Whether a mapping's status filter lets this event through.
 *
 * Only a routing rule declares one, and it decides *when* an issue is created:
 * on reaching a triage status, not on the post arriving. An unknown status is
 * not a wildcard — a rule that names statuses and cannot see one matches
 * nothing.
 *
 * The value compared is the status **id**, read from the post row. The event
 * payload carries the status *name*, and matching on that would mean renaming
 * a status silently stops a board from creating issues (V7).
 */
function statusFilterAllows(filters: MappingFilters | null, statusId: string | undefined): boolean {
  const declared = filters?.statusIds
  if (!declared?.length) return true
  if (!statusId) return false
  return declared.includes(statusId)
}

/**
 * Pure target construction (unit-testable): filter mappings for this event type,
 * apply the board and status filters, dedupe by (integrationType, channelId),
 * decrypt the token via the injected `decrypt`.
 *
 * `statusId` is the post's current status id, or undefined for an event that
 * has no post status. Mappings that declare no `statusIds` ignore it, so every
 * provider that predates per-board routing behaves exactly as before.
 */
export function buildIntegrationTargets(
  mappings: CachedMapping[],
  eventType: string,
  boardIds: string[],
  rootUrl: string,
  decrypt: (blob: string) => { accessToken?: string },
  statusId?: string
): HookTarget[] {
  const targets: HookTarget[] = []
  const seen = new Set<string>()

  for (const m of mappings) {
    if (m.eventType !== eventType) continue

    const filters = m.filters as MappingFilters | null
    if (!boardFilterAllows(filters, boardIds)) continue
    if (!statusFilterAllows(filters, statusId)) continue

    const integrationConfig = (m.integrationConfig as Record<string, unknown>) || {}
    const actionConfig = (m.actionConfig as Record<string, unknown>) || {}
    const channelId = (actionConfig.channelId || integrationConfig.channelId) as string | undefined
    if (!channelId) {
      log.warn({ integration_type: m.integrationType }, 'no channel id for integration, skipping')
      continue
    }

    const dedupeKey = `${m.integrationType}:${channelId}`
    if (seen.has(dedupeKey)) continue
    seen.add(dedupeKey)

    let accessToken: string | undefined
    if (m.secrets) {
      try {
        accessToken = decrypt(m.secrets).accessToken
      } catch (error) {
        log.error(
          { err: error, integration_type: m.integrationType },
          'failed to decrypt integration secrets'
        )
        continue
      }
    }

    // Inbound-only fields stay on the integration row; they must not ride
    // along in hook jobs (webhookSecret especially). Everything else — Jira
    // cloudId/siteUrl, Azure org name — is what the outbound hook needs.
    const {
      webhookSecret: _webhookSecret,
      statusMappings: _statusMappings,
      statusSyncEnabled: _statusSyncEnabled,
      externalWebhookId: _externalWebhookId,
      ...hookConfig
    } = integrationConfig

    targets.push({
      type: m.integrationType,
      target: { channelId },
      config: {
        ...hookConfig,
        accessToken,
        rootUrl,
        ...(m.integrationId ? { integrationId: m.integrationId } : {}),
      },
    })
  }

  return targets
}

/**
 * The post's current status id, read from the row.
 *
 * Deliberately not from the payload: `post.status_changed` carries the status
 * *name* (`newStatus`), and a rule that matched on a name would stop working
 * the moment someone renames a status in the admin UI — silently, because
 * nothing fails, issues just stop being created (V7).
 *
 * Only called when some mapping actually declares `statusIds`, so an instance
 * with no per-board routing keeps dispatching without an extra query.
 */
async function currentStatusId(event: DomainEvent): Promise<string | undefined> {
  if (event.entityType !== 'post') return undefined
  const [post] = await db
    .select({ statusId: posts.statusId })
    .from(posts)
    .where(eq(posts.id, event.entityId as never))
    .limit(1)
  return post?.statusId ?? undefined
}

/** Private comments never reach external integrations. */
function isPrivateComment(event: DomainEvent): boolean {
  if (
    event.type !== 'comment.created' &&
    event.type !== 'comment.updated' &&
    event.type !== 'comment.deleted'
  ) {
    return false
  }
  return (event.payload as { comment?: { isPrivate?: boolean } }).comment?.isPrivate === true
}

export const integrationResolver: SinkResolver = {
  sink: 'integration',
  // Any type with at least one active mapping is interesting. The cheap
  // pre-filter can't know mappings without a query, so accept all types; the
  // mapping filter in resolve() is the real gate (mirrors the monolith, which
  // also queried unconditionally). Private-comment types short-circuit below.
  interestedIn(type: string): boolean {
    return getEventDefinition(type) !== undefined
  },
  async resolve(event: DomainEvent): Promise<HookTarget[]> {
    if (isPrivateComment(event)) return []
    const mappings = await loadMappings()
    const relevant = mappings.filter((m) => m.eventType === event.type)
    if (relevant.length === 0) return []
    const context = await buildHookContext()
    if (!context) throw new Error('Failed to build integration hook context')
    const anyRuleFiltersByStatus = relevant.some(
      (m) => ((m.filters as MappingFilters | null)?.statusIds?.length ?? 0) > 0
    )
    const statusId = anyRuleFiltersByStatus ? await currentStatusId(event) : undefined
    return buildIntegrationTargets(
      relevant,
      event.type,
      boardIdsFromEvent(event),
      context.portalBaseUrl,
      (blob) => decryptSecrets<{ accessToken?: string }>(blob),
      statusId
    )
  },
}
