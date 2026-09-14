/**
 * Contract group W — Widget `open()` deep-links (upstream #531)
 *
 * W1 A host `open()` command lands on the documented view: `new-post` expands the composer with the given title, body and board; `post` opens that post; `article` opens the article named by TypeID or slug; `changelog` opens the given entry, or the list without one; `help` opens help with the given query; `messenger`, `tickets`, `messages` and `home` land on their tabs. A view the workspace has not enabled is ignored, and so is an unknown one.
 * W2 A second identical `new-post` command still expands the composer and reapplies title, body and board: the command is the trigger, not its content.
 * W3 A `new-post` board the anonymous visitor could not see is applied once identify makes it visible, but never over a board the visitor picked themselves after the command.
 * W4 Once this session's board list has arrived, a compose board or an SDK `?board=` filter the session cannot see falls back to the default; through the anonymous first paint the choice is kept.
 * W5 Similar-post hits are cached per session and bounded: a later identify or logout never shows a previous visitor's titles, the cache holds at most 40 queries and drops the oldest first, and a failed search shows no hits rather than stale ones.
 * W6 Help search, help categories, article detail, changelog list and detail, Ask AI and the unread badge all carry the widget identity and are keyed by session, so identify or logout refetches them and no placeholder from another identity is shown.
 * W7 When the session changes, help search drops its results, its in-flight request and its cache; a response from an earlier session is discarded; a non-OK response yields no results.
 * W8 "View on portal" on an article or changelog entry carries a one-time token for an identified visitor and none for an anonymous one; the article URL uses the locale the article was resolved in.
 * W9 A help category the new session cannot see is left once the category list has loaded; before it loads nothing happens.
 * W10 A changelog category filter the current feed no longer contains is cleared.
 * W11 Resolving a public article accepts an `article_` id, a retired `kb_article_` id or a slug; it falls back to the default locale when the requested one has no version and reports the locale it resolved to; helpfulness counters are not exposed; an article that does not exist or is not public resolves to nothing.
 */
import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import { generateId } from '@quackback/ids'
import {
  composeBodyFromPlainText,
  isArticleTypeId,
  resolveComposeBoardId,
  resolveOpenCommand,
  shouldClearInvisibleBoardFilter,
  shouldResetComposeBoard,
  shouldReapplyComposeBoard,
} from '../widget-compose'
import { homeEnabled, type EnabledTabs } from '../widget-nav'

const boards = [
  { id: 'board_ideas', slug: 'ideas' },
  { id: 'board_bugs', slug: 'bug-reports' },
]

const allTabs: EnabledTabs = {
  feedback: true,
  changelog: true,
  help: true,
  messages: true,
  tickets: true,
  home: true,
}

describe('resolveComposeBoardId', () => {
  it('selects the requested slug when it is on the visible list (W1)', () => {
    expect(resolveComposeBoardId(boards, 'bug-reports', 'ideas')).toBe('board_bugs')
  })

  it('falls back to the configured default when no slug is given (W1)', () => {
    expect(resolveComposeBoardId(boards, undefined, 'ideas')).toBe('board_ideas')
  })

  it('falls back to the configured default when the slug is unknown (W4)', () => {
    expect(resolveComposeBoardId(boards, 'secret-board', 'ideas')).toBe('board_ideas')
  })

  it('does not select a board that is not on the visible list (W4)', () => {
    expect(resolveComposeBoardId(boards, 'secret-board', undefined)).toBe('')
  })

  it('auto-selects the only board when no slug or default applies (W1)', () => {
    expect(resolveComposeBoardId([boards[1]], undefined, undefined)).toBe('board_bugs')
    expect(resolveComposeBoardId([boards[1]], 'missing', 'also-missing')).toBe('board_bugs')
  })

  it('leaves the picker empty when several boards have no default (W1)', () => {
    expect(resolveComposeBoardId(boards, undefined, undefined)).toBe('')
  })
})

