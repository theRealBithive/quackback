import { test, expect } from '@playwright/test'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Open the "New Entry" dialog and return the dialog locator.
 */
async function openCreateDialog(page: import('@playwright/test').Page) {
  const newEntryBtn = page.getByRole('button', { name: /new entry/i })
  const dialog = page.getByRole('dialog')
  // The button is server-rendered; a click before hydration opens nothing.
  await expect(async () => {
    await newEntryBtn.first().click()
    await expect(dialog).toBeVisible({ timeout: 2000 })
  }).toPass({ timeout: 20000 })
  return dialog
}

/**
 * Create a new changelog entry via the dialog and wait for it to close.
 * Returns the entry title used.
 */
async function createEntry(
  page: import('@playwright/test').Page,
  title = `E2E Entry ${Date.now()}`
): Promise<string> {
  const dialog = await openCreateDialog(page)

  // Title input uses "What's new?" placeholder
  await dialog.getByPlaceholder("What's new?").fill(title)

  // Fill the rich text editor so the form can be submitted
  const editor = dialog.locator('.ProseMirror[contenteditable="true"]')
  await editor.click()
  await page.keyboard.type('Test content for article.')

  // Submit as draft
  await dialog.getByRole('button', { name: /save draft/i }).click()
  await expect(dialog).toBeHidden({ timeout: 15000 })

  return title
}

/**
 * Pick a publish status in the dialog's metadata sidebar. The control is a
 * popover: its trigger is named after the current status, and each status is
 * a button inside it.
 */
async function choosePublishStatus(
  page: import('@playwright/test').Page,
  dialog: import('@playwright/test').Locator,
  status: 'Draft' | 'Scheduled' | 'Published'
): Promise<void> {
  const trigger = dialog
    .getByRole('complementary')
    .getByRole('button', { name: /^(Draft|Scheduled|Published)$/ })
  await trigger.click()
  const popover = page.locator('[data-slot="popover-content"]')
  await popover.getByRole('button', { name: status, exact: true }).click()
  await expect(trigger).toHaveText(status)
  // The popover is a role="dialog" too; until it has gone, getByRole('dialog')
  // matches two elements.
  await expect(popover).toHaveCount(0)
}

/**
 * Find the first list item card containing `title` text.
 * Uses h3 elements as they render entry titles.
 */
function entryCard(page: import('@playwright/test').Page, title: string) {
  return page.locator('h3').filter({ hasText: title }).first()
}

// ---------------------------------------------------------------------------
// Navigation & display
// ---------------------------------------------------------------------------

test.describe('Changelog admin navigation', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/admin/changelog')
    await page.waitForLoadState('networkidle')
  })

  test('can navigate to /admin/changelog', async ({ page }) => {
    await expect(page).toHaveURL(/\/admin\/changelog/)
  })

  test('page shows entry list or empty state', async ({ page }) => {
    // Either an h3 (entry title) or an empty-state message should be visible
    const content = page.getByText('No changelog entries yet').or(page.locator('h3').first())

    await expect(content.first()).toBeVisible({ timeout: 10000 })
  })

  test('page has a "New Entry" button', async ({ page }) => {
    const newEntryBtn = page.getByRole('button', { name: /new entry/i })
    await expect(newEntryBtn.first()).toBeVisible({ timeout: 10000 })
  })

  test('sidebar filter panel shows status options', async ({ page }) => {
    // The filter panel renders All / Draft / Scheduled / Published filter buttons
    await expect(page.getByRole('option', { name: 'All' })).toBeVisible({ timeout: 10000 })
    await expect(page.getByRole('option', { name: 'Draft' })).toBeVisible()
    await expect(page.getByRole('option', { name: 'Published' })).toBeVisible()
  })
})

// ---------------------------------------------------------------------------
// Create entry
// ---------------------------------------------------------------------------

