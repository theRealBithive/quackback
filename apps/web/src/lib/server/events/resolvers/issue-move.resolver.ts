/**
 * Board-move resolver: a post that changed board takes its GitLab issue along.
 *
 * A board is a product and each product has its own GitLab project, so a post
 * moving between boards has to move between projects too — otherwise the
 * feedback sits with one product and the work on it with another.
 *
 * Two reads stand in front of the decision, and both can return nothing for
 * reasons that are not "nothing to do": the destination board's project lives
 * in a routing rule row rather than in a column, and the post's links are a
 * table of their own. `issue-move-policy.ts` holds the decision itself, with no
 * database in it.
 */
import {
  db,
  integrations,
  integrationEventMappings,
  postExternalLinks,
  eq,
  and,
} from '@/lib/server/db'
import { rulesFromMappings } from '@/lib/server/integrations/board-routing-policy'
import { buildIssueMoveTargets, type MoveCandidateLink } from './issue-move-policy'
import type { SinkResolver } from './registry'
import type { DomainEvent } from '../envelope'
import type { HookTarget } from '../hook-types'

/** The GitLab project registered for a board, or null when it has no rule. */
async function projectForBoard(boardId: string): Promise<string | null> {
  const rows = await db
    .select({
      targetKey: integrationEventMappings.targetKey,
      actionConfig: integrationEventMappings.actionConfig,
      filters: integrationEventMappings.filters,
    })
    .from(integrationEventMappings)
    .innerJoin(integrations, eq(integrationEventMappings.integrationId, integrations.id))
    .where(
      and(
        eq(integrations.integrationType, 'gitlab'),
        eq(integrations.status, 'active'),
        eq(integrationEventMappings.enabled, true),
        eq(integrationEventMappings.targetKey, boardId)
      )
    )

  const rule = rulesFromMappings(rows).find((r) => r.boardId === boardId)
  return rule ? rule.projectId : null
}

/** The post's active external links, in the shape the decision reads. */
async function activeLinks(postId: string): Promise<MoveCandidateLink[]> {
  const rows = await db
    .select({
      linkId: postExternalLinks.id,
      integrationId: postExternalLinks.integrationId,
      integrationType: postExternalLinks.integrationType,
      externalId: postExternalLinks.externalId,
      externalScope: postExternalLinks.externalScope,
    })
    .from(postExternalLinks)
    .where(
      and(eq(postExternalLinks.postId, postId as never), eq(postExternalLinks.status, 'active'))
    )
    .orderBy(postExternalLinks.id)

  return rows.map((r) => ({
    linkId: r.linkId,
    integrationId: r.integrationId,
    integrationType: r.integrationType,
    externalId: r.externalId,
    externalScope: r.externalScope,
  }))
}

export const issueMoveResolver: SinkResolver = {
  sink: 'gitlab_issue_move',
  interestedIn(type: string): boolean {
    return type === 'post.board_changed'
  },
  async resolve(event: DomainEvent): Promise<HookTarget[]> {
    const toBoardId = (event.payload as { toBoardId?: unknown } | undefined)?.toBoardId
    if (typeof toBoardId !== 'string') return []

    const links = await activeLinks(event.entityId)
    if (links.length === 0) return []

    const toProjectId = await projectForBoard(toBoardId)
    return buildIssueMoveTargets({ links, toProjectId })
  },
}
