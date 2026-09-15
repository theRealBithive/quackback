/**
 * Contract group A (contract-c.md), copied verbatim:
 *
 * ## A — Attribute definitions (user and company)
 * - A1 User and company attribute definitions follow one rulebook: the same input is
 *   accepted or rejected identically by both, with only the entity name in messages and
 *   the id prefix differing.
 * - A2 A definition's key is stored normalised (trimmed, lowercased, inner whitespace
 *   turned into underscores), its label trimmed, and an empty description or external
 *   key stored as absent.
 * - A3 A key or label that is empty after trimming is rejected; a currency attribute
 *   without a currency code is rejected.
 * - A4 A currency code is kept only while the type is currency: creating a non-currency
 *   attribute drops any code sent, and switching the type away from currency clears the
 *   stored code.
 * - A5 A second definition with an already-used key is refused as a conflict, not
 *   reported as a server error; an update or delete of an unknown id is refused as not
 *   found, naming the entity and the id.
 * - A6 An update that changes nothing writes nothing and returns the current definition.
 * - A7 A database failure while listing, creating, updating or deleting surfaces as a
 *   server error naming the entity in the plural, never as a validation or not-found
 *   error, and it is logged.
 * - A8 The user- and company-attribute server functions check the authorization they
 *   declare before create, update and delete, and hand the payload to the shared service
 *   unchanged. (Pinned in functions/__tests__/user-attributes.test.ts and
 *   functions/__tests__/company-attributes.test.ts, not here.)
 *
 * Why this file is separate from attribute-definition.service.test.ts: that suite uses
 * the real transactional db-test-fixture (server/__tests__/README.md pattern 1) and
 * skips locally without Postgres. A5's conflict/not-found branches and all of A7 need a
 * query that rejects on demand, and the fixture's `testDb` is a Proxy that cannot be
 * spied on for that (see SELF-IMPROVE.md, "Hand-rolled db stubs..."). This suite uses
 * pattern 2 instead (the importOriginal-spread mock, sanctioned in the same README for
 * "pure logic, error paths, and call-shape/ordering seams"): a small hand-rolled fake db
 * is safe here because exactly one production file — attribute-definition.service.ts —
 * issues exactly four, fully-understood query shapes against it. Being DB-free, every
 * test below runs regardless of whether a test Postgres is reachable.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import fc from 'fast-check'
import { createId } from '@quackback/ids'
import { ValidationError } from '@/lib/shared/errors'

type FakeRow = Record<string, unknown>

type QueryOutcome =
  { kind: 'resolve'; rows: FakeRow[] } | { kind: 'reject'; error: unknown } | { kind: 'echo' }

const dbState = vi.hoisted(() => ({
  outcomes: {
    select: { kind: 'resolve', rows: [] } as QueryOutcome,
    insert: { kind: 'echo' } as QueryOutcome,
    update: { kind: 'echo' } as QueryOutcome,
    delete: { kind: 'resolve', rows: [] } as QueryOutcome,
  },
  captured: {
    insertValues: null as FakeRow | null,
    updateSet: null as FakeRow | null,
  },
}))

function resetFakeDb(): void {
  dbState.outcomes.select = { kind: 'resolve', rows: [] }
  dbState.outcomes.insert = { kind: 'echo' }
  dbState.outcomes.update = { kind: 'echo' }
  dbState.outcomes.delete = { kind: 'resolve', rows: [] }
  dbState.captured.insertValues = null
  dbState.captured.updateSet = null
}

/**
 * Builds a chainable fake for `db.select()/.insert()/.update()/.delete()`. Every
 * chain method (from/where/limit/orderBy/returning) just returns the same object;
 * `.values()`/`.set()` additionally capture their argument so a test can assert on
 * exactly what the service computed. `.then()` makes the object awaitable at any
 * depth, resolving or rejecting per `dbState.outcomes[method]` — this is what lets
 * a test make "the next query" reject without touching a real database.
 */
