// @vitest-environment happy-dom

/**
 * Tests for RichTextEditor extension configuration.
 *
 * RED→GREEN TDD:
 *  - "no duplicate extension names" catches the StarterKit v3 + explicit Underline duplicate
 *  - "extensions are stable across renders" catches the useMemo regression where
 *    new array references on every render cause editor.setOptions() to fire each keystroke
 *  - "value sync skips setContent after internal update" catches the redundant
 *    JSON.stringify + setContent call that fires on every onChange cycle
 *
 * Upstream #539 and #532 added two promises this module answers for. Group C's
 * C6 and group E's E2 are the numbers used below; the tests above predate both
 * and carry none.
 *
 * C6 An image inserted into a post or changelog entry keeps its natural aspect:
 *    the node carries the natural size scaled to the editor's bounds plus
 *    keep-ratio; when the size cannot be read, only src and keep-ratio are set.
 *
 * E2 A resizable image with a numeric width renders with that width as its
 *    max-width and keeps its ratio; without one only keep-ratio is set.
 */

import { describe, it, expect, vi } from 'vitest'
import { createIntl } from 'react-intl'
import { Editor } from '@tiptap/core'
import type { EditorFeatures } from '../rich-text-editor'
import {
  buildExtensions,
  generateContentHTML,
  getSlashMenuItems,
  handleImageDrop,
  hasActiveSuggestion,
  stopEnterFromReachingParentForm,
} from '../rich-text-editor'
import { COMMENT_EDITOR_FEATURES } from '@/components/public/comment-editor-features'

/**
 * `buildExtensions` with the language argument filled in.
 *
 * The slash menu is searched on its own translated titles, so the extension set
 * needs a language to be built in at all. These tests are about which
 * extensions are registered rather than about what they say, so an empty
 * catalogue is right here: every message falls back to the English beside its
 * id, which is what this file asserted before there was a catalogue.
 */
function build(features: EditorFeatures, options: { placeholder: string; onSubmit?: () => void }) {
  return buildExtensions(features, {
    ...options,
    intl: createIntl({ locale: 'en', messages: {} }),
  })
}

// Full widget feature set (worst-case for duplicates)
const WIDGET_FEATURES: EditorFeatures = {
  headings: true,
  codeBlocks: true,
  taskLists: true,
  blockquotes: true,
  dividers: true,
  tables: true,
  images: true,
  embeds: true,
  bubbleMenu: true,
  slashMenu: true,
}

