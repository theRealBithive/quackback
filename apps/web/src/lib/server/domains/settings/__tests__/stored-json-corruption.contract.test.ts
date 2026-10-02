/**
 * Corrupt feature-flag and tier-limit JSON must not take a request down.
 *
 * Contract for upstream batch F (#598, `008173b00`) — the confirmed list for
 * this area:
 *
 *   F18 Corrupt feature-flag or tier-limit JSON behaves like nothing stored
 *       (defaults) and fails no request; it is logged. A blank or `null` value
 *       is silent.
 *
 * "Nothing stored" is the result of the same read over an absent column, so
 * each property compares against that result instead of against a literal.
 *
 * Generators (all structured, so they reach the branches):
 *  - truncated: a valid object whose closing text was cut off (unparseable);
 *  - garbage: text that cannot start a JSON document;
 *  - not an object: valid JSON that is an array, number, string or boolean;
 *  - blank: null, undefined, empty, whitespace, and the JSON text `null`
 *    padded with whitespace.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import fc from 'fast-check'

const hoisted = vi.hoisted(() => ({
  tierLimits: null as string | null,
}))

vi.mock('@/lib/server/db', () => ({
  settings: { tierLimits: 'tier_limits', cloud: 'cloud' },
  db: {
    select: () => ({
      from: () => ({
        limit: async () => [{ tierLimits: hoisted.tierLimits, cloud: null }],
      }),
    }),
  },
}))

const errorLog = vi.hoisted(() => ({ calls: [] as Array<Record<string, unknown>> }))

vi.mock('@/lib/server/logger', () => ({
  logger: {
    child: () => ({
      error: (context: Record<string, unknown>) => {
        errorLog.calls.push(context)
      },
      info: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
      trace: vi.fn(),
      fatal: vi.fn(),
    }),
  },
}))

import { resolveFeatureFlags } from '../settings.types'
import { getTierLimits, invalidateTierLimitsCache } from '../tier-limits.service'

const truncatedJson = fc
  .tuple(
    fc.dictionary(
      fc.constantFrom('feedback', 'changelog', 'statusPage', 'maxBoards'),
      fc.boolean(),
      {
        minKeys: 1,
      }
    ),
    fc.nat()
  )
  .map(([object, cutSeed]) => {
    const text = JSON.stringify(object)
    const keptLength = 1 + (cutSeed % (text.length - 1))
    return text.slice(0, keptLength)
  })

const garbageText = fc.string().map((tail) => `x${tail}`)

const nonObjectJson = fc
  .oneof(fc.array(fc.integer(), { maxLength: 4 }), fc.integer(), fc.string(), fc.boolean())
  .map((value) => JSON.stringify(value))

const corruptText = fc.oneof(truncatedJson, garbageText, nonObjectJson)

const whitespace = fc
  .array(fc.constantFrom(' ', '\t', '\n'), { maxLength: 4 })
  .map((characters) => characters.join(''))

const blankValue = fc.oneof(
  fc.constantFrom(null, undefined),
  fc
    .tuple(whitespace, fc.constantFrom('', 'null'), whitespace)
    .map(([before, word, after]) => `${before}${word}${after}`)
)

beforeEach(() => {
  errorLog.calls.length = 0
  hoisted.tierLimits = null
  invalidateTierLimitsCache()
})

describe('stored feature flags (F18)', () => {
  it('(F18) corrupt text behaves like nothing stored and is logged once', () => {
    const nothingStored = resolveFeatureFlags(null)
    errorLog.calls.length = 0

    fc.assert(
      fc.property(corruptText, (stored) => {
        errorLog.calls.length = 0

        const flags = resolveFeatureFlags(stored)

        expect(flags).toEqual(nothingStored)
        expect(errorLog.calls).toHaveLength(1)
        expect(errorLog.calls[0]).toMatchObject({ column: 'feature_flags' })
      })
    )
  })

  it('(F18) a blank or null value behaves like nothing stored and logs nothing', () => {
    const nothingStored = resolveFeatureFlags(null)

    fc.assert(
      fc.property(blankValue, (stored) => {
        errorLog.calls.length = 0

        const flags = resolveFeatureFlags(stored)

        expect(flags).toEqual(nothingStored)
        expect(errorLog.calls).toHaveLength(0)
      })
    )
  })
})

describe('stored tier limits (F18)', () => {
  async function tierLimitsStoredAs(stored: string | null | undefined) {
    hoisted.tierLimits = stored ?? null
    invalidateTierLimitsCache()
    return getTierLimits()
  }

  it('(F18) corrupt text behaves like nothing stored, fails no request, and is logged once', async () => {
    const nothingStored = await tierLimitsStoredAs(null)

    await fc.assert(
      fc.asyncProperty(corruptText, async (stored) => {
        errorLog.calls.length = 0

        const limits = await tierLimitsStoredAs(stored)

        expect(limits).toEqual(nothingStored)
        expect(errorLog.calls).toHaveLength(1)
        expect(errorLog.calls[0]).toMatchObject({ column: 'tier_limits' })
      })
    )
  })

  it('(F18) a blank or null value behaves like nothing stored and logs nothing', async () => {
    const nothingStored = await tierLimitsStoredAs(null)

    await fc.assert(
      fc.asyncProperty(blankValue, async (stored) => {
        errorLog.calls.length = 0

        const limits = await tierLimitsStoredAs(stored)

        expect(limits).toEqual(nothingStored)
        expect(errorLog.calls).toHaveLength(0)
      })
    )
  })
})
