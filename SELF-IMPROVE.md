# SELF-IMPROVE

Gotchas from concrete runs of work in this repo. One counter per entry; bump it
when the same thing bites again and re-sort the list by counter, descending.
Entries that have actually been fixed move to **Resolved** at the end, with what
fixed them — they are the record of what the counters bought.

## 4x — Stryker runs the whole suite first, and scores a crashed suite as a survivor

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

Second run, with Stryker actually in use. The lever for the dry run is
`vitest.configFile`, pointing at a second, narrow vitest config whose `include`
lists only the suites that can reach the mutated module, and whose `globalSetup`
is deliberately absent so no mutant pays for a test-database probe. The dry run
went from "all 1405 files, times out" to `Ran 42 tests in 1 second`, and a full
run of 176 mutants takes about a minute.

The expensive finding is the other one. **A mutant that makes a suite crash
during collection is reported as `Survived`, not killed.** The file never got as
far as running a test, nothing failed, so Stryker sees no killing test. It only
came out by hand: a survivor that looked impossible — `if (!exception)` →
`if (exception)`, which inverts the whole blocking decision — failed with
`Tests no tests` and a `TypeError` when the same edit was applied manually. The
cause was one line of fixture setup outside a test, a `grade(...)` call in the
`describe` body. This misreports in the reassuring direction, and it is a
property of the runner rather than of that file: any suite that calls production
code at module or `describe` scope will quietly under-report its own mutation
score. Build fixtures inside the test.

Third run, on how to read a survivor. Hand-applying a mutant to check it is the
right move — it is what found the collection crash above — but the _line_ in
the report is not enough to reproduce it. Stryker mutates sub-expressions, so
`if (a || b)` yields separate mutants for the whole condition, for `a`, and for
`b`, all reported on the same line. Rewriting the line from the line number
alone applies a different mutant than the one that survived; here that briefly
looked like the runner reporting a killed mutant as survived. Read
`location.start.column`/`end.column` out of `reports/mutation/mutation.json`
and slice the original text with them, then apply exactly that.

The payoff for doing it properly: of 23 survivors in one module, two were real
defects in a diff parser (a removed SQL comment `-- note` arrives as `--- note`
and was read as a file header), several were redundant guards where two
mechanisms covered one decision, and only two were genuinely equivalent
mutants. A survivor list is a to-do list, not a score.

Fourth run, and the crashed-suite half bit again — while building the gate that
exists to catch it. Mutating the argument object of an internal call to `{}`
threw immediately, inside a fixture built in a `describe` body. The crash
happens during **collection**, vitest reports `Tests no tests`, and Stryker
reads zero failing tests as `Survived`. Two things make it hard to spot from the
report alone: the mutant looks like a deep logic survivor rather than a fixture
problem, and it is the only failure mode of this tool that under-reports in the
reassuring direction. Reproducing a survivor by hand is what identified it — the
Stryker report cannot say "your suite did not run".

What the gate built on this now handles, and what it still cannot. Deriving both
the mutant set and the test selection from the diff is automated —
`scripts/mutation-check.ts` generates the vitest and Stryker configs per run from
`scripts/mutation-manifest.json` — so the dry-run scoping above is no longer
something to remember, and a red suite is reported as "graded nothing" rather
than as a score. The crashed-suite half is not fixed and cannot be fixed from
here; it is how the runner reports, and the only defence is the discipline of
building fixtures inside the test.

One concrete gap is left, and it is small. The gate prints a survivor as file,
line, mutator and replacement — not enough to re-apply it by hand when several
mutants share a line, which is exactly the trap this entry's third run
describes. The columns are already in `.mutation-tmp/report.json`; carrying
`location.start.column` into a `Finding` and printing it would retire that
manual step.

## 3x — vitest 4: dropped flags, swallowed logs, and per-file import resolution

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

Third run, the coverage options. **Setting `coverage.exclude` replaces vitest's
default exclude list rather than adding to it**, and the defaults are what keep
test files, config files and build output out of the report. On the command
line there is no way to spread `coverageConfigDefaults.exclude`, so a
`--coverage.exclude=...` flag silently pulls every test file into scope — and
for a gate that grades coverage, test files counting as source is exactly the
kind of quiet wrongness that reads as a stricter gate. The fix is to keep the
whole coverage block in `vitest.config.ts`, where the defaults can be spread.

## 2x — The DB suites are flaky under parallel load

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

Hit again while measuring what coverage costs a shard. Locally, shard 1/4 with
coverage failed 4 tests and without coverage failed 1 — which reads as "coverage
broke the suite" until you notice the one failure is in both runs
(`singletons-not-shared.test.ts`, a 20s timeout) and the other three are
`channel-accounts/__tests__/channel-account.service.test.ts`, a real-DB suite,
two of them with `Cannot access '__vite_ssr_import_4__' before initialization`.
All four CI shards passed with coverage on 4 vCPU. So the local failures are load
— this laptop runs vitest 11-way with Postgres on the same box — but ruling that
out took a second full 3-minute shard run as a control. That is the cost of the
flakiness: no single run means anything, so every measurement needs a twin.

