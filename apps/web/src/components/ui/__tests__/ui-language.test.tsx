// @vitest-environment happy-dom
/**
 * The rich-text editor and the primitives beside it, in the reader's language.
 *
 * U1 Every word the rich-text editor shows a person -- the toolbar buttons and
 *    their tooltips, what a screen reader announces, the prompt asking for a
 *    link, and what it says when an upload fails -- is in the language of the
 *    person writing. On the portal, in the admin and in the widget alike.
 * U2 Where a control carries both a tooltip and a screen-reader name, the two
 *    say the same thing in the same language. They are a pair; neither can be
 *    translated without the other.
 * U3 A keystroke in a tooltip stays as it is written on the keyboard. The word
 *    is translated, not the key -- a translated key names a key nobody has.
 * U4 An example showing the shape of an input (a specimen URL in a
 *    placeholder) is not translated, because it is not language.
 * U5 The editor reads the same on every surface that mounts it. Every word it
 *    can show is answered by every catalogue slice those surfaces load -- the
 *    same button is never German on the portal and English in the admin.
 * U6 A control whose text is missing shows readable English -- never an empty
 *    element, an empty tooltip or a key name. That is V6 for this surface, and
 *    it weighs more here than elsewhere: an empty `aria-label` is a control a
 *    screen reader cannot name at all.
 *
 * V17 Words a person brought themselves are never translated. Their name, the
 *     name of their organisation and a URL they typed pass through our
 *     sentences untouched.
 *
 * Everything renders in a second language, not in English. The `defaultMessage`
 * beside every id is this module's own English, so under `en` an editor that
 * never consults the catalogue renders exactly the same page -- and every
 * assertion here would hold against the untranslated version.
 *
 * U4 is not held here. It is a string that must stay as it is, so there is
 * nothing to render differently; what holds it is the i18n gate, which reports
 * any word in this file that is not answered by a catalogue and accepts a
 * reasoned `i18n-allow` note in its place (see `scripts/__tests__`).
 */
