# SELF-IMPROVE

Gotchas from concrete runs of work in this repo. One counter per entry; bump it
when the same thing bites again and re-sort the list by counter, descending.
Entries that have actually been fixed move to **Resolved** at the end, with what
fixed them — they are the record of what the counters bought.

## 5x — Stryker runs the whole suite first, and scores a crashed suite as a survivor

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

Fifth run, and the discipline held only because the entry exists. A new service
module opened with

```ts
const isAssignedToSomeBoard = sql`EXISTS (SELECT 1 FROM ...)`
```

at **module scope**, which is not a fixture in a `describe` body but has the
same effect: every suite importing that module builds the fragment at import
time, so a mutant inside it crashes collection and reads as `Survived`. The
tell is the same — the mutant looks like deep logic, the suite reports no
tests. Moving it into `function assignedToSomeBoard(): SQL` fixed it. Worth
generalising from "build fixtures inside the test" to **no call into anything
mutable at module scope**, template tags included: a `sql` tagged template does
not look like a call, and is one.

## 5x — Local `typecheck` reports hundreds of pre-existing errors

`bun run typecheck` yields around 820 `error TS` on a **clean** tree, almost all in
`apps/web/src/routes/**`, because the generated route types are not built locally. Whether
your own change added an error can only be established by stashing, counting the errors,
restoring and counting again.

Stashing is the wrong tool when a long background job is reading the working tree, and it
answers a coarser question than the one you have. Grepping the error list for the files
the change touches is exact and costs one run:

```bash
bun run typecheck 2>&1 | grep -E "error TS" > /tmp/tc.txt
git diff --name-only <base>...HEAD | sed 's|^apps/web/||' \
  | while read -r f; do grep -F "$f" /tmp/tc.txt; done
```

It is also worth running even when nothing looks type-shaped: it is what caught a test
mocking `getValidAccessToken` as resolving `null`, where the source returns `''` and never
a null. The mock typechecked as an error and the test asserted a state the source cannot
produce — no suite and no mutation run would have said so.

Either pull the codegen step into the `typecheck` script or document which command has to
run first.

Third occurrence, with a twist that wastes a five-minute run: **the count is
for the `apps/web` project**. `bun x tsc --noEmit -p tsconfig.json` from the repository
root type-checks a different project and reports **36823** errors, which reads
as though the change broke the build. Both numbers are baselines; only the
`apps/web` one is the one to compare against. Run it from `apps/web`, and
remember the Bash tool keeps its working directory between calls, so a `cd`
three commands ago is why the count changed.

Fourth occurrence, and the number itself is the trap: this entry said 815, the
clean tree now says 820, and five unexplained errors is exactly the shape of
"your change broke something". **Measure the baseline, never read it from
here** — the count drifts with every upstream sync, so a written-down figure
ages into a false alarm. The grep-by-touched-file recipe above does not have
this problem, which is the argument for using it instead of counting at all.

Fifth occurrence, caused by that fourth note. It recorded "815 then, 820 now" as
evidence that the baseline drifts — but the 820 was counted on a tree that
already carried the change under test, and five of those errors were the
change's own: a test file rendering a component that had just been given two new
required props. The tree reads 815 again with them fixed. So the note that
warned against reading a number from here supplied a new one, measured wrong,
and a report went out saying "820, zero added" when the true answer was five
added. **A total means nothing unless the tree is genuinely clean, and a branch
with commits on it never is.** CI's `bun run --filter @quackback/web typecheck`
names all five by file and line in seventy seconds and is the only cheap
authority; locally, use the grep-by-touched-file recipe, which cannot be fooled
this way. The figures in this entry are a record of how far the number moves —
not something to compare against.

**One more thing the recipe above could not have caught**, measured on that
fifth occurrence: the file that failed to compile was
`changelog-segment-picker.test.tsx`, and it was **not in the change's diff** — the
change added two required props to a component, and what broke was a _consumer_
nobody had opened. Grepping the error list for touched files is blind to exactly
the most common way a type error appears. There was no local check that would
have found it.