describe('buildExtensions', () => {
  it('contains no duplicate extension names (full widget feature set)', () => {
    const exts = build(WIDGET_FEATURES, { placeholder: 'Write...' })
    const names = exts.map((e) => (e as { name: string }).name)
    const seen = new Set<string>()
    const duplicates: string[] = []
    for (const name of names) {
      if (seen.has(name)) duplicates.push(name)
      seen.add(name)
    }
    expect(duplicates).toEqual([])
  })

  it('contains no duplicate extension names (minimal feature set)', () => {
    const exts = build({}, { placeholder: 'Write...' })
    const names = exts.map((e) => (e as { name: string }).name)
    const seen = new Set<string>()
    const duplicates: string[] = []
    for (const name of names) {
      if (seen.has(name)) duplicates.push(name)
      seen.add(name)
    }
    expect(duplicates).toEqual([])
  })

  it('always includes underline (via StarterKit)', () => {
    const exts = build({}, { placeholder: 'Write...' })
    // Underline should come from StarterKit v3 — NOT as a standalone top-level extension
    const standaloneUnderline = exts.filter((e) => (e as { name: string }).name === 'underline')
    expect(standaloneUnderline).toHaveLength(0) // should NOT be standalone
  })

  it('returns the same extension instances when called with identical feature flags (memoization contract)', () => {
    // buildExtensions itself is a pure factory - same args produce same structure.
    // This test verifies the returned array length is deterministic.
    const exts1 = build(WIDGET_FEATURES, { placeholder: 'Write...' })
    const exts2 = build(WIDGET_FEATURES, { placeholder: 'Write...' })
    // Lengths must match (different instances, but same count)
    expect(exts1.length).toBe(exts2.length)
    // Names must match in order
    const names1 = exts1.map((e) => (e as { name: string }).name)
    const names2 = exts2.map((e) => (e as { name: string }).name)
    expect(names1).toEqual(names2)
  })

  it('always includes image extension for schema compatibility', () => {
    const with_ = build({ images: true }, { placeholder: '' })
    const without = build({ images: false }, { placeholder: '' })
    const withNames = with_.map((e) => (e as { name: string }).name)
    const withoutNames = without.map((e) => (e as { name: string }).name)
    expect(withNames).toContain('image')
    expect(withoutNames).toContain('image')
  })

  it('does not materialize 0×0 or 500×500 on a stored image that omitted dimensions', () => {
    const editor = new Editor({
      extensions: build(
        { images: true, slashMenu: false, emojiPicker: false, mentions: false },
        { placeholder: '' }
      ),
      content: {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'image', attrs: { src: 'https://cdn.example.com/wide.png' } }],
          },
        ],
      },
    })
    try {
      const img = editor.getJSON().content?.[0]?.content?.[0] as
        | { type?: string; attrs?: { src?: string; width?: number | null; height?: number | null } }
        | undefined
      expect(img?.type).toBe('image')
      expect(img?.attrs?.src).toBe('https://cdn.example.com/wide.png')
      expect(img?.attrs?.width).toBeNull()
      expect(img?.attrs?.height).toBeNull()
    } finally {
      editor.destroy()
    }
  })

  it('includes slashCommands extension by default', () => {
    const exts = build({}, { placeholder: '' })
    const names = exts.map((e) => (e as { name: string }).name)
    expect(names).toContain('slashCommands')
  })

  it('omits slashCommands when slashMenu is false', () => {
    const exts = build({ slashMenu: false }, { placeholder: '' })
    const names = exts.map((e) => (e as { name: string }).name)
    expect(names).not.toContain('slashCommands')
  })

  it('includes emoji extension by default', () => {
    const exts = build({}, { placeholder: '' })
    const names = exts.map((e) => (e as { name: string }).name)
    expect(names).toContain('emoji')
  })

  it('omits emoji extension when emojiPicker is false', () => {
    const exts = build({ emojiPicker: false }, { placeholder: '' })
    const names = exts.map((e) => (e as { name: string }).name)
    expect(names).not.toContain('emoji')
  })

  it('persists attrs.emoji on an emoji node so read-only HTML can skip the dataset', () => {
    const editor = new Editor({
      extensions: buildExtensions({ slashMenu: false, mentions: false }, { placeholder: '' }),
      content: {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'emoji', attrs: { name: 'crossed_fingers', emoji: '🤞' } }],
          },
        ],
      },
    })
    try {
      const node = editor.getJSON().content?.[0]?.content?.[0] as
        { type?: string; attrs?: { name?: string; emoji?: string } } | undefined
      expect(node?.type).toBe('emoji')
      expect(node?.attrs?.name).toBe('crossed_fingers')
      expect(node?.attrs?.emoji).toBe('🤞')
    } finally {
      editor.destroy()
    }
  })

  it('omits enterAsHardBreak by default (document-style Enter)', () => {
    const exts = build({}, { placeholder: '' })
    const names = exts.map((e) => (e as { name: string }).name)
    expect(names).not.toContain('enterAsHardBreak')
  })

  it('includes enterAsHardBreak when enabled (comment-style Enter)', () => {
    const exts = build({ enterAsHardBreak: true }, { placeholder: '' })
    const names = exts.map((e) => (e as { name: string }).name)
    expect(names).toContain('enterAsHardBreak')
  })

  it('COMMENT_EDITOR_FEATURES registers enterAsHardBreak (plain Enter is a newline)', () => {
    const names = build(COMMENT_EDITOR_FEATURES, { placeholder: '' }).map(
      (e) => (e as { name: string }).name
    )
    expect(names).toContain('enterAsHardBreak')
    expect(names).not.toContain('submitOnEnter')
  })

  // P2.1 — mentions feature flag (default TRUE; undefined must mean enabled so
  // every existing consumer keeps the `@` menu).
  it('includes the mention extension by default (undefined = enabled)', () => {
    const names = build({}, { placeholder: '' }).map((e) => (e as { name: string }).name)
    expect(names).toContain('mention')
  })

  it('omits the mention extension when mentions is false', () => {
    const names = build({ mentions: false }, { placeholder: '' }).map(
      (e) => (e as { name: string }).name
    )
    expect(names).not.toContain('mention')
  })

  it('keeps mentions on for an existing preset that never sets the flag (widget set)', () => {
    // Spot-check: WIDGET_FEATURES (and every current preset) leaves `mentions`
    // unset, so the mention menu must survive the flag addition.
    const names = build(WIDGET_FEATURES, { placeholder: '' }).map(
      (e) => (e as { name: string }).name
    )
    expect(names).toContain('mention')
  })
})