function makeChain(method: 'select' | 'insert' | 'update' | 'delete') {
  const chain: Record<string, unknown> = {}
  const self = () => chain
  chain.from = self
  chain.where = self
  chain.limit = self
  chain.orderBy = self
  chain.values = (v: FakeRow) => {
    dbState.captured.insertValues = v
    return chain
  }
  chain.set = (v: FakeRow) => {
    dbState.captured.updateSet = v
    return chain
  }
  chain.returning = self
  chain.then = (onResolve: (v: unknown) => unknown, onReject?: (e: unknown) => unknown) => {
    const outcome = dbState.outcomes[method]
    let promise: Promise<unknown>
    if (outcome.kind === 'reject') {
      promise = Promise.reject(outcome.error)
    } else if (outcome.kind === 'echo') {
      const echoed =
        method === 'insert' ? dbState.captured.insertValues : dbState.captured.updateSet
      promise = Promise.resolve([echoed])
    } else {
      promise = Promise.resolve(outcome.rows)
    }
    return promise.then(onResolve, onReject)
  }
  return chain
}

const loggerControl = vi.hoisted(() => ({ error: vi.fn() }))

vi.mock('@/lib/server/logger', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/server/logger')>()
  return {
    ...original,
    logger: {
      ...original.logger,
      child: () => ({ error: loggerControl.error }),
    },
  }
})

vi.mock('@/lib/server/db', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/server/db')>()
  return {
    ...original,
    db: {
      select: () => makeChain('select'),
      insert: () => makeChain('insert'),
      update: () => makeChain('update'),
      delete: () => makeChain('delete'),
    },
  }
})

import {
  listUserAttributes,
  createUserAttribute,
  updateUserAttribute,
  deleteUserAttribute,
} from '@/lib/server/domains/user-attributes/user-attribute.service'
import {
  listCompanyAttributes,
  createCompanyAttribute,
  updateCompanyAttribute,
  deleteCompanyAttribute,
} from '@/lib/server/domains/company-attributes/company-attribute.service'
import type { CreateAttributeDefinitionInput } from '@/lib/server/domains/attribute-definitions/attribute-definition.types'

beforeEach(() => {
  vi.clearAllMocks()
  resetFakeDb()
})

function existingRow(overrides: FakeRow = {}): FakeRow {
  return {
    id: 'user_attr_existing',
    key: 'existing_key',
    label: 'Existing',
    description: null,
    type: 'string',
    currencyCode: null,
    externalKey: null,
    createdAt: new Date('2024-01-01T00:00:00Z'),
    updatedAt: new Date('2024-01-01T00:00:00Z'),
    ...overrides,
  }
}

type Attempt<T> = { kind: 'ok'; value: T } | { kind: 'error'; error: Error & { code?: string } }

async function attempt<T>(fn: () => Promise<T>): Promise<Attempt<T>> {
  try {
    return { kind: 'ok', value: await fn() }
  } catch (error) {
    return { kind: 'error', error: error as Error & { code?: string } }
  }
}

// --------------------------------------------------------------------- A1 ---

const wordArb = fc.constantFrom(
  'Plan',
  'Tier',
  'MRR',
  'Contract',
  'Value',
  'Region',
  'Spend',
  'Score'
)
const casedWordArb = fc
  .tuple(wordArb, fc.constantFrom<'lower' | 'upper' | 'title'>('lower', 'upper', 'title'))
  .map(([word, casing]) => {
    if (casing === 'lower') return word.toLowerCase()
    if (casing === 'upper') return word.toUpperCase()
    return word
  })
const outerWhitespaceArb = fc.constantFrom('', ' ', '  ', '\t')
const innerSpaceArb = fc.constantFrom(' ', '  ', '\t')

/** Non-blank text: outer whitespace + 1-3 cased words joined by inner whitespace. */
const nonBlankTextArb = fc
  .tuple(
    outerWhitespaceArb,
    fc.array(casedWordArb, { minLength: 1, maxLength: 3 }),
    innerSpaceArb,
    outerWhitespaceArb
  )
  .map(([lead, words, sep, trail]) => `${lead}${words.join(sep)}${trail}`)