import { useState } from 'react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import '@testing-library/jest-dom/vitest'
import { screen, fireEvent, cleanup, render, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { IntlProvider, createIntl, type IntlConfig } from 'react-intl'
import { renderInGerman, renderInLocale } from '@/test/render-with-intl'
import { loadPortalMessages, loadWidgetMessages, SUPPORTED_LOCALES } from '@/lib/shared/i18n'
import germanMessages from '@/locales/de.json'
import frenchMessages from '@/locales/fr.json'
import enMessages from '@/locales/en.json'
import esMessages from '@/locales/es.json'
import arMessages from '@/locales/ar.json'
import ruMessages from '@/locales/ru.json'
import ptBrMessages from '@/locales/pt-br.json'
import zhCnMessages from '@/locales/zh-cn.json'
import zhTwMessages from '@/locales/zh-tw.json'

const hoisted = vi.hoisted(() => ({ toastError: vi.fn() }))
vi.mock('sonner', () => ({ toast: { error: hoisted.toastError } }))

vi.mock('@tanstack/react-router', () => ({
  useRouteContext: () => ({
    settings: { brandingData: { logoUrl: null, name: 'Ärzte Zentrum' }, name: 'Ärzte Zentrum' },
  }),
}))

import type { Editor } from '@tiptap/core'
import {
  RichTextEditor,
  getSlashMenuItems,
  SlashMenuList,
  handleImageDrop,
} from '../rich-text-editor'
import { MentionPicker, type MentionItem } from '../mention-picker'
import { DateTimePicker } from '../datetime-picker'

const german = germanMessages as Record<string, string>
const french = frenchMessages as Record<string, string>

const failOnIntlError: NonNullable<IntlConfig['onError']> = (error) => {
  throw error
}

/**
 * Every catalogue we ship, by locale.
 *
 * Written out rather than imported dynamically so a locale added to
 * `SUPPORTED_LOCALES` without a file here fails to compile, instead of the
 * checks below quietly grading eight languages and calling it nine.
 */
const CATALOGUES: Record<(typeof SUPPORTED_LOCALES)[number], Record<string, string>> = {
  en: enMessages,
  de: germanMessages,
  fr: frenchMessages,
  es: esMessages,
  ar: arMessages,
  ru: ruMessages,
  'pt-br': ptBrMessages,
  'zh-cn': zhCnMessages,
  'zh-tw': zhTwMessages,
}

function catalogueFor(locale: (typeof SUPPORTED_LOCALES)[number]): Record<string, string> {
  return CATALOGUES[locale]
}

/** The tooltip of every control the fixed toolbar renders. Built here rather
 *  than at module scope so a mutant that crashes it is reported as caught. */
function toolbarTooltips(): (string | null)[] {
  return screen.getAllByRole('button').map((button) => button.getAttribute('title'))
}

/** Enough of an editor for a slash command to run against: every chained call
 *  returns the chain, and the commands the rows reach for are recorded. The
 *  cast is at the seam rather than inside: a row's `command` takes the real
 *  `Editor`, and spelling out 57 members it never touches would say less about
 *  what these two tests need than this line does. */
function chainStub(): Editor {
  return chainStubShape() as unknown as Editor
}

function chainStubShape() {
  const chain: Record<string, () => unknown> = {}
  for (const step of ['focus', 'deleteRange', 'setParagraph', 'run']) {
    chain[step] = () => chain
  }
  return {
    chain: () => chain,
    commands: { setResizableImage: vi.fn(), setYoutubeVideo: vi.fn() },
  }
}

afterEach(() => {
  cleanup()
  hoisted.toastError.mockClear()
})

describe('the editor in the reader’s language (U1)', () => {
  it('names every control it renders in that language', () => {
    renderInGerman(<RichTextEditor value={undefined} onChange={() => {}} />)

    const tooltips = toolbarTooltips()
    for (const id of [
      'ui.editor.action.bold',
      'ui.editor.action.italic',
      'ui.editor.action.bulletList',
      'ui.editor.action.orderedList',
      'ui.editor.action.insertLink',
      'ui.editor.action.undo',
      'ui.editor.action.redo',
    ]) {
      expect(tooltips).toContain(german[id])
    }
    // Not the English beside the id, which is what an editor that never read
    // the catalogue would show.
    expect(tooltips).not.toContain('Bold')
    expect(tooltips).not.toContain('Undo')
  })

  it('writes its own placeholder in that language', () => {
    // The placeholder reaches the page through the extension set rather than
    // through markup, which is the half of this editor a render test can
    // otherwise miss entirely.
    renderInGerman(<RichTextEditor value={undefined} onChange={() => {}} />)

    expect(document.querySelector('[data-placeholder]')).toHaveAttribute(
      'data-placeholder',
      german['ui.editor.placeholder']
    )
  })

  it('asks for a link in that language', () => {
    const prompt = vi.fn().mockReturnValue(null)
    vi.stubGlobal('prompt', prompt)
    renderInGerman(<RichTextEditor value={undefined} onChange={() => {}} />)

    fireEvent.click(screen.getByTitle(german['ui.editor.action.insertLink']))

    expect(prompt.mock.calls[0][0]).toBe(german['ui.editor.link.promptLabel'])
    vi.unstubAllGlobals()
  })
})

/** German first, then French, with a button of its own to move between them.
 *  Two separate renders would not do: they would each build their extensions
 *  once and pass whether or not a language change reaches them. */
function SwitchableEditor() {
  const [locale, setLocale] = useState<'de' | 'fr'>('de')
  return (
    <IntlProvider
      locale={locale}
      messages={locale === 'de' ? german : french}
      onError={failOnIntlError}
    >
      <button type="button" onClick={() => setLocale('fr')}>
        move
      </button>
      <RichTextEditor value={undefined} onChange={() => {}} />
    </IntlProvider>
  )
}

describe('changing the language while the editor is mounted (U1)', () => {
  it('moves the markup and what the extensions were built with alike', () => {
    render(<SwitchableEditor />)
    expect(toolbarTooltips()).toContain(german['ui.editor.action.bold'])
    expect(document.querySelector('[data-placeholder]')).toHaveAttribute(
      'data-placeholder',
      german['ui.editor.placeholder']
    )

    fireEvent.click(screen.getByText('move'))

    expect(toolbarTooltips()).toContain(french['ui.editor.action.bold'])
    // The one that binds: the placeholder is held by a memoised extension set,
    // so an editor that rebuilds its markup but not its extensions keeps the
    // language it was mounted in and nothing else here would notice.
    expect(document.querySelector('[data-placeholder]')).toHaveAttribute(
      'data-placeholder',
      french['ui.editor.placeholder']
    )
    expect(german['ui.editor.placeholder']).not.toBe(french['ui.editor.placeholder'])
  })
})

describe('a tooltip and the name a screen reader announces (U2)', () => {
  it('are the same words for a control that carries only a tooltip', () => {
    renderInGerman(<RichTextEditor value={undefined} onChange={() => {}} />)

    const buttons = screen.getAllByRole('button')
    expect(buttons.length).toBeGreaterThan(5)
    // Unguarded, and the only assertion here that is: it names no id and skips
    // no control, so a button that arrives later with a tooltip and no name is
    // this test's finding rather than nobody's.
    for (const button of buttons) {
      const tooltip = button.getAttribute('title')
      expect(tooltip).not.toBe('')
      expect(button.getAttribute('aria-label')).toBe(tooltip)
    }
  })

  it('are a translated pair wherever the two deliberately differ', () => {
    // The image menu is the only place in this editor that gives a control
    // both, on purpose: the tooltip is short and the announced name says what
    // the click will do. It sits in a floating menu that opens on an image
    // selection, which this environment does not produce -- so the pair is
    // held here at the catalogue, in all nine languages at once.
    const pairs = [
      ['ui.editor.image.view', 'ui.editor.image.viewAria'],
      ['ui.editor.image.download', 'ui.editor.image.downloadAria'],
      ['ui.editor.image.copy', 'ui.editor.image.copyAria'],
      ['ui.editor.image.copyLink', 'ui.editor.image.copyLinkAria'],
      ['ui.editor.image.delete', 'ui.editor.image.deleteAria'],
    ]

    for (const locale of SUPPORTED_LOCALES) {
      const catalogue = catalogueFor(locale)
      for (const [tooltip, announced] of pairs) {
        expect(catalogue[tooltip]?.trim()).toBeTruthy()
        expect(catalogue[announced]?.trim()).toBeTruthy()
        // Translating one and leaving the other is how a German tooltip ends
        // up over an English screen-reader name, and collapsing the two loses
        // the fuller wording the announced name exists for.
        expect(catalogue[announced]).not.toBe(catalogue[tooltip])
      }
    }
  })
})

describe('a keystroke in a tooltip (U3)', () => {
  it('is never written into a catalogue, in any language we ship', () => {
    // The keystroke is handed to the frame from the source, so no catalogue
    // carries one and no translator can reword one. Checking the catalogues
    // rather than a rendered tooltip is what makes this hold for all nine at
    // once, in the one place a translation could go wrong.
    const keys = /\bCmd\b|\bCtrl\b|\bStrg\b|\bShift\b|\bUmschalt\b|⌘|⇧/
    const offenders: string[] = []

    for (const locale of SUPPORTED_LOCALES) {
      const catalogue = catalogueFor(locale)
      for (const [id, text] of Object.entries(catalogue)) {
        if (id.startsWith('ui.editor.') && keys.test(text)) offenders.push(`${locale}:${id}`)
      }
    }

    expect(offenders).toEqual([])
  })

  it('is put beside the translated action by a frame every language carries', () => {
    for (const locale of SUPPORTED_LOCALES) {
      const frame = catalogueFor(locale)['ui.editor.shortcutHint']

      expect(frame).toContain('{action}')
      expect(frame).toContain('{shortcut}')
    }
  })
})

describe('every surface that mounts the editor (U5)', () => {
  it('answers every message the editor can show', async () => {
    // The editor renders on all three surfaces, and each loads a slice of the
    // catalogue rather than the whole thing. A slice that does not carry `ui.`
    // is a German portal with an English editor inside it.
    const editorIds = Object.keys(catalogueFor('de')).filter(
      (id) => id.startsWith('ui.editor.') || id.startsWith('ui.mentionPicker.')
    )
    expect(editorIds.length).toBeGreaterThan(50)

    for (const slice of [await loadPortalMessages('de'), await loadWidgetMessages('de')]) {
      for (const id of editorIds) {
        expect(slice[id]).toBe(german[id])
      }
    }
  })
})

describe('a control whose text is missing (U6)', () => {
  it('still reads as English rather than as a blank or a key name', () => {
    // An empty catalogue under the default language: every id falls back to
    // the English written beside it. This is the state a newly added string
    // is in before its keys land, and the reader must still be able to use
    // the editor -- and a screen reader must still be able to name it.
    render(
      <IntlProvider locale="en" messages={{}} onError={failOnIntlError}>
        <RichTextEditor value={undefined} onChange={() => {}} />
      </IntlProvider>
    )

    for (const button of screen.getAllByRole('button')) {
      const announced = button.getAttribute('aria-label')
      expect(announced?.trim()).toBeTruthy()
      expect(announced).not.toContain('ui.editor.')
    }
    expect(toolbarTooltips()).toContain('Bold')
    expect(document.querySelector('[data-placeholder]')).toHaveAttribute(
      'data-placeholder',
      'Write something...'
    )
  })
})

/** A doc holding one node, so a node view mounts for real. */
function docWith(node: Record<string, unknown>) {
  return { type: 'doc', content: [node] }
}

describe('what the editor renders around a node (U1)', () => {
  it('names the control that removes an image in that language', () => {
    renderInGerman(
      <RichTextEditor
        value={docWith({ type: 'chatImage', attrs: { src: 'https://x.test/a.png' } })}
        onChange={() => {}}
        features={{ images: true }}
      />
    )

    expect(screen.getByLabelText(german['ui.imageNode.remove'])).toBeInTheDocument()
  })

  it('names the control that removes an embed in that language', () => {
    // The card inside the node fetches what it previews, so this one nests a
    // query client -- which is what the intl helper's own note says to do
    // rather than teaching that helper about every provider.
    renderInGerman(
      <QueryClientProvider client={new QueryClient()}>
        <RichTextEditor
          value={docWith({ type: 'quackbackEmbed', attrs: { kind: 'post', id: 'post_1' } })}
          onChange={() => {}}
          features={{ quackbackEmbeds: true }}
        />
      </QueryClientProvider>
    )

    expect(screen.getByLabelText(german['ui.embed.remove'])).toBeInTheDocument()
  })

  it('puts the keystroke beside the translated word, not inside it (U3)', () => {
    // The render side of U3. The bubble menu is what carries a shortcut, and
    // it mounts as soon as the document has something in it.
    // The shortcut tooltips live in the bubble menu, which shows on a
    // selection rather than on a cursor -- an image node is one.
    renderInGerman(
      <RichTextEditor
        value={docWith({ type: 'chatImage', attrs: { src: 'https://x.test/a.png' } })}
        onChange={() => {}}
        features={{ images: true }}
      />
    )

    const tooltips = toolbarTooltips()
    expect(tooltips).toContain(`${german['ui.editor.action.bold']} (Cmd+B)`)
    expect(tooltips).toContain(`${german['ui.editor.action.inlineCode']} (Cmd+E)`)
    expect(tooltips).not.toContain('Bold (Cmd+B)')
  })

  it('names the current block in that language (U1)', () => {
    // The trigger of the block-type menu. It reads `Text` here because the
    // selection is the image node; the heading short forms beside it need a
    // text selection inside a heading, which needs the editor instance this
    // component does not hand out. Those three are named in the commit as the
    // lines this batch leaves unexecuted.
    renderInGerman(
      <RichTextEditor
        value={docWith({ type: 'chatImage', attrs: { src: 'https://x.test/a.png' } })}
        onChange={() => {}}
        features={{ images: true, headings: true }}
      />
    )

    expect(screen.getByText(german['ui.editor.block.paragraph'])).toBeInTheDocument()
  })
})

describe('the table tools (U1)', () => {
  it('name every command in the reader’s language', () => {
    // The table toolbar shows while the cursor is inside a table, so a
    // document that is one puts it on the page.
    renderInGerman(
      <RichTextEditor
        value={docWith({
          type: 'table',
          content: [
            {
              type: 'tableRow',
              content: [{ type: 'tableCell', content: [{ type: 'paragraph' }] }],
            },
          ],
        })}
        onChange={() => {}}
        features={{ tables: true }}
        autofocus
      />
    )

    const tooltips = toolbarTooltips()
    for (const id of [
      'ui.editor.table.addRowAbove',
      'ui.editor.table.addRowBelow',
      'ui.editor.table.addColumnLeft',
      'ui.editor.table.addColumnRight',
    ]) {
      expect(tooltips).toContain(german[id])
    }
    expect(tooltips).not.toContain('Add row above')
  })
})

describe('what the editor says when an upload fails (U1)', () => {
  it('says it in the reader’s language', async () => {
    const created: HTMLInputElement[] = []
    const realCreateElement = document.createElement.bind(document)
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const element = realCreateElement(tag)
      if (tag === 'input') created.push(element as HTMLInputElement)
      return element
    })
    renderInGerman(
      <RichTextEditor
        value={undefined}
        onChange={() => {}}
        features={{ images: true }}
        onImageUpload={() => Promise.reject(new Error('no'))}
      />
    )

    fireEvent.click(screen.getByTitle(german['ui.editor.action.insertImage']))
    // The picker is a detached input the editor clicks; the spy above is the
    // only way to reach the handler it hangs on it.
    const picker = created.at(-1)!
    Object.defineProperty(picker, 'files', { value: [new File(['x'], 'a.png')] })
    await picker.onchange?.(new Event('change'))

    expect(hoisted.toastError).toHaveBeenCalledWith(german['ui.editor.image.uploadFailed'])
    expect(hoisted.toastError).not.toHaveBeenCalledWith("Couldn't upload image. Try again.")
    vi.restoreAllMocks()
  })
})