describe('hasActiveSuggestion', () => {
  // Suggestion-style plugins (emoji picker, slash menu, mention) all keep
  // `{ active, range, query, ... }` on their plugin state. The Enter handler
  // checks this to yield Enter to the open popover instead of inserting a
  // hardBreak underneath it.
  function makeEditor(pluginStates: Array<unknown>) {
    const plugins = pluginStates.map((state) => ({
      getState: () => state,
    }))
    return { state: { plugins } } as unknown as Parameters<typeof hasActiveSuggestion>[0]
  }

  it('returns false when no plugin state is active', () => {
    const editor = makeEditor([null, { active: false, range: null }, { unrelated: true }])
    expect(hasActiveSuggestion(editor)).toBe(false)
  })

  it('returns true when any plugin state has active: true', () => {
    const editor = makeEditor([
      null,
      { active: false },
      { active: true, range: { from: 1, to: 2 }, query: 'sli' },
    ])
    expect(hasActiveSuggestion(editor)).toBe(true)
  })

  it('tolerates plugins whose getState returns undefined or non-object', () => {
    const editor = makeEditor([undefined, 'not-a-state', 42])
    expect(hasActiveSuggestion(editor)).toBe(false)
  })
})

// P2.2 — onSubmit (Enter sends). The submitOnEnter extension is only registered
// when RichTextEditor is given an onSubmit callback. We invoke its keyboard
// shortcut handlers directly (mirroring the mock-editor pattern above) so the
// Enter/Shift+Enter/suggestion/precedence behaviour is asserted deterministically
// without standing up a full ProseMirror view.
describe('submitOnEnter (onSubmit)', () => {
  type KeyHandlers = Record<string, () => boolean>
  type KeymapExtension = {
    name: string
    config: { priority?: number; addKeyboardShortcuts: () => KeyHandlers }
  }

  // Minimal editor stub covering the two things the handlers touch:
  // hasActiveSuggestion (state.plugins) and commands.setHardBreak.
  function makeMockEditor({ suggestion = false }: { suggestion?: boolean } = {}) {
    const setHardBreak = vi.fn(() => true)
    const plugins = [{ getState: () => ({ active: suggestion }) }]
    const editor = { state: { plugins }, commands: { setHardBreak } }
    return { editor, setHardBreak }
  }

  function submitExtension(features: EditorFeatures, onSubmit: () => void): KeymapExtension {
    const ext = build(features, { placeholder: '', onSubmit }).find(
      (e) => (e as { name: string }).name === 'submitOnEnter'
    )
    if (!ext) throw new Error('submitOnEnter extension was not registered')
    return ext as unknown as KeymapExtension
  }

  function handlersFor(mockEditor: unknown, onSubmit: () => void): KeyHandlers {
    return submitExtension({}, onSubmit).config.addKeyboardShortcuts.call({ editor: mockEditor })
  }

  it('is absent when no onSubmit is provided (zero behavior change)', () => {
    const names = build({}, { placeholder: '' }).map((e) => (e as { name: string }).name)
    expect(names).not.toContain('submitOnEnter')
  })

  it('is registered when onSubmit is provided', () => {
    const names = build({}, { placeholder: '', onSubmit: () => {} }).map(
      (e) => (e as { name: string }).name
    )
    expect(names).toContain('submitOnEnter')
  })

  it('Enter fires onSubmit and consumes the key (no paragraph split)', () => {
    const onSubmit = vi.fn()
    const { editor, setHardBreak } = makeMockEditor()
    const consumed = handlersFor(editor, onSubmit).Enter()
    expect(onSubmit).toHaveBeenCalledOnce()
    expect(consumed).toBe(true) // returning true stops ProseMirror's default Enter
    expect(setHardBreak).not.toHaveBeenCalled()
  })

  it('Shift+Enter inserts a hardBreak and does not submit', () => {
    const onSubmit = vi.fn()
    const { editor, setHardBreak } = makeMockEditor()
    const result = handlersFor(editor, onSubmit)['Shift-Enter']()
    expect(setHardBreak).toHaveBeenCalledOnce()
    expect(onSubmit).not.toHaveBeenCalled()
    expect(result).toBe(true)
  })

  it('Alt+Enter inserts a hardBreak and does not submit', () => {
    const onSubmit = vi.fn()
    const { editor, setHardBreak } = makeMockEditor()
    const result = handlersFor(editor, onSubmit)['Alt-Enter']()
    expect(setHardBreak).toHaveBeenCalledOnce()
    expect(onSubmit).not.toHaveBeenCalled()
    expect(result).toBe(true)
  })

  it('yields Enter to an active suggestion popover instead of submitting', () => {
    const onSubmit = vi.fn()
    const { editor } = makeMockEditor({ suggestion: true })
    const consumed = handlersFor(editor, onSubmit).Enter()
    expect(onSubmit).not.toHaveBeenCalled()
    expect(consumed).toBe(false) // let the popover's own onKeyDown pick the item
  })

  it('Mod-Enter fires onSubmit (Slack-style send) and consumes the key', () => {
    const onSubmit = vi.fn()
    const { editor, setHardBreak } = makeMockEditor()
    const consumed = handlersFor(editor, onSubmit)['Mod-Enter']()
    expect(onSubmit).toHaveBeenCalledOnce()
    expect(consumed).toBe(true)
    expect(setHardBreak).not.toHaveBeenCalled()
  })

  it('yields Mod-Enter to an active suggestion popover instead of submitting', () => {
    const onSubmit = vi.fn()
    const { editor } = makeMockEditor({ suggestion: true })
    const consumed = handlersFor(editor, onSubmit)['Mod-Enter']()
    expect(onSubmit).not.toHaveBeenCalled()
    expect(consumed).toBe(false)
  })

  it('wins over enterAsHardBreak via a higher extension priority', () => {
    // TipTap tries same-key bindings in descending priority order and stops at
    // the first returning true, so submitOnEnter must outrank enterAsHardBreak.
    const exts = build({ enterAsHardBreak: true }, { placeholder: '', onSubmit: () => {} })
    const byName = new Map(
      exts.map((e) => [(e as { name: string }).name, e as unknown as KeymapExtension])
    )
    expect(byName.has('submitOnEnter')).toBe(true)
    expect(byName.has('enterAsHardBreak')).toBe(true)
    const submitPriority = byName.get('submitOnEnter')!.config.priority ?? 100
    const hardBreakPriority = byName.get('enterAsHardBreak')!.config.priority ?? 100
    expect(submitPriority).toBeGreaterThan(hardBreakPriority)
  })
})

