# SELF-IMPROVE

Gotchas from concrete runs of work in this repo. One counter per entry; bump it
when the same thing bites again and re-sort the list by counter, descending.

## 2x — No property-test and mutation infrastructure

The tooling is missing for non-trivial logic. `fast-check` is a devDependency and
is used by exactly two suites; a mutation runner (Stryker) is still missing, so
every mutation number in this repo is produced by a throwaway script that applies
mutants textually one at a time and re-runs the suite by hand.

Second run: the infrastructure gate on the DB fixture needed 25 mutants written
out by hand to find the four that mattered (three unasserted lines of the
remediation message, and — the one that counted — no end-to-end test that an
unreachable database _without_ `REQUIRE_TEST_DB` still skips instead of throwing,
which is the regression that would have turned every laptop run red). A real
runner would have listed those in one command instead of one bespoke script per
change. Coverage has the same shape: `@vitest/coverage-v8` has to be installed
transiently and `package.json`/`bun.lock` restored afterwards, every time.

## 2x — vitest 4: dropped flags, swallowed logs, and per-file import resolution

Three wasted turns diagnosing an env-leakage question, all of them spent on the
test runner rather than the question:

- `--reporter=basic` is gone in vitest 4 and fails as
  `Failed to load custom Reporter from basic`, which reads like a missing file.
- `--poolOptions.forks.singleFork` is gone too — `Unknown option --poolOptions`.
  Sequential-in-one-worker is now `--maxWorkers=1 --fileParallelism=false`.
- `console.log` inside a test never reaches the terminal, even with
  `--silent=false`. A throwaway probe has to _assert_ what it wants to report
  and read the value out of the assertion diff.

Worth knowing while writing such a probe: the `forks` pool leaves `isolate` at
its default, so every test file gets a fresh process and **no** `process.env`
write crosses files — not even a raw one. Measured, not assumed: a control file
that stubbed the env and never restored it left the next file untouched, and the
two files reported different pids. Env hygiene between files is therefore not a
real hazard here, and `vi.stubEnv` is worth using for the day someone sets
`isolate: false`, not for today.

Second run, a different corner of the same tool. A `globalSetup` file resolves
its own imports **from its own location**, not from the config that registers
it — and bun workspaces do not hoist third-party dependencies to the repo root,
so a setup file at the root cannot import `drizzle-orm` at all
(`ERR_MODULE_NOT_FOUND`, raised before the setup body runs, which breaks every
suite in the repo at once). The workspace packages are worse: `node_modules/@quackback/`
does not exist, and `@quackback/db/client` resolves **only** through the `alias`
block in `vitest.config.ts`, which applies to test modules and not to
globalSetup. A file shared by both configs therefore has to live inside
`apps/web` and import `../../packages/db/src/client` by path. Three turns.

## 1x — The event fan-out can be completely dead without anything saying so

`resolveTargets` (`events/resolvers/registry.ts`) resolves against a module-level
array that only `registerAllResolvers()` fills. If the last caller loses its call
site — exactly what happened in the WO-18 cutover that decoupled `getHookTargets()` —
every resolve returns `[]`: the event is stamped `published`, no hook job is created,
no log, no error. Every sink — integrations, webhooks, notifications, AI, workflows —
is then silently off.

Diagnosing it took roughly fifteen turns and several DB rounds across `events`,
`job_queue`, `kv_store` and `hook_deliveries`, because not one log line pointed in the
right direction. What was missing:

- A warning in `resolveTargets` when the registry is empty. An empty registry is always
  a bug in a running tier, never a valid state. _(Added during that run — the two points
  below are still missing.)_
- A boot log line listing the registered sinks, analogous to `job.worker_started`.
- An admin surface for `listResolvers()`. The comment in `registry.ts:71` already calls
  it "the 'did it fire?' surface", but nothing exposes it.

## 1x — No "why did nothing arrive?" path for integrations

To work out why a correctly configured GitLab integration produces nothing, you have to
rebuild the chain `events` → `job_queue('event-dispatch')` → resolver → `job_queue('events')`
→ `hook_deliveries` by hand in SQL, and know that the mapping cache lives in `kv_store`
under `hooks:integration-mappings`. Two bail-outs in the resolver
(`integration.resolver.ts:81-85` missing `channelId`, `:91-102` decrypt failure) discard a
target silently via `continue`.

