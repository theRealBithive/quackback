import { useCallback, useEffect, useRef } from 'react'
import type { TiptapContent } from '@/lib/shared/db-types'
import {
  hasSameVisibleContent,
  mayReplaceDescription,
  type DescriptionDoc,
} from '@/lib/shared/post-template'

interface PostTemplatePrefillOptions<Doc> {
  /** The resolved template of the selected board (see `resolvePostTemplate`). */
  template: TiptapContent | undefined
  /** The description as the form currently holds it. */
  description: Doc | null
  /** Writes the description. Must be stable (a state setter or a memoized callback). */
  setDescription: (next: Doc | null) => void
}

function isSameTemplate(
  previous: TiptapContent | undefined,
  next: TiptapContent | undefined
): boolean {
  if (previous === undefined || next === undefined) return previous === next
  return hasSameVisibleContent(previous, next)
}

/**
 * Puts the selected board's template into a post form's description.
 *
 * When the template changes (another board was picked, or the settings
 * arrived), the description is replaced only while the author has not written
 * anything of their own. `reset` restores the template, for a form that was
 * just submitted or cancelled.
 */
export function usePostTemplatePrefill<Doc extends DescriptionDoc>({
  template,
  description,
  setDescription,
}: PostTemplatePrefillOptions<Doc>): { reset: () => void } {
  // Two different things: the template of the board selected last time the
  // effect ran (to notice a change), and the template last put into the
  // description (to tell whether the author has touched it). They part ways
  // as soon as a board switch keeps the author's text.
  const selectedTemplateRef = useRef<TiptapContent | undefined>(undefined)
  const insertedTemplateRef = useRef<TiptapContent | undefined>(undefined)
  const descriptionRef = useRef(description)
  descriptionRef.current = description

  useEffect(() => {
    const templateChanged = !isSameTemplate(selectedTemplateRef.current, template)
    selectedTemplateRef.current = template
    if (!templateChanged) return
    if (!mayReplaceDescription(descriptionRef.current, insertedTemplateRef.current)) return

    insertedTemplateRef.current = template
    setDescription((template as Doc | undefined) ?? null)
  }, [template, setDescription])

  const reset = useCallback(() => {
    insertedTemplateRef.current = template
    setDescription((template as Doc | undefined) ?? null)
  }, [template, setDescription])

  return { reset }
}
