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
 * The client upload hooks the portal and admin editors use: what they send,
 * where, and what they refuse before sending anything.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { usePortalMediaUpload, usePostMediaUpload, useMediaUpload } from '../use-image-upload'

const MEGABYTE = 1024 * 1024

function okResponse(publicUrl: string) {
  return { ok: true, json: async () => ({ publicUrl }) }
}

function sentForm(fetchMock: ReturnType<typeof vi.fn>): { endpoint: string; form: FormData } {
  const [endpoint, init] = fetchMock.mock.calls[0] as [string, RequestInit]
  return { endpoint, form: init.body as FormData }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('the portal and admin upload hooks (H1, H3, H4)', () => {
  it('sends a portal video to the portal upload with the portal-media prefix (H1)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse('/api/storage/portal-media/a.mp4'))
    vi.stubGlobal('fetch', fetchMock)
    const { result } = renderHook(() => usePortalMediaUpload())
    const file = new File([new Uint8Array(8)], 'a.mp4', { type: 'video/mp4' })

    await expect(result.current.upload(file)).resolves.toBe('/api/storage/portal-media/a.mp4')
    const { endpoint, form } = sentForm(fetchMock)
    expect(endpoint).toBe('/api/portal/upload')
    expect(form.get('prefix')).toBe('portal-media')
  })

  it('sends an admin post video to the admin upload with the post-media prefix (H1)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse('/api/storage/post-media/a.webm'))
    vi.stubGlobal('fetch', fetchMock)
    const { result } = renderHook(() => usePostMediaUpload())
    await result.current.upload(new File([new Uint8Array(8)], 'a.webm', { type: 'video/webm' }))
    const { endpoint, form } = sentForm(fetchMock)
    expect(endpoint).toBe('/api/upload/image')
    expect(form.get('prefix')).toBe('post-media')
  })

  it('sends an untyped file under the type its extension names (H3)', async () => {
    const cases: Array<[string, string]> = [
      ['clip.mov', 'video/quicktime'],
      ['clip.M4V', 'video/x-m4v'],
      ['shot.png', 'image/png'],
    ]
    for (const [name, expected] of cases) {
      const fetchMock = vi.fn().mockResolvedValue(okResponse('/x'))
      vi.stubGlobal('fetch', fetchMock)
      const { result } = renderHook(() => useMediaUpload())
      const lastModified = 1_700_000_000_000
      await result.current.upload(new File([new Uint8Array(8)], name, { type: '', lastModified }))
      const sent = sentForm(fetchMock).form.get('file') as File
      expect(sent.type, name).toBe(expected)
      expect(sent.name, name).toBe(name)
      expect(sent.lastModified, name).toBe(lastModified)
    }
  })

  it('sends a typed file as it is (H3)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse('/x'))
    vi.stubGlobal('fetch', fetchMock)
    const { result } = renderHook(() => useMediaUpload())
    const file = new File([new Uint8Array(8)], 'clip.mov', { type: 'video/mp4' })
    await result.current.upload(file)
    expect(sentForm(fetchMock).form.get('file')).toBe(file)
  })

  it('refuses before sending: a type it does not accept, a video over 100 MB (H1, H4)', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const onError = vi.fn()
    const { result } = renderHook(() => usePortalMediaUpload({ onError }))
    const refused = [
      new File([new Uint8Array(8)], 'clip.mkv', { type: 'video/x-matroska' }),
      new File([new Uint8Array(8)], 'clip.avi', { type: '' }),
      new File([new Uint8Array(100 * MEGABYTE + 1)], 'clip.mp4', { type: 'video/mp4' }),
    ]
    for (const file of refused) {
      await expect(result.current.upload(file), file.name).rejects.toThrow()
    }
    expect(fetchMock).not.toHaveBeenCalled()
    expect(onError).toHaveBeenCalledTimes(refused.length)
  })
})
