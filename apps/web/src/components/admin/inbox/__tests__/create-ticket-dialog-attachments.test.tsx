// @vitest-environment happy-dom
/**
 * C — Conversation attachment tray (upstream #539)
 *
 * C1 Pasting or dropping an image into a conversation composer (new
 *    conversation, new ticket, agent reply) adds it to the attachment tray
 *    instead of inlining it; non-image files are left to the browser; a paste
 *    or drop without images changes nothing.
 * C2 The paperclip opens a file picker; chosen files land in the tray and the
 *    input resets so the same file can be chosen again.
 * C3 A message with only attachments can be sent; while an upload is in flight
 *    it cannot.
 * C4 Closing and reopening the dialog clears pending attachments.
 * C5 An upload failure is shown as a toast carrying the error's message.
 * C6 An image inserted into a post or changelog entry keeps its natural aspect:
 *    the node carries the natural size scaled to the editor's bounds plus
 *    keep-ratio; when the size cannot be read, only src and keep-ratio are set.
 * C7 A stored inline image lifted onto the tray gets its content type from the
 *    extension (png, jpg, gif, webp, avif, else `image/*`) and its name from
 *    the URL, or `image` when the URL is unreadable.
 * C8 An attachment is rendered only when safe: an image with a sanitizable URL,
 *    a same-origin path, or an http(s) URL; anything else is dropped.
 *
 * This module holds C1, C2 and C5 for the create-ticket dialog's description
 * composer. It is a sibling of `create-ticket-dialog.test.tsx` rather than an
 * addition to it because that suite replaces `useConversationComposerAttachments`
 * and `useImageUpload` with stubs — file-wide, since `vi.mock` is hoisted — and
 * a stubbed `addFiles` can only witness that a callback received a File. The
 * promise here is that the file reaches the tray and the create payload, so the
 * hooks run for real and `fetch` is the seam.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderWithIntl } from '@/test/render-with-intl'
import type { TicketTypeDTO } from '@/lib/shared/tickets'

const mocks = vi.hoisted(() => ({
  mutate: vi.fn(),
  listTicketTypesFn: vi.fn(),
  linkTicketToConversationFn: vi.fn(),
  suggestTicketFieldValuesFn: vi.fn(),
  toastError: vi.fn(),
}))

vi.mock('@/lib/client/mutations/inbox', () => ({
  useCreateTicket: () => ({ mutate: mocks.mutate, isPending: false }),
}))
vi.mock('@/lib/server/functions/ticket-types', () => ({
  listTicketTypesFn: mocks.listTicketTypesFn,
}))
vi.mock('@/lib/server/functions/tickets', () => ({
  linkTicketToConversationFn: mocks.linkTicketToConversationFn,
  suggestTicketFieldValuesFn: mocks.suggestTicketFieldValuesFn,
}))
vi.mock('@tanstack/react-router', () => ({
  useRouteContext: () => ({ settings: { featureFlags: {} } }),
}))
vi.mock('sonner', () => ({
  toast: { error: mocks.toastError, info: vi.fn(), success: vi.fn(), warning: vi.fn() },
}))
vi.mock('@/components/shared/portal-user-picker', () => ({ PortalUserPicker: () => null }))

/**
 * Stands in for TipTap, keeping only the contract the dialog reads: an
 * `onChange(json, html, markdown)` a test can fire. A fragment, so the
 * paste/drop box is the editor's own `parentElement`.
 */
vi.mock('@/components/ui/rich-text-editor', () => ({
  RichTextEditor: ({
    onChange,
    placeholder,
  }: {
    onChange?: (json: unknown, html: string, markdown: string) => void
    placeholder?: string
  }) => (
    <>
      <textarea data-testid="editor" placeholder={placeholder} readOnly />
      <button
        type="button"
        data-testid="type-a-description"
        onClick={() =>
          onChange?.(
            {
              type: 'doc',
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'It crashes' }] }],
            },
            '<p>It crashes</p>',
            '  It crashes  '
          )
        }
      >
        type
      </button>
    </>
  ),
}))

import { CreateTicketDialog } from '../create-ticket-dialog'

const bugType: TicketTypeDTO = {
  id: 'ticket_type_bug',
  name: 'Bug report',
  slug: 'bug_report',
  category: 'customer',
  icon: '🐛',
  color: '#eab308',
  fields: [],
  isDefault: true,
  position: 0,
  intakeVisible: true,
  archived: false,
}

function pngFile(name = 'shot.png'): File {
  return new File([new Uint8Array([1, 2, 3])], name, { type: 'image/png' })
}

function textFile(): File {
  return new File(['hello'], 'notes.txt', { type: 'text/plain' })
}

function respondWith(publicUrl: string) {
  // Typed with the argument list `fetch` is called with, so a test can read the
  // endpoint back off `mock.calls`.
  return vi.fn(async (_input: unknown, _init?: unknown) => ({
    ok: true,
    json: async () => ({ publicUrl }),
  }))
}

function renderDialog() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return renderWithIntl(
    <QueryClientProvider client={qc}>
      <CreateTicketDialog open onOpenChange={vi.fn()} onCreated={vi.fn()} />
    </QueryClientProvider>
  )
}

/** The element carrying the dialog's paste and drop handlers. */
async function composerBox(): Promise<HTMLElement> {
  const editor = await screen.findByTestId('editor')
  return editor.parentElement as HTMLElement
}

function trayThumbnails(): string[] {
  return screen
    .queryAllByRole('button', { name: 'Remove attachment' })
    .map((button) => button.parentElement?.querySelector('img')?.getAttribute('src') ?? '')
}

