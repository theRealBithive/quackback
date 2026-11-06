import { test, expect } from '@playwright/test'
import { setHelpCenter } from '../../utils/db-helpers'
import { HELP_CENTER_FIXTURE } from '../../fixtures/help-center'

/**
 * Help Center admin E2E tests.
 *
 * These tests cover the help center article management UI at /admin/help-center.
 *
 * The file turns the help center on itself (`setHelpCenter`, which also makes
 * sure the fixture category from `e2e/fixtures/help-center.ts` exists). It used
 * to switch the flag through a settings toggle that no longer renders while the
 * product is off, and most tests returned early when an element was missing, so
 * a help center that never appeared passed the whole file. Each test now asserts
 * what it used to check for and skip on.
 */

test.beforeAll(() => {
  setHelpCenter(true)
})

/** Pick the first category in the dialog's category select (the fixture guarantees one). */
async function selectFirstCategory(
  container: import('@playwright/test').Locator,
  page: import('@playwright/test').Page
): Promise<void> {
  const categorySelect = container.locator('[role="combobox"]').first()
  await expect(async () => {
    await categorySelect.click()
    await expect(page.getByRole('option').first()).toBeVisible({ timeout: 2000 })
  }).toPass({ timeout: 15000 })
  await page.getByRole('option').first().click()
}

/**
 * Open the list's "New" menu. The header is server-rendered, so a click that
 * lands before hydration opens nothing; the click is repeated until the menu
 * answers.
 */
async function openNewMenu(page: import('@playwright/test').Page): Promise<void> {
  const newButton = page.getByRole('button', { name: /^New$/i })
  await expect(async () => {
    await newButton.click()
    await expect(page.getByRole('menuitem', { name: 'New article' })).toBeVisible({ timeout: 2000 })
  }).toPass({ timeout: 20000 })
}

/** The article rows of the list, by their titles. */
function articleTitles(page: import('@playwright/test').Page) {
  return page.getByRole('main').getByRole('heading', { level: 3 })
}

/**
 * Create a fresh article via the dialog and navigate to the editor page.
 * Returns the editor URL.
 */
async function createAndOpenArticle(
  page: import('@playwright/test').Page,
  title = `Editor Test Article ${Date.now()}`
): Promise<string> {
  await page.goto('/admin/help-center')
  await page.waitForLoadState('networkidle')

  await openNewMenu(page)
  await page.getByRole('menuitem', { name: 'New article' }).click()

  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()

  await dialog.getByPlaceholder('Article title').fill(title)
  await selectFirstCategory(dialog, page)

  await dialog.locator('.ProseMirror[contenteditable="true"]').click()
  await page.keyboard.type('Test article content for e2e test.')

  await dialog.getByRole('button', { name: /save draft/i }).click()
  await expect(dialog).toBeHidden({ timeout: 15000 })
  await expect(page).toHaveURL(/\/admin\/help-center\/articles\//, { timeout: 15000 })

  return page.url()
}

// ---------------------------------------------------------------------------
// Navigation suite
// ---------------------------------------------------------------------------

test.describe('Help Center admin navigation', () => {
  test('can navigate to help center from admin sidebar', async ({ page }) => {
    await page.goto('/admin')
    await page.waitForLoadState('networkidle')

    const helpCenterLink = page.getByRole('link', { name: 'Help Center' })
    await expect(helpCenterLink).toBeVisible({ timeout: 10000 })
    await helpCenterLink.click()

    await expect(page).toHaveURL(/\/admin\/help-center/, { timeout: 10000 })
  })

  test('help center index shows article list area', async ({ page }) => {
    await page.goto('/admin/help-center')
    await page.waitForLoadState('networkidle')

    await expect(page.getByText('Recent articles')).toBeVisible({ timeout: 10000 })
    // The list shows the most recent articles first; the fixture's may be paged
    // out by those other tests created, so any article row will do.
    await expect(articleTitles(page).first()).toBeVisible()
  })
})

// ---------------------------------------------------------------------------
// Category creation
// ---------------------------------------------------------------------------

test.describe('Help Center category management', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/admin/help-center')
    await page.waitForLoadState('networkidle')
  })

  test('can open New dropdown and choose New category', async ({ page }) => {
    await openNewMenu(page)

    await expect(page.getByRole('menuitem', { name: 'New article' })).toBeVisible()
    await expect(page.getByRole('menuitem', { name: 'New category' })).toBeVisible()

    await page.keyboard.press('Escape')
  })

  test('can create a new top-level category', async ({ page }) => {
    await openNewMenu(page)

    await page.getByRole('menuitem', { name: 'New category' }).click()

    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible({ timeout: 5000 })

    const categoryName = `E2E Category ${Date.now()}`
    await dialog.getByLabel(/name/i).fill(categoryName)
    await dialog.getByRole('button', { name: /create|save/i }).click()

    await expect(dialog).toBeHidden({ timeout: 10000 })
    await expect(page.getByText(categoryName)).toBeVisible({ timeout: 10000 })
  })
})

