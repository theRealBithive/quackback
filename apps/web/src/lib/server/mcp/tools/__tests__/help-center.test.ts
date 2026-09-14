/**
 * ## A — Article ids (upstream a720add94)
 * - A1 An article id is emitted as `article_`; a `kb_article_` id is accepted wherever an article id is read (MCP tools, copilot report, Zod schemas) and rewritten to `article_`, so the retired prefix is never persisted.
 * - A2 A prefix alias resolves to its canonical prefix, a canonical prefix to itself, an unknown prefix to nothing.
 * - A3 A citation whose id is not a valid article id counts as no article rather than failing the report.
 * - A4 The MCP update and delete article tools accept either prefix and act on the same article; delete reports the canonical id.
 *
 * This module pins A1 and A4, for the `update_article` and `delete_article`
 * handlers. `parseTypeId`/`parseOptionalTypeId` (the real alias-rewrite
 * logic, from `@/lib/server/domains/api/validation`) are exercised for real
 * here, not mocked — only the help-center domain service and the feature
 * flag lookup are mocked, to keep the suite off the real database.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { generateId } from '@quackback/ids'

const mockGetArticleById = vi.fn()
const mockCreateArticle = vi.fn()
const mockUpdateArticle = vi.fn()
const mockPublishArticle = vi.fn()
const mockUnpublishArticle = vi.fn()
const mockDeleteArticle = vi.fn()
const mockCreateCategory = vi.fn()
const mockUpdateCategory = vi.fn()
const mockDeleteCategory = vi.fn()
const mockIsFeatureEnabled = vi.fn()

vi.mock('@/lib/server/domains/help-center/help-center.service', () => ({
  getArticleById: (...a: unknown[]) => mockGetArticleById(...a),
  createArticle: (...a: unknown[]) => mockCreateArticle(...a),
  updateArticle: (...a: unknown[]) => mockUpdateArticle(...a),
  publishArticle: (...a: unknown[]) => mockPublishArticle(...a),
  unpublishArticle: (...a: unknown[]) => mockUnpublishArticle(...a),
  deleteArticle: (...a: unknown[]) => mockDeleteArticle(...a),
  createCategory: (...a: unknown[]) => mockCreateCategory(...a),
  updateCategory: (...a: unknown[]) => mockUpdateCategory(...a),
  deleteCategory: (...a: unknown[]) => mockDeleteCategory(...a),
}))
vi.mock('@/lib/server/domains/settings/settings.service', () => ({
  isFeatureEnabled: (...a: unknown[]) => mockIsFeatureEnabled(...a),
}))

import { registerHelpCenterTools } from '../help-center'
import type { McpAuthContext } from '../../types'

type Handler = (args: Record<string, unknown>) => Promise<CallToolResult>

/** Register the help-center tools against a fake server, capturing each wrapped handler. */
function collect(auth: McpAuthContext): Map<string, Handler> {
  const handlers = new Map<string, Handler>()
  const fakeServer = {
    tool: (name: string, _d: string, _s: unknown, _a: unknown, handler: Handler) => {
      handlers.set(name, handler)
    },
  }
  registerHelpCenterTools(fakeServer as never, auth)
  return handlers
}

const teamAuth = {
  principalId: 'principal_key',
  userId: 'user_1',
  name: 'Agent',
  email: 'agent@acme.com',
  role: 'admin' as const,
  authMethod: 'api-key' as const,
  scopes: ['write:article'],
} as unknown as McpAuthContext

const parse = (r: CallToolResult) => JSON.parse((r.content[0] as { text: string }).text)

function articleDTO(id: string) {
  return {
    id,
    slug: 'getting-started',
    title: 'Getting started',
    content: 'Welcome',
    contentJson: null,
    description: null,
    position: 0,
    category: { id: 'kb_category_1', slug: 'general', name: 'General' },
    author: null,
    publishedAt: null,
    viewCount: 0,
    helpfulCount: 0,
    notHelpfulCount: 0,
    createdAt: new Date('2026-07-04T00:00:00.000Z'),
    updatedAt: new Date('2026-07-04T00:00:00.000Z'),
  }
}

function legacyIdFor(canonical: string): string {
  return `kb_article_${canonical.slice('article_'.length)}`
}

beforeEach(() => {
  vi.clearAllMocks()
  mockIsFeatureEnabled.mockResolvedValue(true)
})

