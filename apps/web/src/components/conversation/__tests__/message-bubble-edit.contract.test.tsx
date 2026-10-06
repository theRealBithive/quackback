// @vitest-environment happy-dom
/**
 * The admin inbox bubble: the inline editor and the "(edited)" mark.
 *
 * Contract for the batch G pick (upstream ccf8f0521 #580, "edit and delete your
 * own support messages") -- the confirmed list items this suite pins on the
 * bubble (verbatim):
 *
 *   G1 A teammate can edit the body of a message they wrote themselves, whether a reply or an internal note, on a conversation or a ticket, as long as they still hold the permission that writes that kind of message.
 *   G2 Nobody can edit a message someone else wrote, a customer's message, a system message, a message from the AI assistant, or a structured message, and that includes moderators.
 *   G3 An edited message keeps its place in the thread and carries an "(edited)" mark; saving an unchanged body is not an edit and leaves no mark.
 *   G11 A teammate can delete their own message while they hold the permission that writes it; a moderator can delete any message that is not a system message; a customer can delete their own message in their own conversation; nobody can delete a system message.
 *   G12 A teammate without moderator rights can no longer delete a message someone else wrote, on conversations and on tickets alike.
 *
 * What the bubble owns: it offers the menu entries it is told to offer (the
 * thread decides, see agent-thread-message-edit.contract.test.tsx), it shows
 * the mark exactly for a message that carries `editedAt`, and its editor never
 * loses a draft on a failed save. Whether an unchanged body is an edit is the
 * server's call (it answers with the message unchanged and no `editedAt`); the
 * bubble's part is to send the body as it was and to never invent a mark.
 *
 * The admin inbox bubble is English-only in this fork, so these assertions are
 * English; the German side is in visitor-thread-edit.contract.test.tsx.
 * The rich text editor is replaced by a textarea that reports a TipTap doc the
 * way the real one does.
 */
import { describe, expect, it, vi, afterEach } from 'vitest'
import fc from 'fast-check'
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import type { AgentConversationMessageDTO } from '@/lib/shared/conversation/types'
import { renderWithIntl } from '@/test/render-with-intl'
import {
  CONVERSATION_EDITOR_FEATURES,
  CONVERSATION_NOTE_FEATURES,
} from '../conversation-editor-features'

const { editorProbe } = vi.hoisted(() => ({
  editorProbe: { features: undefined as unknown },
}))
vi.mock('@/components/ui/rich-text-editor', () => ({
  RichTextEditor: ({
    value,
    features,
    onChange,
    onSubmit,
  }: {
    value?: unknown
    features?: unknown
    onChange?: (json: unknown, html: string, markdown: string) => void
    onSubmit?: () => void
  }) => {
    editorProbe.features = features
    return (
      <textarea
        aria-label="editor"
        defaultValue={typeof value === 'string' ? value : ''}
        onChange={(event) => {
          const text = event.target.value
          const paragraph = text ? [{ type: 'text', text }] : []
          onChange?.(
            { type: 'doc', content: [{ type: 'paragraph', content: paragraph }] },
            '',
            text
          )
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault()
            onSubmit?.()
          }
        }}
      />
    )
  },
  RichTextContent: () => null,
}))

import { AgentMessageBubble } from '../message-bubble'

afterEach(cleanup)

function ownReply(over: Partial<AgentConversationMessageDTO> = {}): AgentConversationMessageDTO {
  return {
    id: 'conversation_msg_1' as AgentConversationMessageDTO['id'],
    conversationId: 'conversation_1' as AgentConversationMessageDTO['conversationId'],
    ticketId: null,
    senderType: 'agent',
    content: 'Original text',
    createdAt: '2026-07-01T00:00:00.000Z',
    author: { principalId: 'principal_me' as never, displayName: 'James', avatarUrl: null },
    attachments: [],
    citations: [],
    isAssistant: false,
    isInternal: false,
    contentJson: null,
    viaEmail: false,
    systemEvent: null,
    reactions: [],
    flaggedAt: null,
    postSuggestion: null,
    translatedFrom: null,
    ...over,
  }
}

function openEditor() {
  fireEvent.click(screen.getByLabelText('More actions'))
  fireEvent.click(screen.getByRole('menuitem', { name: 'Edit message' }))
}

