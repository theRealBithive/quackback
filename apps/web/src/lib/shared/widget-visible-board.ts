import type { BoardSettings } from '@/lib/shared/db-types'

/** A board as the widget composer and feed see it. */
export type WidgetVisibleBoard = {
  id: string
  name: string
  slug: string
  /** The board's own description template; the widget resolves the fallback. */
  descriptionTemplate?: BoardSettings['descriptionTemplate']
}

interface BoardForWidget {
  id: string
  name: string
  slug: string
  settings?: BoardSettings | null
}

/**
 * The one projection of a board for the widget. The widget builds its board
 * list twice — in the SSR loader and again after identify — and both must carry
 * the same fields, or a template shown on first paint vanishes after sign-in.
 */
export function toWidgetVisibleBoard(board: BoardForWidget): WidgetVisibleBoard {
  return {
    id: String(board.id),
    name: board.name,
    slug: board.slug,
    descriptionTemplate: board.settings?.descriptionTemplate,
  }
}
