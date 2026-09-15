import { describe, it, expect } from 'vitest'
import {
  typeIdColumn,
  typeIdColumnNullable,
  typeIdReference,
  typeIdTextColumn,
  typeIdWithDefault,
} from '../drizzle'
import { ID_PREFIXES } from '../prefixes'
import { createId, toUuid } from '../core'

/**
 * ## I — Identifiers
 * - I1 A TypeID column value that arrives from the database as anything but a
 *   string is refused with an error naming what arrived, rather than parsed.
 * - I2 A string is recognised as a raw UUID only in the 8-4-4-4-12 hex shape,
 *   with or without hyphens, either case; a raw UUID is written unchanged, a
 *   TypeID as its UUID.
 * - I3 A nullable TypeID column passes null through both ways, a
 *   default-generating column mints a TypeID with its prefix, a reference
 *   column behaves like the plain column.
 */

/**
 * `customType(...)` (drizzle-orm) hands back a `PgCustomColumnBuilder` whose
 * constructor stores the `{ dataType, toDriver, fromDriver }` object we pass
 * it directly on `builder.config.customTypeParams` — no need to `.build()`
 * the column against a real table to reach the conversion functions under
 * test.
 */
function customTypeParamsOf(builder: unknown): {
  dataType: () => string
  fromDriver: (value: unknown) => unknown
  toDriver: (value: unknown) => unknown
} {
  return (
    builder as {
      config: {
        customTypeParams: {
          dataType: () => string
          fromDriver: (value: unknown) => unknown
          toDriver: (value: unknown) => unknown
        }
      }
    }
  ).config.customTypeParams
}

/**
 * `.$defaultFn(fn)` (drizzle-orm) records the generator on `config.defaultFn`
 * and flips `config.hasDefault`; the ORM calls it per insert that omits the
 * column, so reading it back is how the minting behaviour is reachable
 * without a database.
 */
function defaultGeneratorOf(builder: unknown): {
  hasDefault: boolean
  defaultFn: () => unknown
} {
  const { hasDefault, defaultFn } = (
    builder as { config: { hasDefault: boolean; defaultFn: () => unknown } }
  ).config
  return { hasDefault, defaultFn }
}

/** A UUIDv7 in the canonical hyphenated form, as PostgreSQL hands one back. */
const RAW_UUID = '01893d8c-7e80-7000-8000-000000000000'

/**
 * Shapes that are NOT the 8-4-4-4-12 hex form, each one character-class or
 * segment-length away from it. None of them is a TypeID either, so a column
 * that mistook one for a raw UUID would hand the database a string it never
 * validated; recognising it correctly means the TypeID parser refuses it.
 */
const NOT_A_RAW_UUID: ReadonlyArray<readonly [string, string]> = [
  ['a UUID with something before it', 'x01893d8c-7e80-7000-8000-000000000000'],
  ['a UUID with something after it', '01893d8c-7e80-7000-8000-000000000000x'],
  ['one hex digit where eight belong', 'a-7e80-7000-8000-000000000000'],
  ['eight non-hex characters in the first group', 'zzzzzzzz-7e80-7000-8000-000000000000'],
  ['one hex digit in the second group', '01893d8c-a-7000-8000-000000000000'],
  ['four non-hex characters in the second group', '01893d8c-zzzz-7000-8000-000000000000'],
  ['one hex digit in the third group', '01893d8c-7e80-a-8000-000000000000'],
  ['four non-hex characters in the third group', '01893d8c-7e80-zzzz-8000-000000000000'],
  ['one hex digit in the fourth group', '01893d8c-7e80-7000-a-000000000000'],
  ['four non-hex characters in the fourth group', '01893d8c-7e80-7000-zzzz-000000000000'],
  ['one hex digit where twelve belong', '01893d8c-7e80-7000-8000-0'],
  ['twelve non-hex characters in the last group', '01893d8c-7e80-7000-8000-zzzzzzzzzzzz'],
]

