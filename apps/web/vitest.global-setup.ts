/**
 * The infrastructure gate, for every suite in the repo.
 *
 * Contract: V1 and V4 in
 * `apps/web/src/lib/server/__tests__/db-fixture-infra-gate.test.ts`. V1 says a
 * run that skipped a suite for want of infrastructure is not a passing run,
 * whenever the run was declared complete. V4 says a stale schema counts as
 * missing infrastructure rather than as an available database.
 *
 * The fixture enforces both for the ~123 suites that use it. Twenty-five others
 * open their own connection and decide for themselves whether to skip, and a
 * dozen of those live in `packages/db`, which cannot import the fixture at all.
 * Editing them one by one would leave the next such file uncovered anyway.
 *
 * Checking centrally covers all of them, and every suite written later, in one
 * place: if the run was declared complete, a database has to be reachable and
 * its schema has to be current before any test file is loaded. What individual
 * suites then do with `skipIf` is about their own preconditions (V3), not about
 * whether the infrastructure was there.
 *
 * Reachability is not enough on its own. The failure this exists for is someone
 * adding a migration and not re-running `db:migrate`: the connection succeeds,
 * every per-file schema probe fails, and the run reports a screenful of skips.
 * So the applied count is compared against drizzle's journal.
 *
 * With `REQUIRE_TEST_DB` unset — a laptop — this does nothing at all.
 *
 * It lives under `apps/web` rather than at the repo root, which is where a file
 * shared by both vitest configs belongs. A globalSetup file resolves its own
 * imports from its own location, and `drizzle-orm` and `postgres` are
 * dependencies of `apps/web` and `packages/db`, not of the root — at the root
 * this file fails with ERR_MODULE_NOT_FOUND before the gate can run.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { sql } from 'drizzle-orm'
// By relative path, not as `@quackback/db/client`: the workspace packages are
// not linked into `node_modules`, they are resolved by the `alias` block in
// `vitest.config.ts` — and that block applies to test modules, not to a
// globalSetup file. The bare specifier fails here with ERR_MODULE_NOT_FOUND.
import { createDb, type Database } from '../../packages/db/src/client'
import {
  isTestDatabaseRequired,
  schemaStaleness,
  testDatabaseUrls,
  unavailableMessage,
  type TestDatabaseFailure,
} from './src/lib/server/__tests__/db-test-fixture'

const JOURNAL = join(import.meta.dirname, '../../packages/db/drizzle/meta/_journal.json')

/** How many migrations the repo expects, per drizzle's journal. */
function expectedMigrationCount(): number {
  const journal = JSON.parse(readFileSync(JOURNAL, 'utf8')) as { entries?: unknown[] }
  return journal.entries?.length ?? 0
}

/** Throws when the database is behind the migrations in the tree. */
async function assertSchemaCurrent(db: Database): Promise<void> {
  const rows = await db.execute<{ applied: number }>(
    sql`select count(*)::int as applied from drizzle.__drizzle_migrations`
  )
  const stale = schemaStaleness(Number(rows[0]?.applied ?? 0), expectedMigrationCount())
  if (stale) throw new Error(stale)
}

async function endClient(db: Database): Promise<void> {
  const raw = (db as unknown as { $client?: { end?: () => Promise<void> } }).$client
  await raw?.end?.()
}

export default async function assertTestDatabaseUsable(): Promise<void> {
  if (!isTestDatabaseRequired(process.env)) return

  const failures: TestDatabaseFailure[] = []

  for (const url of testDatabaseUrls(process.env)) {
    const db = createDb(url, { max: 1, prepare: false })
    try {
      await db.execute(sql`select 1`)
      await assertSchemaCurrent(db)
      return
    } catch (error) {
      failures.push({ url, error })
    } finally {
      await endClient(db).catch(() => {})
    }
  }

  throw new Error(unavailableMessage(failures))
}
