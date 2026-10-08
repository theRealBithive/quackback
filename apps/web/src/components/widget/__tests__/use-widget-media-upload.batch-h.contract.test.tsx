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
 * The widget's media upload: a widget session is minted lazily, so the hook
 * has to get one before it sends anything, and refuse a file it would never
 * store before it mints a session for it.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import { renderHook } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { installInMemoryLocalStorage } from '@/test/local-storage'
import { clearWidgetToken } from '@/lib/client/widget-auth'

installInMemoryLocalStorage()

vi.mock('@/lib/client/widget-bridge', () => ({ sendToHost: vi.fn() }))
vi.mock('@/lib/client/auth-client', () => ({
  authClient: { signIn: { anonymous: vi.fn() } },
}))
vi.mock('@/lib/shared/i18n', async (orig) => ({
  ...(await orig<typeof import('@/lib/shared/i18n')>()),
  loadMessages: vi.fn().mockResolvedValue({}),
}))

import { WidgetAuthProvider } from '../widget-auth-provider'
import { useWidgetMediaUpload, WidgetSessionError } from '../use-widget-image-upload'
import { authClient } from '@/lib/client/auth-client'

const mintAnon = vi.mocked(authClient.signIn.anonymous)
const MEGABYTE = 1024 * 1024

function mintSucceedsWith(token: string) {
  mintAnon.mockImplementation(async (opts?: unknown) => {
    const { fetchOptions } = (opts ?? {}) as {
      fetchOptions?: { onSuccess?: (ctx: { response: Response }) => void }
    }
    fetchOptions?.onSuccess?.({
      response: new Response(null, { headers: { 'set-auth-token': token } }),
    })
    return { data: { user: { id: 'anon' } }, error: null } as never
  })
}

function wrapper({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={new QueryClient()}>
      <WidgetAuthProvider portalSessionToken={null}>{children}</WidgetAuthProvider>
    </QueryClientProvider>
  )
}

const recording = () => new File([new Uint8Array(8)], 'clip.mov', { type: '' })

beforeEach(() => {
  clearWidgetToken()
  window.localStorage.clear()
  mintAnon.mockReset()
  vi.unstubAllGlobals()
})

describe('the widget media upload (H1, H3, H4, H5)', () => {
  it('mints a session, then sends the video to the widget upload with its Bearer (H1, H3, H5)', async () => {
    mintSucceedsWith('anon-video')
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ publicUrl: '/api/storage/widget-media/clip.mov' }),
    })
    vi.stubGlobal('fetch', fetchMock)
    const { result } = renderHook(() => useWidgetMediaUpload(), { wrapper })

    await expect(result.current.upload(recording())).resolves.toBe(
      '/api/storage/widget-media/clip.mov'
    )
    const [endpoint, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(endpoint).toBe('/api/widget/upload')
    expect(init.headers).toEqual({ Authorization: 'Bearer anon-video' })
    const form = init.body as FormData
    expect(form.get('prefix')).toBe('widget-media')
    expect((form.get('file') as File).type).toBe('video/quicktime')
  })

  it('sends nothing when no session can be had (H5)', async () => {
    mintAnon.mockResolvedValue({ data: null, error: { message: 'nope' } } as never)
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const onError = vi.fn()
    const { result } = renderHook(() => useWidgetMediaUpload({ onError }), { wrapper })

    await expect(result.current.upload(recording())).rejects.toBeInstanceOf(WidgetSessionError)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(onError.mock.calls[0][0]).toBeInstanceOf(WidgetSessionError)
  })

  it('refuses a file it would not store before minting a session for it (H1, H4)', async () => {
    mintSucceedsWith('anon-unused')
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const onError = vi.fn()
    const { result } = renderHook(() => useWidgetMediaUpload({ onError }), { wrapper })
    const refused = [
      new File([new Uint8Array(8)], 'clip.mkv', { type: 'video/x-matroska' }),
      new File([new Uint8Array(100 * MEGABYTE + 1)], 'clip.webm', { type: 'video/webm' }),
    ]
    for (const file of refused) {
      await expect(result.current.upload(file), file.name).rejects.toThrow()
    }
    expect(mintAnon).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(onError).toHaveBeenCalledTimes(refused.length)
  })
})
