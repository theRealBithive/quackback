/**
 * V2 end to end: a laptop that never declared the run complete still skips.
 * With no database and no REQUIRE_TEST_DB, building the fixture reports
 * `available: false` and throws nothing, so `describe.skipIf` does its job and
 * the run stays green.
 *
 * This is the other half of `db-fixture-infra-gate-throws.test.ts`: without
 * it, a gate that threw on every unreachable database would turn every local
 * run red and nothing would notice.
 *
 * The confirmed contract lives in `db-fixture-infra-gate.test.ts`. This file
 * owns one guarantee because the fixture is module-global — one per file.
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

describe('a run that declared nothing, with no database (V2)', () => {
  it('reports the suite unavailable instead of failing', async () => {
    vi.stubEnv('DATABASE_URL', NOTHING_LISTENS_HERE)
    // The whole point of this file: the run was never declared complete, even
    // when the surrounding CI job declares it for every other suite.
    vi.stubEnv('REQUIRE_TEST_DB', undefined)

    const fixture = await createDbTestFixture()

    expect(fixture.available).toBe(false)
    await fixture.close()
  })
})
