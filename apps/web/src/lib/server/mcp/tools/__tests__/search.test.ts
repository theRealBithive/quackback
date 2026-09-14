/**
 * ## A — Article ids (upstream a720add94)
 * - A1 An article id is emitted as `article_`; a `kb_article_` id is accepted wherever an article id is read (MCP tools, copilot report, Zod schemas) and rewritten to `article_`, so the retired prefix is never persisted.
 * - A2 A prefix alias resolves to its canonical prefix, a canonical prefix to itself, an unknown prefix to nothing.
 * - A3 A citation whose id is not a valid article id counts as no article rather than failing the report.
 * - A4 The MCP update and delete article tools accept either prefix and act on the same article; delete reports the canonical id.
 *
 * This module pins A1 only, for `get_details`' article/kb_article branch.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { generateId } from '@quackback/ids'

const mockListInboxPosts = vi.fn()
const mockGetPostWithDetails = vi.fn()
const mockGetCommentsWithReplies = vi.fn()
const mockGetMergedPosts = vi.fn()
const mockGetChangelogById = vi.fn()
const mockListChangelogs = vi.fn()
const mockListArticles = vi.fn()
const mockGetArticleById = vi.fn()
const mockGetCategoryById = vi.fn()
const mockIsFeatureEnabled = vi.fn()

vi.mock('@/lib/server/domains/posts/post.inbox', () => ({
  listInboxPosts: (...a: unknown[]) => mockListInboxPosts(...a),
}))
vi.mock('@/lib/server/domains/posts/post.query', () => ({
  getPostWithDetails: (...a: unknown[]) => mockGetPostWithDetails(...a),
  getCommentsWithReplies: (...a: unknown[]) => mockGetCommentsWithReplies(...a),
}))
vi.mock('@/lib/server/domains/posts/post.merge', () => ({
  getMergedPosts: (...a: unknown[]) => mockGetMergedPosts(...a),
}))
vi.mock('@/lib/server/domains/changelog/changelog.service', () => ({
  getChangelogById: (...a: unknown[]) => mockGetChangelogById(...a),
}))
vi.mock('@/lib/server/domains/changelog/changelog.query', () => ({
  listChangelogs: (...a: unknown[]) => mockListChangelogs(...a),
}))
vi.mock('@/lib/server/domains/help-center/help-center.service', () => ({
  listArticles: (...a: unknown[]) => mockListArticles(...a),
  getArticleById: (...a: unknown[]) => mockGetArticleById(...a),
  getCategoryById: (...a: unknown[]) => mockGetCategoryById(...a),
}))
vi.mock('@/lib/server/domains/settings/settings.service', () => ({
  isFeatureEnabled: (...a: unknown[]) => mockIsFeatureEnabled(...a),
}))

import { registerSearchTools } from '../search'
import type { McpAuthContext } from '../../types'

type Handler = (args: Record<string, unknown>) => Promise<CallToolResult>

/** Register the search tools against a fake server, capturing each wrapped handler. */
function collect(auth: McpAuthContext): Map<string, Handler> {
  const handlers = new Map<string, Handler>()
  const fakeServer = {
    tool: (name: string, _d: string, _s: unknown, _a: unknown, handler: Handler) => {
      handlers.set(name, handler)
    },
  }
  registerSearchTools(fakeServer as never, auth)
  return handlers
}

const teamAuth = {
  principalId: 'principal_key',
  userId: 'user_1',
  name: 'Agent',
  email: 'agent@acme.com',
  role: 'admin' as const,
  authMethod: 'api-key' as const,
  scopes: ['read:article', 'read:feedback'],
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
    publishedAt: new Date('2026-07-04T00:00:00.000Z'),
    viewCount: 0,
    helpfulCount: 3,
    notHelpfulCount: 1,
    createdAt: new Date('2026-07-04T00:00:00.000Z'),
    updatedAt: new Date('2026-07-04T00:00:00.000Z'),
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockIsFeatureEnabled.mockResolvedValue(true)
})

describe('search MCP tools', () => {
  describe('get_details — article ids', () => {
    it('accepts a canonical article_ id and fetches by that id (A1)', async () => {
      const canonical = generateId('article')
      mockGetArticleById.mockResolvedValue(articleDTO(canonical))

      const out = await collect(teamAuth).get('get_details')!({ id: canonical })

      expect(mockGetArticleById).toHaveBeenCalledWith(canonical)
      expect(parse(out).id).toBe(canonical)
    })

    it('accepts a retired kb_article_ id and rewrites it to article_ before fetching (A1)', async () => {
      const canonical = generateId('article')
      const legacy = `kb_article_${canonical.slice('article_'.length)}`
      mockGetArticleById.mockResolvedValue(articleDTO(canonical))

      const out = await collect(teamAuth).get('get_details')!({ id: legacy })

      // The retired prefix must never reach the domain layer or the response.
      expect(mockGetArticleById).toHaveBeenCalledWith(canonical)
      expect(mockGetArticleById).not.toHaveBeenCalledWith(legacy)
      expect(parse(out).id).toBe(canonical)
    })

    it('denies a caller lacking the read:article scope before calling the domain layer (A1)', async () => {
      const noScope = { ...teamAuth, scopes: [] } as unknown as McpAuthContext
      const canonical = generateId('article')

      const out = await collect(noScope).get('get_details')!({ id: canonical })

      expect(out.isError).toBe(true)
      expect(mockGetArticleById).not.toHaveBeenCalled()
    })
  })
})
