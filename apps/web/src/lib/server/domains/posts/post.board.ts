/**
 * Post Board Service
 *
 * Handles moving a post from one board to another.
 */

import { db, posts, boards, eq, and, isNull } from '@/lib/server/db'
import { type PostId, type BoardId, type UserId, type PrincipalId } from '@quackback/ids'
import { NotFoundError } from '@/lib/shared/errors'
import { createActivity } from '@/lib/server/domains/activity/activity.service'
import { emit } from '@/lib/server/events/emit'
import { postBoardChanged } from '@/lib/server/events/catalogue/post'
import type { ChangeBoardResult } from './post.types'

/**
 * Move a post to a different board.
 *
 * Note: Authorization is handled at the action layer before calling this function.
 */
export async function changeBoard(
  postId: PostId,
  newBoardId: BoardId,
  actor: {
    principalId: PrincipalId
    userId?: UserId
    email?: string
    displayName?: string
  }
): Promise<ChangeBoardResult> {
  const existingPost = await db.query.posts.findFirst({ where: eq(posts.id, postId) })
  if (!existingPost) {
    throw new NotFoundError('POST_NOT_FOUND', `Post with ID ${postId} not found`)
  }

  if (existingPost.boardId === newBoardId) {
    return existingPost
  }

  const [currentBoard, newBoard] = await Promise.all([
    db.query.boards.findFirst({ where: eq(boards.id, existingPost.boardId) }),
    db.query.boards.findFirst({
      where: and(eq(boards.id, newBoardId), isNull(boards.deletedAt)),
    }),
  ])

  if (!currentBoard) {
    throw new NotFoundError('BOARD_NOT_FOUND', `Board with ID ${existingPost.boardId} not found`)
  }
  if (!newBoard) {
    throw new NotFoundError('BOARD_NOT_FOUND', `Board with ID ${newBoardId} not found`)
  }

  // The move and the event it raises commit together. A post whose board
  // changed without an event would keep its issue in the old product's GitLab
  // project with nothing left to notice, so the two must not be able to come
  // apart. This is the in-transaction `emit()` that `emitBestEffort`'s own
  // docstring asks callers with a transaction to prefer.
  const updatedPost = await db.transaction(async (tx) => {
    const [row] = await tx
      .update(posts)
      .set({ boardId: newBoardId })
      .where(eq(posts.id, postId))
      .returning()

    if (!row) {
      throw new NotFoundError('POST_NOT_FOUND', `Post with ID ${postId} not found`)
    }

    await emit(tx, postBoardChanged, {
      payload: {
        post: {
          id: row.id,
          title: row.title,
          boardId: newBoard.id,
          boardSlug: newBoard.slug,
        },
        fromBoardId: currentBoard.id,
        toBoardId: newBoard.id,
      },
      actor: { type: 'user', id: actor.principalId },
      entityId: row.id,
      context: { source: 'admin' },
    })

    return row
  })

  // Deliberately outside the transaction and deliberately not awaited, as it
  // was before: `createActivity` is fire-and-forget by contract, and making a
  // failed timeline row fail the board move is a behaviour change nobody asked
  // for. The event above is the durable record.
  createActivity({
    postId,
    principalId: actor.principalId,
    type: 'post.board_changed',
    metadata: {
      fromBoardId: currentBoard.id,
      fromBoardName: currentBoard.name,
      toBoardId: newBoard.id,
      toBoardName: newBoard.name,
    },
  })

  return updatedPost
}
