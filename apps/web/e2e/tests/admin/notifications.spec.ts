import { test, expect, type Page } from '@playwright/test'
import { seedAdminNotifications } from '../../utils/db-helpers'
import { waitForHydration } from '../../utils/helpers'

// The seed gives the admin no notifications, so each test states the list it
// needs: none, or two unread and one read (none linked to a post, so an
// unread row is a button that marks itself read).

async function openNotifications(page: Page): Promise<void> {
  await page.goto('/admin/notifications')
  await page.waitForLoadState('networkidle')
  await expect(page.getByRole('heading', { level: 1, name: 'Notifications' })).toBeVisible({
    timeout: 10_000,
  })
  // The tabs and the actions menu are server-rendered; a click before
  // hydration does nothing.
  await waitForHydration(page.getByRole('button', { name: 'More notification actions' }))
}

/** The summary line under the page heading. */
function summaryLine(page: Page) {
  return page.getByRole('heading', { level: 1, name: 'Notifications' }).locator('xpath=../p')
}

test.describe('Admin Notifications Page', () => {
  test.describe.configure({ mode: 'serial' })

  test('with no notifications it shows the empty state and no bulk action', async ({ page }) => {
    seedAdminNotifications('empty')
    await openNotifications(page)

    await expect(summaryLine(page)).toHaveText('No notifications')
    await expect(page.getByText('No notifications yet')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Mark all as read' })).toHaveCount(0)
  })

  test('lists every notification and counts the unread ones', async ({ page }) => {
    const seeded = seedAdminNotifications()
    await openNotifications(page)

    await expect(summaryLine(page)).toHaveText('2 unread of 3')
    for (const title of [...seeded.unread, ...seeded.read]) {
      await expect(page.getByText(title)).toBeVisible()
    }
    await expect(page.getByRole('heading', { level: 2, name: 'Today' })).toBeVisible()
  })

  test('the Unread tab shows only the unread notifications', async ({ page }) => {
    const seeded = seedAdminNotifications()
    await openNotifications(page)

    await page.getByRole('tab', { name: /Unread/ }).click()
    await expect(page).toHaveURL(/filter=unread/)
    for (const title of seeded.unread) {
      await expect(page.getByText(title)).toBeVisible()
    }
    await expect(page.getByText(seeded.read[0])).toHaveCount(0)
  })

  test('clicking an unread notification marks it read', async ({ page }) => {
    const seeded = seedAdminNotifications()
    await openNotifications(page)

    await page.getByRole('button', { name: new RegExp(seeded.unread[0]) }).click()
    await expect(summaryLine(page)).toHaveText('1 unread of 3')

    await page.reload()
    await expect(summaryLine(page)).toHaveText('1 unread of 3')
  })

  test('"Mark all as read" clears the unread count and then disappears', async ({ page }) => {
    seedAdminNotifications()
    await openNotifications(page)

    await page.getByRole('button', { name: 'Mark all as read' }).click()
    await expect(summaryLine(page)).toHaveText('3 notifications — all caught up')
    await expect(page.getByRole('button', { name: 'Mark all as read' })).toHaveCount(0)
  })

  test('"Archive all read" asks first and then removes the read notifications', async ({
    page,
  }) => {
    const seeded = seedAdminNotifications()
    await openNotifications(page)

    await page.getByRole('button', { name: 'More notification actions' }).click()
    await page.getByRole('menuitem', { name: 'Archive all read' }).click()
    const confirm = page.getByRole('alertdialog')
    await expect(confirm.getByText('Archive all read notifications?')).toBeVisible()
    await confirm.getByRole('button', { name: 'Archive' }).click()

    await expect(page.getByText(seeded.read[0])).toHaveCount(0)
    await expect(summaryLine(page)).toHaveText('2 unread of 2')
  })
})
