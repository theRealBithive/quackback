# Working in this repo

Fork-local conventions. Upstream has no `CLAUDE.md`, so this file never conflicts
on a sync. Concrete gotchas that cost real time are collected in
[SELF-IMPROVE.md](SELF-IMPROVE.md); this file is how to work given they exist.

## Everything that lands in the repo is written in English

We talk German. The repository does not. Every artefact that ends up on disk or
in the history is English: code, comments, identifiers, test names, commit
messages, documentation, log messages, error strings, user-facing copy, and the
notes in [SELF-IMPROVE.md](SELF-IMPROVE.md).

This is not a style preference. It is an AGPL fork of a public upstream project,
and the source is offered to the people using our instance. A patch has to be
able to go upstream without a translation pass, and anyone who reads the code —
a contributor, a future colleague, whoever picks this up after us — must not
need German to follow it.

Chat stays German whenever that is the language of the conversation. The
boundary is the file, not the topic: the moment something is written into the
repo, it is English.

## Tests come before the code, and the contract comes before the tests

For anything non-trivial — branches, arithmetic, money, dates, state transitions,
permissions, parsing, concurrency — the order is:

1. **Write the guarantees as a numbered list in domain language, no code** (`V1`,
   `V2`, …). Derive them from what the software must promise, not from what the
   code currently does. A property read off the implementation can never fail: it
   freezes the bug and the green suite hides it.
   - Right: "V3 A workspace that explicitly held the page back stays dark."
   - Wrong: "V3 In the else branch `enabled` is false."
2. **Show the list and wait for confirmation.** This is the one blocking step and
   the cheap one — it is prose, nothing is built yet.
3. Put the confirmed list **verbatim into the test module header**. Every test
   names its number (`(V3)`). A test with no number was probably read off the
   code; a number with no test is a gap.
4. Prove the tests **red for the right reason**, then implement.

A skipped suite is not a passing suite. The DB fixture skips itself when the
schema is stale (see below), and `12 skipped` reads like success in a terminal.

## Never soften a failing test

Red is a finding. Forbidden: narrowing generators to exclude the counterexample,
lowering example counts, `skip`/`xfail`, widening tolerances, pinning the failing
case as a fixed example. Exactly three allowed reactions: fix the production
code; correct the property if it stated the contract wrongly, saying why in the
docstring; or document it as accepted behaviour and ask.

A restriction that follows from the contract _before_ the first run is
specification. The same restriction _after_ a red run is a cover-up.

Watch for the quiet version: an `if` inside a test that skips exactly the branch
where the implementation differs. Every branched calculation needs at least one
**unguarded** assertion — usually a conservation law that holds across all
branches.

## What "done" means

- **100% line coverage of the lines this change adds or touches** — not the repo
  total. Report the number.
