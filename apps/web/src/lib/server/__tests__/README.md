# Mocking the db in server tests

Two sanctioned patterns. Hand-rolled per-table db stubs in individual test
files (a fake `@/lib/server/db` that re-lists every table) are banned: every
new table breaks them, and 23 files were on that treadmill before this policy.

## 1. Real-DB transactional fixture

For flows that touch multiple tables or whose value is that the SQL actually
runs against the live schema: merge/registry sweeps, FK and unique-constraint
semantics, raw-SQL fragments. Use `db-test-fixture.ts`. Each test runs in a
transaction that is always rolled back, so the test DB stays clean; code under
test that calls `db.transaction(...)` gets a savepoint inside it.

```ts
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { posts } from '@/lib/server/db'

// Domain code imports the global `db`; rebind it to the test transaction.
vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

const fixture = await createDbTestFixture({
  // Probe the columns you seed; a stale schema skips the suite, never fails it.
  probe: async (db) => void (await db.select({ id: posts.id }).from(posts).limit(0)),
})

describe.skipIf(!fixture.available)('my flow', () => {
  beforeEach(fixture.begin)
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  it('moves rows', async () => {
    await testDb.insert(posts).values({/* seed inside the transaction */})
    await realDomainFunction() // runs inside the same transaction via the mock
  })
})
```

Setup: the test DB must be migrated. CI already runs `bun run db:migrate`
against `quackback_test`; locally, after adding migrations run
`DATABASE_URL=postgresql://postgres:password@localhost:5432/quackback_test bun run db:migrate`.
One fixture per file; no `it.concurrent`.

Availability: the fixture probes `DATABASE_URL` and nothing else. It does not
fall back to the dev database — a suite that ran against different data than
the operator named is worse than one that did not run. When `DATABASE_URL` is
unset entirely, the dev database is the default.

Skip semantics depend on whether the run was declared complete:

- **`REQUIRE_TEST_DB` unset** (a laptop): an unreachable or stale database
  leaves `available` false, the suite skips, and the run stays green.
- **`REQUIRE_TEST_DB=1`** (CI sets it on the unit job): the same situation
  fails the run, naming the database it tried, the reason it could not be used,
  and how to supply one. `available` is then never false.

A stale schema counts as unusable, not as available: that is what `probe` is
for, and its failure is now as loud as a refused connection instead of being
swallowed. The guarantees are numbered in
`db-fixture-infra-gate.test.ts`.

## 2. importOriginal-spread mock

For pure logic, error paths, and call-shape/ordering seams. Spread the real
module and override only `db` — never re-list tables:

```ts
const mockInsert = vi.fn()
vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: { insert: (...args: unknown[]) => mockInsert(...args) },
}))
```

The principal-merge suites share one such harness with an operations log:
`principal-merge-db-mock.ts`.

Rule of thumb: if the test's value depends on Postgres accepting the SQL or
enforcing a constraint, use the fixture. If it is about sequencing, branching,
or error handling, use the spread mock.
