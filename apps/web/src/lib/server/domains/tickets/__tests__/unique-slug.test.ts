import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fc from 'fast-check'

/**
 * ## T — Taxonomy names, colours, slugs, positions
 * - T4 A ticket-type or ticket-status slug is the underscore form of the name
 *   (lowercase, hyphens turned into underscores); a name that leaves nothing
 *   falls back to the entity's fallback word.
 * - T5 A generated slug never collides with a slug already taken, soft-deleted
 *   rows included: the base when it is free, otherwise the lowest free `_2`,
 *   `_3`, … suffix.
 */

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { ticketStatuses, isNull } from '@/lib/server/db'
import { nextUniqueSlug, toUnderscoreSlug, uniqueUnderscoreSlug } from '../unique-slug'

describe('toUnderscoreSlug', () => {
  it('rewrites hyphenated slugify output to underscores (T4)', () => {
    expect(toUnderscoreSlug('In Progress')).toBe('in_progress')
    expect(toUnderscoreSlug('Waiting on Customer')).toBe('waiting_on_customer')
  })
})

describe('nextUniqueSlug', () => {
  it('returns the base when free', () => {
    expect(nextUniqueSlug('open', new Set())).toBe('open')
  })

  it('increments _2, _3, … past taken values', () => {
    expect(nextUniqueSlug('open', new Set(['open']))).toBe('open_2')
    expect(nextUniqueSlug('open', new Set(['open', 'open_2']))).toBe('open_3')
  })

  it('never returns a taken slug, and is base when free else the smallest free _k suffix (T5)', () => {
    const baseArb = fc.constantFrom('open', 'bug_report', 'in_progress', 'x', 'waiting_on_vendor')
    fc.assert(
      fc.property(
        baseArb,
        fc.boolean(),
        fc.array(fc.integer({ min: 2, max: 12 }), { maxLength: 8 }),
        (base, baseTaken, suffixNumbers) => {
          const taken = new Set<string>()
          if (baseTaken) taken.add(base)
          for (const n of suffixNumbers) taken.add(`${base}_${n}`)

          const result = nextUniqueSlug(base, taken)

          // Unguarded across both branches: whatever comes back, it is never
          // one of the already-taken slugs.
          expect(taken.has(result)).toBe(false)

          if (!baseTaken) {
            expect(result).toBe(base)
          } else {
            const match = result.match(/^(.*)_(\d+)$/)
            expect(match).not.toBeNull()
            expect(match?.[1]).toBe(base)
            const k = Number(match?.[2])
            expect(k).toBeGreaterThanOrEqual(2)
            // k is the SMALLEST free suffix: every integer from 2 up to k-1
            // must already be taken.
            for (let i = 2; i < k; i++) {
              expect(taken.has(`${base}_${i}`)).toBe(true)
            }
          }
        }
      )
    )
  })
})

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: ticketStatuses.id }).from(ticketStatuses).limit(0)
  },
})

const suffix = () => `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`

async function cleanSlate(): Promise<void> {
  await testDb
    .update(ticketStatuses)
    .set({ deletedAt: new Date() })
    .where(isNull(ticketStatuses.deletedAt))
}

describe.skipIf(!fixture.available)('uniqueUnderscoreSlug (real DB, rolled back)', () => {
  beforeEach(fixture.begin)
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  it('falls back to the given fallback word when the name derives to nothing (T4)', async () => {
    await cleanSlate()
    const slug = await uniqueUnderscoreSlug('!!!', 'status', ticketStatuses)
    expect(slug).toBe('status')
  })

  it('feeds existing rows — soft-deleted included — into the taken set and picks the lowest free suffix (T5)', async () => {
    await cleanSlate()
    const name = `Unique DB Check ${suffix()}`
    const base = toUnderscoreSlug(name)
    await testDb.insert(ticketStatuses).values([
      { name: `${name} A`, slug: base, category: 'open', position: 0 },
      {
        name: `${name} B`,
        slug: `${base}_2`,
        category: 'open',
        position: 1,
        deletedAt: new Date(), // soft-deleted — slug is globally unique, still taken
      },
    ])

    const slug = await uniqueUnderscoreSlug(name, 'status', ticketStatuses)
    expect(slug).toBe(`${base}_3`)
  })

  it('returns the base slug untouched when nothing is taken yet (T5)', async () => {
    await cleanSlate()
    const name = `Fresh Status ${suffix()}`
    const slug = await uniqueUnderscoreSlug(name, 'status', ticketStatuses)
    expect(slug).toBe(toUnderscoreSlug(name))
  })
})