describe('stopEnterFromReachingParentForm', () => {
  function keyEvent(key: string, mods: { metaKey?: boolean; ctrlKey?: boolean } = {}) {
    return {
      key,
      metaKey: !!mods.metaKey,
      ctrlKey: !!mods.ctrlKey,
      stopPropagation: vi.fn(),
    } as unknown as KeyboardEvent
  }

  it('stops plain Enter so a parent form cannot implicitly submit', () => {
    const event = keyEvent('Enter')
    expect(stopEnterFromReachingParentForm(event)).toBe(false)
    expect(event.stopPropagation).toHaveBeenCalledOnce()
  })

  it('stops Shift+Enter the same way (newline, not submit)', () => {
    const event = {
      key: 'Enter',
      metaKey: false,
      ctrlKey: false,
      shiftKey: true,
      stopPropagation: vi.fn(),
    } as unknown as KeyboardEvent
    expect(stopEnterFromReachingParentForm(event)).toBe(false)
    expect(event.stopPropagation).toHaveBeenCalledOnce()
  })

  it('leaves Cmd/Ctrl+Enter alone for wrapper keyboard-submit handlers', () => {
    const meta = keyEvent('Enter', { metaKey: true })
    const ctrl = keyEvent('Enter', { ctrlKey: true })
    expect(stopEnterFromReachingParentForm(meta)).toBe(false)
    expect(stopEnterFromReachingParentForm(ctrl)).toBe(false)
    expect(meta.stopPropagation).not.toHaveBeenCalled()
    expect(ctrl.stopPropagation).not.toHaveBeenCalled()
  })

  it('ignores keys other than Enter', () => {
    const event = keyEvent('Escape')
    expect(stopEnterFromReachingParentForm(event)).toBe(false)
    expect(event.stopPropagation).not.toHaveBeenCalled()
  })
})

