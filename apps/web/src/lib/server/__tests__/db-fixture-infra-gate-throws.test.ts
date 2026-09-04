/**
 * V1 end to end: when the run was declared complete and no database answers,
 * building the fixture fails the run instead of reporting `available: false`
 * and letting 120 suites skip quietly.
 *
 * The confirmed contract lives in `db-fixture-infra-gate.test.ts`. This file
 * owns one guarantee because the fixture is module-global — one per file.
 *
 * No database is needed here: the point is a port nothing listens on, so this
 * file behaves the same on a laptop and in CI.
 */
import { afterAll, describe, it, expect, vi } from 'vitest'
import { createDbTestFixture } from './db-test-fixture'

const NOTHING_LISTENS_HERE = 'postgresql://postgres:password@127.0.0.1:59999/quackback_test'

// Stubbed rather than assigned: the forks pool gives each test file its own
// process, so a raw `process.env` write here reaches no other suite today.
// That isolation is a default, though, and `isolate: false` would turn a raw
// write into a gate switched off for every later file in the worker.
afterAll(() => {
  vi.unstubAllEnvs()
})

describe('a run declared complete with no database (V1)', () => {
  it('fails instead of skipping, and says what was missing and how to supply it', async () => {
    vi.stubEnv('DATABASE_URL', NOTHING_LISTENS_HERE)
    vi.stubEnv('REQUIRE_TEST_DB', '1')

    // Starts as a failing value, so a fixture that builds fails every
    // assertion below rather than skipping them.
    let message = 'the fixture was built, which it must not have been'
    try {
      await createDbTestFixture()
    } catch (error) {
      message = error instanceof Error ? error.message : String(error)
    }

    expect(message).toMatch(/no usable test database/i)
    // V6: the operator learns which database, why, and what to do next.
    expect(message).toContain('127.0.0.1:59999')
    expect(message).toContain('pgvector/pgvector')
    expect(message).toContain('unset REQUIRE_TEST_DB')
    // V8: the URL it names carries a password, and shows it blanked. Asserted
    // positively — the message also quotes the documented local credential in
    // its `docker run` remedy, so "does not contain" would be about the wrong
    // string.
    expect(message).toContain('postgres:***@127.0.0.1:59999')
  })
})
