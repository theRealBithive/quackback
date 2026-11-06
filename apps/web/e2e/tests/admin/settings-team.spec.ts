import { test, expect, type Page } from '@playwright/test'
import { seedRecentPortalSession } from '../../utils/db-helpers'

/**
 * Add people dialog, Cancel and the people list (confirmed 2026-11-06):
 *
 * P1 A click on Cancel closes the dialog on the first try, whether or not the
 *    people list is open.
 * P2 Opening or closing the people list moves nothing below the field (Role,
 *    Cancel, Add people), so every click on them lands on the first press.
 * P3 The list still closes when focus leaves the field and the list, and a
 *    person can still be chosen from it by mouse and by keyboard.
 *
 * P3 is held by the dialog's unit suites
 * (`components/admin/settings/team/__tests__/add-people-dialog.test.tsx`).
 */

/** Opens Add people, retrying the click until hydration has wired it up. */
async function openAddPeople(page: Page) {
  const dialog = page.getByRole('dialog')
  await expect(async () => {
    if (!(await dialog.isVisible())) {
      await page.getByRole('button', { name: /add people/i }).click()
    }
    await expect(dialog).toBeVisible({ timeout: 2000 })
  }).toPass({ timeout: 15_000 })
  return dialog
}

test.describe('Admin Team Settings', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/admin/settings/members')
    await page.waitForLoadState('networkidle')
  })

  test('displays team members page', async ({ page }) => {
    const pageContent = page.getByText(/team members/i).or(page.getByText(/manage who/i))
    await expect(pageContent.first()).toBeVisible({ timeout: 10000 })
  })

  test('shows at least one team member', async ({ page }) => {
    await page.waitForTimeout(500)

    // Each member row renders an Avatar and name/email — look for table rows
    const tableRows = page.locator('tbody tr')
    await expect(tableRows.first()).toBeVisible({ timeout: 10000 })
  })

  test('shows member email in table', async ({ page }) => {
    // The seeded admin user has an email — it appears as muted text in the name cell
    const emailCell = page.locator('p.text-sm.text-muted-foreground').filter({ hasText: /@/ })
    await expect(emailCell.first()).toBeVisible({ timeout: 10000 })
  })

  test('shows role badge for members', async ({ page }) => {
    // Role column renders a Badge with "admin" or "member"
    const roleBadge = page.getByText(/^admin$/i).or(page.getByText(/^member$/i))
    await expect(roleBadge.first()).toBeVisible({ timeout: 10000 })
  })

  test('shows "Add people" button', async ({ page }) => {
    const addButton = page.getByRole('button', { name: /add people/i })
    await expect(addButton).toBeVisible({ timeout: 10000 })
  })

  test('shows search input for filtering members', async ({ page }) => {
    const searchInput = page.getByPlaceholder(/search by name, email, or role/i)
    await expect(searchInput).toBeVisible({ timeout: 10000 })
  })

  test('search input filters the member list', async ({ page }) => {
    const searchInput = page.getByPlaceholder(/search by name, email, or role/i)
    await searchInput.fill('nonexistentuserxyz')

    await page.waitForTimeout(300)

    // The member table says so when nothing matches (the mobile list below
    // it repeats the message, hidden at this width).
    await expect(page.getByRole('cell', { name: 'No results found' })).toBeVisible({
      timeout: 5000,
    })

    // Clear search
    await searchInput.fill('')
  })

  test('can open the add people dialog', async ({ page }) => {
    const dialog = await openAddPeople(page)
    await expect(dialog.getByRole('heading', { name: 'Add people' })).toBeVisible()
  })

  test('add people dialog has the people field, role and actions', async ({ page }) => {
    const dialog = await openAddPeople(page)

    await expect(dialog.getByRole('combobox', { name: 'People' })).toBeVisible()
    await expect(dialog.getByText('Role', { exact: true })).toBeVisible()
    await expect(dialog.getByRole('button', { name: /cancel/i })).toBeVisible()
    // Nothing chosen yet, so there is nothing to add.
    await expect(dialog.getByRole('button', { name: /^add people$/i })).toBeDisabled()
  })

  test('add people dialog cancel closes the dialog (P1)', async ({ page }) => {
    const dialog = await openAddPeople(page)

    await dialog.getByRole('button', { name: /cancel/i }).click()
    await expect(dialog).toBeHidden({ timeout: 5000 })
  })

  test('Cancel closes on the first click while the people list is open (P1, P2)', async ({
    page,
  }) => {
    // Someone recently active, so the field opens its list on focus — the
    // state a full run reaches after the portal specs, set up here directly.
    seedRecentPortalSession()
    await page.reload()
    await page.waitForLoadState('networkidle')

    const dialog = await openAddPeople(page)
    const peopleList = dialog.getByRole('listbox', { name: 'Recently active' })
    await expect(peopleList).toBeVisible({ timeout: 10_000 })

    const cancel = dialog.getByRole('button', { name: 'Cancel' })
    const withListOpen = await cancel.boundingBox()

    // Focus leaves the field and the list, so the list closes (P3)...
    await dialog.getByRole('heading').click()
    await expect(peopleList).toBeHidden()
    // ...and nothing below the field has moved (P2).
    expect(await cancel.boundingBox()).toEqual(withListOpen)

    // Back into the field: the list is open again, and one click on Cancel
    // closes the dialog (P1). Before the fix, pressing Cancel hid the list,
    // Cancel jumped up under the pointer, and the click hit nothing.
    await dialog.getByRole('combobox', { name: 'People' }).focus()
    await expect(peopleList).toBeVisible()
    await cancel.click()
    await expect(dialog).toBeHidden({ timeout: 5000 })
  })

  test('typing a new full email offers to invite it', async ({ page }) => {
    const dialog = await openAddPeople(page)

    const address = `e2e-${Date.now()}@example.com`
    await dialog.getByRole('combobox', { name: 'People' }).fill(address)
    await dialog.getByRole('option', { name: `Invite ${address}` }).click()
    await expect(dialog.getByRole('button', { name: `Remove ${address}` })).toBeVisible()
    await expect(dialog.getByRole('button', { name: /^invite 1 person$/i })).toBeEnabled()

    await dialog.getByRole('button', { name: /cancel/i }).click()
  })

  test('shows "you" label next to the current user', async ({ page }) => {
    // The current admin's row in the member table carries "(you)"; the mobile
    // list repeats it, hidden at this width.
    const youLabel = page.getByRole('table').getByText('(you)', { exact: true })
    await expect(youLabel).toBeVisible({ timeout: 10000 })
    const currentUserRow = page
      .getByRole('table')
      .getByRole('row')
      .filter({ has: page.getByText('(you)', { exact: true }) })
    await expect(currentUserRow).toContainText('demo@example.com')
  })

  test('shows "Invited" badge for pending invitations if any exist', async ({ page }) => {
    await page.waitForTimeout(500)

    const invitedBadge = page.getByText('Invited')

    // Invited badge may not exist in a fresh seed — guard with count check
    if ((await invitedBadge.count()) > 0) {
      await expect(invitedBadge.first()).toBeVisible()
    }
  })
})