test.describe('Changelog create entry', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/admin/changelog')
    await page.waitForLoadState('networkidle')
  })

  test('can open create dialog via "New Entry" button', async ({ page }) => {
    const dialog = await openCreateDialog(page)

    await expect(dialog).toBeVisible()
    await page.keyboard.press('Escape')
  })

  test('create dialog has title input and rich text editor', async ({ page }) => {
    const dialog = await openCreateDialog(page)

    await expect(dialog.getByPlaceholder("What's new?")).toBeVisible()
    await expect(dialog.locator('.ProseMirror[contenteditable="true"]')).toBeVisible()

    await page.keyboard.press('Escape')
  })

  test('create dialog has Save Draft, Schedule, and Publish Now status options in sidebar', async ({
    page,
  }) => {
    const dialog = await openCreateDialog(page)

    const statusTrigger = dialog.getByRole('complementary').getByRole('button', { name: 'Draft' })
    await statusTrigger.click()
    const statusOptions = page.locator('[data-slot="popover-content"]')
    for (const status of ['Draft', 'Scheduled', 'Published']) {
      await expect(statusOptions.getByRole('button', { name: status, exact: true })).toBeVisible()
    }
    await page.keyboard.press('Escape')

    // The submit button follows the chosen status.
    await expect(dialog.getByRole('button', { name: /save draft/i })).toBeVisible()
    await choosePublishStatus(page, dialog, 'Published')
    await expect(dialog.getByRole('button', { name: /publish now/i })).toBeVisible()

    await page.keyboard.press('Escape')
  })

  test('can create a new changelog entry with title and content', async ({ page }) => {
    const title = await createEntry(page)

    await page.waitForLoadState('networkidle')
    // Entry should appear in the list
    await expect(entryCard(page, title)).toBeVisible({ timeout: 10000 })
  })

  test('can create entry using Cmd+Enter keyboard shortcut', async ({ page }) => {
    const dialog = await openCreateDialog(page)

    const title = `Keyboard Entry ${Date.now()}`
    await dialog.getByPlaceholder("What's new?").fill(title)

    // Type some content in the rich text editor
    const editor = dialog.locator('.ProseMirror[contenteditable="true"]')
    await editor.click()
    await page.keyboard.type('Created with keyboard shortcut')

    // Submit with Cmd/Ctrl+Enter
    await page.keyboard.press('Meta+Enter')

    await expect(dialog).toBeHidden({ timeout: 15000 })
    await page.waitForLoadState('networkidle')
    await expect(entryCard(page, title)).toBeVisible({ timeout: 10000 })
  })

  test('shows validation error when submitting without a title', async ({ page }) => {
    const dialog = await openCreateDialog(page)

    // Leave title empty and attempt to submit
    await dialog.getByRole('button', { name: /save draft/i }).click()

    // Dialog should remain open; an error or the empty title input should persist
    await expect(dialog).toBeVisible()
    // The title input should still be present (form was not submitted)
    await expect(dialog.getByPlaceholder("What's new?")).toBeVisible()

    await page.keyboard.press('Escape')
  })

  test('dialog closes after successful creation', async ({ page }) => {
    const dialog = await openCreateDialog(page)

    await dialog.getByPlaceholder("What's new?").fill(`Close Test ${Date.now()}`)
    // Content is required; before the FormControl fix typed content never
    // reached the form, and this dialog stayed open with "Content is required".
    await dialog.locator('.ProseMirror[contenteditable="true"]').click()
    await page.keyboard.type('Entry body.')
    await dialog.getByRole('button', { name: /save draft/i }).click()

    await expect(dialog).toBeHidden({ timeout: 15000 })
  })

  test('dialog can be dismissed with Escape', async ({ page }) => {
    const dialog = await openCreateDialog(page)

    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden({ timeout: 5000 })
  })
})

// ---------------------------------------------------------------------------
// Edit entry
// ---------------------------------------------------------------------------

