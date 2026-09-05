/**
 * The two reads the GitLab hook needs that its event does not carry.
 *
 * Issue creation moved from `post.created` to `post.status_changed`, and that
 * payload names only the post, its title and its board — no body, no author.
 * Widening it was the obvious fix and the wrong one: the same payload goes out
 * to customers' webhooks, so its shape is a public contract.
 *
 * So the hook reads the post instead. Keeping the reads here rather than
 * inline keeps `hook.ts` testable without a fake query builder, and keeps this
 * file small enough to test against a real database.
 */
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'gitlab-post-source' })

/** Everything an issue body is built from. */
export interface IssueSource {
  postId: string
  title: string
  content: string
  boardSlug: string
  authorName: string | null
  authorEmail: string | null
}

/** The post as an issue is written from it, or null if it is gone. */
export async function loadIssueSource(postId: string): Promise<IssueSource | null> {
  const { db, posts, boards, principal, eq } = await import('@/lib/server/db')

  const [row] = await db
    .select({
      title: posts.title,
      content: posts.content,
      boardSlug: boards.slug,
      authorName: principal.displayName,
      authorEmail: principal.contactEmail,
    })
    .from(posts)
    .innerJoin(boards, eq(posts.boardId, boards.id))
    .leftJoin(principal, eq(posts.principalId, principal.id))
    .where(eq(posts.id, postId as never))
    .limit(1)

  if (!row) {
    log.warn({ post_id: postId }, 'post is gone, not creating an issue for it')
    return null
  }

  return {
    postId,
    title: row.title,
    content: row.content,
    boardSlug: row.boardSlug,
    authorName: row.authorName ?? null,
    authorEmail: row.authorEmail ?? null,
  }
}

/**
 * Whether this post already has a live GitLab issue.
 *
 * The guard has to sit before the API call, not after it. `persistExternalLink`
 * dedupes with `onConflictDoNothing` on (externalId, integrationType, postId),
 * and a second issue has a *different* external id — so the conflict never
 * fires, the row is inserted happily, and the post ends up with two issues in
 * the tracker that nothing will ever reconcile.
 */
export async function hasActiveGitLabLink(postId: string): Promise<boolean> {
  const { db, postExternalLinks, eq, and } = await import('@/lib/server/db')

  const [existing] = await db
    .select({ id: postExternalLinks.id })
    .from(postExternalLinks)
    .where(
      and(
        eq(postExternalLinks.postId, postId as never),
        eq(postExternalLinks.integrationType, 'gitlab'),
        eq(postExternalLinks.status, 'active')
      )
    )
    .limit(1)

  return existing !== undefined
}
