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
 * This module holds C8.
 */
import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { ConversationAttachmentList } from '../conversation-attachments'

describe('ConversationAttachmentList', () => {
  it('renders image attachments with a contain-fitted thumb, not object-cover (C8)', () => {
    const { container } = render(
      <ConversationAttachmentList
        attachments={[
          {
            url: 'https://cdn.example.com/wide.png',
            name: 'wide.png',
            contentType: 'image/png',
            size: 100,
          },
        ]}
      />
    )
    const img = container.querySelector('img')
    expect(img).not.toBeNull()
    expect(img?.className).toContain('object-contain')
    expect(img?.className).not.toContain('object-cover')
  })

  it('renders a safe raster data-URI that lift would attach (C8)', () => {
    const src = 'data:image/png;base64,aaaa'
    const { container } = render(
      <ConversationAttachmentList
        attachments={[{ url: src, name: 'shot.png', contentType: 'image/png', size: 0 }]}
      />
    )
    expect(container.querySelector('img')?.getAttribute('src')).toBe(src)
  })

  it('drops javascript: and svg data-URI image srcs (C8)', () => {
    const { container } = render(
      <ConversationAttachmentList
        attachments={[
          {
            url: 'javascript:alert(1)',
            name: 'x',
            contentType: 'image/png',
            size: 0,
          },
          {
            url: 'data:image/svg+xml;base64,PHN2Zz4=',
            name: 'x.svg',
            contentType: 'image/svg+xml',
            size: 0,
          },
        ]}
      />
    )
    expect(container.querySelector('img')).toBeNull()
  })
})

describe('ConversationAttachmentList — which non-image attachments are shown', () => {
  /** The href of every file chip the list rendered, in order. */
  function renderedLinks(container: HTMLElement): (string | null)[] {
    return Array.from(container.querySelectorAll('a')).map((a) => a.getAttribute('href'))
  }

  it('shows a same-origin path and an http(s) URL, and drops everything else (C8)', () => {
    const { container } = render(
      <ConversationAttachmentList
        attachments={[
          // A path served by this instance — no protocol to inspect at all.
          {
            url: '/api/files/report.pdf',
            name: 'report.pdf',
            contentType: 'application/pdf',
            size: 2048,
          },
          {
            url: 'https://cdn.example.com/notes.txt',
            name: 'notes.txt',
            contentType: 'text/plain',
            size: 12,
          },
          {
            url: 'http://cdn.example.com/legacy.txt',
            name: 'legacy.txt',
            contentType: 'text/plain',
            size: 12,
          },
          {
            url: 'ftp://files.example.com/archive.zip',
            name: 'archive.zip',
            contentType: 'application/zip',
            size: 1,
          },
          { url: 'javascript:alert(1)', name: 'trap', contentType: 'application/pdf', size: 1 },
          // Relative but not rooted: `new URL` without a base cannot read it.
          {
            url: 'files/relative.pdf',
            name: 'relative.pdf',
            contentType: 'application/pdf',
            size: 1,
          },
        ]}
      />
    )

    expect(renderedLinks(container)).toEqual([
      '/api/files/report.pdf',
      'https://cdn.example.com/notes.txt',
      'http://cdn.example.com/legacy.txt',
    ])
  })

  it('labels a file chip with its name and a human size (C8)', () => {
    const { container } = render(
      <ConversationAttachmentList
        attachments={[
          {
            url: '/api/files/report.pdf',
            name: 'report.pdf',
            contentType: 'application/pdf',
            size: 2048,
          },
        ]}
      />
    )
    const chip = container.querySelector('a')
    expect(chip?.textContent).toContain('report.pdf')
    expect(chip?.textContent).toContain('2 KB')
    expect(container.querySelector('img')).toBeNull()
  })

  it('renders nothing at all when every attachment is unsafe (C8)', () => {
    const { container } = render(
      <ConversationAttachmentList
        attachments={[
          {
            url: 'ftp://files.example.com/archive.zip',
            name: 'archive.zip',
            contentType: 'application/zip',
            size: 1,
          },
        ]}
      />
    )
    expect(container.firstChild).toBeNull()
  })
})
