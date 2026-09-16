/**
 * Migration 0280's backfill and its trigger, against real Postgres.
 *
 * The sibling checks read the SQL rather than run it. `replay-safety.test.ts`
 * classifies the file from its text, and `lineage-double-apply.db.test.ts`
 * re-applies every file the classifier calls safe and asserts the *catalogue*
 * does not move — which is the right instrument for DDL and blind to every
 * claim this migration makes, because all of them are about rows.
 *
 * And they are the load-bearing half. The column defaults to `dashboard`, so a
 * session the backfill fails to recognise keeps full team authority; the
 * classification below is the only thing standing between an existing widget
 * token and the admin surfaces. It is also the half that cannot be tested with
 * a double: the precedence between the four predicates is decided by Postgres
 * evaluating them in order against real rows.
 *
 * ## How the pre-migration state is staged
 *
 * The test database already has 0280 applied — the fixture refuses a schema
 * behind the tree — so the column and the trigger are there before a row is
 * seeded, and seeding a provenance row fires the trigger straight away. Each
 * case therefore seeds its rows and then forces `scope = 'dashboard'` on them,
 * which is exactly the state an upgrading database is in at the moment the
 * backfill runs: every row carrying the column default and nothing else.
 *
 * ## What is asserted about, and what is not
 *
 * Only the seeded ids. The statement itself is unqualified — it sweeps the
 * whole table — and running it inside the fixture's transaction means it also
 * sweeps whatever else is committed in the database it runs against. Counting
 * rows globally would make the result depend on the state of a shared test
 * database, which is the sort of assertion that passes on a laptop and fails on
 * a runner.
 *
 * Contract (from the confirmed list for this batch; the full list is in
 * functions/__tests__/auth-scope.test.ts):
 *
 *   R1  A session is stamped with the audience it was minted for: the
 *       dashboard, the embedded widget, or the customer portal.
 *   R10 Re-running the migration changes nothing. Sessions the widget
 *       identified, sessions of anonymous users, and sessions older than their
 *       user's first credential become widget sessions. Sessions with portal
 *       provenance become portal sessions. The rest stay dashboard.
 *   R11 A session an old replica minted during a rolling deploy is re-stamped
 *       as a widget session when its provenance row lands, rather than staying
 *       dashboard until the next deploy.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createId, type UserId } from '@quackback/ids'
import { MIGRATIONS_DIR } from '@quackback/db/schema-version'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import {
  account,
  inArray,
  session as sessionTable,
  sql,
  user,
  widgetIdentifiedSession,
  widgetOriginSession,
} from '@/lib/server/db'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.execute(sql`select id, scope from session limit 0`)
    await db.execute(sql`select session_id from widget_identified_session limit 0`)
    await db.execute(sql`select session_id from widget_origin_session limit 0`)
    await db.execute(sql`select id, created_at from account limit 0`)
  },
})

/**
 * The backfill, taken from the migration rather than restated here.
 *
 * A copy would be a differential test against itself: both sides would agree
 * by construction, and a wrong predicate would be wrong in both. The file is
 * split on drizzle's statement separator and the one `DO` block is the
 * backfill — the other statements are the `ALTER TABLE`, the function and the
 * trigger, which the schema already carries.
 */
function backfillStatement(): string {
  const file = readFileSync(join(MIGRATIONS_DIR, '0280_widget_session_scope.sql'), 'utf8')
  const blocks = file.split('--> statement-breakpoint').filter((s) => s.includes('DO $$'))
  if (blocks.length !== 1) {
    throw new Error(`expected exactly one DO block in 0280, found ${blocks.length}`)
  }
  return blocks[0]
}

async function runBackfill(): Promise<void> {
  await testDb.execute(sql.raw(backfillStatement()))
}

// One close for the whole file: `afterAll` inside a describe fires when that
// describe ends, which would shut the connection before the next one opens.
afterAll(fixture.close)

const HOUR = 60 * 60 * 1000

interface SeededUser {
  id: UserId
  /** When the user's first credential was written, or null when they have none. */
  accountAt: Date | null
}

