import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { isPlainRecord } from '../record'

/**
 * ## S — Shared helpers
 * - S1 A value counts as a plain record exactly when it is an object that is
 *   neither null nor an array; SSO claim parsing relies on that reading.
 */

class SomeClass {
  x = 1
}

describe('isPlainRecord', () => {
  it('accepts plain object literals, including empty and nested ones (S1)', () => {
    expect(isPlainRecord({})).toBe(true)
    expect(isPlainRecord({ a: 1 })).toBe(true)
    expect(isPlainRecord({ a: { b: 2 } })).toBe(true)
  })

  it('rejects arrays, null, and primitives (S1)', () => {
    expect(isPlainRecord([])).toBe(false)
    expect(isPlainRecord([1, 2, 3])).toBe(false)
    expect(isPlainRecord(null)).toBe(false)
    expect(isPlainRecord(undefined)).toBe(false)
    expect(isPlainRecord('string')).toBe(false)
    expect(isPlainRecord(42)).toBe(false)
    expect(isPlainRecord(true)).toBe(false)
  })

  it('accepts non-plain objects too — the guard is deliberately naive (S1)', () => {
    // The contract (S1) is "object, non-null, non-array" — nothing more. A
    // Date, a Map, and a class instance are all objects that are neither
    // null nor arrays, so they read as plain records under this guard, even
    // though they are not literal `{}` shapes.
    expect(isPlainRecord(new Date())).toBe(true)
    expect(isPlainRecord(new Map([['a', 1]]))).toBe(true)
    expect(isPlainRecord(new SomeClass())).toBe(true)
  })

  it('for any JSON value, Date, Map, class instance, function, or symbol: true iff object, non-null, non-array (S1)', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.jsonValue(),
          fc.date(),
          fc.constant(new Map([['a', 1]])),
          fc.constant(new SomeClass()),
          fc.constant(() => {}),
          fc.constant(Symbol('x')),
          fc.constant(undefined)
        ),
        (value) => {
          const expected = typeof value === 'object' && value !== null && !Array.isArray(value)
          expect(isPlainRecord(value)).toBe(expected)
        }
      )
    )
  })
})