**Closed** by generating the route tree before typechecking.
`apps/web/scripts/generate-route-tree.ts` resolves Vite's config, which is when
the TanStack Start plugin writes `src/routeTree.gen.ts` — 2.8 seconds, and
byte-identical to what the 55-second `bun run build` writes, verified by diff.
Both `typecheck` scripts run it first, so a clean tree now reports **0 errors**
instead of 815, and any error is the change's own. No baseline, no stashing, no
counting, and the grep recipe is no longer needed for anything.

Two details are load-bearing and are commented in the script: resolving the
config leaves plugin watchers open, so it has to `process.exit(0)` explicitly or
it hangs with the work already done (measured: still sitting there at 90
seconds); and the script fails loudly if no file appeared, because a silent
no-op would quietly restore the number. CI cannot catch that rot on its own —
the `check` job builds before it typechecks, and the build writes the same file
— which is what `apps/web/scripts/__tests__/generate-route-tree.test.ts` is for.

## 4x — Test suites are flaky under parallel load

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

Hit a third time, and this one is not a DB suite at all:
`lib/client/mutations/__tests__/settings.test.ts` times out (`Test timed out in
20000ms`) whenever it runs inside a wider selection, and passes alone. The reason
is visible once measured: alone it needs 16.7s of test time against the 20s
`testTimeout` in `vitest.config.ts`, so it has 3s of headroom and any contention
eats it. It cost two full runs plus a stash-and-compare to prove it was not the
change under test — the same twin-measurement tax as above, now for a suite that
touches no database. A suite that close to the timeout is a failure waiting for a
busy machine; the fix is to find what takes 16s in there, not to raise the limit.

Hit a fourth time, in the one run a final report actually rests on: the whole
suite, 1429 files. `settings.test.ts` timed out again and took
`policy/module-state/__tests__/module-state.test.ts` with it — that suite walks
the source tree, needed 32s under the load of a full run, and lives under the
same 20s ceiling. Both pass in seconds when the two of them run alone. So a full
local run now ends with three red lines none of which mean anything until a
control run has been done, and two of the three are known by name. Either pin a
per-suite `testTimeout` for these two or make the scanner cache its walk; the
alternative is that every full run ends in a diagnosis.

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

## 3x — The mutation manifest is all-or-nothing per file, so one upstream line can lock a file out

An entry declares a whole file, and the gate fails on any survivor in it. A change that
adds three lines to an upstream file therefore has to pin **every** branch that file
already had, including ones its own diff never touched.

Measured on `post.board.ts`: declaring it produced nine survivors. Six were real and are
now killed — one of them, `db.query.posts.findFirst({ where: ... })` losing its `where`,
is the same class of bug as an integration lookup returning _an_ integration instead of
_the_ one. Two more sit on branches a foreign key and an open transaction make
unreachable, so no input reaches them. The last is `db.query.boards.findFirst({ where: ...
})` for the board the post came _from_: dropping the `where` returns a different board and
really does change the payload, but which row an unordered query hands back is not
something a test may rely on, and the board is fetched for its `name`, so the lookup
cannot be removed either. It is upstream code the change did not touch.

That one mutant blocks the entry for the whole file, because declaring it would assert
"these suites hold this file" — and they do not. So the file goes back to being reported
by name as ungraded, and six verified kills sit in the suite without the gate knowing.

**A per-file `except` list, addressed by line text the way `equivalents` already is, would
let a change declare the part it owns** and leave the untouched remainder named in the
report. Without it the incentive runs the wrong way: the cheapest way to keep a gate green
is to not declare the file, which is the outcome the manifest exists to prevent.

The tests stay either way — writing them turned up two existing tests that never entered
the branch they named (see the entry below on hand-typed TypeIDs).