/** Blank after trim: hits the two required-field validation branches. */
const blankTextArb = fc.constantFrom('', '   ', '\t\t', '  \t ')

const keyArb = fc.oneof(
  { weight: 4, arbitrary: nonBlankTextArb },
  { weight: 1, arbitrary: blankTextArb }
)
const labelArb = fc.oneof(
  { weight: 4, arbitrary: nonBlankTextArb },
  { weight: 1, arbitrary: blankTextArb }
)
const attributeTypeArb = fc.constantFrom<CreateAttributeDefinitionInput['type']>(
  'string',
  'number',
  'boolean',
  'date',
  'currency'
)
const currencyCodeArb = fc.constantFrom(
  'USD',
  'EUR',
  'GBP',
  'JPY',
  'CAD',
  'AUD',
  'CHF',
  'CNY',
  'INR',
  'BRL'
)
/** Optional text: present-and-blank, present-and-worded, or absent. */
const optionalTextArb = fc.option(fc.oneof(nonBlankTextArb, fc.constant('')), { nil: undefined })

/**
 * Generator reaches: normalised keys/labels (outer whitespace + mixed casing +
 * inner whitespace), blank keys/labels (the two "is required" branches), a
 * currency type with and without a currencyCode (the "currency code required"
 * branch, both sides), a currencyCode sent on a non-currency type (must be
 * dropped, A4), and an optional description/externalKey that is present-blank,
 * present-worded, or entirely absent (must normalise to null, A2).
 */
const createInputArb: fc.Arbitrary<CreateAttributeDefinitionInput> = fc.record({
  key: keyArb,
  label: labelArb,
  type: attributeTypeArb,
  currencyCode: fc.option(currencyCodeArb, { nil: undefined }),
  description: optionalTextArb,
  externalKey: optionalTextArb,
})

describe('A1 — one rulebook for user and company attributes', () => {
  it('(A1) accepts or rejects a generated create input identically, modulo id prefix', async () => {
    await fc.assert(
      fc.asyncProperty(createInputArb, async (input) => {
        resetFakeDb()
        const userResult = await attempt(() => createUserAttribute(input))
        resetFakeDb()
        const companyResult = await attempt(() => createCompanyAttribute(input))

        if (userResult.kind === 'error' || companyResult.kind === 'error') {
          expect(userResult.kind).toBe('error')
          expect(companyResult.kind).toBe('error')
          if (userResult.kind === 'error' && companyResult.kind === 'error') {
            expect(companyResult.error.constructor).toBe(userResult.error.constructor)
            expect(companyResult.error.code).toBe(userResult.error.code)
            expect(companyResult.error.message).toBe(userResult.error.message)
          }
          return
        }

        expect(companyResult.value.key).toBe(userResult.value.key)
        expect(companyResult.value.label).toBe(userResult.value.label)
        expect(companyResult.value.description).toBe(userResult.value.description)
        expect(companyResult.value.type).toBe(userResult.value.type)
        expect(companyResult.value.currencyCode).toBe(userResult.value.currencyCode)
        expect(companyResult.value.externalKey).toBe(userResult.value.externalKey)
        expect(userResult.value.id.startsWith('user_attr_')).toBe(true)
        expect(companyResult.value.id.startsWith('company_attr_')).toBe(true)
      }),
      { numRuns: 100 }
    )
  })
})

// --------------------------------------------------------------------- A2 ---

describe('A2 — normalisation', () => {
  it('(A2) normalises the key, trims the label, and stores a blank description/externalKey as null', async () => {
    resetFakeDb()
    const result = await createUserAttribute({
      key: '  Plan Tier ',
      label: '  Plan Tier  ',
      type: 'string',
      description: '   ',
      externalKey: '',
    })
    expect(result.key).toBe('plan_tier')
    expect(result.label).toBe('Plan Tier')
    expect(result.description).toBeNull()
    expect(result.externalKey).toBeNull()
  })
})