function typeDraft(text: string) {
  fireEvent.change(screen.getByLabelText('editor'), { target: { value: text } })
}

describe('AgentMessageBubble menu (G1, G2, G11, G12 -- UI half)', () => {
  it('offers Edit message and Delete exactly when told to, in every combination (G1, G2, G11, G12)', () => {
    fc.assert(
      fc.property(fc.boolean(), fc.boolean(), (canEdit, canDelete) => {
        const { unmount } = renderWithIntl(
          <AgentMessageBubble
            message={ownReply()}
            canEdit={canEdit}
            canDelete={canDelete}
            onEdit={async () => {}}
          />
        )
        fireEvent.click(screen.getByLabelText('More actions'))
        const hasEdit = screen.queryByRole('menuitem', { name: 'Edit message' }) !== null
        const hasDelete = screen.queryByRole('menuitem', { name: 'Delete' }) !== null
        unmount()
        expect(hasEdit).toBe(canEdit)
        expect(hasDelete).toBe(canDelete)
      })
    )
  })

  it('offers neither by default, so a caller that decided nothing grants nothing (G2, G12)', () => {
    renderWithIntl(<AgentMessageBubble message={ownReply()} />)
    fireEvent.click(screen.getByLabelText('More actions'))
    expect(screen.queryByRole('menuitem', { name: 'Edit message' })).toBeNull()
    expect(screen.queryByRole('menuitem', { name: 'Delete' })).toBeNull()
  })

  it('offers no Edit message when nobody is wired to save it (G2)', () => {
    renderWithIntl(<AgentMessageBubble message={ownReply()} canEdit />)
    fireEvent.click(screen.getByLabelText('More actions'))
    expect(screen.queryByRole('menuitem', { name: 'Edit message' })).toBeNull()
  })

  it('Delete reports the message it belongs to (G11)', () => {
    const onDelete = vi.fn()
    renderWithIntl(<AgentMessageBubble message={ownReply()} canDelete onDelete={onDelete} />)
    fireEvent.click(screen.getByLabelText('More actions'))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete' }))
    expect(onDelete).toHaveBeenCalledWith('conversation_msg_1')
  })
})

describe('AgentMessageBubble edited mark (G3)', () => {
  it('shows "(edited)" on exactly the messages that carry editedAt (G3)', () => {
    fc.assert(
      fc.property(fc.array(fc.boolean(), { minLength: 1, maxLength: 8 }), (editedFlags) => {
        const { unmount } = renderWithIntl(
          <div>
            {editedFlags.map((edited, index) => (
              <AgentMessageBubble
                key={index}
                message={ownReply({
                  id: `conversation_msg_${index}` as never,
                  content: `message ${index}`,
                  editedAt: edited ? '2026-07-01T01:00:00.000Z' : null,
                })}
              />
            ))}
          </div>
        )
        const shown = screen.queryAllByText('(edited)').length
        unmount()
        expect(shown).toBe(editedFlags.filter(Boolean).length)
      })
    )
  })

  it('treats a message without the field like a never-edited one (G3)', () => {
    renderWithIntl(<AgentMessageBubble message={ownReply({ editedAt: undefined })} />)
    expect(screen.queryByText('(edited)')).toBeNull()
  })

  it('the mark tells when the edit happened (G3)', () => {
    renderWithIntl(
      <AgentMessageBubble message={ownReply({ editedAt: '2026-07-01T01:00:00.000Z' })} />
    )
    expect(screen.getByText('(edited)').getAttribute('title')).toMatch(/^Edited /)
  })
})