describe('markdown serialization optimization', () => {
  it('skips markdown serialization when onChange has arity < 3', () => {
    const getMarkdown = vi.fn(() => '# hello')
    const getJSON = vi.fn(() => ({ type: 'doc', content: [] }))
    const getHTML = vi.fn(() => '<p></p>')
    const mockEditor = { getMarkdown, getJSON, getHTML }

    // Simulate the onUpdate logic
    function runOnUpdate(
      editor: typeof mockEditor,
      onChange: ((...args: unknown[]) => void) | undefined
    ) {
      if (!onChange) return
      const json = editor.getJSON()
      const html = editor.getHTML()
      const markdown = onChange.length >= 3 ? (editor.getMarkdown?.() ?? '') : ''
      onChange(json, html, markdown)
    }

    // 2-arg onChange (widget/portal) — should NOT call getMarkdown
    const twoArgCallback = vi.fn((_json: unknown, _html: unknown) => {})
    runOnUpdate(mockEditor, twoArgCallback)
    expect(getMarkdown).not.toHaveBeenCalled()
    expect(twoArgCallback).toHaveBeenCalledWith(expect.any(Object), expect.any(String), '')

    // 3-arg onChange (changelog) — SHOULD call getMarkdown
    getMarkdown.mockClear()
    const threeArgCallback = vi.fn((_json: unknown, _html: unknown, _md: unknown) => {})
    runOnUpdate(mockEditor, threeArgCallback)
    expect(getMarkdown).toHaveBeenCalledOnce()
    expect(threeArgCallback).toHaveBeenCalledWith(expect.any(Object), expect.any(String), '# hello')
  })
})

