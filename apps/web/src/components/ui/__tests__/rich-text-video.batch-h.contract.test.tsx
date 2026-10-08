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
 * The editor side of the contract. Every sentence is asserted against the
 * catalogue of the language the editor runs in — never against the English
 * written beside the id, which a component that ignores the catalogue would
 * show as well. `ui.editor.slash.video.title` is "Video" in German and English
 * alike, so that one is asserted in French, with a check that the two differ.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createIntl, type IntlShape } from 'react-intl'
import { Editor, type JSONContent } from '@tiptap/core'
import { Slice } from '@tiptap/pm/model'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import {
  buildExtensions,
  getSlashMenuItems,
  handleMediaDrop,
  RichTextEditor,
  type EditorFeatures,
} from '../rich-text-editor'
import { RichTextContent } from '../rich-text-content'
import { COMMENT_EDITOR_FEATURES } from '@/components/public/comment-editor-features'
import { PORTAL_POST_EDITOR_FEATURES } from '@/components/public/feedback/portal-post-editor-features'
import { renderInGerman, renderInLocale } from '@/test/render-with-intl'
import { installInMemoryLocalStorage } from '@/test/local-storage'
import arMessages from '@/locales/ar.json'
import deMessages from '@/locales/de.json'
import enMessages from '@/locales/en.json'
import esMessages from '@/locales/es.json'
import frMessages from '@/locales/fr.json'
import ptBrMessages from '@/locales/pt-br.json'
import ruMessages from '@/locales/ru.json'
import zhCnMessages from '@/locales/zh-cn.json'
import zhTwMessages from '@/locales/zh-tw.json'

const hoisted = vi.hoisted(() => ({ toastError: vi.fn() }))
vi.mock('sonner', () => ({ toast: { error: hoisted.toastError } }))

installInMemoryLocalStorage()

const CATALOGUES: Record<string, Record<string, string>> = {
  en: enMessages,
  de: deMessages,
  fr: frMessages,
  es: esMessages,
  ar: arMessages,
  ru: ruMessages,
  'pt-br': ptBrMessages,
  'zh-cn': zhCnMessages,
  'zh-tw': zhTwMessages,
}
const german = deMessages as Record<string, string>
const french = frMessages as Record<string, string>

const VIDEO_IDS = [
  'ui.editor.slash.video.title',
  'ui.editor.slash.video.description',
  'ui.editor.action.insertVideo',
  'ui.editor.video.remove',
  'ui.editor.video.uploadFailed',
]

function intlFor(locale: string): IntlShape {
  return createIntl({ locale, messages: CATALOGUES[locale] })
}

const SAVED_VIDEO = {
  type: 'video',
  attrs: {
    src: '/api/storage/portal-media/recording.mp4',
    mimeType: 'video/mp4',
    title: 'Recording',
  },
}

const POST_WITH_VIDEO: JSONContent = {
  type: 'doc',
  content: [
    { type: 'paragraph', content: [{ type: 'text', text: 'Before' }] },
    SAVED_VIDEO,
    { type: 'paragraph', content: [{ type: 'text', text: 'After' }] },
  ],
}

const UPLOAD_LESS_PRESETS: Record<string, EditorFeatures> = {
  'the bare editor': {},
  'the public feedback composer without uploads': PORTAL_POST_EDITOR_FEATURES,
  'an editor with uploads switched off': { images: false, videos: false },
  'the comment editor': COMMENT_EDITOR_FEATURES,
}

function videoFile(name = 'recording.mov', type = 'video/quicktime'): File {
  return new File([new Uint8Array([0, 0, 0, 0x18])], name, { type })
}

/** The TipTap editor behind the mounted RichTextEditor, as TipTap stores it on its DOM. */
async function mountedEditor(): Promise<Editor> {
  let editor: Editor | undefined
  await waitFor(() => {
    const dom = document.querySelector('.ProseMirror') as (HTMLElement & { editor?: Editor }) | null
    editor = dom?.editor
    expect(editor).toBeDefined()
  })
  return editor as Editor
}

/** Make the next file picker the editor opens choose `file`. */
function pickFileOnNextClick(file: File) {
  return vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(function (
    this: HTMLInputElement
  ) {
    Object.defineProperty(this, 'files', { value: [file], configurable: true })
    void this.onchange?.(new Event('change'))
  })
}

