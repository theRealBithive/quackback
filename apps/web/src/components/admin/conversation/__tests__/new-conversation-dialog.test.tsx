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
 * This module holds C1–C5 for the outbound compose dialog.
 *
 * The upload hook and the composer-attachment hook are deliberately NOT mocked:
 * the promise this dialog makes is that a pasted screenshot travels all the way
 * from the clipboard to the send payload, and a stubbed `addFiles` would assert
 * only that a callback was handed a File. `fetch` is the seam instead, which is
 * also what makes the failure toast (C5) reachable — the error it shows is the
 * one the upload raised, not one the dialog invented.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderWithIntl } from '@/test/render-with-intl'

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  startAgentConversationFn: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
}))

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => mocks.navigate,
}))
vi.mock('@/lib/server/functions/conversation', () => ({
  startAgentConversationFn: mocks.startAgentConversationFn,
}))
vi.mock('sonner', () => ({
  toast: { error: mocks.toastError, success: mocks.toastSuccess },
}))
vi.mock('@/components/shared/portal-user-picker', () => ({ PortalUserPicker: () => null }))

/**
 * The editor stands in for TipTap, which this suite is not about. It keeps the
 * one contract the dialog reads off it: `onChange(json, html, markdown)`, fired
 * on demand so a test can put the composer into a non-empty state. It renders
 * as a fragment so the paste/drop box is the editor's own `parentElement`.
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
        data-testid="type-a-message"
        onClick={() =>
          onChange?.(
            {
              type: 'doc',
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hello there' }] }],
            },
            '<p>Hello there</p>',
            'Hello there  '
          )
        }
      >
        type
      </button>
    </>
  ),
}))

import { NewConversationDialog } from '../new-conversation-dialog'

const TARGET = {
  principalId: 'principal_01ktjwt5tyf6br9mw521h13n6n',
  name: 'Rita Ora',
  email: 'rita@example.com',
  image: null,
}

function pngFile(name = 'shot.png'): File {
  return new File([new Uint8Array([1, 2, 3])], name, { type: 'image/png' })
}

function textFile(): File {
  return new File(['hello'], 'notes.txt', { type: 'text/plain' })
}

/** A `fetch` that answers every upload with the same public URL. */
function respondWith(publicUrl: string) {
  // Typed with the argument list `fetch` is called with, so a test can read the
  // endpoint back off `mock.calls`.
  return vi.fn(async (_input: unknown, _init?: unknown) => ({
    ok: true,
    json: async () => ({ publicUrl }),
  }))
}

function renderDialog(open = true) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const onOpenChange = vi.fn()
  const result = renderWithIntl(
    <QueryClientProvider client={client}>
      <NewConversationDialog open={open} onOpenChange={onOpenChange} initialTarget={TARGET} />
    </QueryClientProvider>
  )
  return { ...result, onOpenChange, client }
}

/**
 * The element carrying the dialog's paste and drop handlers.
 *
 * Awaited, because the editor now arrives through a `lazy()` boundary
 * (upstream #553): the handlers' own div renders straight away, but the editor
 * this reads its parent off does not. Without the await the suite passed only
 * because the first test in the file resolved the chunk for the rest — run one
 * of the others alone and it could not find the editor at all.
 */
async function composerBox(): Promise<HTMLElement> {
  const editor = await screen.findByTestId('editor')
  return editor.parentElement as HTMLElement
}

/** The thumbnails currently staged in the attachment tray. */
function trayThumbnails(): string[] {
  return screen
    .queryAllByRole('button', { name: 'Remove attachment' })
    .map((button) => button.parentElement?.querySelector('img')?.getAttribute('src') ?? '')
}

function hiddenFileInput(): HTMLInputElement {
  return document.querySelector('input[type="file"]') as HTMLInputElement
}