Second occurrence, on the work item URL fix. Declaring `url.ts` — one changed
line, a regex — meant asserting that its suite pins the **whole** file, including
`normalizeGitLabInstanceUrl`, which the change never touched. Nine mutants
survived the first run and eight of them were in that pre-existing half. Eight
were worth killing anyway, but the ninth forced a contract decision (`http://`
as an instance address) that had nothing to do with the change and could not be
deferred, because the gate is per file and there is no way to say "grade the
line I touched".

The shape that would help is unchanged: a per-file `except` list, or scoping an
entry to a diff range. Until then, declaring a file with pre-existing untested
neighbours is a decision to be made deliberately, not a formality.

Third occurrence, on the GitLab token renewal — and this one found a way around
it worth repeating. Declaring the two files the change touched produced **48**
survivors, 41 of them in halves the change never opened: `oauth.ts` carries an
authorization-URL builder and a code exchange, and `token-refresh.ts` carries a
`db.query.integrations.findFirst({ where })` whose unfiltered mutant is the same
undeterminable case as `post.board.ts` above.

So the new function moved into its own module, `gitlab/server/token-renewal.ts`,
which the new suite pins on its own: 22 mutants, 22 killed, and the two
pre-existing files reported by name as ungraded. **Putting new logic in a new
file is currently the only way to have it mutation-graded without adopting its
neighbours**, and it is worth doing deliberately for that reason alone — not
only when the module boundary is independently justified. Jira's
`server/token.ts` is the same shape, probably for the same reason.

The seven survivors that remained were all real: nothing asserted the request
was a POST, nothing passed `credentials: undefined` — which is what the
framework actually passes when no platform credentials are stored
(`credentials ?? undefined`), so the optional chaining that mutant removed is
load-bearing rather than defensive.

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

## 2x — Two lists that must agree conflict on every merge in a stack

`scripts/mutation-manifest.json` and the `toEqual` in
`scripts/__tests__/mutation-scope.test.ts` are the same list written twice, by
design — the test is the counterweight that stops the manifest shrinking
quietly. Every branch appends to both, so **every** merge in a stack conflicts in
both files, three times in one afternoon here.

The conflicts are not hard, but they are hand-work in JSON where a wrong brace
is a parse error, and a generic "take both sides" resolver corrupted the file
once: the hunks are not uniform. Sometimes one side is empty and the union has to
preserve the `},{` separators, sometimes both sides carry them already. Resolve
these two by reading the hunk, not by a rule, and re-run
`mutation-scope.test.ts` immediately — it fails loudly on a list that no longer
matches, which is the fastest check that the resolution was right.

Worth considering: assert the manifest as an unordered set of entries rather
than an ordered array. Order carries no meaning, and an order-free assertion
would let git merge appended entries without conflict.

Second time, and it is not only those two files: **this one** conflicts on every
merge in a stack for the same reason, because every branch appends an entry to
it. Here the bad resolution was quieter than a parse error — one entry ended up
in the file **twice, verbatim**, and a duplicated section looks exactly like a
section. It was found by reading, not by a check. When resolving a conflict in
an append-only document, count the headings afterwards.

## 2x — The coverage config lives in the root config, so a run from apps/web measures nothing

`vitest.config.ts` at the repo root carries the `coverage` block;
`apps/web/vitest.config.ts` does not. Run the documented coverage command from
`apps/web` — the natural place, since that is where the suites are — and vitest
writes **no report at all**, with no error.

`scripts/diff-coverage-check.ts` then reads every `coverage-final.json` under
`coverage/`, finds the one a _previous_ run left there, and grades the diff
against it. The output is entirely plausible: a file count, a line count, and a
list of "added lines that no test executed" — which are simply every line
added since that stale report was written. Two cycles went into chasing those
as real holes.

Two things would have caught it: the report's own age, and the fact that new
source files appeared under "out of scope, although they look like source" —
a file the run had definitely executed cannot be out of scope. The second one
is the tell worth remembering.

The invocation that works, from the repo **root**, with `apps/web/` on the
paths:

```bash
rm -rf coverage/local   # a stale report is graded silently
bun x vitest run --coverage.enabled --coverage.reporter=json \
  --coverage.reportsDirectory=coverage/local apps/web/src/<the suites>
```

Worth fixing in the gate rather than in memory: refuse a report older than the
newest file it is being asked to grade.

Second run, and it does not need a stale report to mislead. With `coverage/`
cleared first, the run from `apps/web` writes a report that is real but
measured under `apps/web/vitest.config.ts`, whose coverage block does not
exist — so the gate graded a brand-new source file as **out of scope** and
called seven added lines in two edited files never executed, all of which that
same run had just run. Re-running the identical suites from the repo root
turned that into `12 executed, 0 never executed`. The tell held: a file the run
definitely executed was listed under "out of scope, although they look like
source". Read that line before reading the holes.

## 2x — A full local run ends red on a test this machine cannot run, and that costs the coverage report

`lib/server/email/__tests__/sns-signature.test.ts` fails on Fedora with
`error:03000098:digital envelope routines::invalid digest`. It is not the repo:
the same `createSign('RSA-SHA1')` throws in a bare `node -e` outside the
checkout, because the system OpenSSL refuses to _produce_ a SHA-1 signature
under the DEFAULT crypto policy. Verification is not blocked — measured, a
`createVerify('RSA-SHA1')` runs and returns `false` — so it is only the fixture
the test signs for itself that cannot be made here. The production path is fine
and CI signs it happily, which is why nobody had noticed.

The red line is not the cost. `coverage.reportOnFailure` defaults to **false**,
so a full run with _any_ failing test writes no `coverage-final.json` at all, and
`diff-coverage-check.ts` then reads an empty `coverage/` and grades nothing. Ten
minutes of full-suite wall clock produced no number, quietly, under a log that
opens with `Coverage enabled with v8`. Locally the flag is not optional:

```bash
bun x vitest run --coverage.enabled --coverage.reporter=json \
  --coverage.reportOnFailure=true --coverage.reportsDirectory=coverage/local
```

Two fixes, both small: sign the SignatureVersion 1 fixture once and check it in,
so the test verifies instead of signing; and put `reportOnFailure: true` in the
root config's `coverage` block, so a red suite still yields the report that says
which lines the change left uncovered — which is exactly when it is wanted.

Second run, and it cost the same ten minutes again — while measuring an
unrelated i18n change. Neither fix has been made, so the trap is intact: the
run opens with `Coverage enabled with v8`, ends `2 failed | 866 passed`, and
`diff-coverage-check.ts` then reports `FAIL: the diff-coverage gate graded
nothing` — a message about _its_ inputs, which reads as a problem with the
change rather than with the run that fed it. Two observations worth adding.
The gate names the missing report but not the likely cause, and it is
one-line-fixable: a red suite with `reportOnFailure` off is the only way to
reach that state locally, so the message should say so. And the failure is
environmental rather than repo-specific, which means it hits every Fedora
checkout on the first full local run and every one after it, until the fixture
is checked in. The fixture fix is the cheaper of the two and retires the entry
outright; `reportOnFailure: true` only makes the loss visible.

## 1x — A migration passes every local gate and fails CI on schema drift

`bun run db:check-drift` is a CI step (inside the `test` shard, not `check`), and
nothing in the local workflow points at it. It recreates a scratch database from
the migrations and diffs it against the TS schema, and it caught something no
test could: drizzle-kit reported

```
ALTER TABLE "changelog_entry_boards" DROP CONSTRAINT "changelog_entry_boards_pk";
ALTER TABLE "changelog_entry_boards" ADD CONSTRAINT "changelog_entry_boards_pk"
  PRIMARY KEY("board_id","changelog_entry_id");
```

— a drop and recreate of a constraint that is **already exactly that**. Postgres
agreed with both sides: `pg_get_constraintdef` read back
`PRIMARY KEY (board_id, changelog_entry_id)` under that name, and the TS schema
declared the same name and the same order.

