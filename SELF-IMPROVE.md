# SELF-IMPROVE

Gotchas from concrete runs of work in this repo. One counter per entry; bump it
when the same thing bites again and re-sort the list by counter, descending.

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
that run it showed `12 skipped`, which reads easily as success. A
`docker compose -f compose.test.yml up -d` plus a note in the output when a suite was skipped
for lack of a DB would settle both.

## 1x — No property-test and mutation infrastructure

The tooling is missing for non-trivial logic (here: parsing foreign webhook payloads).
`fast-check` was added as a devDependency during that run; a mutation runner (Stryker) is
still missing, and the mutants had to be applied by hand with a throwaway script. As long as
that stays the case, the mutation number in every report is hand-made and not reproducible.
