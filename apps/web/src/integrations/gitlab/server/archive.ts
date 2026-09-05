import {
  ARCHIVE_TIMEOUT_MS,
  handleErrorStatus,
  type ArchiveContext,
  type ArchiveResult,
} from '@/lib/server/integrations/archive'
import {
  extractGitLabProjectPath,
  gitlabApiBase,
  normalizeGitLabInstanceUrl,
} from '@/integrations/gitlab/server/url'
import { gitlabFetch } from '@/integrations/gitlab/server/fetch'

/**
 * The project to close the issue in.
 *
 * The recorded scope wins: it is the numeric project id the link row carries,
 * it follows the issue when it moves between projects, and it survives a
 * project being renamed. The path parsed out of the issue URL is the fallback
 * for links made before the scope was recorded — the API takes a numeric id
 * and a URL-encoded path equally.
 */
function projectFor(ctx: ArchiveContext): string | null {
  const recorded = ctx.externalScope
  if (typeof recorded === 'string' && recorded.length > 0) return recorded
  return extractGitLabProjectPath(ctx.externalUrl)
}

/** Close the linked GitLab issue on cascading post delete. */
export async function closeGitLabIssue(ctx: ArchiveContext): Promise<ArchiveResult> {
  const projectId = projectFor(ctx)
  if (!projectId) return { success: false, error: 'Cannot determine project for this link' }

  const response = await gitlabFetch(
    `${gitlabApiBase(instanceUrlFrom(ctx))}/projects/${encodeURIComponent(projectId)}/issues/${ctx.externalId}`,
    {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${ctx.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ state_event: 'close' }),
      timeoutMs: ARCHIVE_TIMEOUT_MS,
    }
  )

  const err = await handleErrorStatus(response, 'GitLab', 'closed')
  if (err) return err
  return { success: true, action: 'closed' }
}

function instanceUrlFrom(ctx: ArchiveContext): string {
  const stored = ctx.integrationConfig.instanceUrl
  if (typeof stored === 'string' && stored.trim()) {
    return normalizeGitLabInstanceUrl(stored)
  }
  if (ctx.externalUrl) {
    try {
      return new URL(ctx.externalUrl).origin
    } catch {
      // fall through to gitlab.com default
    }
  }
  return normalizeGitLabInstanceUrl(null)
}