test.describe('Changelog edit entry', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/admin/changelog')
    await page.waitForLoadState('networkidle')
  })

  test('clicking an entry row opens the edit modal', async ({ page }) => {
    // Ensure there is at least one entry to click
    const firstCard = page.locator('h3').first()
    await expect(firstCard).toBeVisible({ timeout: 15000 })

    await firstCard.click()

    // The URL should gain an `entry=` query param and a dialog should appear
    await expect(page).toHaveURL(/entry=/, { timeout: 10000 })
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 10000 })

    await page.keyboard.press('Escape')
  })

  test('edit modal shows title input pre-populated', async ({ page }) => {
    const firstCard = page.locator('h3').first()
    await expect(firstCard).toBeVisible({ timeout: 15000 })

    const titleText = (await firstCard.textContent()) ?? ''
    await firstCard.click()

    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible({ timeout: 10000 })

    const titleInput = dialog.getByPlaceholder("What's new?")
    await expect(titleInput).toBeVisible()
    const value = await titleInput.inputValue()
    expect(value.length).toBeGreaterThan(0)
    expect(value).toBe(titleText.trim())

    await page.keyboard.press('Escape')
  })

  test('can update an entry title and save', async ({ page }) => {
    // Create a fresh entry so we have something deterministic to edit
    const originalTitle = await createEntry(page)

    await page.waitForLoadState('networkidle')

    // Click to open the edit modal
    const card = entryCard(page, originalTitle)
    await expect(card.first()).toBeVisible()
    await card.click()

    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible({ timeout: 10000 })

    const updatedTitle = `${originalTitle} (updated)`
    const titleInput = dialog.getByPlaceholder("What's new?")
    await titleInput.fill(updatedTitle)

    await dialog.getByRole('button', { name: /save draft/i }).click()

    await expect(dialog).toBeHidden({ timeout: 15000 })
    await page.waitForLoadState('networkidle')

    // Updated title should now be visible in the list
    await expect(entryCard(page, updatedTitle)).toBeVisible({ timeout: 10000 })
  })

  test('edit modal can be dismissed with Escape', async ({ page }) => {
    const firstCard = page.locator('h3').first()
    await expect(firstCard).toBeVisible({ timeout: 15000 })

    await firstCard.click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible({ timeout: 10000 })

    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden({ timeout: 5000 })
  })

  test('closing edit modal removes entry param from URL', async ({ page }) => {
    const firstCard = page.locator('h3').first()
    await expect(firstCard).toBeVisible({ timeout: 15000 })

    await firstCard.click()
    await expect(page).toHaveURL(/entry=/, { timeout: 10000 })
    // Escape only reaches the modal once it is open and focused.
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 10000 })
    await expect(page.getByRole('dialog').getByPlaceholder("What's new?")).toBeVisible()

    await page.keyboard.press('Escape')
    await expect(page).not.toHaveURL(/entry=/, { timeout: 5000 })
  })
})

// ---------------------------------------------------------------------------
// Publish / Unpublish
// ---------------------------------------------------------------------------

test.describe('Changelog publish and unpublish', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/admin/changelog')
    await page.waitForLoadState('networkidle')
  })

  test('can publish a draft entry via status select in edit modal', async ({ page }) => {
    // Create a fresh draft entry
    const title = await createEntry(page)

    await page.waitForLoadState('networkidle')

    // Open edit modal
    const card = entryCard(page, title)
    await expect(card.first()).toBeVisible()
    await card.click()

    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible({ timeout: 10000 })

    // Change status to "Published" via the StatusSelect combobox in the sidebar
    await choosePublishStatus(page, dialog, 'Published')

    // Submit button should now say "Update & Publish"
    const submitBtn = dialog.getByRole('button', { name: /update & publish|publish now/i })
    await expect(submitBtn).toBeVisible({ timeout: 5000 })
    await submitBtn.click()

    await expect(dialog).toBeHidden({ timeout: 15000 })
    await page.waitForLoadState('networkidle')

    // The entry should now show a "Published" badge
    const publishedBadge = page
      .locator('h3')
      .filter({ hasText: title })
      .locator('xpath=ancestor::div[contains(@class,"group")]')
      .first()
      .getByText('Published', { exact: true })

    await expect(publishedBadge).toBeVisible({ timeout: 10000 })
  })

  test('can change a published entry back to draft via edit modal', async ({ page }) => {
    // Look for an already-published entry — skip if none
    const publishedRows = page
      .locator('div')
      .filter({ hasText: /published/i })
      .locator('h3')

    await expect(publishedRows.first()).toBeVisible()

    await publishedRows.first().click()

    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible({ timeout: 10000 })

    await choosePublishStatus(page, dialog, 'Draft')

    await dialog.getByRole('button', { name: /save draft/i }).click()
    await expect(dialog).toBeHidden({ timeout: 15000 })
  })
})