## 1x — Generating a vitest config has two traps, both of which look like a hang

The mutation gate writes the runner's config per run, and both mistakes cost a
debugging round:

- **`mergeConfig` concatenates arrays.** Merging an override with the root
  config leaves the root's `include` in place, so the selection becomes
  "the whole suite plus my file" — 1400-odd test files, per mutant. It presents
  as a hang, not as a configuration error. Override with a spread
  (`{ ...base.test, include: [...] }`), not with `mergeConfig`.
- **A config outside the repo tree cannot resolve `vitest/config`.** Written to
  `mktemp -d`, the config fails with `Cannot find module 'vitest/config'`,
  because bare specifiers resolve from the config's own location and `/tmp` has
  no `node_modules` above it. Generated configs have to live inside the
  checkout — the gate uses a gitignored `.mutation-tmp/`.

Also worth knowing while writing one: `coverage: undefined` in the test block is
not the same as omitting it, and fails with
`TypeError: Cannot read properties of undefined (reading 'enabled')`.

## 1x — Overriding `core.hooksPath` silently skips lint-staged

husky v9 in this repo sets `core.hooksPath` to `.husky/_`, and the executable
runner in there sources the non-executable `.husky/pre-commit`. Committing with
`git -c core.hooksPath=.husky` therefore points git at the wrong directory, and
its warning names the wrong cause: "the '.husky/pre-commit' hook was ignored
because it's not set as executable" reads like a permission to fix, when the
file is meant to be non-executable and the wiring was correct until the
override. The commit goes through with no formatting or lint run, and the next
signal is CI's `check` job several minutes later. Do not pass `core.hooksPath`;
if a hook has to be skipped, `--no-verify` says so honestly.

## 1x — The audit gate reports advisory counts without naming them

`bun scripts/audit-check.ts` opens with "production dependencies — 9 package(s),
17 advisory(ies)" and "build and test toolchain — 1 package(s), 2 advisory(ies)",
and then names only what fails the run. For the scope that is _reported and never
fails_, that leaves a number nobody can act on: finding out that one of the 17 is
GHSA-p2fr-6hmx-4528 in `@better-auth/oauth-provider` took a separate `bun audit
--json` and a Python one-liner. The report should name package, severity and
GHSA for everything it counted — that is the whole value of the reported-only
scope, and right now the scope exists without its payload.

## 1x — v8 coverage reports are not comparable across shards by statement id

Merging the four CI shards' `coverage-final.json` by statement id looked
obviously right and is wrong. For the same commit and the same source, the v8
provider does not always emit a statement for a module's first import — and when
it skips one, every id after it shifts, so id 1 is line 28 in one shard's report
and line 29 in another's. Adding counts up by id then credits one line's
executions to a statement on a different line.

Measured over the four shards of run 33892255803: 2 of 2632 files disagreed,
both of them on line 1, and both times the contested statement was an import
that had obviously run. Small enough to miss in a fixture, certain enough to
appear on a real run — the first CI run of the diff-coverage gate failed on it.

Anything that merges these reports has to key on **lines**, not statements: a
line is executable when some shard lists a statement starting on it, and covered
when some shard's count for it is above zero. The `statementMap` is a per-run
artefact; the line number is the only coordinate every shard agrees on.

Related: a coverage report read outside the checkout that produced it (CI
artifacts downloaded onto a laptop) has absolute paths that match nothing, so
every touched file lands "out of scope" and the gate prints a pass. Both
failures now fail loudly instead — `scripts/__tests__/diff-coverage-gate.test.ts`.

## 1x — `gh` in this checkout talks to the upstream repository, not ours

`gh repo view` here reports `QuackbackIO/quackback`, because the `upstream`
remote exists and gh resolves it first. So `gh pr create` failed with
`No commits between main and <branch>` — which reads like a git problem and is
not one: it was opening the pull request against upstream, where our branch
does not exist. Every `gh` call needs `--repo theRealBithive/quackback`, or one
`gh repo set-default theRealBithive/quackback` per clone, which is what was
done. Worth knowing before the first `gh` command in a fresh clone, because the
error message points away from the cause.

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

# Resolved

## 1x — Declaring a file in the mutation manifest is a claim, and it can cost an afternoon to find out it is false

Adding an entry to `scripts/mutation-manifest.json` asserts that the named
suites, on their own, pin that file's behaviour. The word "asserts" is doing
real work: on a file that was already in the repository, the claim is usually
**not** true, and there is no cheap way to find out except running the gate.

