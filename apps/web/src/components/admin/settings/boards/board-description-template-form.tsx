import { useState } from 'react'
import type { BoardId } from '@quackback/ids'
import { Button } from '@/components/ui/button'
import { FormError } from '@/components/shared/form-error'
import {
  EMPTY_POST_TEMPLATE,
  PostTemplateEditor,
} from '@/components/admin/settings/post-template-editor'
import { useUpdateBoard } from '@/lib/client/mutations'
import type { TiptapContent } from '@/lib/shared/db-types'

interface BoardDescriptionTemplateFormProps {
  boardId: BoardId
  template: TiptapContent | undefined
}

/**
 * The board's description template: what a new post on this board starts
 * with. Saving sends only this one setting; the server merges it into the
 * board's other settings.
 */
export function BoardDescriptionTemplateForm({
  boardId,
  template,
}: BoardDescriptionTemplateFormProps) {
  const mutation = useUpdateBoard()
  const [draft, setDraft] = useState<TiptapContent>(template ?? EMPTY_POST_TEMPLATE)

  function handleSave() {
    mutation.mutate({ id: boardId, settings: { descriptionTemplate: draft } })
  }

  return (
    <div className="space-y-4">
      {mutation.isError && <FormError message={mutation.error?.message ?? 'An error occurred'} />}

      <PostTemplateEditor
        value={draft}
        onChange={setDraft}
        placeholder="e.g. Steps to reproduce, what you expected, what happened instead…"
      />

      <div className="flex items-center justify-end gap-2">
        <Button type="button" onClick={handleSave} disabled={mutation.isPending}>
          {mutation.isPending ? 'Saving...' : 'Save template'}
        </Button>
      </div>
    </div>
  )
}