function fakeDropView() {
  const created: Array<{ type: string; attrs: unknown }> = []
  const view = {
    state: {
      schema: {
        nodes: {
          video: { create: (attrs: unknown) => (created.push({ type: 'video', attrs }), {}) },
          resizableImage: {
            create: (attrs: unknown) => (created.push({ type: 'image', attrs }), {}),
          },
        },
      },
      tr: { insert: () => ({}) },
    },
    posAtCoords: () => ({ pos: 1, inside: 0 }),
    dispatch: () => {},
  }
  return { view, created }
}

function dropEventWith(files: File[]) {
  return { preventDefault: () => {}, clientX: 0, clientY: 0, dataTransfer: { files } }
}

let consoleErrors: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  hoisted.toastError.mockClear()
  consoleErrors = vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('the editors offer a video where uploads are on (H1)', () => {
  it('offers the video slash entry exactly when videos are on and an upload is wired (H1)', () => {
    const upload = async () => '/api/storage/portal-media/a.mp4'
    const hasVideoEntry = (features: EditorFeatures, onVideoUpload?: typeof upload) =>
      getSlashMenuItems(intlFor('fr'), features, undefined, onVideoUpload).some(
        (item) => item.title === french['ui.editor.slash.video.title']
      )
    expect(hasVideoEntry({ videos: true }, upload)).toBe(true)
    expect(hasVideoEntry({ videos: true })).toBe(false)
    expect(hasVideoEntry({ videos: false }, upload)).toBe(false)
    expect(hasVideoEntry(COMMENT_EDITOR_FEATURES, upload)).toBe(true)
  })

  it('the comment editor turns videos on (H1)', () => {
    expect(COMMENT_EDITOR_FEATURES.videos).toBe(true)
  })

  it('a video dropped with no usable type is uploaded and inserted as a video (H1, H3)', async () => {
    const onVideoUpload = vi.fn(async () => '/api/storage/portal-media/clip.mov')
    const onImageUpload = vi.fn(async () => '/api/storage/portal-media/shot.png')
    const { view, created } = fakeDropView()
    const drop = handleMediaDrop(intlFor('de'), onImageUpload, onVideoUpload)
    const file = videoFile('clip.mov', '')

    expect(drop(view as never, dropEventWith([file]) as never, null, false)).toBe(true)
    await waitFor(() => expect(created).toHaveLength(1))
    expect(onVideoUpload).toHaveBeenCalledWith(file)
    expect(onImageUpload).not.toHaveBeenCalled()
    expect(created[0]).toEqual({
      type: 'video',
      attrs: {
        src: '/api/storage/portal-media/clip.mov',
        mimeType: 'video/quicktime',
        title: 'clip.mov',
      },
    })
  })

  it('a dropped video is left alone where only images may be uploaded (H1)', () => {
    const onImageUpload = vi.fn(async () => '/x.png')
    const { view } = fakeDropView()
    const drop = handleMediaDrop(intlFor('de'), onImageUpload, undefined)
    expect(drop(view as never, dropEventWith([videoFile()]) as never, null, false)).toBe(false)
    expect(onImageUpload).not.toHaveBeenCalled()
  })

  it('the toolbar button uploads the chosen video and inserts it (H1)', async () => {
    const onVideoUpload = vi.fn(async () => '/api/storage/portal-media/clip.webm')
    renderInGerman(
      <RichTextEditor
        value={undefined}
        onChange={() => {}}
        features={{ videos: true }}
        onVideoUpload={onVideoUpload}
      />
    )
    const editor = await mountedEditor()
    pickFileOnNextClick(videoFile('clip.webm', 'video/webm'))
    fireEvent.click(screen.getByTitle(german['ui.editor.action.insertVideo']))
    await waitFor(() =>
      expect(JSON.stringify(editor.getJSON())).toContain('/api/storage/portal-media/clip.webm')
    )
    const video = editor.getJSON().content?.find((node) => node.type === 'video')
    expect(video?.attrs).toEqual({
      src: '/api/storage/portal-media/clip.webm',
      mimeType: 'video/webm',
      title: 'clip.webm',
    })
  })

  it('a pasted video is uploaded and inserted (H1)', async () => {
    const onVideoUpload = vi.fn(async () => '/api/storage/portal-media/pasted.mp4')
    renderInGerman(
      <RichTextEditor
        value={undefined}
        onChange={() => {}}
        features={{ videos: true }}
        onVideoUpload={onVideoUpload}
      />
    )
    const editor = await mountedEditor()
    const file = videoFile('pasted.mp4', 'video/mp4')
    const event = {
      preventDefault: () => {},
      clipboardData: { getData: () => '', items: [{ getAsFile: () => file }] },
    }
    const handled = editor.view.someProp('handlePaste', (handle) =>
      handle(editor.view, event as never, Slice.empty)
    )
    expect(handled).toBe(true)
    await waitFor(() => expect(JSON.stringify(editor.getJSON())).toContain('pasted.mp4'))
    expect(onVideoUpload).toHaveBeenCalledWith(file)
  })

  it('pasting something that is not media is left to the editor (H1)', async () => {
    renderInGerman(
      <RichTextEditor
        value={undefined}
        onChange={() => {}}
        features={{ videos: true }}
        onVideoUpload={async () => '/x.mp4'}
      />
    )
    const editor = await mountedEditor()
    const event = {
      preventDefault: () => {},
      clipboardData: { getData: () => '', items: [{ getAsFile: () => null }] },
    }
    const handled = editor.view.someProp('handlePaste', (handle) =>
      handle(editor.view, event as never, Slice.empty)
    )
    expect(handled).toBeFalsy()
  })
})

