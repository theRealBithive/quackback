/**
 * The changelog RSS feed's product filter.
 *
 * V11 The RSS feed filters by the same products under the same rules as the
 *     page.
 * V7  A product that does not exist, is deleted, or that the reader may not see
 *     contributes nothing to the filter and cannot be told apart from a product
 *     with no entries: it never widens the result and never raises an error.
 *
 * "The same rules" is the whole point, so this suite does not restate them: it
 * uses the real resolver and the real predicate builder and asserts that the
 * feed hands them what the request asked for. A feed that quietly built its own
 * filter would still pass a test that only checked which entries came back on
 * some fixture — and would then disagree with the page it is linked from the
 * first time either changed.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'
import { generateId, toUuid } from '@quackback/ids'
import type { BoardId } from '@quackback/ids'
import { ANONYMOUS_ACTOR } from '@/lib/server/policy/types'

const mockVisibleBoardIdsFor = vi.fn()
const mockPolicyActor = vi.fn()
const spyBoardFilterCondition = vi.fn()
const mockSelectWhere = vi.fn()
const mockIsFeatureEnabled = vi.fn()
const mockPortalAccess = vi.fn()
const mockAudienceGranted = vi.fn()

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: vi.fn(() => (opts: unknown) => ({ options: opts })),
}))
vi.mock('@/lib/server/config', () => ({ config: { baseUrl: 'https://example.test' } }))
vi.mock('@/lib/server/settings-utils', () => ({
  getSettingsBrandingData: vi.fn(async () => ({ name: 'Kulpix' })),
}))
vi.mock('@/lib/server/functions/portal-access', () => ({
  resolvePortalAccessForRequest: (...args: unknown[]) => mockPortalAccess(...args),
}))
vi.mock('@/lib/server/domains/changelog/changelog.audience', () => ({
  isChangelogAudienceGranted: (...args: unknown[]) => mockAudienceGranted(...args),
}))
vi.mock('@/lib/server/functions/auth-helpers', () => ({
  getOptionalAuth: vi.fn(async () => null),
  policyActorFromAuth: (...args: unknown[]) => mockPolicyActor(...args),
}))
vi.mock('@/lib/server/domains/settings/settings.service', () => ({
  isFeatureEnabled: (...args: unknown[]) => mockIsFeatureEnabled(...args),
}))
// The resolver stays real — it is where V7 lives. The predicate builder is
// wrapped rather than replaced, so the suite can read the filter the feed
// resolved without rendering drizzle SQL (a `SQL` object is cyclic, and its
// rendered text would be an assertion about drizzle rather than about us).
vi.mock('@/lib/server/domains/changelog/changelog-board.service', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/lib/server/domains/changelog/changelog-board.service')>()
  return {
    ...actual,
    visibleBoardIdsFor: (...args: unknown[]) => mockVisibleBoardIdsFor(...args),
    changelogBoardFilterCondition: (
      ...args: Parameters<typeof actual.changelogBoardFilterCondition>
    ) => {
      spyBoardFilterCondition(...args)
      return actual.changelogBoardFilterCondition(...args)
    },
  }
})
vi.mock('@/lib/server/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/server/db')>()
  return {
    ...actual,
    db: {
      select: () => ({
        from: () => ({
          where: (condition: unknown) => ({
            orderBy: () => ({ limit: () => mockSelectWhere(condition) }),
          }),
        }),
      }),
    },
  }
})

import { Route } from '../feed'

type Handlers = { GET: (args: { request: Request }) => Promise<Response> }
const { GET } = (Route as unknown as { options: { server: { handlers: Handlers } } }).options.server
  .handlers

// Real ids, not readable stand-ins: the board column maps a typeid to a UUID
// on its way into the query, so a made-up id cannot be rendered at all.
const ALPHA = generateId('board') as BoardId
const BETA = generateId('board') as BoardId
const PRIVATE = generateId('board') as BoardId

const dialect = new PgDialect()

/** The product filter the feed resolved out of the request. */
function resolvedFilter() {
  return spyBoardFilterCondition.mock.calls.at(-1)?.[0]
}

/**
 * The WHERE clause the feed actually sent, rendered.
 *
 * Resolving a filter and using it are two different things: a feed that built
 * the right predicate and then dropped it on the floor would satisfy every
 * assertion about `resolvedFilter()` while serving the whole changelog.
 */
function whereQuery() {
  const condition = mockSelectWhere.mock.calls.at(-1)?.[0]
  return dialect.sqlToQuery(condition)
}

