/**
 * Changelog create: when an entry has content and when it is refused.
 *
 * Contract for the batch F pick (upstream 395821636, "save entries when the
 * editor has a body but markdown is empty") -- the confirmed list items this
 * suite pins:
 *
 *   F1 A changelog entry whose editor shows content is saved, even when the
 *      markdown projection of that content is empty or the serializer failed.
 *   F2 An entry with no content in any form is still refused as "Content is
 *      required".
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import fc from 'fast-check'
import type { ChangelogId, PrincipalId } from '@quackback/ids'
import type { TiptapContent } from '@/lib/shared/db-types'

const ENTRY_ID = 'changelog_01test' as ChangelogId
const AUTHOR = { principalId: 'principal_01author' as PrincipalId, name: 'Author' }

const mockEntryFindFirst = vi.fn()
const mockUpdateSet = vi.fn()
const mockInsertValues = vi.fn()
const mockChangelogEntryPostsFindMany = vi.fn()

// Rows the claim UPDATE...RETURNING yields (a single row = claim won, [] = lost),
// and the due-entry rows the reconciler's select returns. Mutated per test.
let mockClaimResult: unknown[] = []
let mockDueRows: unknown[] = []

vi.mock('@/lib/server/db', async (importOriginal) => ({
  // Spread the real db module so tables/operators stay current; override only what this suite drives.
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: {
    query: {
      changelogEntries: { findFirst: (...args: unknown[]) => mockEntryFindFirst(...args) },
      changelogEntryPosts: {
        findMany: (...args: unknown[]) => mockChangelogEntryPostsFindMany(...args),
      },
      changelogEntryCategories: { findMany: vi.fn().mockResolvedValue([]) },
      principal: { findFirst: vi.fn().mockResolvedValue(null) },
      postStatuses: { findFirst: vi.fn().mockResolvedValue(null) },
    },
    insert: () => ({
      values: (values: unknown) => {
        mockInsertValues(values)
        return {
          returning: () => Promise.resolve([{ id: ENTRY_ID, title: 'Release', content: 'Body' }]),
        }
      },
    }),
    update: () => ({
      set: (values: unknown) => {
        mockUpdateSet(values)
        // `.where()` is both awaitable (plain UPDATE / release) and carries
        // `.returning()` (the atomic claim), mirroring drizzle's builder.
        const p = Promise.resolve(mockClaimResult) as Promise<unknown[]> & {
          returning: () => Promise<unknown[]>
        }
        p.returning = () => Promise.resolve(mockClaimResult)
        return { where: () => p }
      },
    }),
    select: () => {
      // Awaitable at any depth so the due-rows query (ends on `.limit()`) and
      // the products query (ends on `.orderBy()`) share one shape.
      const chain: Record<string, unknown> = {}
      const self = () => chain
      chain.from = self
      chain.innerJoin = self
      chain.where = self
      chain.orderBy = self
      chain.limit = () => Promise.resolve(mockDueRows)
      chain.then = (onOk: (v: unknown) => unknown, onErr: (e: unknown) => unknown) =>
        Promise.resolve([]).then(onOk, onErr)
      return chain
    },
    delete: () => ({ where: vi.fn().mockResolvedValue(undefined) }),
  },
  eq: vi.fn(),
  and: vi.fn(),
  asc: vi.fn(),
  sql: Object.assign(
    vi.fn(() => ({ kind: 'sql' })),
    { raw: vi.fn() }
  ),
  isNull: vi.fn(),
  isNotNull: vi.fn(),
  lte: vi.fn(),
  inArray: vi.fn(),
}))

vi.mock('@/lib/server/content/rehost-images', () => ({
  rehostExternalImages: vi.fn(async (json: unknown) => json),
}))
vi.mock('@/lib/server/events/dispatch', () => ({
  buildEventActor: vi.fn(() => ({ type: 'user' })),
  dispatchChangelogPublished: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/lib/server/events/scheduler', () => ({
  scheduleDispatch: vi.fn().mockResolvedValue(undefined),
  cancelScheduledDispatch: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/lib/server/config', () => ({
  config: { s3PublicUrl: undefined, baseUrl: 'http://localhost:3000' },
  getBaseUrl: () => 'http://localhost:3000',
}))

type Block = { hasBody: boolean; node: TiptapContent }

const text = (value: string): TiptapContent => ({ type: 'text', text: value })
const paragraph = (...children: TiptapContent[]): TiptapContent => ({
  type: 'paragraph',
  content: children,
})

// Blocks the editor can show without a visible body.
const emptyBlock: fc.Arbitrary<Block> = fc.oneof(
  fc.constant<Block>({ hasBody: false, node: { type: 'paragraph' } }),
  fc
    .constantFrom(' ', '   ', '\t', '\n', ' \u00a0 ')
    .map((blank) => ({ hasBody: false, node: paragraph(text(blank)) })),
  fc.constant<Block>({
    hasBody: false,
    node: { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph' }] }] },
  })
)

// Blocks the editor shows as visible content.
const bodiedBlock: fc.Arbitrary<Block> = fc.oneof(
  fc
    .string({ minLength: 1, maxLength: 20 })
    .filter((value) => value.trim().length > 0)
    .map((value) => ({ hasBody: true, node: paragraph(text(value)) })),
  fc
    .string({ minLength: 1, maxLength: 20 })
    .filter((value) => value.trim().length > 0)
    .map((value) => ({
      hasBody: true,
      node: { type: 'heading', attrs: { level: 2 }, content: [text(value)] },
    })),
  fc
    .string({ minLength: 1, maxLength: 20 })
    .filter((value) => value.trim().length > 0)
    .map((value) => ({
      hasBody: true,
      node: {
        type: 'orderedList',
        content: [{ type: 'listItem', content: [paragraph(text(value))] }],
      },
    })),
  fc.constant({
    hasBody: true,
    node: { type: 'image', attrs: { src: '/api/storage/changelog-images/a.png', alt: '' } },
  })
)

const anyBlock = fc.oneof(emptyBlock, bodiedBlock)

function documentOf(blocks: Block[]): TiptapContent {
  return { type: 'doc', content: blocks.map((block) => block.node) }
}

function hasBody(blocks: Block[]): boolean {
  return blocks.some((block) => block.hasBody)
}

// The projection the editor reports: empty (list-only doc, serializer skipped
// or threw), or whitespace only. Never real text.
const emptyMarkdown = fc.constantFrom('', ' ', '\n\n', '  \n ')

const publishState = { type: 'draft' as const }

async function create(content: string, contentJson: TiptapContent | null) {
  const { createChangelog } = await import('../changelog.service')
  return createChangelog({ title: 'Release', content, contentJson, publishState }, AUTHOR)
}

beforeEach(() => {
  vi.clearAllMocks()
  mockChangelogEntryPostsFindMany.mockResolvedValue([])
  mockEntryFindFirst.mockResolvedValue({ id: ENTRY_ID, title: 'Release', content: 'Body' })
})

describe('changelog create content rule', () => {
  it('(F1)(F2) with an empty markdown projection, saves exactly the documents that have a body', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(anyBlock, { maxLength: 6 }),
        emptyMarkdown,
        async (blocks, markdown) => {
          mockInsertValues.mockClear()
          const outcome = await create(markdown, documentOf(blocks)).then(
            () => 'saved',
            (error: Error) => error.message
          )
          if (hasBody(blocks)) {
            expect(outcome).toBe('saved')
          } else {
            expect(outcome).toBe('Content is required')
          }
          const wasInserted = mockInsertValues.mock.calls.length === 1
          expect(wasInserted).toBe(outcome === 'saved')
        }
      ),
      { numRuns: 150 }
    )
  })

  it('(F1) stores the editor document, not a re-parse of the empty markdown', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(bodiedBlock, { minLength: 1, maxLength: 5 }),
        emptyMarkdown,
        async (blocks, markdown) => {
          mockInsertValues.mockClear()
          const document = documentOf(blocks)
          await create(markdown, document)
          const stored = mockInsertValues.mock.calls[0][0] as { contentJson: TiptapContent }
          expect(stored.contentJson).toEqual(document)
        }
      ),
      { numRuns: 60 }
    )
  })

  it('(F2) refuses an entry that has neither markdown nor a document', async () => {
    await fc.assert(
      fc.asyncProperty(
        emptyMarkdown,
        fc.constantFrom(null, { type: 'doc' }, { type: 'doc', content: [] }),
        async (markdown, contentJson) => {
          await expect(create(markdown, contentJson as TiptapContent | null)).rejects.toThrow(
            'Content is required'
          )
        }
      )
    )
  })

  it('(F2) saves a markdown-only entry that carries text, whatever the document says', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 30 }).filter((value) => value.trim().length > 0),
        fc.array(emptyBlock, { maxLength: 3 }),
        async (markdown, blocks) => {
          mockInsertValues.mockClear()
          await create(markdown, documentOf(blocks))
          expect(mockInsertValues).toHaveBeenCalledTimes(1)
        }
      )
    )
  })
})
