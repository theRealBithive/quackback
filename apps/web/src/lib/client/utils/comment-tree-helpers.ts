/**
 * Shared recursive helpers for optimistic comment tree updates.
 */
import type { PostCommentId } from '@quackback/ids'

/** Minimal comment shape that both admin and portal comment types satisfy */
interface CommentNode {
  id: string
  parentId?: string | null
  content: string
  replies: CommentNode[]
}

/**
 * Recursively add a reply under the correct parent in a comment tree.
 */
export function addReplyToTree<T extends CommentNode>(
  comments: T[],
  parentId: string,
  reply: T
): T[] {
  return comments.map((comment) => {
    if (comment.id === parentId) {
      return { ...comment, replies: [...comment.replies, reply] }
    }
    if (comment.replies.length > 0) {
      return { ...comment, replies: addReplyToTree(comment.replies, parentId, reply) }
    }
    return comment
  })
}

/**
 * Recursively replace a temporary optimistic comment with real server data.
 */
export function replaceOptimisticInTree<T extends CommentNode>(
  comments: T[],
  optimisticPrefix: string,
  parentId: string | null,
  content: string,
  serverData: { id: PostCommentId; createdAt: Date | string }
): T[] {
  return comments.map((comment) => {
    if (comment.id.startsWith(optimisticPrefix)) {
      const sameParent = (comment.parentId || null) === (parentId || null)
      const sameContent = comment.content === content
      if (sameParent && sameContent) {
        const createdAt =
          typeof serverData.createdAt === 'string'
            ? serverData.createdAt
            : serverData.createdAt.toISOString()
        return { ...comment, id: serverData.id, createdAt }
      }
    }
    if (comment.replies.length > 0) {
      return {
        ...comment,
        replies: replaceOptimisticInTree(
          comment.replies,
          optimisticPrefix,
          parentId,
          content,
          serverData
        ),
      }
    }
    return comment
  })
}

/**
 * The server-reported comment total after one optimistic comment. A total the
 * server never reported stays unknown, so the heading keeps counting what is loaded.
 */
export function incrementKnownCount(count: number | undefined): number | undefined {
  if (count === undefined) return undefined
  return count + 1
}