describe('resolveOpenCommand', () => {
  it('opens a new-post compose with title, body, and board (W1)', () => {
    expect(
      resolveOpenCommand(
        { view: 'new-post', title: 'Bug:', body: 'steps', board: 'bug-reports' },
        allTabs
      )
    ).toEqual({
      type: 'new-post',
      title: 'Bug:',
      body: 'steps',
      boardSlug: 'bug-reports',
    })
  })

  it('opens new-post with default-board behaviour when board is omitted (W1)', () => {
    expect(resolveOpenCommand({ view: 'new-post' }, allTabs)).toEqual({
      type: 'new-post',
      title: undefined,
      body: undefined,
      boardSlug: undefined,
    })
  })

  it('does not open new-post when Feedback is off (W1)', () => {
    expect(resolveOpenCommand({ view: 'new-post', board: 'bugs' }, { help: true })).toBeNull()
  })

  it('deep-links a post when Feedback is on (W1)', () => {
    expect(resolveOpenCommand({ postId: 'post_01h' }, allTabs)).toEqual({
      type: 'post',
      postId: 'post_01h',
    })
  })

  it('does not deep-link a post when Feedback is off (W1)', () => {
    expect(resolveOpenCommand({ postId: 'post_01h' }, { changelog: true })).toBeNull()
  })

  it('deep-links a help article when Help is on (W1)', () => {
    expect(resolveOpenCommand({ articleId: 'pricing' }, allTabs)).toEqual({
      type: 'article',
      articleId: 'pricing',
    })
  })

  it('forwards an article TypeID the same way as a post TypeID (W1)', () => {
    const articleId = generateId('article')
    const legacyId = `kb_article_${articleId.slice('article_'.length)}`
    expect(resolveOpenCommand({ articleId }, allTabs)).toEqual({
      type: 'article',
      articleId,
    })
    expect(isArticleTypeId(articleId)).toBe(true)
    expect(isArticleTypeId(legacyId)).toBe(true)
    expect(isArticleTypeId('art_01h...')).toBe(false)
    expect(isArticleTypeId('pricing')).toBe(false)
  })

  it('prefills help search and opens a changelog entry (W1)', () => {
    expect(resolveOpenCommand({ view: 'help', query: 'pricing' }, allTabs)).toEqual({
      type: 'help',
      query: 'pricing',
    })
    expect(resolveOpenCommand({ view: 'changelog', entryId: 'chg_01h' }, allTabs)).toEqual({
      type: 'changelog',
      entryId: 'chg_01h',
    })
  })

  it('opens chat aliases on the messenger and tickets with a messages fallback (W1)', () => {
    expect(resolveOpenCommand({ view: 'chat' }, allTabs)).toEqual({ type: 'messenger' })
    expect(resolveOpenCommand({ view: 'live-chat' }, allTabs)).toEqual({ type: 'messenger' })
    expect(resolveOpenCommand({ view: 'tickets' }, { tickets: true })).toEqual({ type: 'tickets' })
    expect(resolveOpenCommand({ view: 'tickets' }, { messages: true })).toEqual({
      type: 'messages',
    })
    expect(resolveOpenCommand({ view: 'chat' }, { feedback: true })).toBeNull()
  })

  it('opens home for an empty payload when Home is enabled (W1)', () => {
    expect(resolveOpenCommand({}, allTabs)).toEqual({ type: 'home' })
    expect(resolveOpenCommand({ view: 'home' }, allTabs)).toEqual({ type: 'home' })
    expect(resolveOpenCommand({}, { feedback: true })).toBeNull()
  })

  it('lets postId and articleId win over view (W1)', () => {
    expect(
      resolveOpenCommand({ view: 'new-post', postId: 'post_01h', title: 'Bug:' }, allTabs)
    ).toEqual({ type: 'post', postId: 'post_01h' })
    expect(
      resolveOpenCommand({ view: 'new-post', articleId: 'pricing', title: 'Bug:' }, allTabs)
    ).toEqual({ type: 'article', articleId: 'pricing' })
    expect(
      resolveOpenCommand({ view: 'help', postId: 'post_01h', articleId: 'pricing' }, allTabs)
    ).toEqual({ type: 'post', postId: 'post_01h' })
  })
})

describe('shouldResetComposeBoard', () => {
  it('resets when the selected board is missing from the confirmed list (W4)', () => {
    expect(shouldResetComposeBoard('board_secret', boards, ['ideas', 'bug-reports'])).toBe(true)
    expect(shouldResetComposeBoard('board_ideas', boards, ['ideas', 'bug-reports'])).toBe(false)
    expect(shouldResetComposeBoard('board_ideas', boards, null)).toBe(false)
    expect(shouldResetComposeBoard('', boards, ['ideas'])).toBe(false)
  })
})