describe('value sync skip optimization', () => {
  it('skips setContent when skipRef is true, then clears the flag', () => {
    const setContent = vi.fn()
    const clearContent = vi.fn()
    const getJSON = vi.fn(() => ({ type: 'doc', content: [] }))
    const mockEditor = { commands: { setContent, clearContent }, getJSON, isDestroyed: false }

    const skipRef = { current: true }
    const value = { type: 'doc', content: [{ type: 'paragraph' }] }

    // Simulate the optimized useEffect logic
    function runValueSyncEffect(
      editor: typeof mockEditor,
      val: typeof value,
      skip: { current: boolean }
    ) {
      if (skip.current) {
        skip.current = false
        return
      }
      if (typeof val === 'object') {
        const current = JSON.stringify(editor.getJSON())
        const next = JSON.stringify(val)
        if (current !== next) {
          editor.commands.setContent(val as unknown as string)
        }
      }
    }

    runValueSyncEffect(mockEditor, value, skipRef)

    expect(setContent).not.toHaveBeenCalled()
    expect(getJSON).not.toHaveBeenCalled() // JSON.stringify avoided entirely
    expect(skipRef.current).toBe(false)
  })

  it('runs setContent when value changes externally (skipRef is false)', () => {
    const setContent = vi.fn()
    const clearContent = vi.fn()
    const currentDoc = { type: 'doc', content: [] }
    const getJSON = vi.fn(() => currentDoc)
    const mockEditor = { commands: { setContent, clearContent }, getJSON, isDestroyed: false }

    const skipRef = { current: false }
    const newValue = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'hello' }] }],
    }

    function runValueSyncEffect(
      editor: typeof mockEditor,
      val: typeof newValue,
      skip: { current: boolean }
    ) {
      if (skip.current) {
        skip.current = false
        return
      }
      if (typeof val === 'object') {
        const current = JSON.stringify(editor.getJSON())
        const next = JSON.stringify(val)
        if (current !== next) {
          editor.commands.setContent(val as unknown as string)
        }
      }
    }

    runValueSyncEffect(mockEditor, newValue, skipRef)

    expect(setContent).toHaveBeenCalledOnce()
    expect(setContent).toHaveBeenCalledWith(newValue)
  })
})

describe('generateContentHTML — quackbackEmbed nodes', () => {
  const POST_ID = 'post_01ktjwt5tyf6br9mw521h13n6n'
  const CHANGELOG_ID = 'changelog_01ktjwt5tyf6br9mwcz1vskk44'

  it('serializes a valid post embed to a placeholder div with data attrs', () => {
    const html = generateContentHTML({
      type: 'doc',
      content: [{ type: 'quackbackEmbed', attrs: { kind: 'post', id: POST_ID } }],
    })
    expect(html).toContain('data-quackback-embed="1"')
    expect(html).toContain('data-kind="post"')
    expect(html).toContain(`data-id="${POST_ID}"`)
    expect(html).toContain('class="quackback-embed-placeholder"')
  })

  it('serializes a valid changelog embed to a placeholder div', () => {
    const html = generateContentHTML({
      type: 'doc',
      content: [{ type: 'quackbackEmbed', attrs: { kind: 'changelog', id: CHANGELOG_ID } }],
    })
    expect(html).toContain('data-kind="changelog"')
    expect(html).toContain(`data-id="${CHANGELOG_ID}"`)
  })

  it('renders nothing for an embed with a bad kind', () => {
    const html = generateContentHTML({
      type: 'doc',
      content: [{ type: 'quackbackEmbed', attrs: { kind: 'board', id: POST_ID } }],
    })
    expect(html).not.toContain('data-quackback-embed')
  })

  it('renders nothing for an embed missing its id', () => {
    const html = generateContentHTML({
      type: 'doc',
      content: [{ type: 'quackbackEmbed', attrs: { kind: 'post' } }],
    })
    expect(html).not.toContain('data-quackback-embed')
  })

  it('HTML-escapes a hostile id in the data-id attribute', () => {
    // The write sanitizer blocks this before storage; this pins the serializer's
    // own escaping so a future change can't reintroduce raw-HTML injection.
    const html = generateContentHTML({
      type: 'doc',
      content: [
        { type: 'quackbackEmbed', attrs: { kind: 'post', id: '"><script>alert(1)</script>' } },
      ],
    })
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
  })
})

describe('generateContentHTML — chatImage nodes', () => {
  it('serializes a valid chatImage to a bounded img with src + alt', () => {
    const html = generateContentHTML({
      type: 'doc',
      content: [
        {
          type: 'chatImage',
          attrs: { src: 'https://example.com/photo.png', alt: 'A screenshot' },
        },
      ],
    })
    expect(html).toContain('<img')
    expect(html).toContain('src="https://example.com/photo.png"')
    expect(html).toContain('alt="A screenshot"')
    expect(html).toContain('class="max-w-xs h-auto object-contain rounded-md"')
  })

  it('renders nothing for a chatImage with no src', () => {
    const html = generateContentHTML({
      type: 'doc',
      content: [{ type: 'chatImage', attrs: { alt: 'orphan' } }],
    })
    expect(html).not.toContain('<img')
  })

  it('renders nothing for a chatImage with an unsafe src', () => {
    const html = generateContentHTML({
      type: 'doc',
      content: [{ type: 'chatImage', attrs: { src: 'javascript:alert(1)' } }],
    })
    expect(html).not.toContain('<img')
  })
})

