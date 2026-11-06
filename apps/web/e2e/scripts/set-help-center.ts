/**
 * CLI: put the help center into a known state for e2e runs.
 *
 * "on" turns the `helpCenter` product flag on and makes sure a public category
 * with two published articles exists, so a spec can assert what the help center
 * shows instead of degrading when the seed has none. The first article carries
 * two level-2 headings in its rich-text body for the table of contents. Idempotent: rows are looked up by
 * slug and created only when missing.
 *
 * "off" turns the flag off and leaves the fixture rows in place.
 *
 * The flag used to be switched on only as a side effect of the widget specs, so
 * whether the help-center specs saw a help center depended on which spec ran
 * first. Each help-center spec now states the state it needs.
 *
 * Usage: bun set-help-center.ts <on|off>
 */
import { generateId, toUuid } from '@quackback/ids'
import { openDb, bustWorkspaceSettings, parseJson } from './_lib'
import { HELP_CENTER_FIXTURE } from '../fixtures/help-center'

const FIRST_ARTICLE_CONTENT = [
  'Welcome to the e2e help center.',
  HELP_CENTER_FIXTURE.firstArticleHeadings[0],
  'Open the portal and look around.',
  HELP_CENTER_FIXTURE.firstArticleHeadings[1],
  'Share an idea with the team.',
].join('\n')

const SECOND_ARTICLE_CONTENT = 'The second article follows the first one.'

function paragraph(text: string) {
  return { type: 'paragraph', content: [{ type: 'text', text }] }
}

function heading(text: string) {
  return { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text }] }
}

/** The rich-text body the article page renders; `content` is its plain-text twin. */
const FIRST_ARTICLE_JSON = {
  type: 'doc',
  content: [
    paragraph('Welcome to the e2e help center.'),
    heading(HELP_CENTER_FIXTURE.firstArticleHeadings[0]),
    paragraph('Open the portal and look around.'),
    heading(HELP_CENTER_FIXTURE.firstArticleHeadings[1]),
    paragraph('Share an idea with the team.'),
  ],
}

const SECOND_ARTICLE_JSON = {
  type: 'doc',
  content: [paragraph(SECOND_ARTICLE_CONTENT)],
}

const mode = (process.argv[2] || 'on').toLowerCase()
if (mode !== 'on' && mode !== 'off') {
  console.error('Usage: bun set-help-center.ts <on|off>')
  process.exit(1)
}
const enabled = mode === 'on'

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

async function ensureCategory(): Promise<string> {
  const existing = await sql<{ id: string }[]>`
    SELECT id FROM kb_categories WHERE slug = ${HELP_CENTER_FIXTURE.categorySlug} LIMIT 1`
  if (existing.length > 0) return existing[0].id

  const categoryId = toUuid(generateId('kb_category'))
  await sql`
    INSERT INTO kb_categories (id, slug, name, description, is_public, position, created_at, updated_at)
    VALUES (${categoryId}, ${HELP_CENTER_FIXTURE.categorySlug}, ${HELP_CENTER_FIXTURE.categoryName},
            ${HELP_CENTER_FIXTURE.categoryDescription}, true, 0, NOW(), NOW())`
  return categoryId
}

async function ensureArticle(input: {
  categoryId: string
  principalId: string
  slug: string
  title: string
  content: string
  contentJson: object
  position: number
}): Promise<void> {
  const existing = await sql`SELECT id FROM kb_articles WHERE slug = ${input.slug} LIMIT 1`
  if (existing.length > 0) return

  const articleId = toUuid(generateId('article'))
  await sql`
    INSERT INTO kb_articles
      (id, category_id, slug, title, content, content_json, principal_id, published_at, position,
       created_at, updated_at)
    VALUES
      (${articleId}, ${input.categoryId}, ${input.slug}, ${input.title}, ${input.content},
       ${sql.json(input.contentJson)}, ${input.principalId}, NOW(), ${input.position}, NOW(), NOW())`
}

try {
  const rows = await sql`SELECT id, feature_flags FROM settings ORDER BY created_at ASC LIMIT 1`
  if (rows.length === 0) throw new Error('No settings row found (run the seed first)')
  const settingsId = rows[0].id as string

  const flags = parseJson(rows[0].feature_flags)
  flags.helpCenter = enabled
  await sql`UPDATE settings SET feature_flags = ${JSON.stringify(flags)} WHERE id = ${settingsId}`

  if (enabled) {
    const principalId = await findDemoPrincipalId()
    const categoryId = await ensureCategory()
    await ensureArticle({
      categoryId,
      principalId,
      slug: HELP_CENTER_FIXTURE.firstArticleSlug,
      title: HELP_CENTER_FIXTURE.firstArticleTitle,
      content: FIRST_ARTICLE_CONTENT,
      contentJson: FIRST_ARTICLE_JSON,
      position: 0,
    })
    await ensureArticle({
      categoryId,
      principalId,
      slug: HELP_CENTER_FIXTURE.secondArticleSlug,
      title: HELP_CENTER_FIXTURE.secondArticleTitle,
      content: SECOND_ARTICLE_CONTENT,
      contentJson: SECOND_ARTICLE_JSON,
      position: 1,
    })
  }

  await bustWorkspaceSettings(sql)
  console.log(JSON.stringify({ helpCenter: mode }))
  await sql.end()
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err))
  await sql.end()
  process.exit(1)
}
