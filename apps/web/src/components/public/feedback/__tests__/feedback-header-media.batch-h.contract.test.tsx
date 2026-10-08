// @vitest-environment happy-dom
/**
 * Contract for batch H, pasted verbatim as confirmed. Every test names the
 * guarantee it pins, e.g. "(H6)".
 *
 * # Batch H contract (confirmed 2026-10-08) — upstream #566 video uploads, #568 headings
 *
 * ## V — What can be uploaded
 *
 * H1 A feedback post, a comment, the widget and the admin editors accept an MP4, WebM, MOV or M4V video in addition to images, up to 100 MB per video. Images stay limited to 5 MB.
 * H2 What a file is decides whether it is stored, not what the browser says it is: a file is stored only when its bytes are the container it claims (an MP4 family file for MP4/MOV/M4V, WebM for WebM). An AVIF or HEIC image presented as a video is refused, and so is a video presented as an image.
 * H3 A file with no type or a generic one is judged by its extension, and then still by its bytes (H2).
 * H4 A refused upload stores nothing.
 *
 * ## A — Who can upload
 *
 * H5 Nobody without a session can upload.
 * H6 An anonymous portal visitor may upload only where the workspace lets anonymous visitors post; otherwise the upload is refused, as before.
 * H7 Uploads are limited per session (20 per minute). Because an anonymous session costs nothing to mint, anonymous uploads are additionally limited per client address, so one client cannot upload 2 GB a minute by rotating sessions.
 *
 * ## P — How a stored video is shown
 *
 * H8 A video in a post plays only from the workspace's own storage. A video pointing anywhere else is removed when the post is saved, so a post can never make the reader's browser contact a third party.
 * H9 A video source that is not http(s) (data:, javascript:, …) is removed, never rendered.
 * H10 Everything a person wrote into a video's attributes (title, type) reaches the page escaped; no attribute can break out of the video element.
 * H11 A stored video's type on the page is one of the accepted video types, whatever the stored attribute said.
 * H12 Videos saved before an editor offered videos stay visible and editable in every editor, including ones that do not offer video upload.
 *
 * ## S — Serving through the storage proxy
 *
 * H13 A video served through the storage proxy can be played from any point: a single byte range is answered with exactly those bytes (206), and the whole file with 200.
 * H14 A request for several ranges at once, or a malformed range, is answered with 416, never with the whole file.
 * H15 A range outside the file is answered with 416.
 * H16 A partial answer is never stored in, or served from, the proxy cache as if it were the whole file.
 * H17 Every proxied answer carries nosniff and the stored content type, so a browser never re-interprets an upload.
 *
 * ## L — Language and composer
 *
 * H18 Every control and message the video feature adds (menu item, toolbar button, remove button, failure message) reads in the page's language, in all nine languages, the German formal.
 * H19 The public feedback composer offers headings (#568; the fork already did, kept).
 */
