import { describe, it, expect } from 'vitest'
import {
  EntityIdSchema,
  HexColorFormatSchema,
  HexColorSchema,
  HexColorWithDefaultSchema,
  OptionalHexColorPatternSchema,
  OptionalHexColorPatternWithDefaultSchema,
  PageLimitMinOneSchema,
  PageLimitSchema,
  ReorderIdsOpenSchema,
  ReorderIdsSchema,
  TaxonomyNameSchema,
} from '../taxonomy'

/**
 * ## T — Taxonomy names, colours, slugs, positions
 * - T7 The shared request schemas reject what the per-entity ones rejected: a
 *   colour that is not `#rrggbb` (with the two historical messages kept
 *   apart), a name outside 1–50 characters, an empty reorder where the
 *   entity always refused one, and a page limit that is not an integer from
 *   1 to 100.
 */

describe('HexColorSchema (T7)', () => {
  it('accepts a well-formed #rrggbb (T7)', () => {
    expect(HexColorSchema.parse('#3b82f6')).toBe('#3b82f6')
  })

  it('rejects a non-hex value with "Color must be a valid hex color" (T7)', () => {
    const result = HexColorSchema.safeParse('blue')
    expect(result.success).toBe(false)
    expect(result.error?.issues[0]?.message).toBe('Color must be a valid hex color')
  })
})

describe('HexColorFormatSchema (T7)', () => {
  it('accepts a well-formed #rrggbb (T7)', () => {
    expect(HexColorFormatSchema.parse('#3B82F6')).toBe('#3B82F6')
  })

  it('rejects a non-hex value with "Invalid color format" — kept apart from HexColorSchema\'s message (T7)', () => {
    const result = HexColorFormatSchema.safeParse('blue')
    expect(result.success).toBe(false)
    expect(result.error?.issues[0]?.message).toBe('Invalid color format')
  })
})

describe('OptionalHexColorPatternSchema / OptionalHexColorPatternWithDefaultSchema (T7)', () => {
  it('OptionalHexColorPatternSchema accepts a valid color and treats it as optional (T7)', () => {
    expect(OptionalHexColorPatternSchema.parse('#654321')).toBe('#654321')
    expect(OptionalHexColorPatternSchema.parse(undefined)).toBeUndefined()
  })

  it('OptionalHexColorPatternSchema rejects a malformed color (T7)', () => {
    expect(OptionalHexColorPatternSchema.safeParse('#fff').success).toBe(false)
  })

  it('OptionalHexColorPatternWithDefaultSchema defaults an omitted color to #6b7280 (T7)', () => {
    expect(OptionalHexColorPatternWithDefaultSchema.parse(undefined)).toBe('#6b7280')
  })

  it('OptionalHexColorPatternWithDefaultSchema keeps an explicit valid color (T7)', () => {
    expect(OptionalHexColorPatternWithDefaultSchema.parse('#abcdef')).toBe('#abcdef')
  })
})

describe('HexColorWithDefaultSchema (T7)', () => {
  it('defaults an omitted color to #6b7280 (T7)', () => {
    expect(HexColorWithDefaultSchema.parse(undefined)).toBe('#6b7280')
  })

  it('keeps an explicit valid color (T7)', () => {
    expect(HexColorWithDefaultSchema.parse('#112233')).toBe('#112233')
  })

  it('rejects a malformed explicit color with the HexColorSchema message (T7)', () => {
    const result = HexColorWithDefaultSchema.safeParse('not-a-color')
    expect(result.success).toBe(false)
    expect(result.error?.issues[0]?.message).toBe('Color must be a valid hex color')
  })
})

describe('TaxonomyNameSchema — 1–50 characters (T7)', () => {
  it('accepts the 1-character and 50-character boundaries (T7)', () => {
    expect(TaxonomyNameSchema.parse('x')).toBe('x')
    expect(TaxonomyNameSchema.parse('x'.repeat(50))).toBe('x'.repeat(50))
  })

  it('rejects an empty string and a 51-character string (T7)', () => {
    expect(TaxonomyNameSchema.safeParse('').success).toBe(false)
    expect(TaxonomyNameSchema.safeParse('x'.repeat(51)).success).toBe(false)
  })
})

describe('ReorderIdsSchema vs ReorderIdsOpenSchema (T7)', () => {
  it('ReorderIdsSchema rejects an empty ids array (T7)', () => {
    expect(ReorderIdsSchema.safeParse({ ids: [] }).success).toBe(false)
  })

  it('ReorderIdsSchema accepts a non-empty ids array (T7)', () => {
    expect(ReorderIdsSchema.parse({ ids: ['a', 'b'] })).toEqual({ ids: ['a', 'b'] })
  })

  it('ReorderIdsOpenSchema accepts an empty ids array (T7)', () => {
    expect(ReorderIdsOpenSchema.parse({ ids: [] })).toEqual({ ids: [] })
  })
})

describe('EntityIdSchema (T7)', () => {
  it('accepts { id: string } (T7)', () => {
    expect(EntityIdSchema.parse({ id: 'post_tag_1' })).toEqual({ id: 'post_tag_1' })
  })

  it('rejects a missing id (T7)', () => {
    expect(EntityIdSchema.safeParse({}).success).toBe(false)
  })
})

describe.each([
  ['PageLimitSchema', PageLimitSchema],
  ['PageLimitMinOneSchema', PageLimitMinOneSchema],
])('%s — integer 1–100, undefined allowed (T7)', (_name, schema) => {
  it('accepts the 1 and 100 boundaries (T7)', () => {
    expect(schema.parse(1)).toBe(1)
    expect(schema.parse(100)).toBe(100)
  })

  it('rejects 0, 101, and a non-integer (T7)', () => {
    expect(schema.safeParse(0).success).toBe(false)
    expect(schema.safeParse(101).success).toBe(false)
    expect(schema.safeParse(1.5).success).toBe(false)
  })

  it('accepts undefined (the limit is optional) (T7)', () => {
    expect(schema.parse(undefined)).toBeUndefined()
  })
})
