/**
 * The `gitlab_issue_move` sink: move one linked issue into another project.
 *
 * A board is a product, so a post moving between boards moves between GitLab
 * projects too. `POST /projects/:id/issues/:iid/move` copies the issue and its
 * discussion into the target, closes the original and links the two — the
 * behaviour we want, without deleting anything (deleting needs Owner rights and
 * takes comments and cross-references with it).
 *
 * The issue's number is project-local, so a successful move hands back a NEW
 * `iid` and the link row has to be rewritten onto it. That rewrite is a single
 * UPDATE on purpose: a post that had one active link before the move has one
 * after it whatever happens (V13), and a delete-then-insert would be a window
 * where it has none.
 *
 * Which link is moved, and whether at all, was decided by
 * `events/resolvers/issue-move-policy.ts`. This module only performs it.
 */
import type { HookHandler, HookResult } from '@/lib/server/events/hook-types'
import type { IntegrationId } from '@quackback/ids'
import { isRetryableError } from '@/lib/server/events/hook-utils'
import { gitlabApiBase } from '@/integrations/gitlab/server/url'
import { gitlabFetch } from '@/integrations/gitlab/server/fetch'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'gitlab-issue-move' })

/** Set by `buildIssueMoveTargets`; see `IssueMoveTarget` there. */
interface MoveTarget {
  linkId: string
  externalId: string
  fromProjectId: string
  toProjectId: string
}

/** The fields of GitLab's move response this depends on. */
interface MovedIssue {
  iid?: number
  project_id?: number
  web_url?: string
}

export const gitlabIssueMoveHook: HookHandler = {
  async run(_event, target, config): Promise<HookResult> {
    const { linkId, externalId, fromProjectId, toProjectId } = target as MoveTarget
    const integrationId = config.integrationId as string | undefined
    if (!integrationId) return { success: false, error: 'missing integrationId' }

    const { getValidAccessToken } = await import('@/lib/server/integrations/token-refresh')
    const accessToken = await getValidAccessToken(integrationId as IntegrationId)
    if (!accessToken) return { success: false, error: 'no access token' }

    const { db, integrations, eq } = await import('@/lib/server/db')
    const integration = await db.query.integrations.findFirst({
      where: eq(integrations.id, integrationId as IntegrationId),
    })
    const instanceUrl = (integration?.config as { instanceUrl?: string } | null)?.instanceUrl
    const api = gitlabApiBase(instanceUrl)

    let moved: MovedIssue
    try {
      const response = await gitlabFetch(
        `${api}/projects/${encodeURIComponent(fromProjectId)}/issues/${encodeURIComponent(externalId)}/move`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ to_project_id: toProjectId }),
        }
      )

      if (!response.ok) return failureFor(response.status, await response.text(), target)

      moved = (await response.json()) as MovedIssue
    } catch (error) {
      log.error({ err: error, link_id: linkId, to_project_id: toProjectId }, 'issue move threw')
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        shouldRetry: isRetryableError(error),
      }
    }

    if (typeof moved.iid !== 'number') {
      // Nothing to point the link at. Reporting a failure is better than
      // writing half a move, and the issue itself did move, so a retry would
      // be refused by GitLab rather than duplicate anything.
      log.error({ link_id: linkId, to_project_id: toProjectId }, 'move answered without an iid')
      return { success: false, error: 'GitLab answered the move without an issue number' }
    }

    const newExternalId = String(moved.iid)
    const newScope = moved.project_id === undefined ? toProjectId : String(moved.project_id)
    await rewriteLink(linkId, {
      externalId: newExternalId,
      externalScope: newScope,
      externalUrl: moved.web_url ?? null,
      fromProjectId,
      toProjectId,
    })

    log.info(
      { link_id: linkId, from_project_id: fromProjectId, to_project_id: toProjectId },
      'issue moved'
    )
    return { success: true, externalId: newExternalId, externalUrl: moved.web_url }
  },
}

/** Map a rejected move onto a hook result. */
function failureFor(status: number, body: string, target: unknown): HookResult {
  const { linkId, toProjectId } = target as MoveTarget
  log.warn(
    { status_code: status, link_id: linkId, to_project_id: toProjectId, body },
    'move refused'
  )

  if (status === 401 || status === 403) {
    return { success: false, error: `Authentication failed (${status})`, authExpired: true }
  }
  // 400 is GitLab declining the move itself — already moved, or a target that
  // takes no issues. A retry cannot change either.
  return {
    success: false,
    error: `GitLab API ${status}: ${body.slice(0, 200)}`,
    shouldRetry: status === 429 || status >= 500,
  }
}

/**
 * Point the link at the issue in its new project, and say so on the post.
 *
 * One UPDATE, so the link is never absent in between; the post id comes back
 * from it rather than from a second read.
 */
async function rewriteLink(
  linkId: string,
  next: {
    externalId: string
    externalScope: string
    externalUrl: string | null
    fromProjectId: string
    toProjectId: string
  }
): Promise<void> {
  const { db, postExternalLinks, postActivity, eq } = await import('@/lib/server/db')

  const [updated] = await db
    .update(postExternalLinks)
    .set({
      externalId: next.externalId,
      externalScope: next.externalScope,
      externalUrl: next.externalUrl,
    })
    .where(eq(postExternalLinks.id, linkId as never))
    .returning({ postId: postExternalLinks.postId })

  if (!updated) return

  await db.insert(postActivity).values({
    postId: updated.postId,
    type: 'external.issue_moved',
    metadata: {
      integrationType: 'gitlab',
      fromProjectId: next.fromProjectId,
      toProjectId: next.toProjectId,
      externalId: next.externalId,
      externalUrl: next.externalUrl,
    },
  })
}