describe('shouldClearInvisibleBoardFilter', () => {
  it('clears a selected slug that the live session list no longer contains (W4)', () => {
    expect(shouldClearInvisibleBoardFilter('secret', ['ideas', 'bugs'])).toBe(true)
    expect(shouldClearInvisibleBoardFilter('ideas', ['ideas', 'bugs'])).toBe(false)
    expect(shouldClearInvisibleBoardFilter('secret', null)).toBe(false)
    expect(shouldClearInvisibleBoardFilter(null, ['ideas'])).toBe(false)
  })
})

describe('shouldReapplyComposeBoard', () => {
  it('re-applies only when identify newly grants the requested slug (W3)', () => {
    expect(shouldReapplyComposeBoard('bugs', new Set(), new Set(['bugs', 'ideas']))).toBe(true)
    expect(shouldReapplyComposeBoard('bugs', new Set(['bugs']), new Set(['bugs', 'ideas']))).toBe(
      false
    )
    expect(shouldReapplyComposeBoard('secret', new Set(['bugs']), new Set(['bugs', 'ideas']))).toBe(
      false
    )
    expect(shouldReapplyComposeBoard(undefined, new Set(), new Set(['bugs']))).toBe(false)
  })

  it('does not overwrite a board the visitor picked after open() (W3)', () => {
    expect(
      shouldReapplyComposeBoard('secret', new Set(['ideas']), new Set(['ideas', 'secret']), true)
    ).toBe(false)
    expect(
      shouldReapplyComposeBoard('secret', new Set(['ideas']), new Set(['ideas', 'secret']), false)
    ).toBe(true)
  })
})

describe('composeBodyFromPlainText', () => {
  it('turns each line into a paragraph (W1)', () => {
    const { json, html } = composeBodyFromPlainText('one\ntwo')
    expect(json).toEqual({
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'one' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'two' }] },
      ],
    })
    expect(html).toContain('one')
    expect(html).toContain('two')
  })
})

describe('resolveOpenCommand — views the workspace cannot serve', () => {
  it('ignores a tickets command when neither Tickets nor Messages is enabled (W1)', () => {
    expect(resolveOpenCommand({ view: 'tickets' }, { help: true, changelog: true })).toBeNull()
    expect(resolveOpenCommand({ view: 'tickets' }, {})).toBeNull()
  })

  it('ignores a view the SDK never documented (W1)', () => {
    expect(resolveOpenCommand({ view: 'billing' }, allTabs)).toBeNull()
    expect(resolveOpenCommand({ view: '' }, allTabs)).toBeNull()
    expect(resolveOpenCommand({ view: 'New-Post' }, allTabs)).toBeNull()
  })

  it('never lands a command on a surface the workspace switched off (W1)', () => {
    const documentedViews = [
      'new-post',
      'changelog',
      'help',
      'messages',
      'chat',
      'live-chat',
      'tickets',
      'home',
      'overview',
    ]
    // The surface each command lands on, in the tab-bar's own terms.
    const landingSurface: Record<string, (tabs: EnabledTabs) => boolean> = {
      'new-post': (tabs) => !!tabs.feedback,
      post: (tabs) => !!tabs.feedback,
      article: (tabs) => !!tabs.help,
      changelog: (tabs) => !!tabs.changelog,
      help: (tabs) => !!tabs.help,
      messenger: (tabs) => !!tabs.messages,
      messages: (tabs) => !!tabs.messages,
      tickets: (tabs) => !!tabs.tickets,
      home: homeEnabled,
    }

    fc.assert(
      fc.property(
        fc.record({
          feedback: fc.boolean(),
          changelog: fc.boolean(),
          help: fc.boolean(),
          messages: fc.boolean(),
          tickets: fc.boolean(),
          home: fc.boolean(),
        }),
        fc.option(fc.constantFrom(...documentedViews, 'billing', 'admin', ''), { nil: undefined }),
        fc.option(fc.constantFrom('post_01h'), { nil: undefined }),
        fc.option(fc.constantFrom('pricing'), { nil: undefined }),
        (tabs, view, postId, articleId) => {
          const command = resolveOpenCommand({ view, postId, articleId }, tabs)
          // Unguarded: the resolver only ever speaks the documented vocabulary.
          const type = command?.type ?? 'none'
          expect(Object.keys(landingSurface).concat('none')).toContain(type)
          if (!command) return
          expect(landingSurface[command.type](tabs)).toBe(true)
        }
      )
    )
  })
})