describe('an image pasted into the editor (U1)', () => {
  it('says in the reader’s language when it will not upload', async () => {
    renderInGerman(
      <RichTextEditor
        value={undefined}
        onChange={() => {}}
        features={{ images: true }}
        onImageUpload={() => Promise.reject(new Error('no'))}
      />
    )

    const surface = document.querySelector('.ProseMirror') as HTMLElement
    const file = new File(['x'], 'a.png', { type: 'image/png' })
    fireEvent.paste(surface, {
      clipboardData: {
        files: [file],
        items: [{ kind: 'file', type: 'image/png', getAsFile: () => file }],
        types: ['Files'],
      },
    })

    await waitFor(() =>
      expect(hoisted.toastError).toHaveBeenCalledWith(german['ui.editor.image.uploadFailed'])
    )
  })
})

describe('the slash-command menu (U1)', () => {
  /** The rows the menu offers, in a given language. */
  function slashRows(locale: 'de' | 'fr') {
    return getSlashMenuItems(
      createIntl({ locale, messages: locale === 'de' ? german : french }),
      { images: true, tables: true, embeds: true, headings: true },
      () => Promise.reject(new Error('no'))
    )
  }

  it('names and describes every row in the reader’s language', () => {
    const rows = slashRows('de')
    const titles = rows.map((row) => row.title)

    expect(titles).toContain(german['ui.editor.slash.table.title'])
    expect(titles).toContain(german['ui.editor.slash.youtube.title'])
    expect(rows.map((row) => row.description)).toContain(
      german['ui.editor.slash.table.description']
    )
    expect(titles).not.toContain('Table')
  })

  it('is searched on those words, so the menu answers in that language too', () => {
    // The reason the language is a required argument rather than an optional
    // one: the filter reads the row's own title, so a German reader typing
    // `/tabelle` against English rows would find nothing.
    const german_ = slashRows('de').map((row) => row.title)
    const french_ = slashRows('fr').map((row) => row.title)

    expect(german_).not.toEqual(french_)
    expect(german['ui.editor.slash.table.title'].toLowerCase()).toContain('tabelle')
  })

  it('asks for a video address in that language', () => {
    const prompt = vi.fn().mockReturnValue(null)
    vi.stubGlobal('prompt', prompt)
    const youtube = slashRows('de').find(
      (row) => row.title === german['ui.editor.slash.youtube.title']
    )!

    youtube.command({ editor: chainStub(), range: { from: 0, to: 1 } })

    expect(prompt).toHaveBeenCalledWith(german['ui.editor.youtube.prompt'])
    vi.unstubAllGlobals()
  })

  it('says an upload failed in that language', async () => {
    const created: HTMLInputElement[] = []
    const realCreateElement = document.createElement.bind(document)
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const element = realCreateElement(tag)
      if (tag === 'input') created.push(element as HTMLInputElement)
      return element
    })
    const image = slashRows('de').find(
      (row) => row.title === german['ui.editor.slash.image.title']
    )!

    image.command({ editor: chainStub(), range: { from: 0, to: 1 } })
    const picker = created.at(-1)!
    Object.defineProperty(picker, 'files', { value: [new File(['x'], 'a.png')] })
    await picker.onchange?.(new Event('change'))

    expect(hoisted.toastError).toHaveBeenCalledWith(german['ui.editor.image.uploadFailed'])
    vi.restoreAllMocks()
  })
})