describe('videos saved before an editor offered them stay (H12)', () => {
  for (const [surface, features] of Object.entries(UPLOAD_LESS_PRESETS)) {
    it(`${surface} keeps a saved video through an edit (H12)`, () => {
      const editor = new Editor({
        extensions: buildExtensions(features, { placeholder: '', intl: intlFor('en') }),
        content: POST_WITH_VIDEO,
      })
      editor.commands.focus('end')
      editor.commands.insertContent(' edited')
      const saved = editor.getJSON()
      expect(saved.content?.filter((node) => node.type === 'video')).toEqual([SAVED_VIDEO])
      expect(editor.getHTML()).toContain('src="/api/storage/portal-media/recording.mp4"')
      editor.destroy()
    })
  }

  it('the reader still sees a saved video (H12)', () => {
    renderInGerman(<RichTextContent content={POST_WITH_VIDEO} />)
    const video = document.querySelector('video')
    expect(video?.getAttribute('src')).toBe('/api/storage/portal-media/recording.mp4')
  })

  it('a mounted editor without video upload shows the saved video (H12)', async () => {
    renderInGerman(<RichTextEditor value={POST_WITH_VIDEO} onChange={() => {}} features={{}} />)
    await waitFor(() =>
      expect(document.querySelector('.ProseMirror video')?.getAttribute('src')).toBe(
        '/api/storage/portal-media/recording.mp4'
      )
    )
  })
})