// ---------------------------------------------------------------------------
// Article creation
// ---------------------------------------------------------------------------

test.describe('Help Center article creation', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/admin/help-center')
    await page.waitForLoadState('networkidle')
  })

  test('can open create article dialog from New dropdown', async ({ page }) => {
    await openNewMenu(page)

    await page.getByRole('menuitem', { name: 'New article' }).click()

    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible({ timeout: 5000 })
    await expect(dialog.getByPlaceholder('Article title')).toBeVisible()

    await page.keyboard.press('Escape')
  })

  test('an article created with a title and a body opens in the editor with both saved (E1)', async ({
    page,
  }) => {
    const title = `E2E Test Article ${Date.now()}`
    const url = await createAndOpenArticle(page, title)
    expect(url).toMatch(/\/admin\/help-center\/articles\//)

    await page.reload()
    await expect(page.getByPlaceholder('Untitled')).toHaveValue(title)
    await expect(
      page.locator('.ProseMirror').getByText('Test article content for e2e test.')
    ).toBeVisible()
  })

  test('create article dialog can be dismissed with Escape', async ({ page }) => {
    await openNewMenu(page)

    await page.getByRole('menuitem', { name: 'New article' }).click()

    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()

    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden({ timeout: 5000 })
  })
})

// ---------------------------------------------------------------------------
// Article editor
// ---------------------------------------------------------------------------

test.describe('Help Center article editor', () => {
  test('editor shows title input, description input, and content area', async ({ page }) => {
    await createAndOpenArticle(page)

    await expect(page.getByPlaceholder('Untitled')).toBeVisible({ timeout: 10000 })
    await expect(page.getByPlaceholder('Page description (optional)')).toBeVisible()
    await expect(page.locator('.ProseMirror[contenteditable="true"]')).toBeVisible()
  })

  test('editor has category select, Publish button and Save changes button', async ({ page }) => {
    await createAndOpenArticle(page)

    const categorySelect = page.locator('button[role="combobox"]')
    await expect(categorySelect.first()).toBeVisible({ timeout: 10000 })

    const publishOrView = page
      .getByRole('button', { name: /publish/i })
      .or(page.getByRole('link', { name: /view article/i }))
    await expect(publishOrView.first()).toBeVisible()

    await expect(page.getByRole('button', { name: /save changes/i })).toBeVisible()
  })

  test('an edited title is saved and the body is kept (E1)', async ({ page }) => {
    await createAndOpenArticle(page)

    const titleInput = page.getByPlaceholder('Untitled')
    await expect(titleInput).toBeVisible({ timeout: 10000 })

    const updatedTitle = `Updated Title ${Date.now()}`
    await titleInput.fill(updatedTitle)
    const saveButton = page.getByRole('button', { name: /save changes/i })
    await saveButton.click()
    await expect(saveButton).toBeDisabled({ timeout: 10000 })

    await page.reload()
    await expect(page.getByPlaceholder('Untitled')).toHaveValue(updatedTitle)
    await expect(
      page.locator('.ProseMirror').getByText('Test article content for e2e test.')
    ).toBeVisible()
  })

  test('can edit article description', async ({ page }) => {
    await createAndOpenArticle(page)

    const descInput = page.getByPlaceholder('Page description (optional)')
    await expect(descInput).toBeVisible({ timeout: 10000 })

    await descInput.fill('A helpful description set by Playwright.')
    await page.getByRole('button', { name: /save changes/i }).click()

    await expect(page).toHaveURL(/\/admin\/help-center\/articles\//)
  })

  test('can publish an article and see "View article" link', async ({ page }) => {
    await createAndOpenArticle(page)

    const publishButton = page.getByRole('button', { name: /^publish$/i })
    await expect(publishButton.first()).toBeVisible()

    await publishButton.click()

    await expect(page.getByRole('link', { name: /view article/i })).toBeVisible({ timeout: 10000 })
  })

  test('can unpublish a published article via ellipsis menu', async ({ page }) => {
    await createAndOpenArticle(page)

    const publishButton = page.getByRole('button', { name: /^publish$/i })
    await expect(publishButton.first()).toBeVisible()

    await publishButton.click()
    await expect(page.getByRole('link', { name: /view article/i })).toBeVisible({ timeout: 10000 })

    const actionsButton = page.getByRole('button', { name: /article actions/i })
    await expect(actionsButton).toBeVisible({ timeout: 5000 })
    await actionsButton.click()

    await page.getByRole('menuitem', { name: /unpublish/i }).click()

    await expect(page.getByRole('button', { name: /^publish$/i })).toBeVisible({ timeout: 10000 })
  })

  test('back button navigates to help center list', async ({ page }) => {
    await createAndOpenArticle(page)

    const breadcrumbLink = page.getByRole('link', { name: 'Help Center' }).first()
    await expect(breadcrumbLink).toBeVisible({ timeout: 10000 })
    await breadcrumbLink.click()

    await expect(page).toHaveURL(/\/admin\/help-center/, { timeout: 10000 })
    expect(page.url()).not.toMatch(/\/articles\//)
  })
})

// ---------------------------------------------------------------------------
// Article list filtering
// ---------------------------------------------------------------------------

test.describe('Help Center article filtering', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/admin/help-center')
    await page.waitForLoadState('networkidle')
  })

  test('Newest is the default sort, and Oldest reverses the list', async ({ page }) => {
    await expect(page.getByRole('button', { name: 'Newest', exact: true })).toBeVisible()
    const newestFirst = await articleTitles(page).allTextContents()
    expect(newestFirst.length).toBeGreaterThan(1)

    await page.getByRole('button', { name: 'Oldest', exact: true }).click()

    await expect(page).toHaveURL(/[?&]sort=oldest/)
    await expect.poll(() => articleTitles(page).allTextContents()).not.toEqual(newestFirst)
    const oldestFirst = await articleTitles(page).allTextContents()
    expect(oldestFirst.at(-1)).not.toBe(newestFirst.at(-1))
  })
})

