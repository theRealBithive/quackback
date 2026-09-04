/**
 * Transactional test-DB fixture: real Postgres, zero persistence. Every test
 * runs inside a transaction that is ALWAYS rolled back (begin in beforeEach,
 * sentinel-throw rollback in afterEach). Usage, the importOriginal-spread
 * rebind of the global `db`, and the policy on when to mock instead all live
 * in README.md next to this file.
 *
 * Mechanics unique to this file:
 * - The transaction callback parks on a hold promise so one transaction
 *   spans the whole test; rollback releases it and the sentinel throw makes
 *   ROLLBACK the only exit, even on test failure.
 * - `testDb` is a proxy onto the live transaction handle, shaped like the
 *   global `db`. Code under test calling `db.transaction(...)` gets a
 *   savepoint inside the fixture's transaction, so even a committed inner
 *   transaction vanishes at rollback.
 * - The module-level transaction slot is file-scoped (vitest isolates module
 *   registries per file); each file opens its own connection, and tests
 *   within a file must run sequentially (no `it.concurrent`).
 */
import { sql } from 'drizzle-orm'
// Direct client import to spin up our own pool — bypasses the global `db`
// proxy/singleton so each test file keeps its own short-lived connection
// (and closes it cleanly in afterAll). The lint rule reserves
// @quackback/db/client for the canonical db.ts entry; this fixture is a
// sanctioned caller of `createDb`, like board-view-filter-parity.test.ts.
// oxlint-disable-next-line no-restricted-imports
import { createDb, type Database } from '@quackback/db/client'

/** The transaction handle type the fixture parks each test inside. */
export type TestTransaction = Parameters<Parameters<Database['transaction']>[0]>[0]

/** The dev database, used only by a run that was told nothing at all. */
export const DEV_DATABASE_URL = 'postgresql://postgres:password@localhost:5432/quackback'

/** One candidate database and why it could not be used. */
export interface TestDatabaseFailure {
  url: string
  error: unknown
}

/** The spellings of REQUIRE_TEST_DB that leave a run free to skip. */
const SKIPPING_ALLOWED = ['', '0', 'false', 'no']

/**
 * Whether this run was declared complete, in which case a missing database
 * fails the run instead of skipping 120 suites quietly. CI sets
 * REQUIRE_TEST_DB=1; a laptop sets nothing, so local runs still skip. Any
 * other value counts as "on" — someone who wrote `true` meant to fail loud.
 */
export function isTestDatabaseRequired(env: Record<string, string | undefined>): boolean {
  const declared = env.REQUIRE_TEST_DB
  if (declared === undefined) return false
  return !SKIPPING_ALLOWED.includes(declared.trim().toLowerCase())
}

/**
 * The databases this run may use. A run that was told which database to use
 * gets exactly that one — falling back to the dev database would quietly run
 * the suite against different data than the operator named.
 */
export function testDatabaseUrls(env: Record<string, string | undefined>): string[] {
  const told = env.DATABASE_URL
  if (!told || told.trim().length === 0) return [DEV_DATABASE_URL]
  return [told]
}

/**
 * Why the database is behind the migrations in the tree, or null when it is not.
 *
 * Contract: V4 — a stale schema counts as missing infrastructure. Ahead is not
 * stale: a branch that removed a migration still has a usable database.
 */
export function schemaStaleness(applied: number, expected: number): string | null {
  if (applied >= expected) return null
  return (
    `schema is stale: ${applied} of ${expected} migrations applied. ` +
    'Run `bun run db:migrate` against this database.'
  )
}

/** How far down a cause chain to report before giving up on it. */
const MAX_CAUSE_DEPTH = 5

/**
 * Renders whatever was thrown, Error or not, so no reason is lost. The chain
 * matters: postgres-js reports `Failed query: select 1` at the top and keeps
 * the half an operator needs — `connect ECONNREFUSED` — in `cause`. The depth
 * limit keeps a self-referencing cause from looping.
 */
function describeFailure(error: unknown): string {
  const reasons: string[] = []
  let current: unknown = error
  for (let depth = 0; current != null && depth < MAX_CAUSE_DEPTH; depth += 1) {
    reasons.push(renderReason(current))
    current = current instanceof Error ? current.cause : null
  }
  return reasons.filter((reason) => reason.length > 0).join('\n      caused by: ')
}

/**
 * One link of the chain. An AggregateError carries an empty message and keeps
 * the reasons in `errors` — that is how `localhost` failing on both ::1 and
 * 127.0.0.1 arrives, and printing its message alone says nothing.
 */
function renderReason(error: unknown): string {
  if (!(error instanceof Error)) return String(error)
  const nested = error instanceof AggregateError ? error.errors : []
  const parts = [
    error.message,
    ...nested.map((inner: unknown) => (inner instanceof Error ? inner.message : String(inner))),
  ]
  return parts.filter((part) => part.length > 0).join('; ')
}

/** Blanks the password in a URL's userinfo, so it never reaches a CI log. */
function redactPassword(url: string): string {
  return url.replace(/\/\/([^/@]*):([^/@]*)@/, '//$1:***@')
}

/**
 * Why no database could be used and what to do about it. This lands in CI
 * logs, so it names the database and the remedy but never the password.
 */
