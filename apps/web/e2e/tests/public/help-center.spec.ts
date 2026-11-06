import { test, expect, type Page } from '@playwright/test'
import { setHelpCenter } from '../../utils/db-helpers'
import { HELP_CENTER_FIXTURE } from '../../fixtures/help-center'

/**
 * Public Help Center at /hc, read anonymously.
 *
 * Contract (confirmed 2026-11-05):
 *   H1 When the help center is off, /hc answers "Page not found".
 *   H2 When it is on, /hc and every category and article page show their
 *      content.
 *
 * The spec puts the help center into the state each test needs
 * (`setHelpCenter`, with the fixture category and two published articles from
 * `e2e/fixtures/help-center.ts`) instead of reading whatever the seed or an
 * earlier spec left behind. It used to return early whenever no help center
 * rendered, and since the seed has it off, almost every test passed without
 * asserting anything.
 *
 * Article and category URLs carry a database-assigned number, so the tests
 * follow the links the pages render rather than building URLs.
 */

// The two describes switch one workspace-wide flag; running them side by side
// would let one observe the other's state.
test.describe.configure({ mode: 'serial' })

/** The category card; popular-article links also mention the category, but after the title. */
function categoryCard(page: Page) {
  return page.getByRole('link', { name: new RegExp(`^${HELP_CENTER_FIXTURE.categoryName}`) })
}

async function openLanding(page: Page): Promise<void> {
  await page.goto('/hc')
  await expect(page.getByRole('heading', { level: 1, name: 'How can we help?' })).toBeVisible()
}

async function openFixtureCategory(page: Page): Promise<void> {
  await openLanding(page)
  await categoryCard(page).click()
  await expect(
    page.getByRole('heading', { level: 1, name: HELP_CENTER_FIXTURE.categoryName })
  ).toBeVisible()
}

async function openFirstArticle(page: Page): Promise<void> {
  await openFixtureCategory(page)
  await page
    .getByRole('main')
    .getByRole('link', { name: new RegExp(HELP_CENTER_FIXTURE.firstArticleTitle) })
    .first()
    .click()
  await expect(
    page.getByRole('heading', { level: 1, name: HELP_CENTER_FIXTURE.firstArticleTitle })
  ).toBeVisible()
}

test.describe('Public Help Center — turned off', () => {
  test.beforeAll(() => {
    setHelpCenter(false)
  })

  test.afterAll(() => {
    setHelpCenter(true)
  })

  test('/hc answers "Page not found" (H1)', async ({ page }) => {
    await page.goto('/hc')

    await expect(page.getByRole('heading', { level: 1, name: 'Page not found' })).toBeVisible()
    await expect(page.getByRole('searchbox', { name: 'Search articles...' })).toHaveCount(0)
  })
})

test.describe('Public Help Center — turned on', () => {
  test.beforeAll(() => {
    setHelpCenter(true)
  })

  test('the landing page shows the search and the fixture category with its article count (H2)', async ({
    page,
  }) => {
    await openLanding(page)

    await expect(page.getByRole('searchbox', { name: 'Search articles...' })).toBeVisible()
    const card = categoryCard(page)
    await expect(card).toBeVisible()
    await expect(card).toContainText(HELP_CENTER_FIXTURE.categoryDescription)
    await expect(card).toContainText('2 articles')
  })

  test('a category page is titled with the category and lists both of its articles (H2)', async ({
    page,
  }) => {
    await openFixtureCategory(page)

    await expect(page).toHaveURL(/\/hc\/[^/]+\/collections\/\d+-e2e-help-center$/)
    const main = page.getByRole('main')
    await expect(
      main.getByRole('link', { name: new RegExp(HELP_CENTER_FIXTURE.firstArticleTitle) }).first()
    ).toBeVisible()
    await expect(
      main.getByRole('link', { name: new RegExp(HELP_CENTER_FIXTURE.secondArticleTitle) }).first()
    ).toBeVisible()
  })

  test('an article page shows its title, body and a table of contents of its headings (H2)', async ({
    page,
  }) => {
    await openFirstArticle(page)

    await expect(page).toHaveURL(/\/hc\/[^/]+\/articles\/\d+-e2e-getting-started$/)
    const article = page.getByRole('article')
    await expect(article.getByText('Welcome to the e2e help center.')).toBeVisible()
    const toc = page.getByRole('complementary')
    for (const headingText of HELP_CENTER_FIXTURE.firstArticleHeadings) {
      await expect(article.getByRole('heading', { level: 2, name: headingText })).toBeVisible()
      await expect(toc.getByRole('link', { name: headingText })).toBeVisible()
    }
  })

  test('an article page offers the "Was this helpful?" feedback (H2)', async ({ page }) => {
    await openFirstArticle(page)

    await expect(page.getByText('Was this helpful?')).toBeVisible()
    await expect(page.getByRole('button', { name: /Yes/ })).toBeVisible()
    await expect(page.getByRole('button', { name: /No/ })).toBeVisible()
  })

  test('next and previous links connect the two articles of the category (H2)', async ({
    page,
  }) => {
    await openFirstArticle(page)

    await page.getByRole('link', { name: /Next/ }).click()
    await expect(
      page.getByRole('heading', { level: 1, name: HELP_CENTER_FIXTURE.secondArticleTitle })
    ).toBeVisible()

    await page.getByRole('link', { name: /Previous/ }).click()
    await expect(
      page.getByRole('heading', { level: 1, name: HELP_CENTER_FIXTURE.firstArticleTitle })
    ).toBeVisible()
  })

  test('the breadcrumb leads from an article back to the landing page (H2)', async ({ page }) => {
    await openFirstArticle(page)

    const breadcrumb = page.getByRole('navigation', { name: 'Breadcrumb' })
    await expect(breadcrumb).toContainText(HELP_CENTER_FIXTURE.categoryName)
    await breadcrumb.getByRole('link', { name: 'Help Center' }).click()

    await expect(page).toHaveURL(/\/hc$/)
    await expect(page.getByRole('heading', { level: 1, name: 'How can we help?' })).toBeVisible()
  })

  test('searching for an article title finds the article and opens it (H2)', async ({ page }) => {
    await openLanding(page)

    const searchbox = page.getByRole('searchbox', { name: 'Search articles...' })
    const result = page
      .getByRole('search')
      .getByRole('button', { name: new RegExp(HELP_CENTER_FIXTURE.firstArticleTitle) })
    // The search box is server-rendered; text typed before hydration is dropped,
    // so typing is repeated until the result list answers.
    await expect(async () => {
      await searchbox.fill('Getting started')
      await expect(result).toBeVisible({ timeout: 2000 })
    }).toPass({ timeout: 15000 })
    await result.click()

    await expect(
      page.getByRole('heading', { level: 1, name: HELP_CENTER_FIXTURE.firstArticleTitle })
    ).toBeVisible()
  })
})