// ---------------------------------------------------------------------------
// Article editor toolbar formatting
// ---------------------------------------------------------------------------

test.describe('Help Center article editor toolbar', () => {
  test('bubble menu appears when text is selected', async ({ page }) => {
    await createAndOpenArticle(page, `Toolbar Test ${Date.now()}`)

    const editor = page.locator('.ProseMirror[contenteditable="true"]')
    await expect(editor).toBeVisible({ timeout: 10000 })

    // Type some text to select
    await editor.click()
    await editor.type('Hello formatting world')

    // Select all text in the editor (Ctrl+A scoped to editor)
    await editor.press('Control+a')

    // Bubble menu should appear (it activates on text selection)
    // The bubble menu may contain Bold, Italic, Link buttons
    // The bubble menu repeats the toolbar's Bold button, so a selection adds a
    // second visible one.
    const boldButtons = page.getByRole('button', { name: /^Bold/ })
    await expect(boldButtons.filter({ visible: true })).toHaveCount(2, { timeout: 3000 })
  })

  test('bold shortcut (Ctrl+B) toggles bold in editor', async ({ page }) => {
    await createAndOpenArticle(page, `Bold Test ${Date.now()}`)

    const editor = page.locator('.ProseMirror[contenteditable="true"]')
    await expect(editor).toBeVisible({ timeout: 10000 })

    await editor.click()
    await editor.type('bold text')
    await editor.press('Control+a')
    await editor.press('Control+b')

    // Text should now be wrapped in a <strong> tag
    const boldText = editor.locator('strong')
    await expect(boldText).toBeVisible({ timeout: 3000 })
  })

  test('italic shortcut (Ctrl+I) toggles italic in editor', async ({ page }) => {
    await createAndOpenArticle(page, `Italic Test ${Date.now()}`)

    const editor = page.locator('.ProseMirror[contenteditable="true"]')
    await expect(editor).toBeVisible({ timeout: 10000 })

    await editor.click()
    await editor.type('italic text')
    await editor.press('Control+a')
    await editor.press('Control+i')

    const italicText = editor.locator('em')
    await expect(italicText).toBeVisible({ timeout: 3000 })
  })

  test('slash command menu opens when "/" is typed at start of line', async ({ page }) => {
    await createAndOpenArticle(page, `Slash Menu Test ${Date.now()}`)

    const editor = page.locator('.ProseMirror[contenteditable="true"]')
    await expect(editor).toBeVisible({ timeout: 10000 })

    // Click at end of editor to position cursor, then press Enter for new line
    await editor.click()
    await editor.press('End')
    await editor.press('Enter')
    await editor.type('/')

    // Every editor suggestion list is mounted in a body-level popup marked
    // with `data-editor-suggestion` (see suggestion-popup.ts).
    const slashMenu = page.locator('[data-editor-suggestion]')
    await expect(slashMenu.first()).toBeVisible({ timeout: 3000 })
    await expect(slashMenu.first()).not.toBeEmpty()
    await page.keyboard.press('Escape')
  })
})