describe('typeIdColumn — what the database is handed (I2)', () => {
  it('declares itself a native uuid column (I2)', () => {
    const { dataType } = customTypeParamsOf(typeIdColumn(ID_PREFIXES.post)('id'))
    expect(dataType()).toBe('uuid')
  })

  it('writes a TypeID as its UUID, not as the TypeID string (I2)', () => {
    const { toDriver } = customTypeParamsOf(typeIdColumn(ID_PREFIXES.post)('id'))
    const id = createId('post')

    expect(toDriver(id)).toBe(toUuid(id))
    expect(toDriver(id)).not.toBe(id)
  })

  it('writes a hyphenated raw UUID through unchanged (I2)', () => {
    const { toDriver } = customTypeParamsOf(typeIdColumn(ID_PREFIXES.post)('id'))
    expect(toDriver(RAW_UUID)).toBe(RAW_UUID)
  })

  it('writes an unhyphenated raw UUID through unchanged (I2)', () => {
    // Better Auth's internal adapter is where the hyphenless form arrives.
    const { toDriver } = customTypeParamsOf(typeIdColumn(ID_PREFIXES.post)('id'))
    const withoutHyphens = RAW_UUID.replaceAll('-', '')

    expect(toDriver(withoutHyphens)).toBe(withoutHyphens)
  })

  it('writes an upper-case raw UUID through unchanged (I2)', () => {
    const { toDriver } = customTypeParamsOf(typeIdColumn(ID_PREFIXES.post)('id'))
    const upperCased = RAW_UUID.toUpperCase()

    expect(toDriver(upperCased)).toBe(upperCased)
  })

  it.each(NOT_A_RAW_UUID)(
    'refuses %s rather than passing it to the database as one (I2)',
    (_shape, value) => {
      const { toDriver } = customTypeParamsOf(typeIdColumn(ID_PREFIXES.post)('id'))

      // Not a raw UUID means it is read as a TypeID, and it is not one of
      // those either — so the write fails loudly instead of storing junk.
      expect(() => toDriver(value)).toThrow()
    }
  )

  it('reads a UUID from the database back as the prefixed TypeID (I1)', () => {
    const { fromDriver } = customTypeParamsOf(typeIdColumn(ID_PREFIXES.post)('id'))
    const id = createId('post')

    expect(fromDriver(toUuid(id))).toBe(id)
  })
})

describe('typeIdTextColumn', () => {
  it('declares itself a text column, not a uuid one (I2)', () => {
    const { dataType } = customTypeParamsOf(typeIdTextColumn(ID_PREFIXES.post)('id'))
    expect(dataType()).toBe('text')
  })

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

  it('writes a hyphenated raw UUID through unchanged (I2)', () => {
    const { toDriver } = customTypeParamsOf(typeIdTextColumn(ID_PREFIXES.post)('id'))
    expect(toDriver(RAW_UUID)).toBe(RAW_UUID)
  })
})