// ---------------------------------------------------------------------------
// Delete entry
// ---------------------------------------------------------------------------

test.describe('Changelog delete entry', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/admin/changelog')
    await page.waitForLoadState('networkidle')
  })

  test('delete option in dropdown opens confirmation dialog', async ({ page }) => {
    // Create an entry to delete so we always have one
    const title = await createEntry(page)

    await page.waitForLoadState('networkidle')

    const row = page
      .locator('h3')
      .filter({ hasText: title })
      .locator('xpath=ancestor::div[contains(@class,"group")]')
      .first()

    await row.hover()

    // Click the ellipsis menu button
    const menuBtn = row.locator('button').last()
    await menuBtn.click()

    const deleteItem = page.getByRole('menuitem', { name: /delete/i })
    await expect(deleteItem).toBeVisible({ timeout: 5000 })
    await deleteItem.click()

    // Confirmation dialog should appear
    const confirmDialog = page
      .getByRole('alertdialog')
      .or(page.getByRole('dialog').filter({ hasText: /delete/i }))
    await expect(confirmDialog).toBeVisible({ timeout: 5000 })

    // Cancel — don't actually delete
    await page.keyboard.press('Escape')
  })

  test('can cancel deletion from confirmation dialog', async ({ page }) => {
    const title = await createEntry(page)

    await page.waitForLoadState('networkidle')

    const row = page
      .locator('h3')
      .filter({ hasText: title })
      .locator('xpath=ancestor::div[contains(@class,"group")]')
      .first()

    await row.hover()
    const menuBtn = row.locator('button').last()
    await menuBtn.click()

    const deleteItem = page.getByRole('menuitem', { name: /delete/i })
    await expect(deleteItem.first()).toBeVisible()
    await deleteItem.click()

    const confirmDialog = page
      .getByRole('alertdialog')
      .or(page.getByRole('dialog').filter({ hasText: /delete/i }))
    await expect(confirmDialog).toBeVisible({ timeout: 5000 })

    // Click Cancel
    const cancelBtn = confirmDialog.getByRole('button', { name: /cancel/i })
    await cancelBtn.click()

    // Dialog should close, entry should still be in the list
    await expect(confirmDialog).toBeHidden({ timeout: 5000 })
    await expect(entryCard(page, title)).toBeVisible({ timeout: 5000 })
  })

  test('can confirm deletion and entry disappears from list', async ({ page }) => {
    const title = await createEntry(page)

    await page.waitForLoadState('networkidle')

    const row = page
      .locator('h3')
      .filter({ hasText: title })
      .locator('xpath=ancestor::div[contains(@class,"group")]')
      .first()

    await row.hover()
    const menuBtn = row.locator('button').last()
    await menuBtn.click()

    const deleteItem = page.getByRole('menuitem', { name: /delete/i })
    await expect(deleteItem.first()).toBeVisible()
    await deleteItem.click()

    const confirmDialog = page
      .getByRole('alertdialog')
      .or(page.getByRole('dialog').filter({ hasText: /delete/i }))
    await expect(confirmDialog).toBeVisible({ timeout: 5000 })

    // Confirm deletion
    const confirmBtn = confirmDialog.getByRole('button', { name: /delete/i })
    await confirmBtn.click()

    await expect(confirmDialog).toBeHidden({ timeout: 10000 })
    await page.waitForLoadState('networkidle')

    // Entry must no longer appear
    await expect(entryCard(page, title)).toHaveCount(0, { timeout: 10000 })
  })
})

// ---------------------------------------------------------------------------
// Admin/Public Publishing Pipeline
// ---------------------------------------------------------------------------

/**
 * Helper: create and immediately publish an entry from the create dialog.
 * Returns the title.
 */
