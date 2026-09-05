import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import type { BoardId, PostId, PostStatusId, PostTagId, PrincipalId } from '@quackback/ids'
import type { PostTag } from '@/lib/shared/db-types'
import { failureMessage } from '@/lib/client/failure-message'
import { inboxKeys } from '@/lib/client/hooks/use-inbox-query'
import { setPostEtaFn } from '@/lib/server/functions/posts'
import {
  useChangePostBoard,
  useChangePostStatusId,
  useUpdatePostOwner,
  useUpdatePostTags,
} from '@/lib/client/mutations'

export interface MetadataHandlers {
  isUpdating: boolean
  handleStatusChange: (statusId: PostStatusId) => Promise<void>
  handleTagsChange: (tagIds: PostTagId[]) => Promise<void>
  handleBoardChange: (boardId: BoardId) => Promise<void>
  handleOwnerChange: (ownerId: PrincipalId | null) => Promise<void>
  handleEtaChange: (eta: string | null) => Promise<void>
}

export function useMetadataHandlers(input: {
  postId: PostId
  allTags: PostTag[]
}): MetadataHandlers {
  const { postId, allTags } = input
  const queryClient = useQueryClient()
  const [isUpdating, setIsUpdating] = useState(false)

  const updateStatus = useChangePostStatusId()
  const updateTags = useUpdatePostTags()
  const changePostBoard = useChangePostBoard()
  const updateOwner = useUpdatePostOwner()

  const handleStatusChange = async (statusId: PostStatusId) => {
    setIsUpdating(true)
    try {
      await updateStatus.mutateAsync({ postId, statusId })
      toast.success('Status updated')
    } catch (err) {
      toast.error(failureMessage(err, 'Failed to update status'))
    } finally {
      setIsUpdating(false)
    }
  }

  // No confirmation on success: this fires once per ticked box.
  const handleTagsChange = async (tagIds: PostTagId[]) => {
    setIsUpdating(true)
    try {
      await updateTags.mutateAsync({ postId, tagIds, allTags })
    } catch (err) {
      toast.error(failureMessage(err, 'Failed to update tags'))
    } finally {
      setIsUpdating(false)
    }
  }

  const handleBoardChange = async (boardId: BoardId) => {
    setIsUpdating(true)
    try {
      await changePostBoard.mutateAsync({ postId, boardId })
      toast.success('Board updated')
    } catch (err) {
      toast.error(failureMessage(err, 'Failed to update board'))
    } finally {
      setIsUpdating(false)
    }
  }

  const handleOwnerChange = async (ownerId: PrincipalId | null) => {
    setIsUpdating(true)
    try {
      await updateOwner.mutateAsync({ postId, ownerId })
      toast.success(ownerId ? 'Owner assigned' : 'Owner unassigned')
    } catch (err) {
      toast.error(failureMessage(err, 'Failed to update owner'))
    } finally {
      setIsUpdating(false)
    }
  }

  const handleEtaChange = async (eta: string | null) => {
    setIsUpdating(true)
    try {
      await setPostEtaFn({ data: { id: postId, eta } })
      queryClient.invalidateQueries({ queryKey: inboxKeys.detail(postId) })
      toast.success(eta ? 'ETA updated' : 'ETA cleared')
    } catch (err) {
      toast.error(failureMessage(err, 'Failed to update ETA'))
    } finally {
      setIsUpdating(false)
    }
  }

  return {
    isUpdating,
    handleStatusChange,
    handleTagsChange,
    handleBoardChange,
    handleOwnerChange,
    handleEtaChange,
  }
}