// ---------------------------------------------------------------------------
// Article SEO / description field
// ---------------------------------------------------------------------------

test.describe('Help Center article SEO description', () => {
  test('description field value is persisted after save and page reload', async ({ page }) => {
    await createAndOpenArticle(page, `SEO Test ${Date.now()}`)

    const descInput = page.getByPlaceholder('Page description (optional)')
    await expect(descInput).toBeVisible({ timeout: 10000 })

    const description = `SEO description set at ${Date.now()}`
    await descInput.fill(description)

    await page.getByRole('button', { name: /save changes/i }).click()
    // Wait for save
    await expect(
      page
        .getByRole('button', { name: /saving/i })
        .or(page.getByRole('button', { name: /save changes/i }))
    ).toBeVisible({ timeout: 5000 })
    await expect(page.getByRole('button', { name: /save changes/i })).toBeVisible({
      timeout: 10000,
    })

    // Reload and verify the description was persisted
    await page.reload()
    await page.waitForLoadState('networkidle')

    const reloadedDesc = page.getByPlaceholder('Page description (optional)')
    await expect(reloadedDesc).toHaveValue(description, { timeout: 10000 })
  })

  test('description field is trimmed on save (leading/trailing whitespace)', async ({ page }) => {
    await createAndOpenArticle(page, `Trim Test ${Date.now()}`)

    const descInput = page.getByPlaceholder('Page description (optional)')
    await expect(descInput).toBeVisible({ timeout: 10000 })

    await descInput.fill('  trimmed description  ')
    await page.getByRole('button', { name: /save changes/i }).click()
    await page.waitForLoadState('networkidle')

    // After reload the value should be trimmed (the server trims on save)
    await page.reload()
    await page.waitForLoadState('networkidle')

    const reloaded = page.getByPlaceholder('Page description (optional)')
    const savedValue = await reloaded.inputValue()
    expect(savedValue.trim()).toBe('trimmed description')
  })
})

// ---------------------------------------------------------------------------
// Article list filtering — status and search
// ---------------------------------------------------------------------------

test.describe('Help Center article list filtering - status', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/admin/help-center')
    await page.waitForLoadState('networkidle')
  })

  test('"Add filter" opens a popover offering Status and Category', async ({ page }) => {
    await page.getByRole('button', { name: 'Add filter' }).click()

    const popover = page.getByRole('dialog')
    await expect(popover.getByRole('button', { name: 'Status' })).toBeVisible()
    await expect(popover.getByRole('button', { name: 'Category' })).toBeVisible()
  })

  for (const status of ['Draft', 'Published'] as const) {
    test(`the ${status} filter shows only ${status.toLowerCase()} articles`, async ({ page }) => {
      const otherStatus = status === 'Draft' ? 'Published' : 'Draft'

      await page
        .getByRole('listbox', { name: 'Status filter' })
        .getByRole('option', { name: status })
        .click()

      await expect(page).toHaveURL(new RegExp(`[?&]status=${status.toLowerCase()}`))
      // The innermost main is the article list; the status filter beside it
      // also lists "Draft" and "Published".
      const list = page.getByRole('main').getByRole('main').getByRole('main')
      await expect.poll(() => articleTitles(page).count()).toBeGreaterThan(0)
      await expect(list.getByText(otherStatus, { exact: true })).toHaveCount(0)
    })
  }

  test('removing the status chip shows every status again', async ({ page }) => {
    await page
      .getByRole('listbox', { name: 'Status filter' })
      .getByRole('option', { name: 'Draft' })
      .click()
    await expect(page).toHaveURL(/[?&]status=draft/)
    await expect.poll(() => articleTitles(page).count()).toBeGreaterThan(0)
    // The list swaps once the filtered response lands; until then it still
    // shows the published articles, and reading it early records those.
    const list = page.getByRole('main').getByRole('main').getByRole('main')
    await expect(list.getByText('Published', { exact: true })).toHaveCount(0)
    const draftsOnly = await articleTitles(page).allTextContents()

    await page.getByRole('button', { name: 'Remove Status Draft filter' }).click()

    await expect(page).not.toHaveURL(/[?&]status=/)
    // The fixture's articles are published, so without the filter a published
    // article is reachable again through the search.
    await page
      .getByPlaceholder('Search all articles...')
      .fill(HELP_CENTER_FIXTURE.firstArticleTitle)
    await expect(
      articleTitles(page).filter({ hasText: HELP_CENTER_FIXTURE.firstArticleTitle })
    ).toBeVisible({ timeout: 10000 })
    expect(draftsOnly).not.toContain(HELP_CENTER_FIXTURE.firstArticleTitle)
  })

  test('searching in the admin list shows matching articles', async ({ page }) => {
    // Create an article with a unique title so we can search for it
    const uniqueTitle = `SearchTarget ${Date.now()}`
    await createAndOpenArticle(page, uniqueTitle)

    // Return to the list
    await page.goto('/admin/help-center')
    await page.waitForLoadState('networkidle')

    const searchInput = page.getByPlaceholder('Search all articles...')

    await searchInput.fill(uniqueTitle)
    await page.waitForTimeout(500) // debounce
    await page.waitForLoadState('networkidle')

    // The article should appear in the list
    await expect(page.getByText(uniqueTitle)).toBeVisible({ timeout: 10000 })
  })

  test('searching with no matches shows "No articles match your search" empty state', async ({
    page,
  }) => {
    const searchInput = page.getByPlaceholder('Search all articles...')

    await searchInput.fill('xyznonexistentarticlexyz98765')
    await page.waitForTimeout(500)
    await page.waitForLoadState('networkidle')

    await expect(
      page
        .getByText('No articles match your search')
        .or(page.getByText('No articles match your filters'))
    ).toBeVisible({ timeout: 10000 })
  })
})