function hiddenFileInput(): HTMLInputElement {
  return document.querySelector('input[type="file"]') as HTMLInputElement
}

beforeEach(() => {
  Element.prototype.scrollIntoView ??= (() => {}) as never
  mocks.mutate.mockReset()
  mocks.toastError.mockReset()
  mocks.listTicketTypesFn.mockReset()
  mocks.listTicketTypesFn.mockResolvedValue([bugType])
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('CreateTicketDialog — the description composer’s attachment tray', () => {
  it('stages a pasted image on the tray instead of inlining it (C1)', async () => {
    const fetchMock = respondWith('https://cdn.example.com/shot.png')
    vi.stubGlobal('fetch', fetchMock)
    renderDialog()

    const handled = fireEvent.paste(await composerBox(), {
      clipboardData: { files: [pngFile()], items: [] },
    })

    expect(handled).toBe(false)
    await waitFor(() => expect(trayThumbnails()).toEqual(['https://cdn.example.com/shot.png']))
    expect(fetchMock.mock.calls[0]![0]).toBe('/api/upload/image')
  })

  it('stages a dropped image on the tray (C1)', async () => {
    vi.stubGlobal('fetch', respondWith('https://cdn.example.com/dropped.png'))
    renderDialog()

    const handled = fireEvent.drop(await composerBox(), {
      dataTransfer: { files: [pngFile('dropped.png')], items: [] },
    })

    expect(handled).toBe(false)
    await waitFor(() => expect(trayThumbnails()).toEqual(['https://cdn.example.com/dropped.png']))
  })

  it('leaves a pasted or dropped non-image file to the browser (C1)', async () => {
    const fetchMock = respondWith('https://cdn.example.com/never.png')
    vi.stubGlobal('fetch', fetchMock)
    renderDialog()

    const box = await composerBox()
    expect(fireEvent.paste(box, { clipboardData: { files: [textFile()], items: [] } })).toBe(true)
    expect(fireEvent.drop(box, { dataTransfer: { files: [textFile()], items: [] } })).toBe(true)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(trayThumbnails()).toEqual([])
  })

  it('changes nothing on a paste or drop carrying no files at all (C1)', async () => {
    const fetchMock = respondWith('https://cdn.example.com/never.png')
    vi.stubGlobal('fetch', fetchMock)
    renderDialog()

    const box = await composerBox()
    expect(fireEvent.paste(box, { clipboardData: { files: [], items: [] } })).toBe(true)
    expect(fireEvent.drop(box, { dataTransfer: { files: [], items: [] } })).toBe(true)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(trayThumbnails()).toEqual([])
  })

  it('creates the ticket with the image on attachments and nothing inline in the description (C1)', async () => {
    vi.stubGlobal('fetch', respondWith('https://cdn.example.com/only.png'))
    renderDialog()

    fireEvent.change(await screen.findByPlaceholderText('Summarize the request…'), {
      target: { value: 'Login is broken' },
    })
    fireEvent.click(screen.getByTestId('type-a-description'))
    fireEvent.paste(await composerBox(), {
      clipboardData: { files: [pngFile('only.png')], items: [] },
    })
    await waitFor(() => expect(trayThumbnails()).toEqual(['https://cdn.example.com/only.png']))

    fireEvent.click(screen.getByRole('button', { name: 'Create ticket' }))

    await waitFor(() => expect(mocks.mutate).toHaveBeenCalledOnce())
    const payload = mocks.mutate.mock.calls[0]![0] as {
      description: string
      descriptionJson: { content: { type: string }[] }
      attachments: { url: string; name: string; contentType: string; size: number }[]
    }
    expect(payload.description).toBe('It crashes')
    expect(payload.attachments).toEqual([
      {
        url: 'https://cdn.example.com/only.png',
        name: 'only.png',
        contentType: 'image/png',
        size: 3,
      },
    ])
    // The document the editor reported is untouched by the paste: the image
    // went to the tray, not into the draft.
    expect(payload.descriptionJson).toEqual({
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'It crashes' }] }],
    })
  })

  it('opens the file picker from the paperclip and resets it after a pick (C2)', async () => {
    vi.stubGlobal('fetch', respondWith('https://cdn.example.com/picked.png'))
    renderDialog()
    await composerBox()

    const input = hiddenFileInput()
    const opened = vi.spyOn(input, 'click')
    fireEvent.click(screen.getByLabelText('Attach image'))
    expect(opened).toHaveBeenCalledOnce()

    Object.defineProperty(input, 'files', { value: [pngFile('picked.png')], configurable: true })
    fireEvent.change(input)

    await waitFor(() => expect(trayThumbnails()).toEqual(['https://cdn.example.com/picked.png']))
    expect(input.value).toBe('')
  })

  it('ignores a file picker that was dismissed without a pick (C2)', async () => {
    const fetchMock = respondWith('https://cdn.example.com/never.png')
    vi.stubGlobal('fetch', fetchMock)
    renderDialog()
    await composerBox()

    const input = hiddenFileInput()
    Object.defineProperty(input, 'files', { value: [], configurable: true })
    fireEvent.change(input)

    expect(fetchMock).not.toHaveBeenCalled()
    expect(trayThumbnails()).toEqual([])
  })

  it('shows the upload error’s own message as a toast (C5)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('The storage bucket is full')
      })
    )
    renderDialog()

    fireEvent.paste(await composerBox(), { clipboardData: { files: [pngFile()], items: [] } })

    await waitFor(() => expect(mocks.toastError).toHaveBeenCalledWith('The storage bucket is full'))
    expect(trayThumbnails()).toEqual([])
  })
})
