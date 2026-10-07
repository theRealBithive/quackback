/**
 * The widget's projection of a board. The contract is listed in full in
 * `lib/shared/__tests__/post-template.test.ts`; this suite holds:
 *
 *   V8  For the same board, portal, widget and admin dialog show the same template.
 *   V10 Only someone allowed to manage the board can change its template; only
 *       someone allowed to manage settings can change the workspace default.
 *       Readers see a board's template only for boards they are allowed to see.
 *
 * The widget builds its board list in two places — the SSR loader and the
 * refetch after identify — and both go through this one function, so a
 * template on first paint is still there after sign-in.
 */
import { describe, it, expect } from 'vitest'
import type { BoardSettings, TiptapContent } from '@/lib/shared/db-types'
import { toWidgetVisibleBoard } from '../widget-visible-board'

const TEMPLATE: TiptapContent = {
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Steps to reproduce:' }] }],
}

describe('a board as the widget sees it', () => {
  it('carries the board template to the widget (V8)', () => {
    const board = {
      id: 'board_1',
      name: 'Bugs',
      slug: 'bugs',
      settings: { descriptionTemplate: TEMPLATE } as BoardSettings,
    }
    expect(toWidgetVisibleBoard(board)).toEqual({
      id: 'board_1',
      name: 'Bugs',
      slug: 'bugs',
      descriptionTemplate: TEMPLATE,
    })
  })

  it('carries no other board setting to the widget (V10)', () => {
    const board = {
      id: 'board_1',
      name: 'Bugs',
      slug: 'bugs',
      settings: {
        descriptionTemplate: TEMPLATE,
        roadmapStatusIds: ['status_1'],
        customFields: [],
      } as unknown as BoardSettings,
    }
    expect(Object.keys(toWidgetVisibleBoard(board)).sort()).toEqual([
      'descriptionTemplate',
      'id',
      'name',
      'slug',
    ])
  })

  it('has no template for a board without settings (V3)', () => {
    const board = { id: 'board_1', name: 'Ideas', slug: 'ideas', settings: null }
    expect(toWidgetVisibleBoard(board).descriptionTemplate).toBeUndefined()
  })
})
