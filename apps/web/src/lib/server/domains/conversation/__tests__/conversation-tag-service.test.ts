import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ConversationTagId } from '@quackback/ids'
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
 */

const { mockFindMany, mockFindFirst, mockReturning, mockSet, mockUpdate, mockConversationTags } =
  vi.hoisted(() => {
    const mockFindMany = vi.fn()
    const mockFindFirst = vi.fn()
    const mockReturning = vi.fn()
    const mockWhere = vi.fn(() => ({ returning: mockReturning }))
    const mockSet = vi.fn(() => ({ where: mockWhere }))
    const mockUpdate = vi.fn(() => ({ set: mockSet }))
    const mockConversationTags = {
      id: Symbol('conversationTags.id'),
      name: Symbol('conversationTags.name'),
      color: Symbol('conversationTags.color'),
      deletedAt: Symbol('conversationTags.deletedAt'),
    }
    return {
      mockFindMany,
      mockFindFirst,
      mockReturning,
      mockWhere,
      mockSet,
      mockUpdate,
      mockConversationTags,
    }
  })

vi.mock('@/lib/server/db', () => ({
  db: {
    query: { conversationTags: { findMany: mockFindMany, findFirst: mockFindFirst } },
    update: mockUpdate,
  },
  eq: vi.fn((col, val) => ({ _tag: 'eq', col, val })),
  and: vi.fn((...args) => ({ _tag: 'and', args })),
  isNull: vi.fn((col) => ({ _tag: 'isNull', col })),
  isNotNull: vi.fn((col) => ({ _tag: 'isNotNull', col })),
  asc: vi.fn((col) => ({ _tag: 'asc', col })),
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({ _tag: 'sql', strings, values }),
  conversationTags: mockConversationTags,
  conversationTagAssignments: {},
  conversations: {},
  workflows: {},
  macros: {},
}))

import {
  normalizeConversationTagInput,
  hasNameConflict,
  updateConversationTag,
} from '../conversation-tag.service'

describe('normalizeConversationTagInput', () => {
  it('trims the name and defaults the color', () => {
    expect(normalizeConversationTagInput({ name: '  Lead ' })).toEqual({
      name: 'Lead',
      color: '#6b7280',
    })
  })

  it('keeps a valid custom hex color', () => {
    expect(normalizeConversationTagInput({ name: 'x', color: '#FF0000' })).toEqual({
      name: 'x',
      color: '#FF0000',
    })
  })

  it('rejects an empty / whitespace name', () => {
    expect(() => normalizeConversationTagInput({ name: '   ' })).toThrow()
  })

  it('rejects a name over 50 characters', () => {
    expect(() => normalizeConversationTagInput({ name: 'a'.repeat(51) })).toThrow()
  })

  it('rejects a non-hex color', () => {
    expect(() => normalizeConversationTagInput({ name: 'x', color: 'red' })).toThrow()
    expect(() => normalizeConversationTagInput({ name: 'x', color: '#FFF' })).toThrow()
  })
})

describe('hasNameConflict', () => {
  const id = (s: string) => s as ConversationTagId
  const live = [
    { id: id('conversation_tag_a'), name: 'Lead' },
    { id: id('conversation_tag_b'), name: 'VIP' },
  ]

  it('flags a rename onto another live tag (case-insensitive)', () => {
    expect(hasNameConflict(id('conversation_tag_a'), 'vip', live)).toBe(true)
    expect(hasNameConflict(id('conversation_tag_a'), '  VIP ', live)).toBe(true)
  })

  it('allows keeping the same tag at its own name', () => {
    // Renaming a tag to (a casing of) its own current name is not a conflict.
    expect(hasNameConflict(id('conversation_tag_b'), 'VIP', live)).toBe(false)
    expect(hasNameConflict(id('conversation_tag_b'), 'vip', live)).toBe(false)
  })

  it('allows a brand-new name', () => {
    expect(hasNameConflict(id('conversation_tag_a'), 'Churned', live)).toBe(false)
  })
})

describe('updateConversationTag — name/color validation (T3, T8)', () => {
  const id = 'conversation_tag_1' as ConversationTagId

  beforeEach(() => {
    vi.clearAllMocks()
    mockFindMany.mockResolvedValue([])
  })

  it('rejects an empty rename with "PostTag name is required" (T3, T8)', async () => {
    await expect(updateConversationTag(id, { name: '   ' })).rejects.toThrow(
      new ValidationError('VALIDATION_ERROR', 'PostTag name is required')
    )
  })

  it('rejects a rename over 50 characters with "PostTag name must not exceed 50 characters" (T3, T8)', async () => {
    await expect(updateConversationTag(id, { name: 'x'.repeat(51) })).rejects.toThrow(
      new ValidationError('VALIDATION_ERROR', 'PostTag name must not exceed 50 characters')
    )
  })

  // Routed through hasNameConflict (tested directly above) rather than a
  // duplicate-lookup mock, since conversation tags check conflicts against
  // the already-fetched list rather than a second query.
  it('rejects a rename onto another live tag as a validation error (T8)', async () => {
    mockFindMany.mockResolvedValue([
      { id, name: 'Lead' },
      { id: 'conversation_tag_2' as ConversationTagId, name: 'VIP' },
    ])

    await expect(updateConversationTag(id, { name: 'vip' })).rejects.toThrow(
      new ValidationError('VALIDATION_ERROR', 'A tag with that name already exists')
    )
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it('allows a rename with no conflict and writes the trimmed name (T3, T8)', async () => {
    mockFindMany.mockResolvedValue([{ id, name: 'Lead' }])
    mockReturning.mockResolvedValue([{ id, name: 'Prospect', color: '#6b7280' }])

    const result = await updateConversationTag(id, { name: '  Prospect  ' })

    expect(mockSet).toHaveBeenCalledWith({ name: 'Prospect' })
    expect(result).toEqual({ id, name: 'Prospect', color: '#6b7280' })
  })

  it('rejects an invalid update color with "Color must be a valid hex color (e.g., #6b7280)" (T3, T8)', async () => {
    await expect(updateConversationTag(id, { color: 'not-a-color' })).rejects.toThrow(
      new ValidationError('VALIDATION_ERROR', 'Color must be a valid hex color (e.g., #6b7280)')
    )
  })

  it('accepts a valid update color and writes it (T3, T8)', async () => {
    mockReturning.mockResolvedValue([{ id, name: 'Lead', color: '#112233' }])

    const result = await updateConversationTag(id, { color: '#112233' })

    expect(mockSet).toHaveBeenCalledWith({ color: '#112233' })
    expect(result.color).toBe('#112233')
  })

  // Not a T-numbered guarantee — this pins the no-op guard (no name/color
  // given, so no write happens) rather than a validation rule, so it
  // carries no contract number.
  it('returns the current row without writing when neither field changes', async () => {
    mockFindFirst.mockResolvedValue({ id, name: 'Lead', color: '#6b7280' })

    const result = await updateConversationTag(id, {})

    expect(mockUpdate).not.toHaveBeenCalled()
    expect(result).toEqual({ id, name: 'Lead', color: '#6b7280' })
  })
})
