import { test, expect } from '@playwright/test'

/**
 * Segment management lives in the Users page sidebar (desktop-only nav).
 * The create/edit dialogs are the shared <SegmentFormDialog>.
 */
test.describe('Admin Users Segments', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/admin/users')
    await page.waitForLoadState('networkidle')
  })

  test('sidebar shows Segments section with create button', async ({ page }) => {
    await expect(page.getByText('Segments', { exact: true })).toBeVisible({ timeout: 10000 })
    await expect(page.getByRole('button', { name: 'Create segment' })).toBeVisible()
  })

  test('lists the seeded segments, each with an edit action', async ({ page }) => {
    // The seed creates segments, so the list is never empty here; every row
    // carries its (hover-revealed) edit button in the DOM.
    const editButtons = page.locator('button[title="Edit segment"]')
    await expect(editButtons.first()).toBeAttached({ timeout: 10000 })
    expect(await editButtons.count()).toBeGreaterThan(0)
  })

  test('can open "Create segment" dialog', async ({ page }) => {
    await page.getByRole('button', { name: 'Create segment' }).click()

    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible({ timeout: 5000 })
    await expect(dialog.getByRole('heading', { name: 'Create Segment' })).toBeVisible()
  })

  test('create dialog has manual and dynamic type selectors', async ({ page }) => {
    await page.getByRole('button', { name: 'Create segment' }).click()

    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible({ timeout: 5000 })

    // Type selector buttons (manual / dynamic) — text is lowercase in the DOM (CSS capitalize)
    await expect(dialog.getByRole('button', { name: /^manual/ })).toBeVisible()
    await expect(dialog.getByRole('button', { name: /^dynamic/ })).toBeVisible()
  })

  test('create dialog has name and description fields', async ({ page }) => {
    await page.getByRole('button', { name: 'Create segment' }).click()

    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible({ timeout: 5000 })

    await expect(dialog.locator('#seg-name')).toBeVisible()
    await expect(dialog.locator('#seg-desc')).toBeVisible()

    await expect(dialog.getByRole('button', { name: /cancel/i })).toBeVisible()
    await expect(dialog.getByRole('button', { name: /create segment/i })).toBeVisible()
  })

  test('create button is disabled until name is filled', async ({ page }) => {
    await page.getByRole('button', { name: 'Create segment' }).click()

    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible({ timeout: 5000 })

    const submitButton = dialog.getByRole('button', { name: /create segment/i })
    await expect(submitButton).toBeDisabled()

    await dialog.locator('#seg-name').fill('My Segment')
    await expect(submitButton).toBeEnabled()
  })

  test('cancel button closes the dialog', async ({ page }) => {
    await page.getByRole('button', { name: 'Create segment' }).click()

    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible({ timeout: 5000 })

    await dialog.getByRole('button', { name: /cancel/i }).click()
    await expect(dialog).toBeHidden({ timeout: 5000 })
  })

  test('can create a manual segment', async ({ page }) => {
    const segmentName = `E2E Manual ${Date.now()}`

    await page.getByRole('button', { name: 'Create segment' }).click()

    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible({ timeout: 5000 })

    // Manual is the default type — just fill name
    await dialog.locator('#seg-name').fill(segmentName)
    await dialog.locator('#seg-desc').fill('Created by E2E test')

    await dialog.getByRole('button', { name: /create segment/i }).click()
    await expect(dialog).toBeHidden({ timeout: 10000 })

    // New segment should appear in the sidebar nav
    await expect(page.getByText(segmentName)).toBeVisible({ timeout: 10000 })
  })

  test('dynamic type shows rule builder section', async ({ page }) => {
    await page.getByRole('button', { name: 'Create segment' }).click()

    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible({ timeout: 5000 })

    // Click the "dynamic" type option (text is lowercase in DOM; CSS capitalize makes it visually "Dynamic")
    await dialog.getByRole('button', { name: /^dynamic/ }).click()

    // Rule builder should appear
    await expect(dialog.getByText('Rules', { exact: true })).toBeVisible({ timeout: 3000 })
    await expect(dialog.getByText(/add condition/i)).toBeVisible()
  })

  test('dynamic rule builder has "Add condition" button', async ({ page }) => {
    await page.getByRole('button', { name: 'Create segment' }).click()

    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible({ timeout: 5000 })

    await dialog.getByRole('button', { name: /^dynamic/ }).click()

    const addConditionButton = dialog.getByRole('button', { name: /add condition/i })
    await expect(addConditionButton).toBeVisible({ timeout: 3000 })

    // Click "Add condition" — a condition row should appear
    await addConditionButton.click()

    // Condition row has attribute + operator dropdowns
    const conditionSelects = dialog.locator('[role="combobox"]')
    await expect(conditionSelects.first()).toBeVisible({ timeout: 3000 })
  })

  test('condition row has attribute and operator selectors', async ({ page }) => {
    await page.getByRole('button', { name: 'Create segment' }).click()

    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible({ timeout: 5000 })

    await dialog.getByRole('button', { name: /^dynamic/ }).click()
    await dialog.getByRole('button', { name: /add condition/i }).click()

    // At least 2 comboboxes: attribute + operator
    const comboboxes = dialog.locator('[role="combobox"]')
    await expect(comboboxes).toHaveCount(3) // match (all/any) + attribute + operator
  })

  test('condition attribute dropdown contains built-in options', async ({ page }) => {
    await page.getByRole('button', { name: 'Create segment' }).click()

    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible({ timeout: 5000 })

    await dialog.getByRole('button', { name: /^dynamic/ }).click()
    await dialog.getByRole('button', { name: /add condition/i }).click()

    // Click the attribute combobox (second combobox — first is match all/any)
    const comboboxes = dialog.locator('[role="combobox"]')
    await comboboxes.nth(1).click()

    await expect(page.getByRole('option', { name: 'Name', exact: true })).toBeVisible()
    await expect(page.getByRole('option', { name: 'Email', exact: true })).toBeVisible()

    await page.keyboard.press('Escape')
  })

  test('can create a dynamic segment with a condition', async ({ page }) => {
    const segmentName = `E2E Dynamic ${Date.now()}`

    await page.getByRole('button', { name: 'Create segment' }).click()

    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible({ timeout: 5000 })

    await dialog.getByRole('button', { name: /^dynamic/ }).click()
    await dialog.locator('#seg-name').fill(segmentName)

    // Add a condition
    await dialog.getByRole('button', { name: /add condition/i }).click()

    // Condition: Email Verified is True (a boolean field needs no typed value)
    const comboboxes = dialog.locator('[role="combobox"]')
    await comboboxes.nth(1).click()
    await page.getByRole('option', { name: 'Email Verified', exact: true }).click()
    await expect(comboboxes.nth(1)).toHaveText('Email Verified')
    await expect(comboboxes.nth(3)).toHaveText('True')

    await dialog.getByRole('button', { name: /create segment/i }).click()
    await expect(dialog).toBeHidden({ timeout: 10000 })

    await expect(page.getByText(segmentName)).toBeVisible({ timeout: 10000 })
  })

  test('can open edit dialog for an existing segment', async ({ page }) => {
    // Create a segment so a row is guaranteed to exist
    const segmentName = `E2E EditTarget ${Date.now()}`

    await page.getByRole('button', { name: 'Create segment' }).click()
    const createDialog = page.getByRole('dialog')
    await expect(createDialog).toBeVisible({ timeout: 5000 })
    await createDialog.locator('#seg-name').fill(segmentName)
    await createDialog.getByRole('button', { name: /create segment/i }).click()
    await expect(createDialog).toBeHidden({ timeout: 10000 })

    const segButton = page.getByRole('button', { name: segmentName })
    await expect(segButton).toBeVisible({ timeout: 10000 })

    // Edit/delete actions only show on row hover
    await segButton.hover()
    await page.getByRole('button', { name: 'Edit segment' }).first().click()

    const editDialog = page.getByRole('dialog')
    await expect(editDialog).toBeVisible({ timeout: 5000 })

    // Edit dialog title should say "Edit Segment"
    await expect(editDialog.getByText(/edit segment/i)).toBeVisible()

    // Save button should say "Save changes"
    await expect(editDialog.getByRole('button', { name: /save changes/i })).toBeVisible()

    // Type selector should NOT be shown when editing
    await expect(editDialog.getByText('manual')).not.toBeVisible()

    await editDialog.getByRole('button', { name: /cancel/i }).click()
    await expect(editDialog).toBeHidden({ timeout: 5000 })
  })

  test('can delete a segment with confirmation', async ({ page }) => {
    const segmentName = `E2E Delete Seg ${Date.now()}`

    // Create a segment to delete
    await page.getByRole('button', { name: 'Create segment' }).click()
    const createDialog = page.getByRole('dialog')
    await expect(createDialog).toBeVisible({ timeout: 5000 })
    await createDialog.locator('#seg-name').fill(segmentName)
    await createDialog.getByRole('button', { name: /create segment/i }).click()
    await expect(createDialog).toBeHidden({ timeout: 10000 })

    const segButton = page.getByRole('button', { name: segmentName })
    await expect(segButton).toBeVisible({ timeout: 10000 })

    // Hover the row to reveal the delete (trash) action
    await segButton.hover()
    await page.getByRole('button', { name: 'Delete segment' }).first().click()

    // Confirmation dialog should appear and mention the segment name
    const confirmDialog = page.getByRole('alertdialog').or(page.getByRole('dialog'))
    await expect(confirmDialog).toBeVisible({ timeout: 5000 })
    await expect(confirmDialog.getByText(segmentName)).toBeVisible()

    // Confirm deletion
    await confirmDialog.getByRole('button', { name: /^delete$/i }).click()

    // The dialog closes and the segment's nav row is gone. (The name is not
    // looked up page-wide: the closing dialog still quotes it for a moment.)
    await expect(confirmDialog).toBeHidden({ timeout: 10000 })
    await expect(page.getByRole('button', { name: segmentName })).toHaveCount(0)
  })

  test('delete confirmation can be cancelled', async ({ page }) => {
    const segmentName = `E2E Cancel Del Seg ${Date.now()}`

    await page.getByRole('button', { name: 'Create segment' }).click()
    const createDialog = page.getByRole('dialog')
    await expect(createDialog).toBeVisible({ timeout: 5000 })
    await createDialog.locator('#seg-name').fill(segmentName)
    await createDialog.getByRole('button', { name: /create segment/i }).click()
    await expect(createDialog).toBeHidden({ timeout: 10000 })

    const segButton = page.getByRole('button', { name: segmentName })
    await expect(segButton).toBeVisible({ timeout: 10000 })

    await segButton.hover()
    await page.getByRole('button', { name: 'Delete segment' }).first().click()

    const confirmDialog = page.getByRole('alertdialog').or(page.getByRole('dialog'))
    await expect(confirmDialog).toBeVisible({ timeout: 5000 })

    // Cancel — segment should still be present
    await confirmDialog.getByRole('button', { name: /cancel/i }).click()
    await expect(confirmDialog).toBeHidden({ timeout: 5000 })
    await expect(page.getByText(segmentName)).toBeVisible()
  })

  test('rule builder match selector has ALL and ANY options', async ({ page }) => {
    await page.getByRole('button', { name: 'Create segment' }).click()

    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible({ timeout: 5000 })

    await dialog.getByRole('button', { name: /^dynamic/ }).click()
    await dialog.getByRole('button', { name: /add condition/i }).click()

    // The match selector is the first combobox (renders "ALL" / "ANY")
    const matchSelect = dialog.locator('[role="combobox"]').first()
    await matchSelect.click()

    await expect(page.getByRole('option', { name: 'ALL', exact: true })).toBeVisible()
    await expect(page.getByRole('option', { name: 'ANY', exact: true })).toBeVisible()

    await page.keyboard.press('Escape')
  })
})
