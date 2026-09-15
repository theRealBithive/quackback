import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { PostStatusId } from '@quackback/ids'
import { ValidationError } from '@/lib/shared/errors'

/**
 * ## T — Taxonomy names, colours, slugs, positions
 * - T3 Post tags, conversation labels, changelog categories, post statuses,
 *   ticket types and ticket statuses keep their pre-consolidation rejection
 *   messages word for word, and a create payload without a colour gets the
 *   shared default swatch `#6b7280`.
 * - T8 Update paths validate like create paths: renaming or recolouring a
 *   post tag, conversation label, changelog category, post status, ticket
 *   status or ticket type applies the same name and colour rules and
 *   messages as creating one.
 *
 * Pure unit test — the db module is stubbed so createStatus/updateStatus's
 * color validation (`assertHexColor`, the caller-supplied message) can be
 * pinned without a database.
 */

const {
  mockFindFirst,
  mockInsertReturning,
  mockInsertValues,
  mockInsert,
  mockUpdateReturning,
  mockUpdateSet,
  mockUpdate,
  mockPostStatuses,
} = vi.hoisted(() => {
  const mockFindFirst = vi.fn()
  const mockInsertReturning = vi.fn()
  const mockInsertValues = vi.fn(() => ({ returning: mockInsertReturning }))
  const mockInsert = vi.fn(() => ({ values: mockInsertValues }))
  const mockUpdateReturning = vi.fn()
  const mockUpdateWhere = vi.fn(() => ({ returning: mockUpdateReturning }))
  const mockUpdateSet = vi.fn(() => ({ where: mockUpdateWhere }))
  const mockUpdate = vi.fn(() => ({ set: mockUpdateSet }))
  const mockPostStatuses = {
    id: Symbol('postStatuses.id'),
    slug: Symbol('postStatuses.slug'),
    category: Symbol('postStatuses.category'),
    position: Symbol('postStatuses.position'),
    isDefault: Symbol('postStatuses.isDefault'),
    deletedAt: Symbol('postStatuses.deletedAt'),
  }
  return {
    mockFindFirst,
    mockInsertReturning,
    mockInsertValues,
    mockInsert,
    mockUpdateReturning,
    mockUpdateWhere,
    mockUpdateSet,
    mockUpdate,
    mockPostStatuses,
  }
})

vi.mock('@/lib/server/db', () => ({
  db: {
    query: { postStatuses: { findFirst: mockFindFirst } },
    insert: mockInsert,
    update: mockUpdate,
    execute: vi.fn(),
  },
  eq: vi.fn((col, val) => ({ _tag: 'eq', col, val })),
  and: vi.fn((...args) => ({ _tag: 'and', args })),
  isNull: vi.fn((col) => ({ _tag: 'isNull', col })),
  inArray: vi.fn((col, vals) => ({ _tag: 'inArray', col, vals })),
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({ _tag: 'sql', strings, values }),
  asc: vi.fn((col) => ({ _tag: 'asc', col })),
  posts: {},
  postStatuses: mockPostStatuses,
}))

import { createStatus, updateStatus } from '../status.service'

const validCreateInput = {
  name: 'In Review',
  slug: 'in_review',
  color: '#3b82f6',
  category: 'active' as const,
}

beforeEach(() => {
  vi.clearAllMocks()
  mockFindFirst.mockResolvedValue(undefined) // no duplicate slug, no existing status by default
})

describe('createStatus — color validation (T3)', () => {
  it('rejects an invalid color with "Color must be in hex format (e.g., #3b82f6)" (T3)', async () => {
    await expect(createStatus({ ...validCreateInput, color: 'blue' })).rejects.toThrow(
      new ValidationError('VALIDATION_ERROR', 'Color must be in hex format (e.g., #3b82f6)')
    )
  })

  it('creates the status when the color is a well-formed #rrggbb (T3)', async () => {
    mockInsertReturning.mockResolvedValue([{ id: 'post_status_1', ...validCreateInput }])

    const result = await createStatus(validCreateInput)

    expect(mockInsertValues).toHaveBeenCalledWith(expect.objectContaining({ color: '#3b82f6' }))
    expect(result).toMatchObject({ id: 'post_status_1', color: '#3b82f6' })
  })
})

describe('updateStatus — color validation (T3, T8)', () => {
  beforeEach(() => {
    mockFindFirst.mockResolvedValue({ id: 'post_status_1', name: 'In Review', color: '#3b82f6' })
  })

  it('rejects an invalid update color with the same "Color must be in hex format (e.g., #3b82f6)" message (T3, T8)', async () => {
    await expect(
      updateStatus('post_status_1' as PostStatusId, { color: 'not-a-color' })
    ).rejects.toThrow(
      new ValidationError('VALIDATION_ERROR', 'Color must be in hex format (e.g., #3b82f6)')
    )
  })

  it('rejects an empty update color with "Color cannot be empty" (T3, T8)', async () => {
    await expect(updateStatus('post_status_1' as PostStatusId, { color: '   ' })).rejects.toThrow(
      new ValidationError('VALIDATION_ERROR', 'Color cannot be empty')
    )
  })

  it('accepts a well-formed update color and writes it (T3, T8)', async () => {
    mockUpdateReturning.mockResolvedValue([{ id: 'post_status_1', color: '#654321' }])

    const result = await updateStatus('post_status_1' as PostStatusId, { color: '#654321' })

    expect(mockUpdateSet).toHaveBeenCalledWith(expect.objectContaining({ color: '#654321' }))
    expect(result.color).toBe('#654321')
  })
})