The cause is that the composite key led with `board_id` while the table declared
`changelog_entry_id` first. drizzle-kit compares a composite key against the
table's **attribute order**, so a key deliberately ordered for the index it
should serve reads as a difference. The link table it was modelled on does not
trip this only because its key happens to match its column order. Fix: declare
the columns in key order — the comment on the schema now says why, because it
looks like cosmetics and is not.

Two things worth doing: run `bun run db:check-drift` locally whenever a
migration is added (it takes about a minute and needs only `DATABASE_URL`), and
say so in CLAUDE.md's Migrations section next to the two tests that go red on
purpose — the gate that fails here is silent until CI.

## 1x — Hand-rolled `db` stubs break on a query they never mentioned, and a drizzle `SQL` cannot be printed

Two halves of the same problem: what a test does when it has to look at a query
instead of at a result.

Adding one `db.select()` to a shared read path — the products lookup in
`getChangelogById` — broke three suites that had never heard of products.
`mockReturnValueOnce` chains are positional, so a new query inserted _before_ an
existing one silently hands every later call the wrong stub; and a stub chain
that stops at `.where()` throws `orderBy is not a function` the moment a clause
is added. Both failures name a method, never the call site, and neither is
about the code under test. Two defences, both cheap and both applied here:
make the chain awaitable at any depth (`chain.then = …` returning `[]`), so an
added clause degrades to an empty result instead of a crash; and prefer
splitting a query into its own service function over threading another
`mockReturnValueOnce` through, so ordering stops being load-bearing.

The other half: to assert that a predicate reached the query at all, the test
has to read the `SQL` object the mock captured. `JSON.stringify` throws
`Converting circular structure to JSON` — drizzle's `SQL` holds table objects
that point back. `new PgDialect().sqlToQuery(condition)` renders it to
`{ sql, params }`, with one catch that costs a run: rendering maps parameters
through their column, so a readable stand-in id (`'board_alpha'`) fails inside
typeid's parser with `Invalid length. Suffix should have 26 characters`. Test
ids have to be real (`generateId('board')`), and they arrive in `params` as
UUIDs, so compare against `toUuid(id)` rather than the typeid.

This is worth an assertion helper next to the db fixture rather than a note:
`renderedWhere(mock)` returning `{ sql, params }` would have saved both runs.
It also matters beyond convenience — a suite that only checks _which filter was
resolved_ passes when the filter is never pushed into the WHERE clause, which
is a survivor the mutation gate pays twenty minutes to find.

A third variant, for when the assertion is "no query was issued at all":
`testDb` is a **Proxy** onto the active transaction, so `vi.spyOn(testDb,
'select')` fails with `The property "select" is not defined on the object`, and
so does spying on its prototype. There is no way to count queries through the
fixture; that assertion needs its own small suite with a counting stub, which
then has to be added to that file's `suites` list in the mutation manifest.