describe('the list the slash popup mounts (U1)', () => {
  /** A German intl outside React, for the rows the list is handed. */
  function germanIntl() {
    return createIntl({ locale: 'de', messages: german })
  }

  it('names its groups and its rows in the reader’s language', () => {
    const rows = getSlashMenuItems(germanIntl(), { headings: true, tables: true })

    renderInGerman(<SlashMenuList items={rows} command={() => {}} />)

    // `Listen` and `Überschrift 1` rather than `Text`, which German keeps as
    // it is and which is both a group name and a row title.
    expect(screen.getByText(german['ui.editor.slash.group.lists'])).toBeInTheDocument()
    expect(screen.getByText(german['ui.editor.slash.heading1.title'])).toBeInTheDocument()
    expect(screen.queryByText('Lists')).toBeNull()
    expect(screen.queryByText('Heading 1')).toBeNull()
  })

  it('says so in the reader’s language when nothing matched what was typed', () => {
    renderInGerman(<SlashMenuList items={[]} command={() => {}} />)

    expect(screen.getByText(german['ui.editor.slash.empty'])).toBeInTheDocument()
    expect(screen.queryByText('No matching commands')).toBeNull()
  })
})

describe('an image dropped into the editor (U1)', () => {
  it('says an upload failed in the reader’s language', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const drop = handleImageDrop(createIntl({ locale: 'de', messages: german }), () =>
      Promise.reject(new Error('no'))
    )
    // Enough of a view for the handler to reach the upload: the failing path
    // never gets as far as inserting a node.
    const view = { state: { schema: { nodes: {} } }, posAtCoords: () => ({ pos: 1, inside: 0 }) }
    const event = {
      preventDefault: () => {},
      clientX: 0,
      clientY: 0,
      dataTransfer: { files: [new File(['x'], 'a.png', { type: 'image/png' })] },
    }

    expect(drop(view as never, event as never, null, false)).toBe(true)

    await waitFor(() =>
      expect(hoisted.toastError).toHaveBeenCalledWith(german['ui.editor.image.uploadFailed'])
    )
    expect(hoisted.toastError).not.toHaveBeenCalledWith("Couldn't upload image. Try again.")
    errors.mockRestore()
  })
})

