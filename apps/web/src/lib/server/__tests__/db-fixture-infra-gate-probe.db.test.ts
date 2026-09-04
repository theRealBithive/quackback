/**
 * V4 and V5 end to end: a stale schema is missing infrastructure, not an
 * available database. The probe exists precisely to catch a schema the suite's
 * columns are not in yet, and its failure has to be as loud as a refused
 * connection — with the reason intact, not swallowed by a bare `catch {}`.
 *
 * The confirmed contract lives in `db-fixture-infra-gate.test.ts`. This file
 * owns one guarantee because the fixture is module-global — one per file.
 */
import { afterAll, describe, it, expect, vi } from 'vitest'
import { sql } from 'drizzle-orm'
// The fixture itself is the sanctioned caller of createDb; this file needs its
// own throwaway connection only to decide whether a database is there at all.
// oxlint-disable-next-line no-restricted-imports
import { createDb } from '@quackback/db/client'
import { createDbTestFixture, isTestDatabaseRequired } from './db-test-fixture'

const STALE_SCHEMA = 'column "not_migrated_yet" does not exist'

/** True when the configured database actually answers, so this file has something to test. */
async function answersSelectOne(url: string | undefined): Promise<boolean> {
  if (!url) return false
  const db = createDb(url, { max: 1, prepare: false })
  try {
    await db.execute(sql`select 1`)
    return true
  } catch {
    return false
  } finally {
    const raw = (db as unknown as { $client?: { end?: () => Promise<void> } }).$client
    await raw?.end?.().catch(() => {})
  }
}

const reachable = await answersSelectOne(process.env.DATABASE_URL)

// This file is a test *of* the gate, so it must not skip on the runs the gate
// exists for: V4 and V5 would then go unverified and the run would still be
// green — the same hole V1 closes, one level up.
if (!reachable && isTestDatabaseRequired(process.env)) {
  throw new Error(
    'db-fixture-infra-gate: REQUIRE_TEST_DB declared this run complete, but no database answered, ' +
      'so V4 and V5 could not be checked. Supply a test database, or unset REQUIRE_TEST_DB.'
  )
}

// Stubbed rather than assigned: the forks pool gives each test file its own
// process, so a raw `process.env` write here reaches no other suite today.
// That isolation is a default, though, and `isolate: false` would turn a raw
// write into a gate switched off for every later file in the worker.
afterAll(() => {
  vi.unstubAllEnvs()
})

describe.skipIf(!reachable)('a stale schema on a run declared complete (V4, V5)', () => {
  it('fails as loudly as a refused connection, carrying the probe failure', async () => {
    vi.stubEnv('REQUIRE_TEST_DB', '1')

    // Starts as a failing value, so a fixture that builds fails every
    // assertion below rather than skipping them.
    let message = 'the fixture was built, which it must not have been'
    try {
      await createDbTestFixture({
        probe: async () => {
          throw new Error(STALE_SCHEMA)
        },
      })
    } catch (error) {
      message = error instanceof Error ? error.message : String(error)
    }

    expect(message).toMatch(/no usable test database/i)
    expect(message).toContain(STALE_SCHEMA)
  })
})