/*
 * The public feedback composer's half of H1 and H6: which editor it hands the
 * visitor, and that an anonymous visitor's upload first mints the session the
 * server then judges. The server decides (see the portal upload suites); this
 * only proves the composer does not upload past a session it could not get.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ComponentProps, ReactNode } from 'react'
import { renderInGerman } from '@/test/render-with-intl'

const hoisted = vi.hoisted(() => ({
  routeContext: vi.fn(),
  editorProps: [] as Array<Record<string, unknown>>,
  ensureAnonSession: vi.fn(),
  uploadMedia: vi.fn(),
}))

vi.mock('@/lib/client/auth-client', () => ({ signOut: vi.fn() }))
vi.mock('@tanstack/react-router', () => ({
  useRouter: () => ({ invalidate: vi.fn() }),
  useRouteContext: () => hoisted.routeContext(),
}))
vi.mock('@/lib/client/hooks/use-auth-broadcast', () => ({ useAuthBroadcast: () => {} }))
vi.mock('@/components/ui/rich-text-editor', () => ({
  RichTextEditor: (props: Record<string, unknown>) => {
    hoisted.editorProps.push(props)
    return <textarea data-testid="feedback-editor" />
  },
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn() } }))
vi.mock('@/lib/client/hooks/use-image-upload', () => ({
  usePortalMediaUpload: () => ({ upload: hoisted.uploadMedia }),
}))
vi.mock('@/lib/client/mutations/portal-posts', () => ({
  useCreatePublicPost: () => ({ mutateAsync: vi.fn(), isPending: false }),
}))
vi.mock('@/components/auth/auth-popover-context', () => ({
  useAuthPopover: () => ({ openAuthPopover: vi.fn() }),
}))
vi.mock('@/lib/client/hooks/use-similar-posts', () => ({ useSimilarPosts: () => ({ posts: [] }) }))
vi.mock('@/lib/client/hooks/use-ensure-anon-session', () => ({
  useEnsureAnonSession: () => hoisted.ensureAnonSession,
}))
vi.mock('framer-motion', () => {
  function strip<T extends Record<string, unknown>>(props: T) {
    const { initial: _i, animate: _a, exit: _e, transition: _t, ...rest } = props
    return rest
  }
  return {
    motion: {
      div: ({ children, ...props }: ComponentProps<'div'> & Record<string, unknown>) => (
        <div {...(strip(props) as ComponentProps<'div'>)}>{children}</div>
      ),
      input: (props: ComponentProps<'input'> & Record<string, unknown>) => (
        <input {...(strip(props) as ComponentProps<'input'>)} />
      ),
    },
    AnimatePresence: ({ children }: { children: ReactNode }) => <>{children}</>,
  }
})

import { FeedbackHeaderAnimated } from '../feedback-header-animated'

type UploadProp = ((file: File) => Promise<string>) | undefined

function renderComposer(canSubmit: boolean) {
  const { container } = renderInGerman(
    <QueryClientProvider client={new QueryClient()}>
      <FeedbackHeaderAnimated
        workspaceName="Acme"
        boards={[]}
        defaultBoardId="board_1"
        boardPermissions={{ board_1: { canSubmit, canVote: true } }}
      />
    </QueryClientProvider>
  )
  const titleInput = container.querySelector('input[type="text"]') as HTMLInputElement
  fireEvent.change(titleInput, { target: { value: 'A' } })
  return hoisted.editorProps[hoisted.editorProps.length - 1]
}

const recording = new File([new Uint8Array([0, 0, 0, 0x18])], 'clip.mp4', { type: 'video/mp4' })

beforeEach(() => {
  hoisted.editorProps.length = 0
  hoisted.ensureAnonSession.mockReset()
  hoisted.uploadMedia.mockReset()
  hoisted.uploadMedia.mockResolvedValue('/api/storage/portal-media/clip.mp4')
  hoisted.routeContext.mockReturnValue({ session: null, settings: {} })
})

afterEach(() => cleanup())

describe('the public feedback composer (H1, H6)', () => {
  it('offers video upload to a visitor who may post anonymously (H1)', () => {
    const props = renderComposer(true)
    expect(props.features).toMatchObject({ videos: true, images: true, headings: true })
    expect(typeof props.onVideoUpload).toBe('function')
  })

  it('mints the anonymous session before it uploads (H6)', async () => {
    hoisted.ensureAnonSession.mockResolvedValue(true)
    const props = renderComposer(true)
    const upload = props.onVideoUpload as UploadProp
    await expect(upload?.(recording)).resolves.toBe('/api/storage/portal-media/clip.mp4')
    expect(hoisted.ensureAnonSession).toHaveBeenCalledBefore(hoisted.uploadMedia)
    expect(hoisted.uploadMedia).toHaveBeenCalledWith(recording)
  })

  it('uploads nothing when no session could be had (H5, H6)', async () => {
    hoisted.ensureAnonSession.mockResolvedValue(false)
    const props = renderComposer(true)
    const upload = props.onVideoUpload as UploadProp
    await expect(upload?.(recording)).rejects.toThrow()
    expect(hoisted.uploadMedia).not.toHaveBeenCalled()
  })

  it('offers no upload where the visitor may not post (H6)', () => {
    const props = renderComposer(false)
    expect(props.features).toMatchObject({ videos: false, images: false })
    expect(props.onVideoUpload).toBeUndefined()
    expect(props.onImageUpload).toBeUndefined()
  })
})