describe('a date the picker shows (V11)', () => {
  it('is written the way the reader’s language writes one', () => {
    // The oracle is `Intl` asked for German outright, and the check below it
    // is what keeps this from passing on a date both languages agree on: what
    // is asserted is that the German form is on the page and the English one
    // is not, which is exactly what a hard-coded `MMM d, yyyy` got wrong.
    const when = new Date('2026-09-07T12:00:00Z')
    const fields = { day: 'numeric', month: 'short', year: 'numeric' } as const
    const inGerman = new Intl.DateTimeFormat('de', fields).format(when)
    const inEnglish = new Intl.DateTimeFormat('en', fields).format(when)
    expect(inGerman).not.toBe(inEnglish)

    renderInGerman(<DateTimePicker value={when} onChange={() => {}} dateOnly />)

    expect(screen.getByText(inGerman)).toBeInTheDocument()
    expect(screen.queryByText(inEnglish)).toBeNull()
  })

  it('keeps the separator between a date and a time it shows together', () => {
    const when = new Date('2026-09-07T12:00:00Z')

    renderInGerman(<DateTimePicker value={when} onChange={() => {}} />)

    // The time half is the runtime's zone, so this names the shape rather than
    // the hour: the date is the reader's, the `·` is the design's.
    expect(screen.getByText(/·/)).toHaveTextContent(
      new Intl.DateTimeFormat('de', { day: 'numeric', month: 'short', year: 'numeric' }).format(
        when
      )
    )
  })
})