beforeEach(() => {
  mocks.navigate.mockReset()
  mocks.startAgentConversationFn.mockReset()
  mocks.toastError.mockReset()
  mocks.toastSuccess.mockReset()
  mocks.startAgentConversationFn.mockResolvedValue({ conversation: { id: 'conversation_1' } })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('NewConversationDialog — the attachment tray', () => {
  it('stages a pasted image on the tray instead of inlining it (C1)', async () => {
    const fetchMock = respondWith('https://cdn.example.com/shot.png')
    vi.stubGlobal('fetch', fetchMock)
    renderDialog()

    const handled = fireEvent.paste(await composerBox(), {
      clipboardData: { files: [pngFile()], items: [] },
    })

    // A handled paste is a cancelled one — the browser must not also drop the
    // image into the document.
    expect(handled).toBe(false)
    await waitFor(() => expect(trayThumbnails()).toEqual(['https://cdn.example.com/shot.png']))
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(fetchMock.mock.calls[0]![0]).toBe('/api/upload/image')
  })

  it('stages a dropped image on the tray (C1)', async () => {
    const fetchMock = respondWith('https://cdn.example.com/dropped.png')
    vi.stubGlobal('fetch', fetchMock)
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

    const pasted = fireEvent.paste(await composerBox(), {
      clipboardData: { files: [textFile()], items: [] },
    })
    const dropped = fireEvent.drop(await composerBox(), {
      dataTransfer: { files: [textFile()], items: [] },
    })

    // Not cancelled: the browser is still free to handle the plain text.
    expect(pasted).toBe(true)
    expect(dropped).toBe(true)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(trayThumbnails()).toEqual([])
  })

  it('changes nothing on a paste or drop carrying no files at all (C1)', async () => {
    const fetchMock = respondWith('https://cdn.example.com/never.png')
    vi.stubGlobal('fetch', fetchMock)
    renderDialog()

    expect(fireEvent.paste(await composerBox(), { clipboardData: { files: [], items: [] } })).toBe(
      true
    )
    expect(fireEvent.drop(await composerBox(), { dataTransfer: { files: [], items: [] } })).toBe(
      true
    )
    expect(fetchMock).not.toHaveBeenCalled()
    expect(trayThumbnails()).toEqual([])
  })

  it('opens the file picker from the paperclip and resets it after a pick (C2)', async () => {
    const fetchMock = respondWith('https://cdn.example.com/picked.png')
    vi.stubGlobal('fetch', fetchMock)
    renderDialog()

    const input = hiddenFileInput()
    const opened = vi.spyOn(input, 'click')
    fireEvent.click(screen.getByLabelText('Attach image'))
    expect(opened).toHaveBeenCalledOnce()

    Object.defineProperty(input, 'files', { value: [pngFile('picked.png')], configurable: true })
    fireEvent.change(input)

    await waitFor(() => expect(trayThumbnails()).toEqual(['https://cdn.example.com/picked.png']))
    // Reset so choosing the very same file again still fires a change event.
    expect(input.value).toBe('')
  })

  it('ignores a file picker that was dismissed without a pick (C2)', () => {
    const fetchMock = respondWith('https://cdn.example.com/never.png')
    vi.stubGlobal('fetch', fetchMock)
    renderDialog()

    const input = hiddenFileInput()
    Object.defineProperty(input, 'files', { value: [], configurable: true })
    fireEvent.change(input)

    expect(fetchMock).not.toHaveBeenCalled()
    expect(trayThumbnails()).toEqual([])
  })

  it('sends a message that is nothing but an attachment (C3)', async () => {
    vi.stubGlobal('fetch', respondWith('https://cdn.example.com/only.png'))
    renderDialog()

    const send = screen.getByRole('button', { name: /Send message/ })
    expect(send).toBeDisabled()

    fireEvent.paste(await composerBox(), {
      clipboardData: { files: [pngFile('only.png')], items: [] },
    })
    await waitFor(() => expect(send).toBeEnabled())

    fireEvent.click(send)

    await waitFor(() => expect(mocks.startAgentConversationFn).toHaveBeenCalledOnce())
    expect(mocks.startAgentConversationFn.mock.calls[0]![0]).toEqual({
      data: {
        targetPrincipalId: TARGET.principalId,
        content: '',
        contentJson: null,
        attachments: [
          {
            url: 'https://cdn.example.com/only.png',
            name: 'only.png',
            contentType: 'image/png',
            size: 3,
          },
        ],
      },
    })
  })

  it('refuses to send while an upload is still in flight (C3)', async () => {
    let finishUpload: (value: unknown) => void = () => {}
    vi.stubGlobal(
      'fetch',
      vi.fn(
        () =>
          new Promise((resolve) => {
            finishUpload = resolve
          })
      )
    )
    renderDialog()

    const send = screen.getByRole('button', { name: /Send message/ })
    // Typed text alone would already allow a send; the in-flight upload is what
    // holds it back, so the message is non-empty before the paste.
    fireEvent.click(await screen.findByTestId('type-a-message'))
    expect(send).toBeEnabled()

    fireEvent.paste(await composerBox(), { clipboardData: { files: [pngFile()], items: [] } })
    await waitFor(() => expect(send).toBeDisabled())

    finishUpload({
      ok: true,
      json: async () => ({ publicUrl: 'https://cdn.example.com/late.png' }),
    })
    await waitFor(() => expect(send).toBeEnabled())
  })

  it('carries the editor’s document and its trimmed markdown into the send (C3)', async () => {
    renderDialog()

    fireEvent.click(await screen.findByTestId('type-a-message'))
    fireEvent.click(screen.getByRole('button', { name: /Send message/ }))

    await waitFor(() => expect(mocks.startAgentConversationFn).toHaveBeenCalledOnce())
    expect(mocks.startAgentConversationFn.mock.calls[0]![0]).toEqual({
      data: {
        targetPrincipalId: TARGET.principalId,
        content: 'Hello there',
        contentJson: {
          type: 'doc',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hello there' }] }],
        },
        attachments: undefined,
      },
    })
  })

  it('clears pending attachments when the dialog is closed and opened again (C4)', async () => {
    vi.stubGlobal('fetch', respondWith('https://cdn.example.com/stale.png'))
    const { rerender, client } = renderDialog()

    fireEvent.paste(await composerBox(), {
      clipboardData: { files: [pngFile('stale.png')], items: [] },
    })
    await waitFor(() => expect(trayThumbnails()).toEqual(['https://cdn.example.com/stale.png']))

    const dialog = (open: boolean) => (
      <QueryClientProvider client={client}>
        <NewConversationDialog open={open} onOpenChange={vi.fn()} initialTarget={TARGET} />
      </QueryClientProvider>
    )
    rerender(dialog(false))
    rerender(dialog(true))

    await waitFor(() => expect(trayThumbnails()).toEqual([]))
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