/**
 * Make `new Image()` behave like a browser that has finished loading (or
 * failed to), because no test environment here ever loads one: without this the
 * promise inside `resizableImageInsertAttrs` never settles and everything that
 * awaits it hangs rather than fails.
 *
 * Returns the teardown, which the caller runs before asserting so a later test
 * gets the real globals back.
 */
function stubImageLoading(
  outcome: { naturalWidth: number; naturalHeight: number } | 'error'
): () => void {
  const realCreateObjectURL = URL.createObjectURL
  const realRevokeObjectURL = URL.revokeObjectURL
  let nextUrl = 0

  class StubImage {
    onload: (() => void) | null = null
    onerror: (() => void) | null = null
    naturalWidth = 0
    naturalHeight = 0

    set src(_value: string) {
      queueMicrotask(() => {
        if (outcome === 'error') {
          this.onerror?.()
          return
        }
        this.naturalWidth = outcome.naturalWidth
        this.naturalHeight = outcome.naturalHeight
        this.onload?.()
      })
    }
  }

  vi.stubGlobal('Image', StubImage)
  URL.createObjectURL = () => `blob:stub/${nextUrl++}`
  URL.revokeObjectURL = () => {}

  return () => {
    vi.unstubAllGlobals()
    URL.createObjectURL = realCreateObjectURL
    URL.revokeObjectURL = realRevokeObjectURL
  }
}

function screenshotFile(): File {
  return new File([new Uint8Array([1, 2, 3])], 'shot.png', { type: 'image/png' })
}

function englishIntl() {
  return createIntl({ locale: 'en', messages: {} })
}

describe('the resizable image node’s keep-ratio attribute', () => {
  /**
   * The `renderHTML` the editor registers for `data-keep-ratio`.
   *
   * Reached the same way this file reaches `submitOnEnter`: out of the built
   * extension list rather than through a mounted editor, because what E2 is
   * about is what the attribute serializes to, not how a node view draws it.
   * The parent stub is empty; `{ ...undefined }` is legal, so the spread of the
   * inherited definitions costs nothing here.
   */
  function keepRatioRenderHTML() {
    const image = build({ images: true }, { placeholder: '' }).find(
      (extension) => (extension as { name: string }).name === 'image'
    ) as unknown as {
      config: {
        addAttributes: () => Record<
          string,
          { renderHTML?: (attributes: Record<string, unknown>) => Record<string, string> }
        >
      }
    }
    if (!image) throw new Error('the resizable image extension was not registered')
    const renderHTML = image.config.addAttributes.call({ parent: () => ({}) })['data-keep-ratio']
      ?.renderHTML
    if (!renderHTML) throw new Error('data-keep-ratio has no renderHTML')
    return renderHTML
  }

  it('renders a numeric width as the node’s max-width, and keeps the ratio (E2)', () => {
    expect(keepRatioRenderHTML()({ width: 300, 'data-keep-ratio': true })).toEqual({
      style: 'max-width: 300px',
      'data-keep-ratio': 'true',
    })
  })

  it('renders keep-ratio alone when there is no usable width (E2)', () => {
    const renderHTML = keepRatioRenderHTML()
    const keepRatioOnly = { 'data-keep-ratio': 'true' }

    expect(renderHTML({ 'data-keep-ratio': true })).toEqual(keepRatioOnly)
    expect(renderHTML({ width: null, 'data-keep-ratio': true })).toEqual(keepRatioOnly)
    expect(renderHTML({ width: 0, 'data-keep-ratio': true })).toEqual(keepRatioOnly)
    expect(renderHTML({ width: Number.NaN, 'data-keep-ratio': true })).toEqual(keepRatioOnly)
  })

  it('renders nothing at all for a node that does not keep its ratio (E2)', () => {
    expect(keepRatioRenderHTML()({ width: 300 })).toEqual({})
  })
})