// ---------------------------------------------------------------------------
// Article preview / "View article" link
// ---------------------------------------------------------------------------

test.describe('Help Center article preview link', () => {
  test('"View article" link uses the correct /hc/articles/{cat}/{slug} path', async ({ page }) => {
    await createAndOpenArticle(page, `Preview Test ${Date.now()}`)

    // The article must be published to show the "View article" link
    const publishButton = page.getByRole('button', { name: /^publish$/i })
    await expect(publishButton.first()).toBeVisible()
    await publishButton.click()

    // Wait for "View article" link to appear
    const viewLink = page.locator('a').filter({ hasText: /view article/i })
    await expect(viewLink).toBeVisible({ timeout: 10000 })

    // Verify the href follows /hc/articles/{category-slug}/{article-slug}
    const href = await viewLink.getAttribute('href')
    expect(href).toMatch(/\/hc\/articles\//)
  })

  test('"View article" link opens in a new tab (target=_blank)', async ({ page }) => {
    await createAndOpenArticle(page, `NewTab Test ${Date.now()}`)

    const publishButton = page.getByRole('button', { name: /^publish$/i })
    await expect(publishButton.first()).toBeVisible()
    await publishButton.click()

    const viewLink = page.locator('a').filter({ hasText: /view article/i })
    await expect(viewLink).toBeVisible({ timeout: 10000 })

    const target = await viewLink.getAttribute('target')
    expect(target).toBe('_blank')
  })

  test('"View article" link is not shown for draft articles', async ({ page }) => {
    await createAndOpenArticle(page, `Draft Link Test ${Date.now()}`)

    // Article is in draft state after creation — "View article" should not be present
    const viewLink = page.locator('a').filter({ hasText: /view article/i })
    await expect(viewLink).toBeHidden({ timeout: 5000 })

    // Publish button should be visible instead
    await expect(page.getByRole('button', { name: /^publish$/i })).toBeVisible()
  })
})

// ---------------------------------------------------------------------------
// Article list item — context menu
// ---------------------------------------------------------------------------

test.describe('Help Center article list item actions', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/admin/help-center')
    await page.waitForLoadState('networkidle')
  })

  test('an article row offers Edit and Delete in its menu', async ({ page }) => {
    // The row's menu button carries no label; it is the only button in the row.
    const row = page
      .locator('div.group')
      .filter({ has: page.locator('h3') })
      .first()
    await row.hover()
    await row.getByRole('button').click()

    await expect(page.getByRole('menuitem', { name: 'Edit' })).toBeVisible()
    await expect(page.getByRole('menuitem', { name: 'Delete' })).toBeVisible()
    await page.keyboard.press('Escape')
  })
})