A per-integration diagnostic view — last event, last target, last delivery attempt, reason
for discarding — would collapse that whole procedure into one glance. Some of the columns
already exist (`last_outbound_at`, `last_error`), but they are only written on an actual
HTTP call, so precisely not when the problem sits before it.

## 1x — `db:generate` is broken, migrations have to be written by hand

`bun run db:generate` aborts with `[drizzle/meta/0050_snapshot.json, 0051, 0052] are
pointing to a parent snapshot: ... which is a collision.` The snapshots stop at 0052, the
migrations run to 0273 — the generated path was abandoned long ago. What is actually
customary: write the SQL file by hand in `packages/db/drizzle/` (with `IF NOT EXISTS`, like 0272) and append an entry to `drizzle/meta/_journal.json` (`idx` +1, `when` +1, `tag` = the
filename without `.sql`).

Nothing in the repo says so. Either fix the snapshot collision or remove the `db:generate`
script entry and record the manual procedure in `packages/db/README` — otherwise everyone
tries it again and loses the same round.

## 1x — Local `typecheck` reports 815 pre-existing errors

`bun run typecheck` yields 815 `error TS` on a **clean** tree, almost all in
`apps/web/src/routes/**`, because the generated route types are not built locally. Whether
your own change added an error can only be established by stashing, counting the errors,
restoring and counting again.

Either pull the codegen step into the `typecheck` script or document which command has to
run first.

## 1x — No documented path to a local test database

The DB-backed suites need Postgres on `localhost:5432`, database `quackback_test`, migrated.
That is written down nowhere in one place, and the obvious attempt fails: `postgres:16`
aborts mid-migration with `extension "vector" is not available`. The right image is
`pgvector/pgvector:pg17` (stated only in `.github/workflows/ci.yml`), followed by
`DATABASE_URL=postgresql://postgres:password@localhost:5432/quackback_test bun run db:migrate`.

Making it worse: if the DB is missing or the schema is stale, the fixture **skips** the suite
silently (`describe.skipIf(!fixture.available)`). The run looks green and checked nothing — in
that run it showed `12 skipped`, which reads easily as success.

_Closed:_ `REQUIRE_TEST_DB=1` (set on the CI unit job) turns an unreachable or
stale database into a failure naming the database, the reason and the remedy.
`apps/web/vitest.global-setup.ts` checks once before any file loads, so it covers
the 123 fixture suites, the 25 that open their own connection — 12 of them in
`packages/db`, which cannot import the fixture — and every suite written later.
Staleness is a journal-count comparison, because a database that merely lags the
migrations connects fine and turns every per-file probe into a skip.

Still open: there is no `docker compose -f compose.test.yml up -d` to bring the
database up in one command.

## 1x — Stryker runs the whole suite before the first mutant

Measured while checking whether the hand-rolled mutation script can be replaced.
`@stryker-mutator/core@10` and `@stryker-mutator/vitest-runner@10` do install and
work under bun, with two conditions that cost a run each:

- the runner has to be named explicitly in `plugins: ["@stryker-mutator/vitest-runner"]`,
  or Stryker reports `Cannot find TestRunner plugin "vitest"` and, misleadingly,
  `no TestRunner plugins were loaded` — bun's `.bun/` store defeats its plugin scan;
- its **initial dry run executes the entire suite**, all 1405 files, before it
  mutates anything. It times out long before that finishes, so `mutate` scoped to
  one file is not enough on its own: the _test command_ has to be scoped too, and
  `dryRunTimeoutMinutes` raised.

So a diff-scoped mutation gate here is not "point Stryker at the changed files".
It has to derive both the mutant set and the test selection from the diff.

## 1x — The DB suites are flaky under parallel load

`principals/__tests__/seat-usage.db.test.ts` and
`tickets/__tests__/ticket-convergence-1b.test.ts` each fail intermittently when
the ~120 fixture-backed suites run together, and pass when run alone. Measured
over nine full runs of that set: 3 failures in 6 runs on one branch, 1 in 3 on an
unmodified tree — different files, same shape. `seat-usage` asserts
`after.members === before.members + 2` against a database-wide count and saw +4,
so something outside its own rolled-back transaction commits rows while it runs.

The cost is not the flake itself, it is that it makes any change to shared test
infrastructure unfalsifiable: proving a fixture change innocent took six 75-second
full-set runs plus a stash-and-compare, because a single red run says nothing.
Either make the whole-DB counts workspace-scoped, or serialise the suites that
count globally.
