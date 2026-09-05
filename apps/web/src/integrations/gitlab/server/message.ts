/**
 * GitLab issue content building utilities.
 */

import type { EventData } from '@/lib/server/events/types'
import { stripHtml, truncate } from '@/lib/server/events/hook-utils'
import { buildPostUrl, getAuthorName } from '@/lib/server/integrations/message-utils'
import type { IssueSource } from '@/integrations/gitlab/server/post-source'

/**
 * Build issue title and description from the post itself.
 *
 * The one place the body is formatted. Two callers reach it with the same
 * fields from different places: `post.created` has them in its payload, and
 * `post.status_changed` — the trigger since per-board routing — carries only
 * the post's identity, so the hook reads the rest from the row.
 */
export function buildIssueContent(
  source: IssueSource,
  rootUrl: string
): { title: string; description: string } {
  const postUrl = buildPostUrl(rootUrl, source.boardSlug, source.postId)
  const content = truncate(stripHtml(source.content), 2000)
  const author = getAuthorName(source)

  const description = [
    `> Submitted by **${author}** via [Quackback](${postUrl})`,
    '',
    content,
    '',
    '---',
    `[View original feedback](${postUrl})`,
  ].join('\n')

  return { title: source.title, description }
}

/**
 * Build issue title and description for a GitLab issue.
 */
export function buildGitLabIssue(
  event: EventData,
  rootUrl: string
): {
  title: string
  description: string
} {
  if (event.type !== 'post.created') {
    return { title: '', description: '' }
  }

  const { post } = event.data
  return buildIssueContent(
    {
      postId: post.id,
      title: post.title,
      content: post.content,
      boardSlug: post.boardSlug,
      authorName: post.authorName ?? null,
      authorEmail: post.authorEmail ?? null,
    },
    rootUrl
  )
}
