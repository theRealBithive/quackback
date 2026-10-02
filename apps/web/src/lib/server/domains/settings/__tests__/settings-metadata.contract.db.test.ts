/**
 * The shared `settings.metadata` bag: concurrent writers, sibling keys, and a
 * bag that cannot be read.
 *
 * Contract for upstream batch F (#597, `90fb0a491`) — the confirmed list for
 * this area:
 *
 *   F15 Two concurrent writes to different metadata keys both survive.
 *   F16 Writing one metadata key never changes or removes another stored key.
 *   F17 If stored metadata is not a JSON object, a write is refused and the
 *       stored text stays as it was.
 *
 * Reading of F17: a bag that is absent (NULL, blank, or the JSON text `null`)
 * holds nothing, so a write starts a new bag; only a present bag that is not
 * an object (array, number, string, boolean, unparseable text) is refused.
 * The owner confirmed this reading (2026-10-02), matching F18's "a blank or
 * `null` value is silent".
 *
 * Real Postgres, in a copy of `settings` inside a schema of this suite's own
 * (same approach as `settings-metadata-writes.db.test.ts`). The race is forced,
 * not hoped for: a third connection holds the settings row, every writer is
 * started and waits behind it, and only then is the row released.
 *
 * Generators: pre-existing bags are dictionaries of identifier-like keys to
 * strings, integers, booleans, null, arrays and nested objects, so a sibling
 * can be any JSON shape; written keys overlap the pre-existing ones some of
 * the time, so both "add a key" and "replace a key" are reached; unreadable
 * stored text covers arrays, scalars, truncated objects and non-JSON text.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import fc from 'fast-check'
import postgres from 'postgres'
import type { Transaction } from '@/lib/server/db'

const race = vi.hoisted(() => ({
  schema: `settings_meta_contract_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
  db: null as unknown,
}))

// Domain code imports the global `db`; point it at this suite's schema.
vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: new Proxy(
    {},
    {
      get(_, prop) {
        const target = race.db as Record<string | symbol, unknown>
        const value = target[prop]
        return typeof value === 'function' ? value.bind(target) : value
      },
    }
  ),
}))

const cache = vi.hoisted(() => ({ del: vi.fn(async (..._keys: string[]) => {}) }))

vi.mock('@/lib/server/cache', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/cache')>()),
  cacheDel: cache.del,
}))

// Same sanctioned direct client import as the db test fixture: this suite
// builds its own connections rather than going through the global `db`.
// oxlint-disable-next-line no-restricted-imports
import { createDbFromSql } from '@quackback/db/client'
import { db, settings, sql } from '@/lib/server/db'
import { getExecuteRows } from '@/lib/server/utils/execute-rows'
import { writeMetadataKey } from '../settings.helpers'
import { updateFeatureFlags } from '../settings.service'
import { updateChangelogSettings } from '../settings.changelog'
import { updateStatusSettings } from '../settings.status'
import {
  updateWorkflowAbandonedAutoCloseSettings,
  updateWorkflowCloseSpamSettings,
} from '../settings.workflows'

let admin: postgres.Sql | null = null
let pool: postgres.Sql | null = null
let available = false
try {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('no test database')
  admin = postgres(url, { max: 1, onnotice: () => {} })
  await admin.unsafe(`create schema ${race.schema}`)
  await admin.unsafe(`create table ${race.schema}.settings (like public.settings including all)`)
  pool = postgres(url, {
    max: 8,
    onnotice: () => {},
    connection: { search_path: `${race.schema}, public` },
  })
  race.db = createDbFromSql(pool)
  await db.select().from(settings).limit(0)
  available = true
} catch {
  // Without a database the suite skips; REQUIRE_TEST_DB=1 turns that into a
  // failure in the global setup.
}

afterAll(async () => {
  await pool?.end()
  await admin?.unsafe(`drop schema if exists ${race.schema} cascade`).catch(() => {})
  await admin?.end()
})

type Bag = Record<string, unknown>

async function seed(metadata: string | null): Promise<void> {
  await db.delete(settings)
  await db.insert(settings).values({
    name: 'Metadata contract',
    slug: 'metadata-contract',
    createdAt: new Date(),
    featureFlags: JSON.stringify({ changelog: true, statusPage: false }),
    metadata,
  })
}

async function storedMetadataText(): Promise<string | null> {
  const [row] = await db.select({ metadata: settings.metadata }).from(settings)
  return row.metadata
}

async function storedBag(): Promise<Bag> {
  const text = await storedMetadataText()
  return JSON.parse(text ?? '{}') as Bag
}

/** Wait until `count` sessions queue behind the backend `pid` (following the chain). */
async function waitForBlockedBy(pid: number, count: number): Promise<void> {
  const deadline = Date.now() + 10_000
  for (;;) {
    const [{ blocked }] = getExecuteRows<{ blocked: number }>(
      await db.execute(sql`
        with recursive waiting(pid) as (
          select pid from pg_stat_activity where ${pid} = any(pg_blocking_pids(pid))
          union
          select a.pid from pg_stat_activity a join waiting w on w.pid = any(pg_blocking_pids(a.pid))
        )
        select count(*)::int as blocked from waiting
      `)
    )
    if (blocked >= count) return
    if (Date.now() > deadline) {
      throw new Error(`only ${blocked} of ${count} writers reached the row`)
    }
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
}

/**
 * Run `writers` while a third connection holds the settings row, and release
 * it only once every writer is waiting on it, so they are certain to overlap.
 */
async function behindHeldRow<T>(
  writers: Array<() => Promise<T>>,
  during?: (tx: Transaction) => Promise<void>
): Promise<T[]> {
  let releaseRow!: () => void
  const rowReleased = new Promise<void>((resolve) => (releaseRow = resolve))
  let reportPid!: (pid: number) => void
  const holderPid = new Promise<number>((resolve) => (reportPid = resolve))
  const holding = db.transaction(async (tx) => {
    await tx.select({ id: settings.id }).from(settings).limit(1).for('update')
    await during?.(tx)
    const [{ pid }] = getExecuteRows<{ pid: number }>(
      await tx.execute(sql`select pg_backend_pid() as pid`)
    )
    reportPid(pid)
    await rowReleased
  })
  const pid = await Promise.race([
    holderPid,
    holding.then(() => Promise.reject(new Error('the row holder ended before holding'))),
  ])

  const racing = Promise.all(writers.map((write) => write()))
  try {
    await waitForBlockedBy(pid, writers.length)
  } finally {
    releaseRow()
    await holding
  }
  return racing
}

const metadataKey = fc.stringMatching(/^[a-z][A-Za-z0-9]{0,8}$/)

const metadataValue = fc.oneof(
  fc.string(),
  fc.integer(),
  fc.boolean(),
  fc.constant(null),
  fc.array(fc.string(), { maxLength: 3 }),
  fc.dictionary(fc.constantFrom('a', 'b', 'c'), fc.integer(), { maxKeys: 3 })
)

const metadataBag = fc.dictionary(metadataKey, metadataValue, { maxKeys: 5 })

/** Distinct keys, each with a value, none of them equal to another. */
function distinctWrites(minLength: number, maxLength: number) {
  return fc.uniqueArray(fc.tuple(metadataKey, metadataValue), {
    minLength,
    maxLength,
    selector: ([key]) => key,
  })
}

describe.skipIf(!available)('settings.metadata contract (F15, F16, F17)', () => {
  beforeEach(() => {
    cache.del.mockClear()
  })

  describe('concurrent writes to different keys (F15)', () => {
    it('(F15) every one of several concurrent writers keeps its key, next to the stored ones', async () => {
      await fc.assert(
        fc.asyncProperty(metadataBag, distinctWrites(2, 4), async (preexisting, writes) => {
          await seed(JSON.stringify(preexisting))

          await behindHeldRow(
            writes.map(
              ([key, value]) =>
                () =>
                  writeMetadataKey(key, value)
            )
          )

          const expected: Bag = { ...preexisting }
          for (const [key, value] of writes) expected[key] = value
          expect(await storedBag()).toEqual(expected)
        }),
        { numRuns: 12 }
      )
    })

    it('(F15) two partial updates to different fields of the same key both survive', async () => {
      await fc.assert(
        fc.asyncProperty(
          metadataBag,
          fc.constantFrom('public', 'authenticated'),
          fc.boolean(),
          fc.boolean(),
          async (preexisting, audience, autoSubscribe, emailsDisabled) => {
            const otherKeys: Bag = { ...preexisting }
            delete otherKeys.changelogSettings
            await seed(JSON.stringify(otherKeys))

            await behindHeldRow([
              () => updateChangelogSettings({ audience }),
              () => updateChangelogSettings({ autoSubscribe, emailsDisabled }),
            ])

            const bag = await storedBag()
            expect(bag.changelogSettings).toMatchObject({ audience, autoSubscribe, emailsDisabled })
            expect(bag).toMatchObject(otherKeys)
          }
        ),
        { numRuns: 8 }
      )
    })

    it('(F15) status settings: partial updates to different fields both survive', async () => {
      await seed(JSON.stringify({ instanceId: 'inst_1' }))

      await behindHeldRow([
        () => updateStatusSettings({ audience: 'authenticated' }),
        () => updateStatusSettings({ pageDescription: 'Status of the service' }),
        () => updateStatusSettings({ emailsDisabled: true }),
      ])

      const bag = await storedBag()
      expect(bag.statusSettings).toMatchObject({
        audience: 'authenticated',
        pageDescription: 'Status of the service',
        emailsDisabled: true,
      })
      expect(bag.instanceId).toBe('inst_1')
    })

    it('(F15) abandoned auto-close: partial updates to different fields both survive', async () => {
      await seed(null)

      await behindHeldRow([
        () => updateWorkflowAbandonedAutoCloseSettings({ waitMinutes: 17 }),
        () => updateWorkflowAbandonedAutoCloseSettings({ keepIfEmailCaptured: false }),
      ])

      const bag = await storedBag()
      expect(bag.workflowAbandonedAutoClose).toMatchObject({
        waitMinutes: 17,
        keepIfEmailCaptured: false,
      })
    })

    it('(F15) writers of the four partial-update settings and a flag change all keep their keys', async () => {
      await seed(JSON.stringify({ instanceId: 'inst_1' }))

      await behindHeldRow<unknown>([
        () => updateChangelogSettings({ audience: 'authenticated' }),
        () => updateStatusSettings({ emailsDisabled: true }),
        () => updateWorkflowAbandonedAutoCloseSettings({ waitMinutes: 9 }),
        () => updateWorkflowCloseSpamSettings({ enabled: true }),
        () => updateFeatureFlags({ statusPage: true }),
      ])

      const bag = await storedBag()
      expect(Object.keys(bag).sort()).toEqual(
        [
          'changelogSettings',
          'instanceId',
          'statusSettings',
          'workflowAbandonedAutoClose',
          'workflowCloseSpam',
        ].sort()
      )
      expect(bag.changelogSettings).toMatchObject({ audience: 'authenticated' })
      expect(bag.workflowAbandonedAutoClose).toMatchObject({ waitMinutes: 9 })
      expect(bag.workflowCloseSpam).toMatchObject({ enabled: true })
      // Turning Status on and the emails switch are both Status keys; neither is lost.
      expect(bag.statusSettings).toMatchObject({ enabled: true, emailsDisabled: true })
    })

    it('(F15) a key written by another session while a writer waits for the row is kept', async () => {
      await seed(JSON.stringify({ instanceId: 'inst_1' }))

      await behindHeldRow(
        [() => writeMetadataKey('writtenLast', { ok: true })],
        // Another writer commits while this one waits for the row.
        async (tx) => {
          await tx
            .update(settings)
            .set({ metadata: JSON.stringify({ instanceId: 'inst_1', writtenFirst: 1 }) })
        }
      )

      expect(await storedBag()).toEqual({
        instanceId: 'inst_1',
        writtenFirst: 1,
        writtenLast: { ok: true },
      })
    })
  })

  describe('writing one key leaves the others alone (F16)', () => {
    it('(F16) after any sequence of writes the stored keys are the pre-existing keys plus the written ones', async () => {
      await fc.assert(
        fc.asyncProperty(metadataBag, distinctWrites(1, 5), async (preexisting, writes) => {
          await seed(JSON.stringify(preexisting))

          for (const [key, value] of writes) {
            await writeMetadataKey(key, value)
          }

          const writtenKeys = writes.map(([key]) => key)
          const expectedKeys = new Set([...Object.keys(preexisting), ...writtenKeys])
          const bag = await storedBag()
          // Unguarded conservation: no key is lost, none appears from nowhere.
          expect(new Set(Object.keys(bag))).toEqual(expectedKeys)
          for (const [key, value] of writes) {
            expect(bag[key]).toEqual(value)
          }
          for (const [key, value] of Object.entries(preexisting)) {
            if (!writtenKeys.includes(key)) expect(bag[key]).toEqual(value)
          }
        }),
        { numRuns: 20 }
      )
    })

    it('(F16) the partial-update callers change only their own key', async () => {
      await fc.assert(
        fc.asyncProperty(metadataBag, async (preexisting) => {
          const callerKeys = [
            'changelogSettings',
            'statusSettings',
            'workflowAbandonedAutoClose',
            'workflowCloseSpam',
          ]
          const siblings: Bag = { ...preexisting }
          for (const key of callerKeys) delete siblings[key]
          await seed(JSON.stringify(siblings))

          await updateChangelogSettings({ audience: 'authenticated' })
          await updateStatusSettings({ emailsDisabled: true })
          await updateWorkflowAbandonedAutoCloseSettings({ waitMinutes: 3 })
          await updateWorkflowCloseSpamSettings({ enabled: true })

          const bag = await storedBag()
          expect(bag).toMatchObject(siblings)
          expect(Object.keys(bag).sort()).toEqual([...Object.keys(siblings), ...callerKeys].sort())
        }),
        { numRuns: 8 }
      )
    })

    it('(F16) turning the Status page on through the feature flags keeps every other key', async () => {
      await fc.assert(
        fc.asyncProperty(metadataBag, async (preexisting) => {
          const siblings: Bag = { ...preexisting }
          delete siblings.statusSettings
          await seed(JSON.stringify(siblings))

          await updateFeatureFlags({ statusPage: true })

          const bag = await storedBag()
          expect(bag).toMatchObject(siblings)
          expect(Object.keys(bag).sort()).toEqual(
            [...Object.keys(siblings), 'statusSettings'].sort()
          )
        }),
        { numRuns: 8 }
      )
    })

    it('(F16) an absent bag starts a new one holding exactly the written key', async () => {
      const absentValues = [null, '', '   ', 'null', ' null\n']
      for (const absent of absentValues) {
        await seed(absent)

        await writeMetadataKey('emailAutoAck', { enabled: true })

        expect(await storedBag()).toEqual({ emailAutoAck: { enabled: true } })
      }
    })
  })

  describe('a stored bag that is not a JSON object (F17)', () => {
    const truncatedObject = fc
      .dictionary(metadataKey, fc.integer(), { minKeys: 1, maxKeys: 3 })
      .map((object) => JSON.stringify(object).slice(0, -1))

    const unreadableText = fc.oneof(
      truncatedObject,
      fc.string().map((tail) => `x${tail}`),
      fc.array(metadataValue, { maxLength: 3 }).map((array) => JSON.stringify(array)),
      fc.integer().map((number) => JSON.stringify(number)),
      fc.string().map((text) => JSON.stringify(text)),
      fc.boolean().map((flag) => JSON.stringify(flag))
    )

    const refusedWriters: Array<[string, () => Promise<unknown>]> = [
      ['a plain key write', () => writeMetadataKey('emailAutoAck', { enabled: true })],
      ['a key write computed from the stored text', () => writeMetadataKey('tally', () => 1)],
      ['turning Status on', () => updateFeatureFlags({ statusPage: true })],
      ['a changelog settings update', () => updateChangelogSettings({ audience: 'authenticated' })],
      ['a status settings update', () => updateStatusSettings({ emailsDisabled: true })],
      [
        'an abandoned auto-close update',
        () => updateWorkflowAbandonedAutoCloseSettings({ waitMinutes: 4 }),
      ],
      ['a close-spam update', () => updateWorkflowCloseSpamSettings({ enabled: true })],
    ]

    it.each(refusedWriters)(
      '(F17) %s is refused and the stored text stays as it was',
      async (_name, write) => {
        await fc.assert(
          fc.asyncProperty(unreadableText, async (stored) => {
            await seed(stored)
            cache.del.mockClear()

            await expect(write()).rejects.toThrow()

            expect(await storedMetadataText()).toBe(stored)
            expect(cache.del).not.toHaveBeenCalled()
          }),
          { numRuns: 10 }
        )
      }
    )

    it('(F17) a refused write leaves the stored text byte-identical, including whitespace', async () => {
      const stored = '  [1,  2 ,3]\n'
      await seed(stored)

      await expect(writeMetadataKey('emailAutoAck', { enabled: true })).rejects.toThrow()

      expect(await storedMetadataText()).toBe(stored)
    })
  })
})
