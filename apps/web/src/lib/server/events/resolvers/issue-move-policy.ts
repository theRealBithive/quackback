/**
 * Which linked GitLab issue a board change moves, and where to.
 *
 * A board is a product and each product has its own GitLab project, so moving a
 * post between boards has to move its issue between projects. This module is
 * that decision on its own — no database, no HTTP — which is what lets the
 * guarantees be checked directly (see `__tests__/issue-move-policy.test.ts`).
 *
 * It is deliberately GitLab-only. The agreed scope is one tracker, and the
 * resolver already knows each link's type, so gating here is a readable line
 * rather than a registry lookup with a single implementer behind it.
 */
import type { HookTarget } from '../hook-types'

/** The sink that performs the move. Registered in `events/registry.ts`. */
export const GITLAB_ISSUE_MOVE_SINK = 'gitlab_issue_move'

/** One active external link, reduced to what the decision reads. */
export interface MoveCandidateLink {
  linkId: string
  /** Null for a sidebar link: no integration record, so no token to move with. */
  integrationId: string | null
  integrationType: string
  /** The issue's project-local number (GitLab's `iid`). */
  externalId: string
  /** The project the issue lives in. Null on links made before scoped links. */
  externalScope: string | null
}

/** Where one issue moves from and to. Serialised into the hook target. */
export interface IssueMoveTarget {
  linkId: string
  externalId: string
  fromProjectId: string
  toProjectId: string
}

/**
 * The targets for one board change.
 *
 * `toProjectId` is the project registered for the board the post moved TO, or
 * null when that board has no rule. A link is moved only when all of this
 * holds: it is a GitLab link, it has an integration to authenticate with, we
 * know which project it is in, and that project is not already the destination.
 * Everything else yields no target, which leaves the issue and the link exactly
 * as they were.
 */
export function buildIssueMoveTargets(params: {
  links: MoveCandidateLink[]
  toProjectId: string | null
}): HookTarget[] {
  const { links, toProjectId } = params
  if (toProjectId === null) return []

  const targets: HookTarget[] = []
  for (const link of links) {
    if (link.integrationType !== 'gitlab') continue
    if (!link.integrationId) continue

    const fromProjectId = link.externalScope
    if (fromProjectId === null) continue
    if (fromProjectId === toProjectId) continue

    const target: IssueMoveTarget = {
      linkId: link.linkId,
      externalId: link.externalId,
      fromProjectId,
      toProjectId,
    }
    targets.push({
      type: GITLAB_ISSUE_MOVE_SINK,
      target,
      config: { integrationId: link.integrationId },
      // The event id is already part of the job id, so keying per link is what
      // makes one board change move one issue exactly once.
      deliveryKey: `gitlab-issue-move:${link.linkId}`,
    })
  }
  return targets
}