One last thing that reads as a pass: `bun scripts/mutation-check.ts | tail -60`
reports **tail's** exit code. The gate printed `FAIL: 5 mutant(s) ... not
caught` and the shell said `exited with code 0`. Redirect to a file and read it
instead of piping, or the one signal CI acts on is the one you discard.

## 1x — The coverage and mutation gates read HEAD, not the working tree

Both gates ask git for the diff between the merge base and `HEAD`
(`git diff -U0 <merge-base> HEAD` in `scripts/mutation-check.ts`, the same in
`diff-coverage-check.ts`). So running either one over uncommitted work does not
grade that work: it grades the previous commit and reports a confident PASS.

That is exactly how it reads on screen. The run said `3 file(s), 80 line(s) — 12
executed, 0 never executed` and `PASS: every line this change added was executed
by a test` — while the new module, its suite and the component it rewired were
all still unstaged. Nothing in the output says "your change is not in this
measurement", because from the gate's point of view there is no change.

The cost is a wasted 60-second coverage run and, worse, a moment of believing an
untested file was covered. Committing first turned the same command into
`5 file(s), 209 line(s) — 57 executed, 1 never executed` and named the line.

Either would fix it: have both gates refuse to run with a dirty tree, or have
them diff the working tree (`git diff <merge-base>` without `HEAD`) and say which
of the two they did in the line they already print about the merge base.

## 1x — A cache key nested under another's prefix, with six copies of the patch that reads it

`inboxKeys.facetCounts()` was deliberately nested under `inboxKeys.lists()`
(`['inbox','list','facet-counts',filters]`) so that invalidating the lists also
refreshes the filter counts. That is sound for `invalidateQueries`, which only
marks entries stale. It is a trap for `setQueriesData`, which matches the same
prefix and hands the _counts_ payload to an updater written for an infinite
list. The updater did `old.pages.map(...)`, a counts payload has no `pages`,
and the throw landed inside `onMutate` — which aborts the mutation before
`mutationFn` runs. Every metadata control in the feedback detail sidebar
failed, and the change was never sent rather than merely mis-displayed.

Two structural facts let it live in production for months. The
`setQueriesData<InfiniteData<…>>` type parameter is an assertion, not a check:
TypeScript agrees the value is a list because the call said so. And the same
unguarded `old.pages.map` was copy-pasted **four** times across `posts.ts` and
`comments.ts`, so nothing pointed at one place to fix.

Five further copies live in `portal-posts.ts` and `users.ts` under
`publicPostsKeys.lists()`. They are correct **today** only because nothing has
been nested under that prefix yet — the same kind of commit that gave the inbox
counts a shared prefix would break them.
`apps/web/src/lib/client/mutations/inbox-list-cache.ts` is what the inbox now
goes through; the portal ones should follow before someone nests a sibling
there too.

The rule that generalises: an updater reached through a key _prefix_ has to
check the shape it was handed. Only an updater addressed by a full key may
assume one.

## 1x — An un-awaited `fc.assert` passes having asserted nothing

`fc.assert(fc.asyncProperty(...))` returns a promise. Without `await`, the test
function returns before a single case runs, vitest sees no rejection, and the
property reports green — over zero examples. It is indistinguishable from a
property that genuinely holds, and it fails in the reassuring direction: the
stronger the property, the more confidence the empty pass buys.

Caught here only because the property was written **before** the fix and was
therefore expected to be red. It was green, which is the only reason anyone
looked. Written after the implementation, as most properties are, it would have
been a permanently green test proving nothing, and the mutation gate would not
have flagged it either — a property that runs no case kills no mutant, but the
mutants it should have killed were being killed by the example-based tests
beside it.

`fc.assert` over a synchronous `fc.property` needs no `await`, so the two spellings
sit side by side in the same file and look alike. Rule of thumb: `asyncProperty`
always with `await`, and a new property is worth proving red once before trusting
it green.

## 1x — There are two DB test fixtures, and the wrong one is the one that gets copied

Three new database suites here were written against
`lib/server/jobs/__tests__/harness.ts`, because the nearest existing example in
the same directory (`events/__tests__/process-integration.test.ts`) uses it.
That harness is for **lease** suites only: a lease exists so work can outlive
the transaction that claimed it, so those suites commit for real, open four
connections each, and clean up with `DELETE ... WHERE` on a database every
worktree on the machine shares.

The right tool for everything else is `lib/server/__tests__/db-test-fixture.ts`
— one connection, a transaction rolled back after every test, and a `probe` that
skips the suite on a stale schema instead of failing it mid-test. There is a
README beside it that says exactly this. It was not found, because the search
started from a neighbouring test file rather than from the directory that owns
the fixture.

Cost: three suites written twice, plus a stretch of chasing 10-second hook
timeouts in unrelated portal suites on the suspicion that the extra connections
had caused them. (They had not — `apps/web/src/lib/server/functions` produces
between one and three of those on `origin/main` too, measured over two runs.)

What would have prevented it: the harness's own header says it is for lease
suites, but nothing says where to go instead. One line in it pointing at
`db-test-fixture.ts` and its README would have been enough.

## 1x — Merging a stacked PR with `--delete-branch` closes the one above it, irrecoverably

Four PRs stacked A -> B -> C -> D, each based on the one below. Merging A with
`gh pr merge --squash --delete-branch` deleted its head branch, which was B's
**base**. GitHub did not retarget B; it **closed** it. And a pull request whose
base branch no longer exists cannot be reopened or retargeted:

```
GraphQL: Could not open the pull request. (reopenPullRequest)
GraphQL: Cannot change the base branch of a closed pull request. (updatePullRequest)
```

The branch and its commits are untouched, so nothing is lost but the thread —
the review history, the body, the discussion. The repair is a new PR from the
same head branch, cross-linked in both directions, which is exactly the noise a
stack is supposed to avoid.

The order that works: merge without `--delete-branch`, retarget the PR above to
`main` while its base still exists, then delete the branch. Or retarget every PR
in the stack to `main` up front and accept that each diff temporarily contains
the ones below it.

## 1x — A hand-typed TypeID fails the parser, and `.rejects.toThrow()` reads that as success

`changeBoard('post_01jqzz000000000000000000', ...)` does not reach the not-found branch: the
suffix is 24 characters, the TypeID parser wants 26, and it throws `Invalid length` long
before the lookup. Two tests named `raises nothing when the post does not exist` and
`raises nothing when the target board does not exist` were asserting a bare
`.rejects.toThrow()`, so both passed on the parser's complaint and neither had ever
executed the code they were named for.

Use `generateId('post')` from `@quackback/ids` for an id that is well-formed and absent,
and assert the id itself is in the message (`.rejects.toThrow(missingPost)`) rather than
that something threw. A bare `toThrow()` in a suite that constructs ids by hand should be
read as untested until proven otherwise.

## 1x — A mutation survivor is reported by line, and a line can hold several mutants

The gate's summary lists survivors as `file.ts:54 ObjectLiteral -> {}`. On a line that
holds more than one mutable sub-expression that does not say which one, and the two
readings lead to opposite conclusions. Both of these cost a mutate-run-restore cycle in
one session:

- `issue-move.ts:54` reads as a type assertion (`{ instanceUrl?: string }`, erased at
  runtime and therefore genuinely equivalent). It was the argument to
  `db.query.integrations.findFirst({ where: ... })` — a real gap, where dropping the
  `where` returns _an_ integration instead of _the_ one.
- `issue-move.resolver.ts:47` reads as the ternary on the next line. It was the arrow
  body inside `.find((r) => r.boardId === boardId)` on line 47 itself.

The column is in the detail section further up the report, but the summary is what you act
on, and reading the source line at that number is the natural next move — which is exactly
what misleads. **Print the trimmed source line beside each survivor**, the way an
`equivalents` record already addresses its line by text. It costs one `readFileSync` in
`mutation-policy.ts` and removes the ambiguity at the point of use.

Until then: never mutate from the summary alone. Take the `file:line:col` out of the
detail block, and confirm the mutant by applying it by hand and watching the suite go red.

## 1x — postgres.js encodes a JSON _string_ parameter into jsonb a second time

Seeding an `integrations` row for a migration-replay test, this looked obvious:

```ts
sql.unsafe(`INSERT INTO integrations (..., config) VALUES ($1, ..., $2::jsonb)`, [
  id,
  JSON.stringify({ channelId: '101' }),
])
```

What lands in the column is `"{\"channelId\":\"101\"}"` — `jsonb_typeof` says
`string`, not `object`, so `config ->> 'channelId'` is **null**. The driver
JSON-encodes the value it is given, and the value it was given was already JSON.
Nothing errors: the insert succeeds, the row is there, and only the `->>` comes
back empty.

The failure surfaces a long way from the cause. Here the migration under test
matched no row, the test went red on the wrong assertion, and the first
hypothesis was that the migration's `DO` block had not executed at all — psql ran
the same file correctly, which pointed at the execution path rather than at the
seed. It cost a debug script to see `jsonb_typeof = string`.

Pass the object (`[{ channelId: '101' }]`) and let the driver encode it once, or
write the literal into the SQL, which is what the test does now — a constant does
not need a placeholder, and the literal is the version that reads correctly at a
glance. Worth checking wherever a test seeds a jsonb column, because the wrong
version is silent and looks right.

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

## 1x — `en.json` is generated, stale, and nothing compares it to the source

Measured on 2026-09-06 while building the shared intl render helper. `en.json`
is not hand-written: `bun run intl:extract` regenerates it from every
`defaultMessage` under `src/**`. It has not been re-run in a while, and three
numbers fall out of comparing the two:

|                                                | Count     |                                                               |
| ---------------------------------------------- | --------- | ------------------------------------------------------------- |
| ids in the source with **no** catalogue entry  | **95**    | render `defaultMessage`; untranslatable in all nine languages |
| catalogue ids with no literal source reference | 243       | partly dynamic ids, partly dead keys — paid for nine times    |
| shared ids whose **text differs**              | 27 of 947 | the catalogue is behind the source                            |

At runtime the catalogue wins: `loadMessages` imports `en.json`, and an entry
that exists beats the `defaultMessage` beside it. So for those 27 the product
shows the older wording — mostly typography (`...` against an ellipsis,
straight against curly quotes), but three are different sentences.

No existing test can see any of this, and the reason is worth knowing before
trusting the suite: `locale-parity.test.ts` compares the nine catalogues **to
each other**, so an id missing from all nine is perfect parity. The
`*-message-coverage` tests check that a used id falls under an allowed prefix,
not that it is defined anywhere. The gap between those two is exactly where
the 95 live.

The mechanics of measuring it cost a run, twice over. `formatjs extract` takes
`--flatten` and ignores it in this version — values come back as
`{"defaultMessage": "..."}` objects while `en.json` holds plain strings, so a
naive diff reports **947 of 947 ids as different** and looks like catastrophe
rather than a shape mismatch. And the extractor silently skips any
`<FormattedMessage>` whose `id` is not a string literal (it warns, into a wall
of other warnings), so a component building ids dynamically is invisible to it
— which is part of why 243 catalogue keys look dead when some are not.

One consequence for writing tests: a `<FormattedMessage>` with a literal `id`
**inside a test file** is extracted into the shipped catalogue, because the
glob is `src/**`. Use a variable for the id in tests.

The fix belongs in the planned i18n gate: assert that every literal id in the
source is defined in all nine catalogues, and that every catalogue key has a
source reference. Until then the 95 grow with every batch.

# Resolved

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

## 1x — The mutation gate had no database, so a third of its mutants were never run

The `mutation` job in `ci.yml` carried no Postgres service. Every DB-backed suite in the
manifest therefore skipped itself, Stryker found no test covering the code those suites
hold, and reported their mutants as `NoCoverage`: **113 of 193** on the first run that
graded a `.db.test.ts`. The gate failed on the count, which is the right outcome, but the
message reads like a test problem and it was a runner problem.

Worth knowing for the shape of the mistake, not just the fix: this exact hypothesis was
written down earlier in the same session, then **retracted as disproved** — because the
local reproduction had `DATABASE_URL` set and the run log said `Ran 47 tests`. The local
evidence was real and the conclusion was still wrong, because the two environments differ
in precisely the variable under test. A hypothesis about CI is not disproved by a local
run unless the local run reproduces CI's environment.

**Closed** by giving the job the pgvector service, `bun run db:migrate` and
`REQUIRE_TEST_DB=1` — the last so a database that is missing or behind the migrations
fails naming itself instead of reverting to the quiet skip. Documented in CLAUDE.md's
mutation section, since "the job waits for `unit`" was the only prerequisite recorded
there and it was not the only one.