async function seedUser(opts: {
  anonymous?: boolean
  accountAt?: Date | null
}): Promise<SeededUser> {
  const id = createId('user') as UserId
  await testDb.insert(user).values({
    id,
    name: 'Seed',
    email: `${id}@example.test`,
    emailVerified: true,
    isAnonymous: opts.anonymous ?? false,
    createdAt: new Date(),
    updatedAt: new Date(),
  })
  const accountAt = opts.accountAt === undefined ? new Date() : opts.accountAt
  if (accountAt) {
    await testDb.insert(account).values({
      accountId: id,
      providerId: 'credential',
      userId: id,
      createdAt: accountAt,
      updatedAt: accountAt,
    })
  }
  return { id, accountAt }
}

async function seedSession(userId: UserId, createdAt: Date): Promise<string> {
  const id = `sess_${createId('user').slice(5)}`
  await testDb.insert(sessionTable).values({
    id,
    token: id,
    userId,
    expiresAt: new Date(Date.now() + 7 * 24 * HOUR),
    createdAt,
    updatedAt: new Date(),
  })
  return id
}

async function markIdentified(sessionId: string): Promise<void> {
  await testDb.insert(widgetIdentifiedSession).values({ sessionId, hmacVerified: true })
}

async function markPortalOrigin(sessionId: string, userId: UserId): Promise<void> {
  await testDb.insert(widgetOriginSession).values({ sessionId, userId })
}

/**
 * Put every named session back on the column default.
 *
 * Seeding a provenance row fires the trigger this migration installs, so
 * without this the rows would already be marked and the backfill would be
 * asked to do nothing. This is the state an upgrading database is in.
 */
async function resetToPreMigrationState(ids: string[]): Promise<void> {
  await testDb.update(sessionTable).set({ scope: 'dashboard' }).where(inArray(sessionTable.id, ids))
}

async function scopeOf(sessionId: string): Promise<string> {
  const rows = await testDb.execute(sql`SELECT scope FROM session WHERE id = ${sessionId}`)
  return (rows as unknown as Array<{ scope: string }>)[0].scope
}