describe('words a person brought themselves (V17)', () => {
  const items: MentionItem[] = [
    { principalId: 'principal_jane', displayName: 'Jane Doe', avatarUrl: null, role: 'member' },
  ]

  it('shows a display name exactly as it was given', () => {
    renderInGerman(<MentionPicker items={items} command={() => {}} />)

    expect(screen.getByText('Jane Doe')).toBeInTheDocument()
  })

  it('puts an organisation name into our sentence rather than through the catalogue', () => {
    renderInGerman(<MentionPicker items={items} command={() => {}} />)

    const badge = screen.getByTitle(/Ärzte Zentrum/)
    // Our half is German, their half is theirs. A frame rather than a name in
    // front of a bare noun, because German needs the preposition.
    expect(badge).toHaveAttribute('title', 'Mitglied von Ärzte Zentrum')
    expect(badge).toHaveAttribute('aria-label', 'Mitglied von Ärzte Zentrum')
  })

  it('hands a URL the reader typed back to them unchanged', () => {
    const prompt = vi.fn().mockReturnValue(null)
    vi.stubGlobal('prompt', prompt)
    renderInLocale('fr', <RichTextEditor value={undefined} onChange={() => {}} />)

    fireEvent.click(screen.getByTitle(french['ui.editor.action.insertLink']))

    // The label is ours and is French; the value beside it is whatever the
    // editor already held, and nothing in the catalogue touches it.
    expect(prompt).toHaveBeenCalledWith(french['ui.editor.link.promptLabel'], undefined)
    vi.unstubAllGlobals()
  })
})