- **Property tests for non-trivial logic.** `fast-check` is a devDependency.
  Prefer non-interference properties ("changing a field the parser must not read
  never changes the output") over asserting an absent substring: they are
  stronger and cannot produce spurious counterexamples.
- **A measured mutation score.** There is no mutation runner here. Until there
  is, write a throwaway script that applies mutants textually one at a time and
  runs the suite. The bar is **no unjustified survivors**, not the number 100 —
  record any equivalent mutant, and why it is equivalent, in the test module.

Two things tests do not prove, so do not claim them: a high mutation score does
not mean the code is correct (it measures whether tests notice _changes_, and a
pre-existing bug is not a mutant), and a differential test against your own
earlier version finds nothing, because both sides agree by construction.

## Measuring coverage

No coverage provider is installed. Install it transiently, measure, then restore
`package.json` and `bun.lock` so the dependency does not land in a commit:

```bash
bun add -d @vitest/coverage-v8@4.1.11
bun x vitest run --coverage.enabled --coverage.provider=v8 \
  --coverage.reporter=text --coverage.include='<the files you changed>' <suites>
```

Whole-file percentages are not the number to report. Intersect the JSON reporter's
uncovered lines with the added lines from `git diff -U0`.

## The test database

Real-DB suites need Postgres **with pgvector** — plain `postgres:16` fails deep
inside the migration with `extension "vector" is not available`:

```bash
docker run -d --name quackback-test-pg -e POSTGRES_PASSWORD=password \
  -e POSTGRES_DB=quackback_test -p 5432:5432 pgvector/pgvector:pg17
DATABASE_URL=postgresql://postgres:password@localhost:5432/quackback_test bun run db:migrate
```

Re-run the migration after adding one, or every DB-backed suite silently skips
— unless the run says it must not. CI's `unit` job sets `REQUIRE_TEST_DB=1`,
which turns an unreachable or stale database from a quiet skip into a failure
naming the database it tried and the reason. Reproducing a CI failure locally
means setting it too:

```bash
REQUIRE_TEST_DB=1 DATABASE_URL=postgresql://postgres:password@localhost:5432/quackback_test bun run test
```

Leave it unset on a laptop and the old behaviour is back: suites without a
database skip and the run stays green. The guarantees are numbered in
`apps/web/src/lib/server/__tests__/db-fixture-infra-gate.test.ts`.

The check runs in `apps/web/vitest.global-setup.ts`, once, before any test file
loads — so it covers the suites that use the fixture, the 25 that open their own
connection, and anything added later. It verifies two things: that a database
answers, and that its applied-migration count is not behind
`packages/db/drizzle/meta/_journal.json`. A database that merely lags the
migrations connects fine and turns every per-file schema probe into a skip,
which is the failure it exists for.

## Migrations

`bun run db:generate` is broken (a drizzle snapshot collision predating this
fork). Write the SQL by hand in `packages/db/drizzle/`, using `IF NOT EXISTS`
like the surrounding files, and append an entry to `drizzle/meta/_journal.json`
(`idx` +1, `when` +1, `tag` = the filename without `.sql`).

Adding a migration turns two tests red **on purpose**, so a human confirms
whether the new migration writes data:

- `fleet/__tests__/migrator-gate.test.ts` lists the post-0248 span; append the tag.
- `policy/migration-contract/__tests__/ledger.test.ts` snapshots `CONTRACT.md`;
  regenerate with `-u` and check the diff is only the scanned count. Destructive
  DDL needs a `-- @contract: safe-after X.Y.Z` comment in the migration, never an
  allowlist entry.

## Things the linter and typechecker will not tell you plainly

- `bun run typecheck` reports **~815 pre-existing errors** on a clean tree,
  because the generated route types are not built locally. To know whether you
  added one, count, `git stash`, count again.
- Job handler modules must not contain a call-time `import()`
  (`jobs/__tests__/handler-imports.test.ts`). It would load that module graph
  inside a per-pass workspace scope.
- Application code must not import `@quackback/db`. Use `@/lib/server/db` on the
  server, `@/lib/shared/db-types` on the client.

## Releases and deploys

Never deploy a moving tag. A push to `main` publishes
`ghcr.io/therealbithive/quackback:main`, which is fine to try things with and
wrong to run: a pod rescheduled overnight silently picks up a different build,
and afterwards nobody can say which source was running — which is also how AGPL
§13 quietly stops being satisfied (see [LEGAL.md](LEGAL.md)).

Cut a git tag instead. Fork builds are `vX.Y.Z-exkulpa.N`, where `X.Y.Z` is the
next upstream patch version, not the current one: semver sorts a prerelease
_before_ its version, and our build is ahead of the upstream release it is based
on, not a preview of it. Pushing the tag builds
`ghcr.io/therealbithive/quackback:X.Y.Z-exkulpa.N` and moves `:latest`.

The image tag has to be valid semver, because the workflow derives it via
`type=semver`. For a name that semver cannot express, dispatch the workflow
manually with `sha` and `image_tag` instead — that path takes any string.

## Branch protection and dependency updates

Both are repository settings, not files, so nothing in this repo can enforce
them — this section records what they are supposed to be.

**Required status checks on `main`.** Use a ruleset (Settings > Rules), not
classic branch protection, and require exactly these:

- `check` — lint, build, typecheck, manifest and widget checks.
- `test` — the aggregate job. It exists for this purpose: it asserts
  `needs.unit.result == 'success'` and therefore covers all four shards. Do not
  require the individual `test (n/4)` shards; the names break the moment the
  shard count changes.
- `e2e-smoke`.

Never require `e2e-full`. It carries `if: github.event_name == 'schedule'`, so
it never reports on a pull request and would block every one of them forever.
`live-api` is optional — it does run on pull requests, but the DB suites in that
neighbourhood are measurably flaky under parallel load.

Two settings do the actual work: **include administrators** (a rule the only
maintainer can push past is decoration) and **require branches to be up to date
before merging** (without it, a green check can predate the commit it is
protecting, which is how `REQUIRE_TEST_DB` stops binding).

**Dependency updates.** `.github/renovate.json5` is configured and inert until
the Renovate GitHub App is installed on the repository. Renovate is the choice
because Dependabot supports bun for version updates only — bun security updates
are unsupported — and because only Renovate's `lockFileMaintenance` moves
transitive dependencies, where most advisories live. The config's header
comment carries the reasoning and the one knob worth touching.

The **dependency graph is disabled** on this repository, which is the default
for a fork. Until someone enables it under Settings, there are no Dependabot
alerts, Renovate's `vulnerabilityAlerts` section is inert, and
`bun scripts/audit-check.ts` in CI is the only advisory detection we have. That
gate audits **production dependencies only** (`bun audit --production`), so an
advisory in the build toolchain is currently invisible. Widening it means
editing an upstream-owned file, which is why it has not been done.

## Licensing

This is an AGPL-3.0 fork that we run as a network service, which carries
obligations towards the people using it. [LEGAL.md](LEGAL.md) records what they
are, what we already do, and what is still open — read it before building
anything proprietary into this repository.

## Commits

Conventional commits (`fix(events):`, `feat(gitlab):`). The subject says what
changed for a user or an operator, and the body says why — including the
behaviour change someone will notice after deploying. The pre-commit hook runs
`lint-staged` and needs `bun` on `PATH`.