describe.skipIf(!fixture.available)(
  'what the backfill makes of the sessions it finds (R10)',
  () => {
    beforeEach(fixture.begin)
    afterEach(fixture.rollback)

    it('classifies each kind of session, and leaves a staff session alone', async () => {
      const staff = await seedUser({ accountAt: new Date(Date.now() - 48 * HOUR) })
      const visitor = await seedUser({ anonymous: true, accountAt: null })

      const dashboard = await seedSession(staff.id, new Date())
      const identified = await seedSession(staff.id, new Date())
      const anonymous = await seedSession(visitor.id, new Date())
      const beforeAnyCredential = await seedSession(staff.id, new Date(Date.now() - 72 * HOUR))
      const portal = await seedSession(staff.id, new Date())

      await markIdentified(identified)
      await markPortalOrigin(portal, staff.id)
      const all = [dashboard, identified, anonymous, beforeAnyCredential, portal]
      await resetToPreMigrationState(all)

      await runBackfill()

      expect(await scopeOf(identified)).toBe('widget')
      expect(await scopeOf(anonymous)).toBe('widget')
      expect(await scopeOf(beforeAnyCredential)).toBe('widget')
      expect(await scopeOf(portal)).toBe('portal')
      // The one that must not move: a session minted after its user had a
      // credential, with no widget provenance of any kind.
      expect(await scopeOf(dashboard)).toBe('dashboard')
    })

    it('prefers the portal audience over the widget one when a session carries both', async () => {
      // The handoff promotes a session the widget identified, so both rows exist
      // for the same session and the order of the four statements is what
      // decides. Portal is the later, narrower fact.
      const staff = await seedUser({ accountAt: new Date(Date.now() - 48 * HOUR) })
      const both = await seedSession(staff.id, new Date())

      await markIdentified(both)
      await markPortalOrigin(both, staff.id)
      await resetToPreMigrationState([both])

      await runBackfill()

      expect(await scopeOf(both)).toBe('portal')
    })

    it('leaves a session alone when its user has no credential at all', async () => {
      // `created_at < (select min(created_at) …)` is NULL when the subquery finds
      // nothing, and NULL is not true, so the row is not matched. Pinned because
      // it is the one case where the conservative predicate answers the
      // permissive way, and a future edit to the subquery would change it
      // silently.
      const noCredential = await seedUser({ accountAt: null })
      const session = await seedSession(noCredential.id, new Date())

      await resetToPreMigrationState([session])

      await runBackfill()

      expect(await scopeOf(session)).toBe('dashboard')
    })

    it('writes nothing on a second run (R10)', async () => {
      const staff = await seedUser({ accountAt: new Date(Date.now() - 48 * HOUR) })
      const visitor = await seedUser({ anonymous: true, accountAt: null })
      const dashboard = await seedSession(staff.id, new Date())
      const identified = await seedSession(staff.id, new Date())
      const anonymous = await seedSession(visitor.id, new Date())
      const portal = await seedSession(staff.id, new Date())

      await markIdentified(identified)
      await markPortalOrigin(portal, staff.id)
      const all = [dashboard, identified, anonymous, portal]
      await resetToPreMigrationState(all)

      await runBackfill()
      const afterFirst = await Promise.all(all.map(scopeOf))

      await runBackfill()
      const afterSecond = await Promise.all(all.map(scopeOf))

      expect(afterSecond).toEqual(afterFirst)
      // Stated as the outcome too, so a run that flattened everything to one
      // value would not pass by being stable.
      expect(afterFirst).toEqual(['dashboard', 'widget', 'widget', 'portal'])
    })

    it('does not demote a portal session that a later run sees again (R10)', async () => {
      const staff = await seedUser({ accountAt: new Date(Date.now() - 48 * HOUR) })
      const portal = await seedSession(staff.id, new Date())

      await markIdentified(portal)
      await markPortalOrigin(portal, staff.id)
      await resetToPreMigrationState([portal])

      await runBackfill()
      await runBackfill()
      await runBackfill()

      expect(await scopeOf(portal)).toBe('portal')
    })
  }
)

describe.skipIf(!fixture.available)('the rolling-deploy trigger (R11)', () => {
  beforeEach(fixture.begin)
  afterEach(fixture.rollback)

  it('re-stamps a session whose provenance row arrives after the backfill', async () => {
    // An old replica still running the previous image mints a session without
    // the column, so it lands on the default, and then writes the provenance
    // row. Nothing would ever revisit that session.
    const staff = await seedUser({ accountAt: new Date(Date.now() - 48 * HOUR) })
    const session = await seedSession(staff.id, new Date())
    await resetToPreMigrationState([session])

    expect(await scopeOf(session)).toBe('dashboard')

    await markIdentified(session)

    expect(await scopeOf(session)).toBe('widget')
  })

  it('fires on an update of the provenance row, not only its insert', async () => {
    const staff = await seedUser({ accountAt: new Date(Date.now() - 48 * HOUR) })
    const session = await seedSession(staff.id, new Date())
    await markIdentified(session)
    await resetToPreMigrationState([session])

    await testDb.execute(
      sql`UPDATE widget_identified_session SET hmac_verified = true WHERE session_id = ${session}`
    )

    expect(await scopeOf(session)).toBe('widget')
  })

  it('never pulls a portal session back to the widget audience', async () => {
    // The trigger is guarded on `scope = 'dashboard'` for this: the handoff
    // promotes to portal, and a later touch of the provenance row must not
    // undo it.
    const staff = await seedUser({ accountAt: new Date(Date.now() - 48 * HOUR) })
    const session = await seedSession(staff.id, new Date())
    await markIdentified(session)
    await testDb.execute(sql`UPDATE session SET scope = 'portal' WHERE id = ${session}`)

    await testDb.execute(
      sql`UPDATE widget_identified_session SET hmac_verified = true WHERE session_id = ${session}`
    )

    expect(await scopeOf(session)).toBe('portal')
  })
})