// --------------------------------------------------------------------- A3 ---

describe('A3 — validation messages, verbatim', () => {
  it.each([
    ['user', createUserAttribute],
    ['company', createCompanyAttribute],
  ])(
    '(A3) %s: a blank key is rejected with "Attribute key is required"',
    async (_label, create) => {
      resetFakeDb()
      await expect(create({ key: '   ', label: 'Label', type: 'string' })).rejects.toMatchObject({
        code: 'VALIDATION_ERROR',
        message: 'Attribute key is required',
      })
    }
  )

  it.each([
    ['user', createUserAttribute],
    ['company', createCompanyAttribute],
  ])(
    '(A3) %s: a blank label is rejected with "Attribute label is required"',
    async (_label, create) => {
      resetFakeDb()
      await expect(create({ key: 'k', label: '  ', type: 'string' })).rejects.toMatchObject({
        code: 'VALIDATION_ERROR',
        message: 'Attribute label is required',
      })
    }
  )

  it.each([
    ['user', createUserAttribute],
    ['company', createCompanyAttribute],
  ])(
    '(A3) %s: a currency attribute without a currency code is rejected with "Currency code is required for currency attributes"',
    async (_label, create) => {
      resetFakeDb()
      await expect(create({ key: 'k', label: 'L', type: 'currency' })).rejects.toMatchObject({
        code: 'VALIDATION_ERROR',
        message: 'Currency code is required for currency attributes',
      })
    }
  )
})

// --------------------------------------------------------------------- A4 ---

describe('A4 — currency code lifecycle', () => {
  it('(A4) create: a currencyCode sent on a non-currency type is dropped', async () => {
    resetFakeDb()
    const result = await createUserAttribute({
      key: 'k',
      label: 'L',
      type: 'number',
      currencyCode: 'EUR',
    })
    expect(result.currencyCode).toBeNull()
  })

  it('(A4) update: switching the type away from currency clears the stored code', async () => {
    resetFakeDb()
    dbState.outcomes.select = {
      kind: 'resolve',
      rows: [existingRow({ type: 'currency', currencyCode: 'EUR' })],
    }
    const result = await updateUserAttribute(createId('user_attr'), { type: 'string' })
    expect(dbState.captured.updateSet).toMatchObject({ type: 'string', currencyCode: null })
    expect(result.currencyCode).toBeNull()
  })

  it('(A4) update: currencyCode alone sets it', async () => {
    resetFakeDb()
    dbState.outcomes.select = { kind: 'resolve', rows: [existingRow()] }
    const result = await updateUserAttribute(createId('user_attr'), { currencyCode: 'GBP' })
    expect(dbState.captured.updateSet).toEqual({ currencyCode: 'GBP' })
    expect(result.currencyCode).toBe('GBP')
  })

  it('(A4) update: switching the type TO currency leaves an explicitly-set code untouched', async () => {
    resetFakeDb()
    dbState.outcomes.select = {
      kind: 'resolve',
      rows: [existingRow({ type: 'string', currencyCode: null })],
    }
    const result = await updateUserAttribute(createId('user_attr'), {
      type: 'currency',
      currencyCode: 'USD',
    })
    // Only the "switching away from currency" branch nulls the code (line 193-195);
    // switching TO currency must not go anywhere near that clearing branch.
    expect(dbState.captured.updateSet).toMatchObject({ type: 'currency', currencyCode: 'USD' })
    expect(result.currencyCode).toBe('USD')
  })
})

// --------------------------------------------------------- A2 (on update) ---

