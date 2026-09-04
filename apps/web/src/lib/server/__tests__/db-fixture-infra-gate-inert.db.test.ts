/**
 * V3: the gate only ever fires on missing infrastructure. With a database
 * present, declaring the run complete changes nothing, and a deliberate skip
 * for an unrelated reason still skips without turning the run red.
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
// exists for: V3 would then go unverified and the run would still be
// green — the same hole V1 closes, one level up.
if (!reachable && isTestDatabaseRequired(process.env)) {
  throw new Error(
    'db-fixture-infra-gate: REQUIRE_TEST_DB declared this run complete, but no database answered, ' +
      'so V3 could not be checked. Supply a test database, or unset REQUIRE_TEST_DB.'
  )
}

// Stubbed rather than assigned: the forks pool gives each test file its own
// process, so a raw `process.env` write here reaches no other suite today.
// That isolation is a default, though, and `isolate: false` would turn a raw
// write into a gate switched off for every later file in the worker.
afterAll(() => {
  vi.unstubAllEnvs()
})

describe.skipIf(!reachable)('a run declared complete with the database present (V3)', () => {
  it('builds the fixture as usual', async () => {
    vi.stubEnv('REQUIRE_TEST_DB', '1')

    const fixture = await createDbTestFixture()

    expect(fixture.available).toBe(true)
    await fixture.close()
  })

  it.skip('a skip for an unrelated reason is untouched by the gate', () => {
    expect.unreachable('this test is deliberately skipped and must not fail the run')
  })
})