describe('every control and message the video feature adds reads in the page’s language (H18)', () => {
  it('has all its sentences in all nine catalogues, each translated where the language differs (H18)', () => {
    for (const [locale, catalogue] of Object.entries(CATALOGUES)) {
      for (const id of VIDEO_IDS) {
        expect(catalogue[id], `${locale} ${id}`).toEqual(expect.any(String))
        expect(catalogue[id].length, `${locale} ${id}`).toBeGreaterThan(0)
      }
    }
    expect(german['ui.editor.video.uploadFailed']).toContain('Sie')
    expect(french['ui.editor.slash.video.title']).not.toBe(german['ui.editor.slash.video.title'])
  })

  it('names the slash entry in the language the editor runs in, in all nine (H18)', () => {
    const upload = async () => '/x.mp4'
    for (const locale of Object.keys(CATALOGUES)) {
      const titles = getSlashMenuItems(intlFor(locale), { videos: true }, undefined, upload).map(
        (item) => [item.title, item.description]
      )
      expect(titles, locale).toContainEqual([
        CATALOGUES[locale]['ui.editor.slash.video.title'],
        CATALOGUES[locale]['ui.editor.slash.video.description'],
      ])
    }
  })

  it('titles the toolbar button in the reader’s language (H18)', () => {
    renderInLocale(
      'fr',
      <RichTextEditor
        value={undefined}
        onChange={() => {}}
        features={{ videos: true }}
        onVideoUpload={async () => '/x.mp4'}
      />
    )
    expect(screen.getByTitle(french['ui.editor.action.insertVideo'])).toBeInTheDocument()
    expect(screen.queryByTitle('Insert Video')).toBeNull()
  })

  it('labels the remove button in the reader’s language, and it removes the video (H18)', async () => {
    renderInGerman(<RichTextEditor value={POST_WITH_VIDEO} onChange={() => {}} features={{}} />)
    const remove = await screen.findByLabelText(german['ui.editor.video.remove'])
    expect(screen.queryByLabelText('Remove video')).toBeNull()
    const editor = await mountedEditor()
    fireEvent.click(remove)
    await waitFor(() =>
      expect(editor.getJSON().content?.some((node) => node.type === 'video')).toBe(false)
    )
  })

  it('says a dropped video failed to upload in the reader’s language (H18)', async () => {
    const { view } = fakeDropView()
    const drop = handleMediaDrop(intlFor('de'), undefined, () => Promise.reject(new Error('no')))
    expect(drop(view as never, dropEventWith([videoFile()]) as never, null, false)).toBe(true)
    await waitFor(() =>
      expect(hoisted.toastError).toHaveBeenCalledWith(german['ui.editor.video.uploadFailed'])
    )
    expect(consoleErrors).toHaveBeenCalled()
  })

  it('says a pasted video failed to upload in the reader’s language (H18)', async () => {
    renderInGerman(
      <RichTextEditor
        value={undefined}
        onChange={() => {}}
        features={{ videos: true }}
        onVideoUpload={() => Promise.reject(new Error('no'))}
      />
    )
    const editor = await mountedEditor()
    const file = videoFile()
    const event = {
      preventDefault: () => {},
      clipboardData: { getData: () => '', items: [{ getAsFile: () => file }] },
    }
    editor.view.someProp('handlePaste', (handle) =>
      handle(editor.view, event as never, Slice.empty)
    )
    await waitFor(() =>
      expect(hoisted.toastError).toHaveBeenCalledWith(german['ui.editor.video.uploadFailed'])
    )
  })

  it('says a video chosen from the toolbar failed to upload in the reader’s language (H18)', async () => {
    renderInGerman(
      <RichTextEditor
        value={undefined}
        onChange={() => {}}
        features={{ videos: true }}
        onVideoUpload={() => Promise.reject(new Error('no'))}
      />
    )
    await mountedEditor()
    pickFileOnNextClick(videoFile())
    fireEvent.click(screen.getByTitle(german['ui.editor.action.insertVideo']))
    await waitFor(() =>
      expect(hoisted.toastError).toHaveBeenCalledWith(german['ui.editor.video.uploadFailed'])
    )
  })

  it('says a video chosen from the slash menu failed to upload in the reader’s language (H18)', async () => {
    const editor = new Editor({
      extensions: buildExtensions({ videos: true }, { placeholder: '', intl: intlFor('de') }),
    })
    const item = getSlashMenuItems(intlFor('de'), { videos: true }, undefined, () =>
      Promise.reject(new Error('no'))
    ).find((entry) => entry.title === german['ui.editor.slash.video.title'])
    pickFileOnNextClick(videoFile())
    item?.command({ editor, range: { from: 1, to: 1 } })
    await waitFor(() =>
      expect(hoisted.toastError).toHaveBeenCalledWith(german['ui.editor.video.uploadFailed'])
    )
    editor.destroy()
  })

  it('inserts a video chosen from the slash menu (H1)', async () => {
    const editor = new Editor({
      extensions: buildExtensions({ videos: true }, { placeholder: '', intl: intlFor('de') }),
    })
    const item = getSlashMenuItems(
      intlFor('de'),
      { videos: true },
      undefined,
      async () => '/api/storage/portal-media/slash.m4v'
    ).find((entry) => entry.title === german['ui.editor.slash.video.title'])
    pickFileOnNextClick(videoFile('slash.m4v', ''))
    item?.command({ editor, range: { from: 1, to: 1 } })
    await waitFor(() =>
      expect(editor.getJSON().content?.find((node) => node.type === 'video')?.attrs).toEqual({
        src: '/api/storage/portal-media/slash.m4v',
        mimeType: 'video/x-m4v',
        title: 'slash.m4v',
      })
    )
    editor.destroy()
  })
})

describe('the public feedback composer offers headings (H19)', () => {
  it('turns headings on, and its editor can make one (H19)', () => {
    expect(PORTAL_POST_EDITOR_FEATURES.headings).toBe(true)
    const editor = new Editor({
      extensions: buildExtensions(PORTAL_POST_EDITOR_FEATURES, {
        placeholder: '',
        intl: intlFor('en'),
      }),
      content: '<p>Title</p>',
    })
    editor.commands.setTextSelection(1)
    expect(editor.can().toggleHeading({ level: 2 })).toBe(true)
    editor.commands.toggleHeading({ level: 2 })
    expect(editor.getJSON().content?.[0]?.type).toBe('heading')
    editor.destroy()
  })

  it('a heading typed into the composer survives as a heading (H19)', () => {
    const editor = new Editor({
      extensions: buildExtensions(PORTAL_POST_EDITOR_FEATURES, {
        placeholder: '',
        intl: intlFor('en'),
      }),
      content: '<h2>Steps</h2><p>One</p>',
    })
    expect(editor.getJSON().content?.[0]).toMatchObject({ type: 'heading', attrs: { level: 2 } })
    editor.destroy()
  })
})
