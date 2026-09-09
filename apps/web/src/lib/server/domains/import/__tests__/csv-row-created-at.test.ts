/**
 * The created_at CSV column. Contract, written before the tests:
 *
 * V1 A parseable timestamp is kept exactly, so imported posts keep the order
 *    they had in the source system.
 * V2 An unparseable timestamp falls back to the import time instead of
 *    failing the row — a bad date must not cost the post.
 * V3 A blank or absent column falls back to the import time the same way.
 */
import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import { csvRowSchema } from '../import-row-resolver'

const baseRow = { title: 'A title', content: 'Some content', author_name: 'Ada' }

describe('csvRowSchema created_at', () => {
  it('keeps a parseable timestamp so imported posts keep their original order (V1)', () => {
    const parsed = csvRowSchema.parse({ ...baseRow, created_at: '2024-03-05T10:15:00Z' })
    expect(parsed.created_at.toISOString()).toBe('2024-03-05T10:15:00.000Z')
  })

  it('round-trips every ISO timestamp between 2000 and 2035 to the same instant (V1)', () => {
    fc.assert(
      fc.property(
        fc.date({ min: new Date('2000-01-01T00:00:00Z'), max: new Date('2035-12-31T23:59:59Z') }),
        (date) => {
          const parsed = csvRowSchema.parse({ ...baseRow, created_at: date.toISOString() })
          expect(parsed.created_at.getTime()).toBe(date.getTime())
        }
      )
    )
  })

  it('falls back to the import time for an unparseable timestamp instead of failing the row (V2)', () => {
    const before = Date.now()
    const parsed = csvRowSchema.parse({ ...baseRow, created_at: 'last tuesday' })
    expect(parsed.created_at.getTime()).toBeGreaterThanOrEqual(before)
    expect(parsed.created_at.getTime()).toBeLessThanOrEqual(Date.now())
  })

  it('falls back to the import time when the column is blank (V3)', () => {
    const before = Date.now()
    const parsed = csvRowSchema.parse({ ...baseRow, created_at: '' })
    expect(parsed.created_at.getTime()).toBeGreaterThanOrEqual(before)
    expect(parsed.created_at.getTime()).toBeLessThanOrEqual(Date.now())
  })
})