describe('AgentMessageBubble inline editor (G1, G3)', () => {
  it('starts from the current body and saves what was typed, then closes (G1, G3)', async () => {
    const onEdit = vi.fn(async () => {})
    renderWithIntl(<AgentMessageBubble message={ownReply()} canEdit onEdit={onEdit} />)
    openEditor()
    expect((screen.getByLabelText('editor') as HTMLTextAreaElement).value).toBe('Original text')

    typeDraft('  Better text  ')
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() => expect(screen.queryByTestId('message-edit-form')).toBeNull())
    expect(onEdit).toHaveBeenCalledTimes(1)
    const [messageId, draft] = onEdit.mock.calls[0] as unknown as [string, { content: string }]
    expect(messageId).toBe('conversation_msg_1')
    expect(draft.content).toBe('Better text')
  })

  it('saving an unchanged body sends it as it was and leaves no mark (G3)', async () => {
    // The server decides that an unchanged body is no edit and answers with the
    // message as it was, so the bubble never receives an editedAt.
    const onEdit = vi.fn(async () => {})
    renderWithIntl(<AgentMessageBubble message={ownReply()} canEdit onEdit={onEdit} />)
    openEditor()
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() => expect(screen.queryByTestId('message-edit-form')).toBeNull())
    expect(onEdit).toHaveBeenCalledWith('conversation_msg_1', {
      content: 'Original text',
      contentJson: null,
    })
    expect(screen.getByText('Original text')).toBeTruthy()
    expect(screen.queryByText('(edited)')).toBeNull()
  })

  it('Cancel drops the draft and restores the original; reopening starts from the original (G3)', () => {
    const onEdit = vi.fn(async () => {})
    renderWithIntl(<AgentMessageBubble message={ownReply()} canEdit onEdit={onEdit} />)
    openEditor()
    typeDraft('Something else entirely')
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(screen.queryByTestId('message-edit-form')).toBeNull()
    expect(screen.getByText('Original text')).toBeTruthy()
    expect(onEdit).not.toHaveBeenCalled()

    openEditor()
    expect((screen.getByLabelText('editor') as HTMLTextAreaElement).value).toBe('Original text')
  })

  it('Escape cancels like Cancel (G3)', () => {
    const onEdit = vi.fn(async () => {})
    renderWithIntl(<AgentMessageBubble message={ownReply()} canEdit onEdit={onEdit} />)
    openEditor()
    typeDraft('Draft')
    fireEvent.keyDown(screen.getByLabelText('editor'), { key: 'Escape' })

    expect(screen.queryByTestId('message-edit-form')).toBeNull()
    expect(screen.getByText('Original text')).toBeTruthy()
    expect(onEdit).not.toHaveBeenCalled()
  })

  it('Enter in the editor saves, like the Save button (G1)', async () => {
    const onEdit = vi.fn(async () => {})
    renderWithIntl(<AgentMessageBubble message={ownReply()} canEdit onEdit={onEdit} />)
    openEditor()
    typeDraft('Saved with Enter')
    fireEvent.keyDown(screen.getByLabelText('editor'), { key: 'Enter' })

    await waitFor(() => expect(onEdit).toHaveBeenCalledTimes(1))
    expect(onEdit.mock.calls[0]).toEqual([
      'conversation_msg_1',
      expect.objectContaining({ content: 'Saved with Enter' }),
    ])
  })

  it('a failed save keeps the editor open with the draft and allows another try (G3)', async () => {
    const onEdit = vi
      .fn<(id: string, draft: { content: string }) => Promise<void>>()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(undefined)
    renderWithIntl(<AgentMessageBubble message={ownReply()} canEdit onEdit={onEdit} />)
    openEditor()
    typeDraft('My careful rewrite')
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() => expect(onEdit).toHaveBeenCalledTimes(1))
    const save = await screen.findByRole('button', { name: 'Save changes' })
    expect(screen.getByTestId('message-edit-form')).toBeTruthy()
    expect((screen.getByLabelText('editor') as HTMLTextAreaElement).value).toBe(
      'My careful rewrite'
    )
    expect((save as HTMLButtonElement).disabled).toBe(false)
    expect(screen.queryByText('(edited)')).toBeNull()

    fireEvent.click(save)
    await waitFor(() => expect(screen.queryByTestId('message-edit-form')).toBeNull())
    expect(onEdit).toHaveBeenCalledTimes(2)
    expect(onEdit.mock.calls[1][1].content).toBe('My careful rewrite')
  })

  it('a save in flight shows it and cannot be sent twice (G3)', async () => {
    let finish: () => void = () => {}
    const onEdit = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve
        })
    )
    renderWithIntl(<AgentMessageBubble message={ownReply()} canEdit onEdit={onEdit} />)
    openEditor()
    typeDraft('Once only')
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    const saving = await screen.findByRole('button', { name: 'Saving…' })
    expect((saving as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'Cancel' }) as HTMLButtonElement).disabled).toBe(
      true
    )
    fireEvent.keyDown(screen.getByLabelText('editor'), { key: 'Enter' })
    expect(onEdit).toHaveBeenCalledTimes(1)

    finish()
    await waitFor(() => expect(screen.queryByTestId('message-edit-form')).toBeNull())
  })

  it('a body emptied of all text cannot be saved, by button or by Enter (G3)', () => {
    const onEdit = vi.fn(async () => {})
    renderWithIntl(<AgentMessageBubble message={ownReply()} canEdit onEdit={onEdit} />)
    openEditor()
    typeDraft('')

    expect(
      (screen.getByRole('button', { name: 'Save changes' }) as HTMLButtonElement).disabled
    ).toBe(true)
    fireEvent.keyDown(screen.getByLabelText('editor'), { key: 'Enter' })
    expect(onEdit).not.toHaveBeenCalled()
    expect(screen.getByTestId('message-edit-form')).toBeTruthy()
  })

  it('a message with an attachment can be saved with its text removed (G3)', async () => {
    const onEdit = vi.fn(async () => {})
    const attachment = {
      url: 'https://example.test/a.png',
      name: 'a.png',
      contentType: 'image/png',
      size: 10,
    }
    renderWithIntl(
      <AgentMessageBubble
        message={ownReply({ attachments: [attachment] })}
        canEdit
        onEdit={onEdit}
      />
    )
    openEditor()
    typeDraft('')
    const save = screen.getByRole('button', { name: 'Save changes' }) as HTMLButtonElement
    expect(save.disabled).toBe(false)
    fireEvent.click(save)

    await waitFor(() => expect(onEdit).toHaveBeenCalledTimes(1))
    expect(onEdit).toHaveBeenCalledWith('conversation_msg_1', { content: '', contentJson: null })
  })

  it('an internal note is edited with the note toolbar, a reply with the reply toolbar (G1)', () => {
    renderWithIntl(
      <AgentMessageBubble message={ownReply({ isInternal: true })} canEdit onEdit={vi.fn()} />
    )
    openEditor()
    expect(editorProbe.features).toBe(CONVERSATION_NOTE_FEATURES)
    cleanup()

    renderWithIntl(<AgentMessageBubble message={ownReply()} canEdit onEdit={vi.fn()} />)
    openEditor()
    expect(editorProbe.features).toBe(CONVERSATION_EDITOR_FEATURES)
  })
})