describe('typeIdColumnNullable — null on both sides (I3)', () => {
  it('declares itself a native uuid column (I2)', () => {
    const { dataType } = customTypeParamsOf(typeIdColumnNullable(ID_PREFIXES.post)('id'))
    expect(dataType()).toBe('uuid')
  })

  it('writes null as null rather than parsing it (I3)', () => {
    const { toDriver } = customTypeParamsOf(typeIdColumnNullable(ID_PREFIXES.post)('id'))
    expect(toDriver(null)).toBeNull()
  })

  it('reads null and undefined from the database back as null (I3)', () => {
    // An outer join produces the absent column as undefined rather than null,
    // and a nullable foreign key must survive it the same way.
    const { fromDriver } = customTypeParamsOf(typeIdColumnNullable(ID_PREFIXES.post)('id'))

    expect(fromDriver(null)).toBeNull()
    expect(fromDriver(undefined)).toBeNull()
  })

  it('reads a UUID from the database back as the prefixed TypeID (I3)', () => {
    const { fromDriver } = customTypeParamsOf(typeIdColumnNullable(ID_PREFIXES.post)('id'))
    const id = createId('post')

    expect(fromDriver(toUuid(id))).toBe(id)
  })

  it('writes a TypeID as its UUID and a raw UUID unchanged, like the plain column (I3)', () => {
    const { toDriver } = customTypeParamsOf(typeIdColumnNullable(ID_PREFIXES.post)('id'))
    const id = createId('post')

    expect(toDriver(id)).toBe(toUuid(id))
    expect(toDriver(RAW_UUID)).toBe(RAW_UUID)
    expect(toDriver(RAW_UUID.replaceAll('-', ''))).toBe(RAW_UUID.replaceAll('-', ''))
    expect(toDriver(RAW_UUID.toUpperCase())).toBe(RAW_UUID.toUpperCase())
  })

  it.each(NOT_A_RAW_UUID)(
    'refuses %s rather than passing it to the database as one (I2)',
    (_shape, value) => {
      const { toDriver } = customTypeParamsOf(typeIdColumnNullable(ID_PREFIXES.post)('id'))
      expect(() => toDriver(value)).toThrow()
    }
  )
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

describe('typeIdWithDefault — the column that mints its own id (I3)', () => {
  it('carries a default generator that mints a TypeID with the column prefix (I3)', () => {
    const { hasDefault, defaultFn } = defaultGeneratorOf(typeIdWithDefault(ID_PREFIXES.post)('id'))

    expect(hasDefault).toBe(true)
    expect(String(defaultFn())).toMatch(/^post_[0-9a-z]+$/)
  })

  it('mints a different id every time it is asked (I3)', () => {
    const { defaultFn } = defaultGeneratorOf(typeIdWithDefault(ID_PREFIXES.post)('id'))

    const minted = new Set([defaultFn(), defaultFn(), defaultFn()])
    expect(minted.size).toBe(3)
  })

  it('mints the prefix it was built with, not a fixed one (I3)', () => {
    const { defaultFn } = defaultGeneratorOf(typeIdWithDefault(ID_PREFIXES.board)('id'))
    expect(String(defaultFn())).toMatch(/^board_/)
  })

  it('is still the plain uuid column underneath, conversions included (I3)', () => {
    const { dataType, toDriver, fromDriver } = customTypeParamsOf(
      typeIdWithDefault(ID_PREFIXES.post)('id')
    )
    const id = createId('post')

    expect(dataType()).toBe('uuid')
    expect(toDriver(id)).toBe(toUuid(id))
    expect(fromDriver(toUuid(id))).toBe(id)
  })

  it('mints an id the column can then write to the database (I3)', () => {
    const builder = typeIdWithDefault(ID_PREFIXES.post)('id')
    const { defaultFn } = defaultGeneratorOf(builder)
    const { toDriver } = customTypeParamsOf(builder)

    const minted = String(defaultFn())
    expect(toDriver(minted)).toBe(toUuid(minted))
  })
})

describe('typeIdReference — a foreign key onto a TypeID column (I3)', () => {
  it('declares the same uuid column as the plain one (I3)', () => {
    const { dataType } = customTypeParamsOf(typeIdReference(ID_PREFIXES.board)('board_id'))
    expect(dataType()).toBe('uuid')
  })

  it('converts in both directions exactly like the plain column (I3)', () => {
    const { toDriver, fromDriver } = customTypeParamsOf(
      typeIdReference(ID_PREFIXES.board)('board_id')
    )
    const boardId = createId('board')

    expect(toDriver(boardId)).toBe(toUuid(boardId))
    expect(toDriver(RAW_UUID)).toBe(RAW_UUID)
    expect(fromDriver(toUuid(boardId))).toBe(boardId)
  })

  it('refuses a non-string value from the database, naming its type (I3)', () => {
    const { fromDriver } = customTypeParamsOf(typeIdReference(ID_PREFIXES.board)('board_id'))
    expect(() => fromDriver(123)).toThrow('Expected string from database, got number')
  })

  it('keeps the column name it was given (I3)', () => {
    const builder = typeIdReference(ID_PREFIXES.board)('board_id') as {
      config: { name: string }
    }
    expect(builder.config.name).toBe('board_id')
  })
})