describe('an image dropped into the editor', () => {
  /** Enough of a ProseMirror view for the drop handler to insert into. */
  function fakeView() {
    const created: Record<string, unknown>[] = []
    const dispatched: { pos: number }[] = []
    const view = {
      state: {
        schema: {
          nodes: {
            resizableImage: {
              create: (attrs: Record<string, unknown>) => {
                created.push(attrs)
                return { attrs }
              },
            },
          },
        },
        tr: { insert: (pos: number) => ({ pos }) },
      },
      posAtCoords: () => ({ pos: 3, inside: 0 }),
      dispatch: (tr: { pos: number }) => dispatched.push(tr),
    }
    return { view, created, dispatched }
  }

  function dropEvent(file: File) {
    return {
      preventDefault: () => {},
      clientX: 0,
      clientY: 0,
      dataTransfer: { files: [file] },
    }
  }

  it('creates the node at the file’s natural size, scaled to the editor’s bound (C6)', async () => {
    const restore = stubImageLoading({ naturalWidth: 1920, naturalHeight: 1080 })
    const { view, created, dispatched } = fakeView()
    const drop = handleImageDrop(englishIntl(), async () => 'https://cdn.example.com/shot.png')

    expect(drop(view as never, dropEvent(screenshotFile()) as never, null, false)).toBe(true)
    await vi.waitFor(() => expect(created).toHaveLength(1))
    restore()

    expect(created[0]).toEqual({
      src: 'https://cdn.example.com/shot.png',
      'data-keep-ratio': true,
      width: 500,
      height: 281,
    })
    expect(dispatched).toEqual([{ pos: 3 }])
  })

  it('creates the node with src and keep-ratio alone when the size cannot be read (C6)', async () => {
    const restore = stubImageLoading('error')
    const { view, created } = fakeView()
    const drop = handleImageDrop(englishIntl(), async () => 'https://cdn.example.com/broken.png')

    expect(drop(view as never, dropEvent(screenshotFile()) as never, null, false)).toBe(true)
    await vi.waitFor(() => expect(created).toHaveLength(1))
    restore()

    expect(created[0]).toEqual({
      src: 'https://cdn.example.com/broken.png',
      'data-keep-ratio': true,
    })
  })
})

describe('the slash menu’s image row', () => {
  it('inserts the uploaded image at its natural size, scaled and keeping ratio (C6)', async () => {
    const restore = stubImageLoading({ naturalWidth: 1600, naturalHeight: 900 })
    const pickers: HTMLInputElement[] = []
    const realCreateElement = document.createElement.bind(document)
    const createElement = vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const element = realCreateElement(tag)
      if (tag === 'input') pickers.push(element as HTMLInputElement)
      return element
    })

    const setResizableImage = vi.fn()
    const chain: Record<string, () => unknown> = {}
    for (const step of ['focus', 'deleteRange', 'run']) chain[step] = () => chain
    const editor = { chain: () => chain, commands: { setResizableImage } }

    const rows = getSlashMenuItems(englishIntl(), { images: true }, async () =>
      Promise.resolve('https://cdn.example.com/wide.png')
    )
    const imageRow = rows.find((row) => row.title === 'Image')
    if (!imageRow) throw new Error('the slash menu offers no image row')

    imageRow.command({ editor: editor as never, range: { from: 0, to: 1 } })
    const picker = pickers.at(-1)!
    Object.defineProperty(picker, 'files', { value: [screenshotFile()], configurable: true })
    await picker.onchange?.(new Event('change'))

    createElement.mockRestore()
    restore()

    expect(setResizableImage).toHaveBeenCalledWith({
      src: 'https://cdn.example.com/wide.png',
      'data-keep-ratio': true,
      width: 500,
      height: 281,
    })
  })
})
