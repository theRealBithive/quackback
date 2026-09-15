/**
 * Tag portal visibility at the service layer.
 *
 * `listPublicPostTags` is the portal's tag catalog. Non-team viewers must only
 * receive tags marked public; team actors get everything (they assign internal
 * tags from the portal too). Create/update persist the flag, defaulting new
 * tags to public so behaviour is unchanged for admins who never touch it.
 *
 * Pure unit test — the db module is stubbed with tagging operators so the
 * `where` shape can be asserted without a database.
 *
 * ## T — Taxonomy names, colours, slugs, positions
 * - T3 Post tags, conversation labels, changelog categories, post statuses,
 *   ticket types and ticket statuses keep their pre-consolidation rejection
 *   messages word for word, and a create payload without a colour gets the
 *   shared default swatch `#6b7280`.
 * - T8 Update paths validate like create paths: renaming or recolouring a
 *   post tag, conversation label, changelog category, post status, ticket
 *   status or ticket type applies the same name and colour rules and
 *   messages as creating one.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { PostTagId, PrincipalId } from '@quackback/ids'
import type { Actor } from '@/lib/server/policy'
import { ConflictError, ValidationError } from '@/lib/shared/errors'

const mockEq = vi.fn((col, val) => ({ _tag: 'eq', col, val }))
const mockAnd = vi.fn((...args) => ({ _tag: 'and', args }))
const mockNe = vi.fn((col, val) => ({ _tag: 'ne', col, val }))
const mockIsNull = vi.fn((col) => ({ _tag: 'isNull', col }))
const mockAsc = vi.fn((col) => ({ _tag: 'asc', col }))

const mockPostTags = {
  id: Symbol('postTags.id'),
  name: Symbol('postTags.name'),
  isPublic: Symbol('postTags.isPublic'),
  deletedAt: Symbol('postTags.deletedAt'),
}

const mockFindMany = vi.fn()
const mockFindFirst = vi.fn()
const mockInsertReturning = vi.fn()
const mockInsertValues = vi.fn(() => ({ returning: mockInsertReturning }))
const mockUpdateReturning = vi.fn()
const mockUpdateWhere = vi.fn(() => ({ returning: mockUpdateReturning }))
const mockUpdateSet = vi.fn(() => ({ where: mockUpdateWhere }))

vi.mock('@/lib/server/db', () => ({
  db: {
    query: { postTags: { findMany: mockFindMany, findFirst: mockFindFirst } },
    insert: vi.fn(() => ({ values: mockInsertValues })),
    update: vi.fn(() => ({ set: mockUpdateSet })),
  },
  eq: mockEq,
  and: mockAnd,
  ne: mockNe,
  isNull: mockIsNull,
  asc: mockAsc,
  postTags: mockPostTags,
  boards: {},
  postTagAssignments: {},
  posts: {},
}))

const TEAM_ACTOR: Actor = {
  principalId: 'principal_team' as PrincipalId,
  role: 'admin',
  principalType: 'user',
  segmentIds: new Set(),
  permissions: new Set(),
}

const CUSTOMER_ACTOR: Actor = {
  principalId: 'principal_customer' as PrincipalId,
  role: 'user',
  principalType: 'user',
  segmentIds: new Set(),
  permissions: new Set(),
}

beforeEach(() => {
  vi.clearAllMocks()
  mockFindMany.mockResolvedValue([])
  mockFindFirst.mockResolvedValue(undefined)
})

describe('listPublicPostTags — portal visibility', () => {
  it('restricts to public, non-deleted tags for an anonymous viewer (default actor)', async () => {
    const { listPublicPostTags } = await import('../post-tag.service')

    await listPublicPostTags()

    const { where } = mockFindMany.mock.calls[0][0]
    expect(where).toEqual({
      _tag: 'and',
      args: [
        { _tag: 'isNull', col: mockPostTags.deletedAt },
        { _tag: 'eq', col: mockPostTags.isPublic, val: true },
      ],
    })
  })

  it('restricts to public tags for a signed-in customer', async () => {
    const { listPublicPostTags } = await import('../post-tag.service')

    await listPublicPostTags(CUSTOMER_ACTOR)

    expect(mockEq).toHaveBeenCalledWith(mockPostTags.isPublic, true)
  })

  it('returns every non-deleted tag for a team actor', async () => {
    const { listPublicPostTags } = await import('../post-tag.service')

    await listPublicPostTags(TEAM_ACTOR)

    const { where } = mockFindMany.mock.calls[0][0]
    expect(where).toEqual({ _tag: 'isNull', col: mockPostTags.deletedAt })
    expect(mockEq).not.toHaveBeenCalledWith(mockPostTags.isPublic, true)
  })
})

describe('createPostTag — isPublic', () => {
  it('defaults new tags to public when the flag is omitted', async () => {
    mockInsertReturning.mockResolvedValue([{ id: 'post_tag_1', isPublic: true }])
    const { createPostTag } = await import('../post-tag.service')

    await createPostTag({ name: 'Bug' })

    expect(mockInsertValues).toHaveBeenCalledWith(expect.objectContaining({ isPublic: true }))
  })

  it('persists an explicit internal flag', async () => {
    mockInsertReturning.mockResolvedValue([{ id: 'post_tag_1', isPublic: false }])
    const { createPostTag } = await import('../post-tag.service')

    await createPostTag({ name: 'Churn risk', isPublic: false })

    expect(mockInsertValues).toHaveBeenCalledWith(expect.objectContaining({ isPublic: false }))
  })
})

describe('createPostTag — name/color validation (T3)', () => {
  it('rejects an empty name with "PostTag name is required" (T3)', async () => {
    const { createPostTag } = await import('../post-tag.service')
    await expect(createPostTag({ name: '   ' })).rejects.toThrow(
      new ValidationError('VALIDATION_ERROR', 'PostTag name is required')
    )
  })

  it('rejects a name over 50 characters with "PostTag name must not exceed 50 characters" (T3)', async () => {
    const { createPostTag } = await import('../post-tag.service')
    await expect(createPostTag({ name: 'x'.repeat(51) })).rejects.toThrow(
      new ValidationError('VALIDATION_ERROR', 'PostTag name must not exceed 50 characters')
    )
  })

  it('rejects a duplicate name (case-insensitive) as a conflict (T3)', async () => {
    mockFindFirst.mockResolvedValue({ id: 'post_tag_existing', name: 'Bug' })
    const { createPostTag } = await import('../post-tag.service')
    await expect(createPostTag({ name: 'Bug' })).rejects.toThrow(ConflictError)
  })

  it('rejects an invalid explicit color with "Color must be a valid hex color (e.g., #6b7280)" (T3)', async () => {
    const { createPostTag } = await import('../post-tag.service')
    await expect(createPostTag({ name: 'Bug', color: 'blue' })).rejects.toThrow(
      new ValidationError('VALIDATION_ERROR', 'Color must be a valid hex color (e.g., #6b7280)')
    )
  })

  it('defaults an omitted color to the shared swatch #6b7280 (T3)', async () => {
    mockInsertReturning.mockResolvedValue([{ id: 'post_tag_1', color: '#6b7280' }])
    const { createPostTag } = await import('../post-tag.service')

    await createPostTag({ name: 'Bug' })

    expect(mockInsertValues).toHaveBeenCalledWith(expect.objectContaining({ color: '#6b7280' }))
  })
})

describe('updatePostTag — isPublic', () => {
  beforeEach(() => {
    mockFindFirst.mockResolvedValue({ id: 'post_tag_1', name: 'Bug', isPublic: true })
    mockUpdateReturning.mockResolvedValue([{ id: 'post_tag_1', isPublic: false }])
  })

  it('writes isPublic when provided', async () => {
    const { updatePostTag } = await import('../post-tag.service')

    await updatePostTag('post_tag_1' as PostTagId, { isPublic: false })

    expect(mockUpdateSet).toHaveBeenCalledWith({ isPublic: false })
  })

  it('leaves isPublic untouched when omitted', async () => {
    const { updatePostTag } = await import('../post-tag.service')

    await updatePostTag('post_tag_1' as PostTagId, { color: '#ef4444' })

    expect(mockUpdateSet).toHaveBeenCalledWith({ color: '#ef4444' })
  })
})

describe('updatePostTag — name/color validation (T3, T8)', () => {
  it('rejects an empty rename with "PostTag name cannot be empty" (T3, T8)', async () => {
    mockFindFirst.mockResolvedValueOnce({ id: 'post_tag_1', name: 'Bug' }) // existingTag lookup
    const { updatePostTag } = await import('../post-tag.service')
    await expect(updatePostTag('post_tag_1' as PostTagId, { name: '   ' })).rejects.toThrow(
      new ValidationError('VALIDATION_ERROR', 'PostTag name cannot be empty')
    )
  })

  it('rejects a rename over 50 characters with "PostTag name must not exceed 50 characters" (T3, T8)', async () => {
    mockFindFirst.mockResolvedValueOnce({ id: 'post_tag_1', name: 'Bug' })
    const { updatePostTag } = await import('../post-tag.service')
    await expect(
      updatePostTag('post_tag_1' as PostTagId, { name: 'x'.repeat(51) })
    ).rejects.toThrow(
      new ValidationError('VALIDATION_ERROR', 'PostTag name must not exceed 50 characters')
    )
  })

  it('rejects a rename onto another live tag as a conflict (checked with ne(id) so it never flags itself) (T3, T8)', async () => {
    mockFindFirst
      .mockResolvedValueOnce({ id: 'post_tag_1', name: 'Bug' }) // existingTag lookup
      .mockResolvedValueOnce({ id: 'post_tag_2', name: 'Feature' }) // duplicate hit
    const { updatePostTag } = await import('../post-tag.service')

    await expect(updatePostTag('post_tag_1' as PostTagId, { name: 'Feature' })).rejects.toThrow(
      ConflictError
    )
    expect(mockNe).toHaveBeenCalledWith(mockPostTags.id, 'post_tag_1')
  })

  it('allows a rename with no conflict and trims the stored name (T3, T8)', async () => {
    mockFindFirst
      .mockResolvedValueOnce({ id: 'post_tag_1', name: 'Bug' }) // existingTag lookup
      .mockResolvedValueOnce(undefined) // no duplicate
    mockUpdateReturning.mockResolvedValue([{ id: 'post_tag_1', name: 'Bugs' }])
    const { updatePostTag } = await import('../post-tag.service')

    await updatePostTag('post_tag_1' as PostTagId, { name: '  Bugs  ' })

    expect(mockUpdateSet).toHaveBeenCalledWith(expect.objectContaining({ name: 'Bugs' }))
  })

  it('rejects an invalid update color with "Color must be a valid hex color (e.g., #6b7280)" (T3, T8)', async () => {
    mockFindFirst.mockResolvedValueOnce({ id: 'post_tag_1', name: 'Bug' })
    const { updatePostTag } = await import('../post-tag.service')
    await expect(
      updatePostTag('post_tag_1' as PostTagId, { color: 'not-a-color' })
    ).rejects.toThrow(
      new ValidationError('VALIDATION_ERROR', 'Color must be a valid hex color (e.g., #6b7280)')
    )
  })
})