export function unavailableMessage(failures: readonly TestDatabaseFailure[]): string {
  const attempts = failures.map(
    (failure) => `  - ${redactPassword(failure.url)}\n      ${describeFailure(failure.error)}`
  )
  return [
    'No usable test database, and REQUIRE_TEST_DB declared this run complete.',
    ...(attempts.length > 0 ? ['Tried:', ...attempts] : ['No database was configured to try.']),
    'Supply one with:',
    '  docker run -d --name quackback-test-pg -e POSTGRES_PASSWORD=password \\',
    '    -e POSTGRES_DB=quackback_test -p 5432:5432 pgvector/pgvector:pg17',
    '  DATABASE_URL=postgresql://postgres:password@localhost:5432/quackback_test bun run db:migrate',
    'Or unset REQUIRE_TEST_DB to let suites without a database skip again.',
  ].join('\n')
}

/** Thrown into the transaction callback so postgres always rolls back; compared by identity. */
const ROLLBACK = new Error('db-test-fixture: intentional rollback')

let created = false
let activeDb: Database | null = null
let activeTx: TestTransaction | null = null
let releaseHold: (() => void) | null = null
let txSettled: Promise<void> | null = null

/**
 * The current test's transaction, shaped like the global `db` so it can be
 * dropped in via the importOriginal-spread mock. Property access forwards to
 * the live transaction; using it outside begin()/rollback() throws.
 */
export const testDb: Database = new Proxy({} as Database, {
  get(_, prop) {
    if (!activeTx) {
      throw new Error(
        'db-test-fixture: no active test transaction. Call fixture.begin() in beforeEach ' +
          'and guard the suite with describe.skipIf(!fixture.available).'
      )
    }
    const value = (activeTx as unknown as Record<string | symbol, unknown>)[prop]
    return typeof value === 'function'
      ? (value as (...args: unknown[]) => unknown).bind(activeTx)
      : value
  },
})

export interface DbTestFixtureOptions {
  /**
   * Schema-currency probe, run against each candidate DB before it is
   * accepted. Select the columns your suite depends on (`limit(0)` is
   * enough); a stale or missing schema then skips the suite instead of
   * failing it mid-test.
   */
  probe?: (db: Database) => Promise<void>
}

export interface DbTestFixture {
  /**
   * False when the DB is not reachable/current; use describe.skipIf. Never
   * false when REQUIRE_TEST_DB declared the run complete — creating the
   * fixture throws instead, so the skip cannot pass for a green run.
   */
  available: boolean
  /** Open the per-test transaction. Call from beforeEach. */
  begin: () => Promise<void>
  /** Roll the transaction back. Call from afterEach; safe to call when begin failed. */
  rollback: () => Promise<void>
  /** Release the connection. Call from afterAll. */
  close: () => Promise<void>
}

async function endClient(db: Database): Promise<void> {
  // postgres-js attaches its raw client at $client; closing it releases the
  // pool so vitest doesn't hang on exit.
  const raw = (db as unknown as { $client?: { end?: () => Promise<void> } }).$client
  await raw?.end?.()
}

/**
 * Create the file's fixture. Await at module top level so
 * `describe.skipIf(!fixture.available)` sees a definite boolean.
 */
export async function createDbTestFixture(
  options: DbTestFixtureOptions = {}
): Promise<DbTestFixture> {
  if (created) {
    throw new Error('db-test-fixture: one fixture per test file (testDb is module-global)')
  }
  created = true

  const failures: TestDatabaseFailure[] = []
  for (const url of testDatabaseUrls(process.env)) {
    const candidate = createDb(url, { max: 1, prepare: false })
    try {
      await candidate.execute(sql`select 1`)
      await options.probe?.(candidate)
      activeDb = candidate
      break
    } catch (error) {
      // Keep the reason: a swallowed probe failure is what turns a stale
      // schema into a silently skipped suite.
      failures.push({ url, error })
      await endClient(candidate).catch(() => {})
    }
  }

  if (!activeDb && isTestDatabaseRequired(process.env)) {
    throw new Error(unavailableMessage(failures))
  }

  const begin = async (): Promise<void> => {
    const db = activeDb
    if (!db) {
      throw new Error(
        'db-test-fixture: no reachable test database — guard the suite with describe.skipIf(!fixture.available)'
      )
    }
    if (activeTx || txSettled) {
      throw new Error('db-test-fixture: begin() called before the previous rollback()')
    }

    let ready!: (tx: TestTransaction) => void
    let failed!: (err: unknown) => void
    const txReady = new Promise<TestTransaction>((resolve, reject) => {
      ready = resolve
      failed = reject
    })
    const hold = new Promise<void>((resolve) => {
      releaseHold = resolve
    })

    // The callback parks on `hold` so the transaction spans the whole test,
    // then throws the sentinel — rollback is the only way out.
    txSettled = db
      .transaction(async (tx) => {
        ready(tx)
        await hold
        throw ROLLBACK
      })
      .catch((err) => {
        if (err !== ROLLBACK) throw err
      })
    // BEGIN itself can fail before the callback runs (dead connection);
    // surface that as a begin() failure instead of hanging on txReady.
    txSettled.catch(failed)

    activeTx = await txReady
  }

  const rollback = async (): Promise<void> => {
    activeTx = null
    releaseHold?.()
    releaseHold = null
    const settled = txSettled
    txSettled = null
    // Surfaces any transaction-machinery error not already thrown in-test.
    if (settled) await settled
  }

  const close = async (): Promise<void> => {
    if (txSettled) await rollback()
    const db = activeDb
    activeDb = null
    if (db) await endClient(db)
  }

  return { available: activeDb !== null, begin, rollback, close }
}
