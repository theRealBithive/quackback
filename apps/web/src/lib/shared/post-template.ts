/**
 * Description templates: the text a post's description editor starts with,
 * like a GitHub issue template. A template is a suggestion of what the team
 * would like to know, never a requirement — nothing here validates a post
 * against it.
 *
 * A board may carry its own template; the workspace may carry a default for
 * boards that do not. Every form that creates a post resolves the template
 * through {@link resolvePostTemplate}, so the same board shows the same
 * template everywhere.
 */
import type { TiptapContent } from '@/lib/shared/db-types'
import { tiptapContentSchema } from '@/lib/shared/schemas/posts'
import { isEmptyTiptapDoc } from '@/lib/shared/utils/is-empty-tiptap-doc'

/** Upper bound on a stored template, measured as its serialized JSON. */
export const POST_TEMPLATE_MAX_LENGTH = 20_000

export const POST_TEMPLATE_TOO_LONG_MESSAGE = `Template must be ${POST_TEMPLATE_MAX_LENGTH} characters or less once saved`

function fitsTemplateLimit(doc: TiptapContent): boolean {
  const serializedLength = JSON.stringify(doc).length
  return serializedLength <= POST_TEMPLATE_MAX_LENGTH
}

/** Shape check for a template at the server boundary. Rejects, never truncates. */
export const postTemplateSchema = tiptapContentSchema.refine(fitsTemplateLimit, {
  message: POST_TEMPLATE_TOO_LONG_MESSAGE,
})

/** The editor's document as the forms hold it; `null` is the empty form. */
export type DescriptionDoc = {
  type?: string
  text?: string
  content?: DescriptionDoc[]
  marks?: { type: string }[]
  attrs?: Record<string, unknown>
}

function hasVisibleContent(doc: TiptapContent | undefined): doc is TiptapContent {
  return !isEmptyTiptapDoc(doc)
}

/**
 * The template a new post on this board starts with: the board's own when it
 * has one with visible text, otherwise the workspace default, otherwise none.
 */
export function resolvePostTemplate(
  boardTemplate: TiptapContent | undefined,
  workspaceTemplate: TiptapContent | undefined
): TiptapContent | undefined {
  if (hasVisibleContent(boardTemplate)) return boardTemplate
  if (hasVisibleContent(workspaceTemplate)) return workspaceTemplate
  return undefined
}

/**
 * What a reader sees of a document: node types, text and mark types.
 * Attributes are left out because the editor fills in defaults (alignment,
 * heading ids, link targets) that a stored template does not carry, so an
 * untouched template would otherwise never compare equal to itself.
 */
function visibleOutline(node: DescriptionDoc): unknown {
  const marks = node.marks ?? []
  const markTypes = marks.map((mark) => mark.type).sort()
  const children = node.content ?? []
  const childOutlines = children.map(visibleOutline)
  return { type: node.type, text: node.text, marks: markTypes, content: childOutlines }
}

export function hasSameVisibleContent(first: DescriptionDoc, second: DescriptionDoc): boolean {
  const firstOutline = JSON.stringify(visibleOutline(first))
  const secondOutline = JSON.stringify(visibleOutline(second))
  return firstOutline === secondOutline
}

/**
 * May the description be replaced by another board's template? Only while the
 * author has not written anything of their own: it is empty, or it still reads
 * exactly like the template that was put there.
 */
export function mayReplaceDescription(
  description: DescriptionDoc | null,
  insertedTemplate: DescriptionDoc | undefined
): boolean {
  const descriptionDoc = (description ?? undefined) as TiptapContent | undefined
  if (isEmptyTiptapDoc(descriptionDoc)) return true
  if (insertedTemplate === undefined) return false
  return hasSameVisibleContent(description, insertedTemplate)
}