describe('A2 — update forwards description and normalises externalKey', () => {
  it('(A2) update: a description is forwarded as given, blank included (no trim/null fallback, unlike create)', async () => {
    resetFakeDb()
    dbState.outcomes.select = { kind: 'resolve', rows: [existingRow()] }
    const result = await updateUserAttribute(createId('user_attr'), { description: '   ' })
    expect(dbState.captured.updateSet).toEqual({ description: '   ' })
    expect(result.description).toBe('   ')
  })

  it('(A2) update: a blank externalKey normalises to null', async () => {
    resetFakeDb()
    dbState.outcomes.select = { kind: 'resolve', rows: [existingRow()] }
    const result = await updateUserAttribute(createId('user_attr'), { externalKey: '   ' })
    expect(dbState.captured.updateSet).toEqual({ externalKey: null })
    expect(result.externalKey).toBeNull()
  })
})

// --------------------------------------------------------------------- A5 ---

describe('A5 — conflict, not-found, and the negative pg-error shape', () => {
  it.each([
    ['bare code', { code: '23505' }],
    ['wrapped cause code', { cause: { code: '23505' } }],
  ])(
    '(A5) create: a unique-violation error (%s) becomes a ConflictError with the shared message',
    async (_label, pgError) => {
      resetFakeDb()
      dbState.outcomes.insert = { kind: 'reject', error: pgError }
      await expect(
        createUserAttribute({ key: 'k', label: 'L', type: 'string' })
      ).rejects.toMatchObject({
        code: 'DUPLICATE_KEY',
        message: 'An attribute with that key already exists',
      })
    }
  )

  it('(A5) create: a non-unique pg error becomes an InternalError, never a ConflictError', async () => {
    resetFakeDb()
    dbState.outcomes.insert = { kind: 'reject', error: { code: '23503' } }
    await expect(
      createUserAttribute({ key: 'k', label: 'L', type: 'string' })
    ).rejects.toMatchObject({
      code: 'DATABASE_ERROR',
      message: 'Failed to create user attributes',
    })
  })

  it('(A5) update: an unknown id is refused as not found, naming the entity and the id', async () => {
    resetFakeDb()
    dbState.outcomes.select = { kind: 'resolve', rows: [] }
    const missing = createId('user_attr')
    await expect(updateUserAttribute(missing, { label: 'X' })).rejects.toMatchObject({
      code: 'NOT_FOUND',
      message: `User attribute ${missing} not found`,
    })
  })

  it('(A5) remove: an unknown id is refused as not found, naming the entity and the id', async () => {
    resetFakeDb()
    dbState.outcomes.select = { kind: 'resolve', rows: [] }
    const missing = createId('company_attr')
    await expect(deleteCompanyAttribute(missing)).rejects.toMatchObject({
      code: 'NOT_FOUND',
      message: `Company attribute ${missing} not found`,
    })
  })
})

// --------------------------------------------------------------------- A6 ---

describe('A6 — an update that changes nothing', () => {
  it('(A6) update with {} returns the existing row and never calls the update builder', async () => {
    resetFakeDb()
    const existing = existingRow({ id: 'user_attr_noop' })
    dbState.outcomes.select = { kind: 'resolve', rows: [existing] }
    // If update() reached the update builder, this would make the call reject —
    // the only way a positive "never called" assertion is possible here (the
    // real db-test-fixture's testDb Proxy cannot be spied on for a call count).
    dbState.outcomes.update = { kind: 'reject', error: new Error('update builder must not run') }

    const result = await updateUserAttribute(createId('user_attr'), {})

    expect(result).toMatchObject({
      id: 'user_attr_noop',
      key: 'existing_key',
      label: 'Existing',
      description: null,
      type: 'string',
      currencyCode: null,
      externalKey: null,
    })
  })
})

// --------------------------------------------------------------------- A7 ---

