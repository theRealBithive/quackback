// @vitest-environment happy-dom
/**
 * The board settings card that edits a board's description template. The
 * contract is listed in full in `lib/shared/__tests__/post-template.test.ts`;
 * this suite holds the client half of:
 *
 *   V11 Saving a board's template never discards the board's other settings
 *       (roadmap statuses, custom fields).
 *
 * The server merges whatever settings it is sent, so the card must send the
 * template and nothing else — a stale copy of the other settings sent along
 * would overwrite a change made elsewhere since the page loaded.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { TiptapContent } from '@/lib/shared/db-types'
import type { BoardId } from '@quackback/ids'

const updateBoard = vi.hoisted(() => ({ mutate: vi.fn() }))

vi.mock('@/lib/client/mutations', () => ({
  useUpdateBoard: () => ({
    mutate: updateBoard.mutate,
    isPending: false,
    isError: false,
    error: null,
  }),
}))

// The editor stands in for TipTap: a button that "types" a fixed document.
vi.mock('@/components/ui/rich-text-editor', () => ({
  RichTextEditor: ({
    value,
    onChange,
  }: {
    value?: unknown
    onChange?: (json: unknown, html: string, markdown: string) => void
  }) => (
    <div>
      <pre data-testid="template-body">{JSON.stringify(value)}</pre>
      <button
        type="button"
        onClick={() =>
          onChange?.(
            {
              type: 'doc',
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Version?' }] }],
            },
            '<p>Version?</p>',
            'Version?'
          )
        }
      >
        type in editor
      </button>
    </div>
  ),
}))

import { BoardDescriptionTemplateForm } from '../board-description-template-form'

const BOARD_ID = 'board_01' as BoardId

function docSaying(text: string): TiptapContent {
  return { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] }
}

describe('BoardDescriptionTemplateForm', () => {
  beforeEach(() => vi.clearAllMocks())
  afterEach(cleanup)

  it('opens on the board’s stored template', () => {
    render(<BoardDescriptionTemplateForm boardId={BOARD_ID} template={docSaying('Steps')} />)
    expect(JSON.parse(screen.getByTestId('template-body').textContent ?? '')).toEqual(
      docSaying('Steps')
    )
  })

  it('opens on an empty template when the board has none', () => {
    render(<BoardDescriptionTemplateForm boardId={BOARD_ID} template={undefined} />)
    const shown = JSON.parse(screen.getByTestId('template-body').textContent ?? '') as TiptapContent
    expect(shown.type).toBe('doc')
    expect(JSON.stringify(shown)).not.toContain('"text"')
  })

  it('saves the edited template and no other setting (V11)', () => {
    render(<BoardDescriptionTemplateForm boardId={BOARD_ID} template={docSaying('Steps')} />)

    fireEvent.click(screen.getByRole('button', { name: 'type in editor' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save template' }))

    expect(updateBoard.mutate).toHaveBeenCalledTimes(1)
    expect(updateBoard.mutate.mock.calls[0]![0]).toEqual({
      id: BOARD_ID,
      settings: { descriptionTemplate: docSaying('Version?') },
    })
  })
})