async function fetchFeed(query = ''): Promise<string> {
  const response = await GET({
    request: new Request(`https://example.test/changelog/feed${query}`),
  })
  return response.text()
}

beforeEach(() => {
  vi.clearAllMocks()
  mockPortalAccess.mockResolvedValue({ granted: true })
  mockAudienceGranted.mockResolvedValue(true)
  mockIsFeatureEnabled.mockResolvedValue(true)
  mockVisibleBoardIdsFor.mockResolvedValue([ALPHA, BETA])
  mockPolicyActor.mockResolvedValue({
    principalId: 'principal_reader',
    role: 'user',
    principalType: 'user',
    segmentIds: new Set(),
  })
  mockSelectWhere.mockResolvedValue([])
})

describe('changelog RSS feed, product filter', () => {
  it('adds no product predicate when none was asked for, and asks the database nothing extra (V5)', async () => {
    await fetchFeed()

    expect(mockVisibleBoardIdsFor).not.toHaveBeenCalled()
    expect(resolvedFilter()).toEqual({ filtered: false })
  })

  it('narrows to the product the request named (V11)', async () => {
    await fetchFeed(`?board=${ALPHA}`)

    expect(resolvedFilter()).toEqual({ filtered: true, boardIds: [ALPHA] })
  })

  it('accepts several products, the way the page does (V11)', async () => {
    await fetchFeed(`?board=${ALPHA}&board=${BETA}`)

    expect(resolvedFilter()).toEqual({ filtered: true, boardIds: [ALPHA, BETA] })
  })

  it('never lets a product the reader may not see into the query (V7)', async () => {
    await fetchFeed(`?board=${PRIVATE}`)

    expect(resolvedFilter()).toEqual({ filtered: true, boardIds: [] })
  })

  it('keeps the visible half of a mixed request (V7, V11)', async () => {
    await fetchFeed(`?board=${PRIVATE}&board=${ALPHA}`)

    expect(resolvedFilter()).toEqual({ filtered: true, boardIds: [ALPHA] })
  })

  it('answers a request naming only invisible products without raising (V7)', async () => {
    const xml = await fetchFeed(`?board=${PRIVATE}`)

    expect(xml).toContain('<rss version="2.0"')
    expect(xml).toContain('<title>Kulpix Changelog</title>')
  })

  it('names the URL that was actually fetched as the feed’s own address (V9)', async () => {
    // A reader subscribed to one product must not have their reader re-resolve
    // to the whole changelog on the next refresh.
    const xml = await fetchFeed(`?board=${ALPHA}`)

    expect(xml).toContain(
      `<atom:link href="https://example.test/changelog/feed?board=${ALPHA}" rel="self"`
    )
  })

  it('keeps the plain feed address when no product was asked for', async () => {
    const xml = await fetchFeed()

    expect(xml).toContain('<atom:link href="https://example.test/changelog/feed" rel="self"')
  })

  it('sends the product predicate to the database, not just to itself (V11)', async () => {
    await fetchFeed(`?board=${ALPHA}`)

    const { sql, params } = whereQuery()
    expect(sql).toContain('changelog_entry_boards')
    expect(params).toContain(toUuid(ALPHA))
  })

  it('sends no product predicate at all when none was asked for (V5)', async () => {
    await fetchFeed()

    expect(whereQuery().sql).not.toContain('changelog_entry_boards')
  })

  it('narrows an anonymous subscriber by what anonymous may see (V11)', async () => {
    // The page serves anonymous readers through ANONYMOUS_ACTOR; the feed has
    // to reach the same filter for the same request, or a subscribed reader
    // and the page they subscribed from disagree.
    mockPolicyActor.mockResolvedValue(ANONYMOUS_ACTOR)
    mockVisibleBoardIdsFor.mockResolvedValue([ALPHA])

    await fetchFeed(`?board=${ALPHA}&board=${PRIVATE}`)

    expect(mockVisibleBoardIdsFor).toHaveBeenCalledWith(ANONYMOUS_ACTOR)
    expect(resolvedFilter()).toEqual({ filtered: true, boardIds: [ALPHA] })
  })

  it('serves an empty feed, not a filtered one, when the portal denies the caller', async () => {
    mockPortalAccess.mockResolvedValue({ granted: false })

    const xml = await fetchFeed(`?board=${ALPHA}`)

    expect(xml).toContain('<rss version="2.0"')
    expect(xml).not.toContain('<item>')
    expect(mockVisibleBoardIdsFor).not.toHaveBeenCalled()
  })
})