describe('A7 — database failures', () => {
  const domains = [
    {
      label: 'user',
      plural: 'user attributes',
      list: () => listUserAttributes(),
      create: () => createUserAttribute({ key: 'k', label: 'L', type: 'string' }),
      update: () => updateUserAttribute(createId('user_attr'), { label: 'New' }),
      remove: () => deleteUserAttribute(createId('user_attr')),
    },
    {
      label: 'company',
      plural: 'company attributes',
      list: () => listCompanyAttributes(),
      create: () => createCompanyAttribute({ key: 'k', label: 'L', type: 'string' }),
      update: () => updateCompanyAttribute(createId('company_attr'), { label: 'New' }),
      remove: () => deleteCompanyAttribute(createId('company_attr')),
    },
  ] as const

  it.each(domains.map((d) => [d.label, d] as const))(
    '(A7) %s: list surfaces a rejecting select as InternalError and logs it',
    async (_label, d) => {
      resetFakeDb()
      const dbFailure = new Error('connection reset')
      dbState.outcomes.select = { kind: 'reject', error: dbFailure }
      await expect(d.list()).rejects.toMatchObject({
        code: 'DATABASE_ERROR',
        message: `Failed to list ${d.plural}`,
      })
      expect(loggerControl.error).toHaveBeenCalledWith(
        { err: dbFailure },
        `failed to list ${d.plural}`
      )
    }
  )

  it.each(domains.map((d) => [d.label, d] as const))(
    '(A7) %s: create surfaces a rejecting insert as InternalError and logs it',
    async (_label, d) => {
      resetFakeDb()
      const dbFailure = new Error('connection reset')
      dbState.outcomes.insert = { kind: 'reject', error: dbFailure }
      await expect(d.create()).rejects.toMatchObject({
        code: 'DATABASE_ERROR',
        message: `Failed to create ${d.plural}`,
      })
      expect(loggerControl.error).toHaveBeenCalledWith(
        { err: dbFailure },
        `failed to create ${d.plural}`
      )
    }
  )

  it.each(domains.map((d) => [d.label, d] as const))(
    '(A7) %s: update surfaces a rejecting update as InternalError and logs it',
    async (_label, d) => {
      resetFakeDb()
      dbState.outcomes.select = { kind: 'resolve', rows: [existingRow()] }
      const dbFailure = new Error('connection reset')
      dbState.outcomes.update = { kind: 'reject', error: dbFailure }
      await expect(d.update()).rejects.toMatchObject({
        code: 'DATABASE_ERROR',
        message: `Failed to update ${d.plural}`,
      })
      expect(loggerControl.error).toHaveBeenCalledWith(
        { err: dbFailure },
        `failed to update ${d.plural}`
      )
    }
  )

  it.each(domains.map((d) => [d.label, d] as const))(
    '(A7) %s: remove surfaces a rejecting delete as InternalError and logs it',
    async (_label, d) => {
      resetFakeDb()
      dbState.outcomes.select = { kind: 'resolve', rows: [existingRow()] }
      const dbFailure = new Error('connection reset')
      dbState.outcomes.delete = { kind: 'reject', error: dbFailure }
      await expect(d.remove()).rejects.toMatchObject({
        code: 'DATABASE_ERROR',
        message: `Failed to delete ${d.plural}`,
      })
      expect(loggerControl.error).toHaveBeenCalledWith(
        { err: dbFailure },
        `failed to delete ${d.plural}`
      )
    }
  )

  it('(A7) update propagates an injected ValidationError from the update builder unchanged (line 210)', async () => {
    resetFakeDb()
    dbState.outcomes.select = { kind: 'resolve', rows: [existingRow()] }
    const injected = new ValidationError('VALIDATION_ERROR', 'injected mid-flight')
    dbState.outcomes.update = { kind: 'reject', error: injected }
    await expect(updateUserAttribute(createId('user_attr'), { label: 'New' })).rejects.toBe(
      injected
    )
  })

  it('(A7) remove wraps that same kind of error as InternalError, unlike update (line 224 asymmetry)', async () => {
    resetFakeDb()
    dbState.outcomes.select = { kind: 'resolve', rows: [existingRow()] }
    const injected = new ValidationError('VALIDATION_ERROR', 'injected mid-flight')
    dbState.outcomes.delete = { kind: 'reject', error: injected }
    await expect(deleteUserAttribute(createId('user_attr'))).rejects.toMatchObject({
      code: 'DATABASE_ERROR',
      message: 'Failed to delete user attributes',
    })
  })
})