describe('help-center MCP tools', () => {
  describe('update_article', () => {
    it('rewrites a retired kb_article_ id to article_ before applying a field update (A1)', async () => {
      const canonical = generateId('article')
      const legacy = legacyIdFor(canonical)
      mockUpdateArticle.mockResolvedValue(articleDTO(canonical))

      const out = await collect(teamAuth).get('update_article')!({
        articleId: legacy,
        title: 'New Title',
      })

      expect(mockUpdateArticle).toHaveBeenCalledWith(
        canonical,
        expect.objectContaining({ title: 'New Title' }),
        undefined
      )
      expect(parse(out).id).toBe(canonical)
    })

    it('applies a field update with a canonical article_ id unchanged (A1)', async () => {
      const canonical = generateId('article')
      mockUpdateArticle.mockResolvedValue(articleDTO(canonical))

      await collect(teamAuth).get('update_article')!({
        articleId: canonical,
        title: 'New Title',
      })

      expect(mockUpdateArticle).toHaveBeenCalledWith(
        canonical,
        expect.objectContaining({ title: 'New Title' }),
        undefined
      )
    })

    it('falls back to getArticleById when no field, publish, or author update is given (A1)', async () => {
      const canonical = generateId('article')
      mockGetArticleById.mockResolvedValue(articleDTO(canonical))

      const out = await collect(teamAuth).get('update_article')!({ articleId: canonical })

      expect(mockUpdateArticle).not.toHaveBeenCalled()
      expect(mockPublishArticle).not.toHaveBeenCalled()
      expect(mockUnpublishArticle).not.toHaveBeenCalled()
      expect(mockGetArticleById).toHaveBeenCalledWith(canonical)
      expect(parse(out).id).toBe(canonical)
    })

    it('rewrites a retired kb_article_ authorId to article-domain principal update (A1)', async () => {
      // Sanity check that the authorId parameter (a *different* prefix,
      // 'principal') is unaffected by the articleId rewrite — the two
      // parseOptionalTypeId/parseTypeId calls are independent.
      const canonical = generateId('article')
      const legacy = legacyIdFor(canonical)
      const principalId = generateId('principal')
      mockUpdateArticle.mockResolvedValue(articleDTO(canonical))

      await collect(teamAuth).get('update_article')!({
        articleId: legacy,
        authorId: principalId,
      })

      expect(mockUpdateArticle).toHaveBeenCalledWith(canonical, expect.any(Object), principalId)
    })
  })

  describe('delete_article', () => {
    it('rewrites a retired kb_article_ id to article_, deletes by canonical id, and reports the canonical id (A1, A4)', async () => {
      const canonical = generateId('article')
      const legacy = legacyIdFor(canonical)
      mockDeleteArticle.mockResolvedValue(undefined)

      const out = await collect(teamAuth).get('delete_article')!({ articleId: legacy })

      expect(mockDeleteArticle).toHaveBeenCalledWith(canonical)
      expect(mockDeleteArticle).not.toHaveBeenCalledWith(legacy)
      expect(parse(out)).toEqual({ deleted: true, id: canonical })
    })

    it('deletes by a canonical article_ id and reports it unchanged (A4)', async () => {
      const canonical = generateId('article')
      mockDeleteArticle.mockResolvedValue(undefined)

      const out = await collect(teamAuth).get('delete_article')!({ articleId: canonical })

      expect(mockDeleteArticle).toHaveBeenCalledWith(canonical)
      expect(parse(out)).toEqual({ deleted: true, id: canonical })
    })

    it('accepts either prefix and acts on the same underlying article (A4)', async () => {
      const canonical = generateId('article')
      const legacy = legacyIdFor(canonical)
      mockDeleteArticle.mockResolvedValue(undefined)

      const viaCanonical = parse(
        await collect(teamAuth).get('delete_article')!({ articleId: canonical })
      )
      const viaLegacy = parse(await collect(teamAuth).get('delete_article')!({ articleId: legacy }))

      expect(viaCanonical.id).toBe(canonical)
      expect(viaLegacy.id).toBe(canonical)
      expect(mockDeleteArticle).toHaveBeenNthCalledWith(1, canonical)
      expect(mockDeleteArticle).toHaveBeenNthCalledWith(2, canonical)
    })
  })
})
