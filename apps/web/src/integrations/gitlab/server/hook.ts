/**
 * GitLab hook handler.
 * Creates issues in GitLab when events occur.
 */

import type { HookHandler, HookResult } from '@/lib/server/events/hook-types'
import type { EventData } from '@/lib/server/events/types'
import { isRetryableError } from '@/lib/server/events/hook-utils'
import { buildGitLabIssue, buildIssueContent } from '@/integrations/gitlab/server/message'
import { loadIssueSource, hasActiveGitLabLink } from '@/integrations/gitlab/server/post-source'
import { gitlabApiBase } from '@/integrations/gitlab/server/url'
import { gitlabFetch } from '@/integrations/gitlab/server/fetch'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'gitlab' })

export interface GitLabTarget {
  channelId: string // projectId stored as channelId for consistency
}

export interface GitLabConfig {
  accessToken: string
  rootUrl: string
  /** Origin of a self-hosted GitLab instance; omitted for gitlab.com. */
  instanceUrl?: string
}

/**
 * The issue body for this event, or null when there is nothing to create.
 *
 * `post.created` carries the post in its payload. `post.status_changed` — the
 * trigger since per-board routing — names only the post, its title and its
 * board, so the body and the author are read from the row. Widening that
 * payload instead was rejected: it goes out to customers' webhooks, so its
 * shape is a public contract.
 */
async function issueContentFor(
  event: EventData,
  rootUrl: string
): Promise<{ title: string; description: string } | null> {
  if (event.type === 'post.created') return buildGitLabIssue(event, rootUrl)

  const postId = (event.data as { post?: { id?: string } } | undefined)?.post?.id
  if (!postId) return null

  const source = await loadIssueSource(postId)
  if (!source) return null
  return buildIssueContent(source, rootUrl)
}

export const gitlabHook: HookHandler = {
  async run(event: EventData, target: unknown, config: unknown): Promise<HookResult> {
    if (event.type !== 'post.created' && event.type !== 'post.status_changed') {
      return { success: true }
    }

    const postId = (event.data as { post?: { id?: string } } | undefined)?.post?.id
    if (!postId) return { success: true }

    const { channelId: projectId } = target as GitLabTarget
    const { accessToken, rootUrl, instanceUrl } = config as GitLabConfig
    const api = gitlabApiBase(instanceUrl)

    log.debug({ event_type: event.type, project_id: projectId }, 'processing event')

    // Before the API call, never after it. `persistExternalLink` dedupes on
    // (externalId, integrationType, postId) and a second issue has a different
    // external id, so a late check finds no conflict and leaves two issues in
    // the tracker for one post.
    if (await hasActiveGitLabLink(postId)) {
      log.info({ post_id: postId, project_id: projectId }, 'post already has an issue, skipping')
      return { success: true }
    }

    const content = await issueContentFor(event, rootUrl)
    if (!content) return { success: true }
    const { title, description } = content

    try {
      const response = await gitlabFetch(
        `${api}/projects/${encodeURIComponent(projectId)}/issues`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ title, description }),
        }
      )

      if (!response.ok) {
        const errorBody = await response.text()
        const status = response.status

        if (status === 401 || status === 403) {
          log.error({ status_code: status, project_id: projectId, body: errorBody }, 'auth error')
          return {
            success: false,
            error: `Authentication failed (${status}). Please reconnect GitLab.`,
            shouldRetry: false,
          }
        }

        if (status === 429) {
          log.warn({ status_code: status, project_id: projectId, body: errorBody }, 'rate limited')
          return { success: false, error: 'Rate limited', shouldRetry: true }
        }

        log.error({ status_code: status, project_id: projectId, body: errorBody }, 'api error')
        return {
          success: false,
          error: `GitLab API error: ${status}`,
          shouldRetry: status >= 500,
        }
      }

      const data = (await response.json()) as { iid: number; web_url: string }
      log.info({ issue_iid: data.iid, project_id: projectId }, 'issue created')

      return { success: true, externalId: String(data.iid), externalUrl: data.web_url }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error'
      log.error({ err: error, project_id: projectId }, 'issue creation failed')

      return {
        success: false,
        error: errorMsg,
        shouldRetry: isRetryableError(error),
      }
    }
  },

  async testConnection(config: unknown): Promise<{ ok: boolean; error?: string }> {
    const { accessToken, instanceUrl } = config as GitLabConfig
    try {
      const response = await gitlabFetch(`${gitlabApiBase(instanceUrl)}/user`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      })
      return { ok: response.ok, error: response.ok ? undefined : `HTTP ${response.status}` }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : 'Connection failed' }
    }
  },
}