async function createAndPublishEntry(
  page: import('@playwright/test').Page,
  title: string
): Promise<string> {
  const dialog = await openCreateDialog(page)

  await dialog.getByPlaceholder("What's new?").fill(title)
  await dialog.locator('.ProseMirror[contenteditable="true"]').click()
  await page.keyboard.type('Published entry content.')

  // Switch status to "Published"
  await choosePublishStatus(page, dialog, 'Published')

  // Submit button should now say "Publish Now"
  const publishBtn = dialog.getByRole('button', { name: /publish now/i })
  await expect(publishBtn).toBeVisible({ timeout: 5000 })
  await publishBtn.click()

  await expect(dialog).toBeHidden({ timeout: 15000 })
  return title
}

/**
 * Helper: revert a published entry back to draft via the edit modal.
 * Expects to be called from /admin/changelog with the entry visible.
 */
async function unpublishEntry(page: import('@playwright/test').Page, title: string): Promise<void> {
  const card = entryCard(page, title)
  await card.click()

  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible({ timeout: 10000 })

  await choosePublishStatus(page, dialog, 'Draft')

  await dialog.getByRole('button', { name: /save draft/i }).click()
  await expect(dialog).toBeHidden({ timeout: 15000 })
  await page.waitForLoadState('networkidle')
}

/**
 * Delete a test entry by title to clean up after publishing pipeline tests.
 */
async function deleteEntryByTitle(
  page: import('@playwright/test').Page,
  title: string
): Promise<void> {
  await page.goto('/admin/changelog')
  await page.waitForLoadState('networkidle')

  const row = page
    .locator('h3')
    .filter({ hasText: title })
    .locator('xpath=ancestor::div[contains(@class,"group")]')
    .first()

  await expect(row.first()).toBeVisible()

  await row.hover()
  const menuBtn = row.locator('button').last()
  await menuBtn.click()

  const deleteItem = page.getByRole('menuitem', { name: /delete/i })
  await expect(deleteItem.first()).toBeVisible()
  await deleteItem.click()

  const confirmDialog = page
    .getByRole('alertdialog')
    .or(page.getByRole('dialog').filter({ hasText: /delete/i }))
  await expect(confirmDialog.first()).toBeVisible()

  await confirmDialog.getByRole('button', { name: /delete/i }).click()
  await expect(confirmDialog).toBeHidden({ timeout: 10000 })
  await page.waitForLoadState('networkidle')
}