Measured while touching two GitLab files with one field each.
`gitlab/server/inbound.ts` came back with 21 survivors — all but one in guards
nobody had ever pinned (an issue hook naming no issue, a note whose text is not
text, an absent author, both 401 bodies). Closing them was worth doing and took
about a dozen small tests, because the file is pure parsing. Then
`gitlab/server/hook.ts` came back with **60**: 15 survivors and 45 never
executed, across outbound error handling the change had not touched. That one
was backed out — the entry would have been a false claim, and the gate's
designed answer for an unpinned file is to name it as ungraded.

So: the size of the claim has nothing to do with the size of the diff. Before
declaring a pre-existing file, run the gate with the entry added and read the
number before committing to it. A pure module is usually a dozen tests away
from honest; a module that does I/O in its branches is a work item of its own.

Two smaller traps found on the way:

- `NoCoverage` mutants mean the entry names too few suites, not that the code is
  untested. `inbound.ts` had 18 of them purely because `verifySignature` lives
  in that file and is tested from `signature-matrix.test.ts` two directories
  away. The fix is a second entry in `suites`, not more tests.
- Editing the manifest with a blind string replace puts the new record in
  `equivalents` as well as `graded`, because the same `"file":` line matches in
  both arrays. The gate refuses to run at all and says an equivalence record
  needs a `why` — which reads like a missing reason rather than a record that
  should not exist. Edit that file as JSON, not as text.

## 1x — A Stryker run leaves two things behind that nothing else guards

Both surfaced within an hour of the mutation gate going green, and neither is
about mutation scores.

**A crashed run leaves a sandbox, and vitest collected it.** Stryker copies the
whole checkout into `.mutation-tmp/stryker/sandbox-XXXXXX/` and applies one
mutant to the copy. `.mutation-tmp/` is gitignored, which is not the same as
being outside vitest's `include` — so after a run that crashed, a plain
`bun x vitest run <suite>` collected the suite twice and reported four failures
from a file that had already been restored on disk. The failing paths name the
sandbox, which is the only clue, and it reads like a stale cache. CI never sees
it (one checkout per job); a laptop does.

**Closed** by `'**/.mutation-tmp/**'` in the root config's `test.exclude`,
asserted in full by `scripts/__tests__/coverage-scope.test.ts`.

**Stryker's tsconfig rewrite depends on the runner's Node build.** The gate
passed on one commit and failed on the next, same tree, with
`TypeError: ts.parseConfigFileTextToJson is not a function` inside
`TSConfigPreprocessor.rewriteTSConfigFile`. That function does
`const { default: ts } = await import('typescript')` — CommonJS interop, whose
named and default bindings a Node patch release can change. The two runners
differed in exactly that: Node v22.23.1 passed, v22.23.2 failed. Nothing in
`ci.yml` pins Node, because the workflow installs bun and Stryker's bin then
runs under whatever `node` the runner image ships.

**Closed** by not needing that code path: `strykerConfigFor` points
`tsconfigFile` at a file that does not exist, so the rewrite is skipped. It
exists for `extends` and `references` paths that fall outside the sandbox, and
here every tsconfig extends a path inside the repository while the root one —
the only file Stryker would have touched — extends nothing at all.

Still open, and worth knowing before it bites elsewhere: **the Node version in
CI is not controlled.** Every job that runs a tool with a `#!/usr/bin/env node`
shebang gets the runner image's Node, which drifts between images inside a
single workflow run. Pinning it needs `actions/setup-node` in each such job.

## 3x — Coverage had to be re-installed for every measurement

The tooling for non-trivial logic is half-present. `fast-check` is a
devDependency and is used by a handful of suites; a mutation runner was missing,
so every mutation number in this repo up to the audit-gate change was produced by
a throwaway script that applies mutants textually one at a time and re-runs the
suite by hand.

Second run: the infrastructure gate on the DB fixture needed 25 mutants written
out by hand to find the four that mattered (three unasserted lines of the
remediation message, and — the one that counted — no end-to-end test that an
unreachable database _without_ `REQUIRE_TEST_DB` still skips instead of throwing,
which is the regression that would have turned every laptop run red). A real
runner would have listed those in one command instead of one bespoke script per
change. Coverage has the same shape: `@vitest/coverage-v8` has to be installed
transiently and `package.json`/`bun.lock` restored afterwards, every time.

Third run closed the mutation half — Stryker landed with the dependency-audit
gate — and left the coverage half exactly as it was. `@vitest/coverage-v8` still
has to be added, used, and then unpicked from `package.json` and `bun.lock`
before anything can be committed, and the whole-file percentage it prints is not
the number the discipline asks for: the lines a change touches have to be
intersected with the JSON reporter's uncovered list by hand. Installing it as a
devDependency the way Stryker now is would remove one install, one restore and
one chance to commit a stray manifest per change.

**Closed** by the diff-coverage gate: `@vitest/coverage-v8` is a devDependency,
the scope lives in `vitest.config.ts`, and `scripts/diff-coverage-check.ts`
does the intersection with the diff that used to be done by hand. Three runs
paid for it.
