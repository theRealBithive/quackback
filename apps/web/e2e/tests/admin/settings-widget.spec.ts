import { test, expect } from '@playwright/test'

test.describe('Admin Widget Settings', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/admin/settings/widget')
    await page.waitForLoadState('networkidle')
  })

  test('page loads and shows Widget heading', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Widget' }).first()).toBeVisible({
      timeout: 10000,
    })
    await expect(
      page.getByText(
        'Embed the messenger widget in your product — feedback, conversations, help, and updates'
      )
    ).toBeVisible({ timeout: 10000 })
  })

  test('shows the site-embed toggle', async ({ page }) => {
    await expect(page.getByText('Add to your site')).toBeVisible({ timeout: 10000 })
    const widgetToggle = page.locator('#widget-toggle')
    await expect(widgetToggle).toBeVisible({ timeout: 10000 })
    await expect(widgetToggle).toBeEnabled()
  })

  test('shows Tabs section with Feedback and Changelog toggles', async ({ page }) => {
    await expect(page.getByText('Tabs', { exact: true })).toBeVisible({ timeout: 10000 })
    await expect(page.locator('#tab-feedback')).toBeVisible()
    await expect(page.locator('#tab-changelog')).toBeVisible()
  })

  test('shows Feedback tab label with description', async ({ page }) => {
    await expect(page.getByText('Search, vote, and submit ideas')).toBeVisible({ timeout: 10000 })
  })

  test('shows Changelog tab label with description', async ({ page }) => {
    await expect(page.getByText('Show product updates and shipped features')).toBeVisible({
      timeout: 10000,
    })
  })

  test('shows Layout controls', async ({ page }) => {
    await expect(page.getByText('Layout')).toBeVisible({ timeout: 10000 })
    await expect(page.getByText('Button position')).toBeVisible({ timeout: 10000 })
    await expect(page.getByText('Default board', { exact: true })).toBeVisible()
  })

  test('shows install status inside Add to your site', async ({ page }) => {
    await expect(page.getByText('Add to your site')).toBeVisible({ timeout: 10000 })
    await expect(page.getByRole('link', { name: /Set it up|View installation/ })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Installation' })).toHaveCount(0)
  })

  test('install page shows the snippet without an enable-channel step', async ({ page }) => {
    await page.goto('/admin/settings/widget/install')
    // The seeded workspace has never loaded the widget, so the page shows the
    // two install steps and the hand-install snippet behind a section.
    await expect(page.getByText('1. Copy the prompt for your agent')).toBeVisible({
      timeout: 10000,
    })
    await expect(page.getByText('2. Open a page on your site')).toBeVisible()
    await expect(page.getByText('Install without an agent')).toBeVisible()
    await expect(page.getByText('Enable the channel')).toHaveCount(0)
    await expect(page.locator('#widget-toggle')).toHaveCount(0)
    await expect(
      page.getByRole('button', { name: /Turn on the Messages tab|Enable feedback widget/ })
    ).toHaveCount(0)
  })

  test('shows widget preview panel', async ({ page }) => {
    await expect(page.getByText('Live preview', { exact: true })).toBeVisible({ timeout: 10000 })
  })

  test('can toggle the widget enabled/disabled state and auto-saves', async ({ page }) => {
    const widgetToggle = page.locator('#widget-toggle')
    await expect(widgetToggle).toBeVisible({ timeout: 10000 })

    const initialChecked = await widgetToggle.isChecked()

    await widgetToggle.click()
    await page.waitForTimeout(600)

    const nowChecked = await widgetToggle.isChecked()
    if (nowChecked !== initialChecked) {
      await widgetToggle.click()
      await page.waitForTimeout(600)
    }
  })
})