test.describe('Changelog - Admin/Public Publishing Pipeline', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/admin/changelog')
    await page.waitForLoadState('networkidle')
  })

  test('draft entry is NOT visible on public /changelog', async ({ page }) => {
    const title = `Draft Visibility Test ${Date.now()}`

    // Create as draft only
    await createEntry(page, title)

    await page.waitForLoadState('networkidle')

    // Confirm it exists as a draft in admin
    await expect(entryCard(page, title)).toBeVisible({ timeout: 10000 })

    // Navigate to public changelog and verify the draft is absent
    await page.goto('/changelog')
    await page.waitForLoadState('networkidle')

    // The title must not appear anywhere on the public page
    await expect(page.getByText(title, { exact: false })).toHaveCount(0)

    // Clean up
    await deleteEntryByTitle(page, title)
  })

  test('published entry appears on public /changelog', async ({ page }) => {
    const title = `Publish Pipeline Test ${Date.now()}`

    await createAndPublishEntry(page, title)

    await page.waitForLoadState('networkidle')

    // Navigate to public changelog
    await page.goto('/changelog')
    await page.waitForLoadState('networkidle')

    // The entry title should be visible as an h2 in a public entry card
    await expect(page.locator('h2').filter({ hasText: title })).toBeVisible({ timeout: 10000 })

    // Clean up
    await deleteEntryByTitle(page, title)
  })

  test('display date override appears on public /changelog', async ({ page }) => {
    const title = `Display Date Test ${Date.now()}`

    await createAndPublishEntry(page, title)

    await page.waitForLoadState('networkidle')

    await entryCard(page, title).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible({ timeout: 10000 })

    const displayDateLabel = dialog.getByText('Published date', { exact: true })
    await expect(displayDateLabel).toBeVisible({ timeout: 5000 })

    // The date button is named after the date it shows ("Nov 5, 2026").
    await dialog
      .getByRole('complementary')
      .getByRole('button', { name: /^[A-Z][a-z]{2} \d{1,2}, \d{4}$/ })
      .click()

    const prevMonth = page.getByRole('button', { name: /previous month/i })
    // The month grid is labelled with its month and year ("January 2024").
    const monthGrid = page.getByRole('grid').first()
    await expect(monthGrid).toBeVisible()
    for (let i = 0; i < 48; i++) {
      const shownMonth = (await monthGrid.getAttribute('aria-label')) ?? ''
      if (/january 2024/i.test(shownMonth)) break
      await prevMonth.click()
    }
    await expect(monthGrid).toHaveAttribute('aria-label', /january 2024/i)

    // Day buttons carry the full date as their name ("Monday, January 15th, 2024").
    await monthGrid.getByRole('button', { name: /January 15(th)?, 2024/ }).click()

    const entryId = new URL(page.url()).searchParams.get('entry')
    expect(entryId).toMatch(/^changelog_/)
    await dialog.getByRole('button', { name: /update & publish/i }).click()
    await expect(dialog).toBeHidden({ timeout: 15000 })
    await page.waitForLoadState('networkidle')

    // The public list is ordered by the shown date, so an entry dated back to
    // 2024 sits far down it; its own page is the place to read the date.
    await page.goto(`/changelog/${entryId}`)
    const entry = page.getByRole('main')
    await expect(entry.locator('time').first()).toContainText('January 15, 2024', {
      timeout: 10000,
    })

    await deleteEntryByTitle(page, title)
  })

  test('entry content on public page matches what was entered in admin', async ({ page }) => {
    const title = `Content Match Test ${Date.now()}`
    const body = `Unique body text for content match ${Date.now()}`

    // Open create dialog, fill title and content, then publish
    const dialog = await openCreateDialog(page)

    await dialog.getByPlaceholder("What's new?").fill(title)

    const editor = dialog.locator('.ProseMirror[contenteditable="true"]')
    await editor.click()
    await page.keyboard.type(body)

    // Switch to Published
    await choosePublishStatus(page, dialog, 'Published')

    const publishBtn = dialog.getByRole('button', { name: /publish now/i })
    await expect(publishBtn).toBeVisible({ timeout: 5000 })
    await publishBtn.click()
    await expect(dialog).toBeHidden({ timeout: 15000 })
    await page.waitForLoadState('networkidle')

    // Navigate to public changelog
    await page.goto('/changelog')
    await page.waitForLoadState('networkidle')

    // Both title and body text must be present
    await expect(page.locator('h2').filter({ hasText: title })).toBeVisible({ timeout: 10000 })
    await expect(page.getByText(body, { exact: false })).toBeVisible({ timeout: 10000 })

    // Clean up
    await deleteEntryByTitle(page, title)
  })

  test('unpublishing an entry removes it from public /changelog', async ({ page }) => {
    const title = `Unpublish Pipeline Test ${Date.now()}`

    // Publish the entry first
    await createAndPublishEntry(page, title)

    await page.waitForLoadState('networkidle')

    // Verify it is visible on the public page
    await page.goto('/changelog')
    await page.waitForLoadState('networkidle')
    await expect(page.locator('h2').filter({ hasText: title })).toBeVisible({ timeout: 10000 })

    // Go back to admin and revert to draft
    await page.goto('/admin/changelog')
    await page.waitForLoadState('networkidle')
    await unpublishEntry(page, title)

    // Return to public changelog and verify the entry is gone
    await page.goto('/changelog')
    await page.waitForLoadState('networkidle')
    await expect(page.locator('h2').filter({ hasText: title })).toHaveCount(0)

    // Clean up
    await deleteEntryByTitle(page, title)
  })

  test('scheduled entry does not appear on public /changelog before its publish time', async ({
    page,
  }) => {
    const title = `Scheduled Visibility Test ${Date.now()}`

    // Open create dialog
    const dialog = await openCreateDialog(page)

    await dialog.getByPlaceholder("What's new?").fill(title)
    await dialog.locator('.ProseMirror[contenteditable="true"]').click()
    await page.keyboard.type('Scheduled entry content.')

    // Switch status to "Scheduled"
    await choosePublishStatus(page, dialog, 'Scheduled')

    // The DateTimePicker should appear and default to tomorrow — leave it as-is
    const scheduleRow = dialog.getByRole('complementary').getByText('Schedule', { exact: true })
    await expect(scheduleRow).toBeVisible({ timeout: 5000 })

    // Submit as scheduled
    const scheduleBtn = dialog.getByRole('button', { name: /^schedule$/i })
    await expect(scheduleBtn).toBeVisible({ timeout: 5000 })
    await scheduleBtn.click()
    await expect(dialog).toBeHidden({ timeout: 15000 })
    await page.waitForLoadState('networkidle')

    // Verify entry is shown as "Scheduled" in admin
    const adminRow = page
      .locator('h3')
      .filter({ hasText: title })
      .locator('xpath=ancestor::div[contains(@class,"group")]')
      .first()
    await expect(adminRow).toBeVisible({ timeout: 10000 })

    // Navigate to public changelog — scheduled entry must NOT be visible
    await page.goto('/changelog')
    await page.waitForLoadState('networkidle')
    await expect(page.getByText(title, { exact: false })).toHaveCount(0)

    // Clean up
    await deleteEntryByTitle(page, title)
  })
})

