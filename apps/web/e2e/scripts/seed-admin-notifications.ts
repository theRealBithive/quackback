/**
 * CLI: give the e2e admin (demo@example.com) a known notification list.
 *
 * Replaces every in-app notification the admin has with two unread and one
 * read notification, none linked to a post, so the notifications page renders
 * each as a row that marks itself read when clicked. The seed creates no
 * notifications at all, so without this the page only ever shows its empty
 * state and a spec cannot tell a working list from a broken one.
 *
 * "empty" only removes the admin's notifications, for the empty state.
 *
 * Prints the titles as JSON: { unread: string[], read: string[] }.
 *
 * Usage: bun seed-admin-notifications.ts <list|empty>
 */
import { generateId, toUuid } from '@quackback/ids'
import { openDb } from './_lib'

const UNREAD_TITLES = ['E2E unread status change', 'E2E unread second change']
const READ_TITLES = ['E2E already read change']

const mode = (process.argv[2] || 'list').toLowerCase()
if (mode !== 'list' && mode !== 'empty') {
  console.error('Usage: bun seed-admin-notifications.ts <list|empty>')
  process.exit(1)
}
const seedsList = mode === 'list'

const sql = openDb()

async function findDemoPrincipalId(): Promise<string> {
  const rows = await sql<{ id: string }[]>`
    SELECT p.id FROM principal p
    JOIN "user" u ON u.id = p.user_id
    WHERE u.email = ${'demo@example.com'}
    LIMIT 1`
  if (rows.length === 0) throw new Error('demo@example.com principal missing (run db:seed first)')
  return rows[0].id
}

async function insertNotification(principalId: string, title: string, read: boolean) {
  const id = toUuid(generateId('notification'))
  const readAt = read ? new Date() : null
  await sql`
    INSERT INTO in_app_notifications (id, principal_id, type, title, body, read_at, created_at)
    VALUES (${id}, ${principalId}, ${'post_status_changed'}, ${title},
            ${'Seeded for the e2e notifications spec'}, ${readAt}, NOW())`
}

try {
  const principalId = await findDemoPrincipalId()
  await sql`DELETE FROM in_app_notifications WHERE principal_id = ${principalId}`
  if (!seedsList) {
    console.log(JSON.stringify({ unread: [], read: [] }))
  } else {
    for (const title of UNREAD_TITLES) {
      await insertNotification(principalId, title, false)
    }
    for (const title of READ_TITLES) {
      await insertNotification(principalId, title, true)
    }
    console.log(JSON.stringify({ unread: UNREAD_TITLES, read: READ_TITLES }))
  }
  await sql.end()
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err))
  await sql.end()
  process.exit(1)
}
