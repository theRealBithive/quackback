import { describe, it, expect } from 'vitest'
import { typeIdColumn, typeIdColumnNullable, typeIdTextColumn } from '../drizzle'
import { ID_PREFIXES } from '../prefixes'
import { createId, toUuid } from '../core'

/**
 * ## I — Identifiers
 * - I1 A TypeID column value that arrives from the database as anything but a
 *   string is refused with an error naming what arrived, rather than parsed.
 */

/**
 * `customType(...)` (drizzle-orm) hands back a `PgCustomColumnBuilder` whose
 * constructor stores the `{ dataType, toDriver, fromDriver }` object we pass
 * it directly on `builder.config.customTypeParams` — no need to `.build()`
 * the column against a real table to reach the conversion functions under
 * test.
 */
function customTypeParamsOf(builder: unknown): {
  fromDriver: (value: unknown) => unknown
  toDriver: (value: unknown) => unknown
} {
  return (
    builder as {
      config: {
        customTypeParams: {
          fromDriver: (value: unknown) => unknown
          toDriver: (value: unknown) => unknown
        }
      }
    }
  ).config.customTypeParams
}

describe('typeIdTextColumn', () => {
  it('fromDriver refuses a non-string value from the database, naming its type (I1)', () => {
    const { fromDriver } = customTypeParamsOf(typeIdTextColumn(ID_PREFIXES.post)('id'))
    expect(() => fromDriver(42)).toThrow('Expected string from database, got number')
  })

  it('fromDriver refuses null the same way, naming "object" (I1)', () => {
    const { fromDriver } = customTypeParamsOf(typeIdTextColumn(ID_PREFIXES.post)('id'))
    expect(() => fromDriver(null)).toThrow('Expected string from database, got object')
  })

  it('round-trips a TypeID through its UUID-text driver form when the value IS a string (I1)', () => {
    const { toDriver, fromDriver } = customTypeParamsOf(typeIdTextColumn(ID_PREFIXES.post)('id'))
    const id = createId('post')
    const driverValue = toDriver(id)
    expect(driverValue).toBe(toUuid(id))
    expect(fromDriver(driverValue)).toBe(id)
  })
})

describe('typeIdColumn / typeIdColumnNullable — fromDriver non-string guard (I1)', () => {
  it('typeIdColumn.fromDriver refuses a non-string value (I1)', () => {
    const { fromDriver } = customTypeParamsOf(typeIdColumn(ID_PREFIXES.post)('id'))
    expect(() => fromDriver(123)).toThrow('Expected string from database, got number')
  })

  it('typeIdColumnNullable.fromDriver passes null through but refuses a non-string, non-null value (I1)', () => {
    const { fromDriver } = customTypeParamsOf(typeIdColumnNullable(ID_PREFIXES.post)('id'))
    expect(fromDriver(null)).toBeNull()
    expect(() => fromDriver(123)).toThrow('Expected string from database, got number')
  })
})