describe('AgentMessageBubble toolbar around the editor (G3)', () => {
  it('keeps every other message action working when no edit is open (G3)', async () => {
    const handlers = {
      onToggleReaction: vi.fn(),
      onToggleFlag: vi.fn(),
      onMarkUnread: vi.fn(),
      onSharePost: vi.fn(),
      onTrackAsPost: vi.fn(),
    }
    renderWithIntl(
      <AgentMessageBubble message={ownReply({ senderType: 'visitor' })} {...handlers} />
    )

    fireEvent.click(screen.getByLabelText('Flag message'))
    expect(handlers.onToggleFlag).toHaveBeenCalledWith('conversation_msg_1', true)

    fireEvent.click(screen.getByLabelText('Add reaction'))
    fireEvent.click(await screen.findByRole('button', { name: 'React with 👍' }))
    expect(handlers.onToggleReaction).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByLabelText('More actions'))
    fireEvent.click(screen.getByRole('menuitem', { name: /Mark unread/ }))
    expect(handlers.onMarkUnread).toHaveBeenCalledWith('conversation_msg_1')

    fireEvent.click(screen.getByLabelText('More actions'))
    fireEvent.click(screen.getByRole('menuitem', { name: /Share a post/ }))
    expect(handlers.onSharePost).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByLabelText('More actions'))
    fireEvent.click(screen.getByRole('menuitem', { name: /Track as feedback/ }))
    expect(handlers.onTrackAsPost).toHaveBeenCalledTimes(1)
  })

  it('replaces the bubble and its toolbar while the editor is open and restores both on Cancel (G3)', () => {
    renderWithIntl(<AgentMessageBubble message={ownReply()} canEdit onEdit={vi.fn()} />)
    openEditor()
    expect(screen.queryByLabelText('More actions')).toBeNull()
    expect(screen.queryByLabelText('Flag message')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.getByLabelText('More actions')).toBeTruthy()
    expect(screen.getByText('Original text')).toBeTruthy()
  })
})
