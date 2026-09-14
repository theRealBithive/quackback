/**
 * ## W — Widget `open()` deep-links (upstream #531)
 * - W6 Help search, help categories, article detail, changelog list and detail, Ask AI and the unread badge all carry the widget identity and are keyed by session, so identify or logout refetches them and no placeholder from another identity is shown.
 * - W7 When the session changes, help search drops its results, its in-flight request and its cache; a response from an earlier session is discarded; a non-OK response yields no results.
 * - W11 Resolving a public article accepts an `article_` id, a retired `kb_article_` id or a slug; it falls back to the default locale when the requested one has no version and reports the locale it resolved to; helpfulness counters are not exposed; an article that does not exist or is not public resolves to nothing.
 *
 * This module pins W11 only, for `resolvePublicArticleRefFn`.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { generateId } from '@quackback/ids'
import { NotFoundError } from '@/lib/shared/errors'

const hoisted = vi.hoisted(() => ({
  mockHasAuthCredentials: vi.fn(),
  mockGetOptionalAuth: vi.fn(),
  mockPolicyActorFromAuth: vi.fn(),
  mockRequireAuth: vi.fn(),
  mockGetPublicArticleByIdForLocale: vi.fn(),
  mockGetPublicArticleBySlugForLocale: vi.fn(),
}))

type AnyHandler = (ctx: { data: unknown }) => Promise<unknown>

const handlers: AnyHandler[] = []
vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => {
    const chain = {
      validator() {
        return chain
      },
      handler(fn: AnyHandler) {
        handlers.push(fn)
        return chain
      },
    }
    return chain
  },
}))

vi.mock('@/lib/server/functions/auth-helpers', () => ({
  hasAuthCredentials: hoisted.mockHasAuthCredentials,
  getOptionalAuth: hoisted.mockGetOptionalAuth,
  policyActorFromAuth: hoisted.mockPolicyActorFromAuth,
  requireAuth: hoisted.mockRequireAuth,
}))

// help-center.ts's top-level import of the domain service pulls in real DB
// access for every export, even ones resolvePublicArticleRefFn never calls —
// stub the whole surface so importing the module cannot reach Postgres.
vi.mock('@/lib/server/domains/help-center/help-center.service', () => ({
  listCategories: vi.fn(),
  listPublicCategoryEditors: vi.fn(),
  getCategoryById: vi.fn(),
  createCategory: vi.fn(),
  updateCategory: vi.fn(),
  deleteCategory: vi.fn(),
  restoreCategory: vi.fn(),
  listArticles: vi.fn(),
  listArticlePerformance: vi.fn(),
  listPublicArticles: vi.fn(),
  listPopularPublicArticles: vi.fn(),
  getArticleById: vi.fn(),
  createArticle: vi.fn(),
  updateArticle: vi.fn(),
  publishArticle: vi.fn(),
  unpublishArticle: vi.fn(),
  deleteArticle: vi.fn(),
  restoreArticle: vi.fn(),
  recordArticleFeedback: vi.fn(),
  attachArticleFeedbackReason: vi.fn(),
  listArticleFeedbackReasons: vi.fn(),
}))

// The actual data-layer boundary resolvePublicArticleRefFn calls through its
// inline dynamic import — this is the one substitution the test controls.
vi.mock('@/lib/server/domains/help-center/help-center-locale.query', () => ({
  getPublicArticleByIdForLocale: hoisted.mockGetPublicArticleByIdForLocale,
  getPublicArticleBySlugForLocale: hoisted.mockGetPublicArticleBySlugForLocale,
}))

vi.mock('@/lib/server/logger', () => ({
  logger: { child: () => ({ debug: vi.fn(), error: vi.fn(), warn: vi.fn(), info: vi.fn() }) },
}))

// Importing the SUT registers every exported server fn's handler in
// declaration order; resolvePublicArticleRefFn is appended last (see its own
// doc comment: "Appended so existing help-center handler indices stay put").
await import('../help-center')
// A brittle hard-coded index is exactly what that doc comment warns about,
// so assert the count here — a future insertion fails this assertion by
// name instead of silently pointing every test below at the wrong handler.
expect(handlers.length).toBe(32)
const resolveHandler = handlers[handlers.length - 1]

function articleRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: generateId('article'),
    slug: 'getting-started',
    title: 'Getting started',
    content: 'Welcome',
    contentJson: null,
    description: null,
    position: 0,
    categoryId: 'kb_category_1',
    helpfulCount: 7,
    notHelpfulCount: 2,
    createdAt: new Date('2026-07-04T00:00:00.000Z'),
    updatedAt: new Date('2026-07-04T00:00:00.000Z'),
    publishedAt: new Date('2026-07-01T00:00:00.000Z'),
    deletedAt: null,
    ...overrides,
  }
}

const ANONYMOUS_ACTOR_SHAPE = {
  principalId: null,
  role: null,
  principalType: 'anonymous',
  segmentIds: expect.any(Set),
}

beforeEach(() => {
  vi.clearAllMocks()
  hoisted.mockHasAuthCredentials.mockReturnValue(false)
})

describe('resolvePublicArticleRefFn', () => {
  it('accepts a canonical article_ id and looks it up by id, in the requested locale (W11)', async () => {
    const id = generateId('article')
    hoisted.mockGetPublicArticleByIdForLocale.mockResolvedValue(articleRow({ id }))

    const result = (await resolveHandler({ data: { ref: id, locale: 'en' } })) as Record<
      string,
      unknown
    >

    expect(hoisted.mockGetPublicArticleByIdForLocale).toHaveBeenCalledWith(
      id,
      'en',
      expect.objectContaining(ANONYMOUS_ACTOR_SHAPE)
    )
    expect(hoisted.mockGetPublicArticleBySlugForLocale).not.toHaveBeenCalled()
    expect(result.id).toBe(id)
  })

  it('accepts a retired kb_article_ id, rewritten to article_ before the id lookup (W11)', async () => {
    const canonical = generateId('article')
    const legacy = `kb_article_${canonical.slice('article_'.length)}`
    hoisted.mockGetPublicArticleByIdForLocale.mockResolvedValue(articleRow({ id: canonical }))

    await resolveHandler({ data: { ref: legacy, locale: 'en' } })

    expect(hoisted.mockGetPublicArticleByIdForLocale).toHaveBeenCalledWith(
      canonical,
      'en',
      expect.anything()
    )
  })

  it('treats a non-TypeID ref as a slug and looks it up by slug (W11)', async () => {
    hoisted.mockGetPublicArticleBySlugForLocale.mockResolvedValue(
      articleRow({ slug: 'getting-started' })
    )

    const result = (await resolveHandler({
      data: { ref: 'getting-started', locale: 'en' },
    })) as Record<string, unknown>

    expect(hoisted.mockGetPublicArticleBySlugForLocale).toHaveBeenCalledWith(
      'getting-started',
      'en',
      expect.anything()
    )
    expect(hoisted.mockGetPublicArticleByIdForLocale).not.toHaveBeenCalled()
    expect(result.slug).toBe('getting-started')
  })

  it('falls back to the default locale when the requested locale has no version, and reports the locale it resolved to (W11)', async () => {
    const id = generateId('article')
    hoisted.mockGetPublicArticleByIdForLocale.mockImplementation(
      async (_id: string, locale: string) => {
        if (locale === 'de') {
          throw new NotFoundError('ARTICLE_NOT_FOUND', 'no de version')
        }
        return articleRow({ id })
      }
    )

    const result = (await resolveHandler({ data: { ref: id, locale: 'de' } })) as Record<
      string,
      unknown
    >

    expect(hoisted.mockGetPublicArticleByIdForLocale).toHaveBeenNthCalledWith(
      1,
      id,
      'de',
      expect.anything()
    )
    expect(hoisted.mockGetPublicArticleByIdForLocale).toHaveBeenNthCalledWith(
      2,
      id,
      'en',
      expect.anything()
    )
    expect(result.resolvedLocale).toBe('en')
  })

  it('reports the requested locale when a version exists there (no fallback taken) (W11)', async () => {
    const id = generateId('article')
    hoisted.mockGetPublicArticleByIdForLocale.mockResolvedValue(articleRow({ id }))

    const result = (await resolveHandler({ data: { ref: id, locale: 'fr' } })) as Record<
      string,
      unknown
    >

    expect(hoisted.mockGetPublicArticleByIdForLocale).toHaveBeenCalledTimes(1)
    expect(result.resolvedLocale).toBe('fr')
  })

  it('never exposes the helpfulness counters (W11)', async () => {
    const id = generateId('article')
    hoisted.mockGetPublicArticleByIdForLocale.mockResolvedValue(
      articleRow({ id, helpfulCount: 99, notHelpfulCount: 1 })
    )

    const result = (await resolveHandler({ data: { ref: id, locale: 'en' } })) as Record<
      string,
      unknown
    >

    expect(result.helpfulCount).toBeUndefined()
    expect(result.notHelpfulCount).toBeUndefined()
    expect(Object.keys(result)).not.toContain('helpfulCount')
    expect(Object.keys(result)).not.toContain('notHelpfulCount')
  })

  it('resolves to null when the article does not exist or is not public, even after the default-locale fallback (W11)', async () => {
    const id = generateId('article')
    hoisted.mockGetPublicArticleByIdForLocale.mockRejectedValue(
      new NotFoundError('ARTICLE_NOT_FOUND', 'gone')
    )

    const result = await resolveHandler({ data: { ref: id, locale: 'en' } })

    expect(result).toBeNull()
  })

  it('resolves to null for a slug that does not exist or is not public (W11)', async () => {
    hoisted.mockGetPublicArticleBySlugForLocale.mockRejectedValue(
      new NotFoundError('ARTICLE_NOT_FOUND', 'gone')
    )

    const result = await resolveHandler({ data: { ref: 'no-such-slug', locale: 'en' } })

    expect(result).toBeNull()
  })

  // Not itself a W11 clause, but its necessary complement: W11 promises
  // "not found or not public resolves to nothing" — a promise that would be
  // meaningless if ANY failure (a real backend error, say) were also
  // swallowed into the same null. Exercises the handler's `throw err`
  // branch, which the catch block's `if (err instanceof NotFoundError)`
  // deliberately does not cover (W11).
  it('propagates an error that is not a NotFoundError, rather than resolving to null (W11)', async () => {
    const id = generateId('article')
    hoisted.mockGetPublicArticleByIdForLocale.mockRejectedValue(new Error('db exploded'))

    await expect(resolveHandler({ data: { ref: id, locale: 'en' } })).rejects.toThrow('db exploded')
  })
})