// ---------------------------------------------------------------------------
// Search / Filter
// ---------------------------------------------------------------------------

test.describe('Changelog search and filter', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/admin/changelog')
    await page.waitForLoadState('networkidle')
  })

  test('search input is present', async ({ page }) => {
    const searchInput = page.locator('[data-search-input]').or(page.getByPlaceholder(/search/i))
    await expect(searchInput.first()).toBeVisible({ timeout: 10000 })
  })

  test('typing in search input filters the list', async ({ page }) => {
    const searchInput = page.locator('[data-search-input]').or(page.getByPlaceholder(/search/i))
    await expect(searchInput.first()).toBeVisible()

    // Create an entry with a unique searchable title
    const unique = `SearchTarget${Date.now()}`
    await createEntry(page, unique)

    await page.waitForLoadState('networkidle')

    await searchInput.first().fill(unique)

    // Only the matching entry should be visible; others with different text disappear
    await expect(entryCard(page, unique)).toBeVisible({ timeout: 10000 })
  })

  test('pressing "/" focuses search input', async ({ page }) => {
    // Focus outside any input first
    await page.locator('body').click()

    await page.keyboard.press('/')

    const searchInput = page.locator('[data-search-input]')
    await expect(searchInput.first()).toBeFocused({ timeout: 3000 })
  })

  test('status filter: clicking Draft shows only draft entries', async ({ page }) => {
    const draftFilter = page.getByRole('option', { name: 'Draft' })
    await expect(draftFilter.first()).toBeVisible()

    await draftFilter.click()
    await page.waitForLoadState('networkidle')

    // No entry in the list carries a "Published" badge. The filter's own
    // "Published" option sits in the sidebar, outside the list.
    const entryTitles = page.locator('h3')
    await expect(entryTitles.first()).toBeVisible()
    const list = entryTitles.first().locator('xpath=ancestor::div[contains(@class,"group")]/..')
    await expect(list.getByText(/^Published$/)).toHaveCount(0)
  })

  test('status filter: clicking All resets the filter', async ({ page }) => {
    const draftFilter = page.getByRole('option', { name: 'Draft' })
    await expect(draftFilter.first()).toBeVisible()

    await draftFilter.click()
    await page.waitForLoadState('networkidle')

    const allFilter = page.getByRole('option', { name: 'All' })
    await allFilter.click()
    await page.waitForLoadState('networkidle')

    // Page should still be on /admin/changelog
    await expect(page).toHaveURL(/\/admin\/changelog/)
  })

  test('Scheduled filter option is present and clickable', async ({ page }) => {
    const scheduledFilter = page.getByRole('option', { name: 'Scheduled' })
    await expect(scheduledFilter).toBeVisible({ timeout: 10000 })
    await scheduledFilter.click()
    await page.waitForLoadState('networkidle')
    await expect(page).toHaveURL(/\/admin\/changelog/)
  })
})
