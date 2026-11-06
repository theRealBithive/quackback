/**
 * CLI: make one seeded portal user "recently active".
 *
 * The Add people dialog lists the most recently active portal users as soon as
 * its People field takes focus, and "active" means holding a live non-widget
 * session. The seed creates no sessions, so on a fresh database that list is
 * empty, while in a full run the portal specs before it have signed people in.
 * A spec that needs the list open regardless of what ran first calls this.
 *
 * Idempotent: the session has a fixed id and is refreshed rather than added.
 * Prints the user's email.
 *
 * Usage: bun seed-recent-portal-session.ts
 */
import { openDb } from './_lib'

const SESSION_ID = 'e2e-recent-portal-session'
const PORTAL_USER_EMAIL = 'user4@example.com'

const sql = openDb()

try {
  const users = await sql<{ id: string }[]>`
    SELECT u.id FROM "user" u
    JOIN principal p ON p.user_id = u.id
    WHERE u.email = ${PORTAL_USER_EMAIL} AND p.role = 'user'
    LIMIT 1`
  if (users.length === 0) {
    throw new Error(`${PORTAL_USER_EMAIL} is not a seeded portal user (run db:seed first)`)
  }
  const userId = users[0].id

  await sql`
    INSERT INTO session (id, token, user_id, scope, expires_at, created_at, updated_at)
    VALUES (${SESSION_ID}, ${SESSION_ID + '-token'}, ${userId}, ${'dashboard'},
            NOW() + INTERVAL '1 day', NOW(), NOW())
    ON CONFLICT (id) DO UPDATE
      SET user_id = EXCLUDED.user_id, expires_at = EXCLUDED.expires_at, updated_at = NOW()`

  console.log(PORTAL_USER_EMAIL)
  await sql.end()
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err))
  await sql.end()
  process.exit(1)
}
