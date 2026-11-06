import { test, expect, type Page } from '@playwright/test'

// Webhooks live on the Webhooks tab of the Developers settings page. The
// seeded workspace has none, so the file walks one webhook through its life:
// the empty state, the create dialog's rules, creation, the list row, and
// deletion. Serial, because each step reads what the one before left behind.

const WEBHOOKS_URL = '/admin/settings/developers?tab=webhooks'
const webhookUrl = `https://example.com/e2e-webhook-${Date.now()}`

async function openWebhooksTab(page: Page): Promise<void> {
  await page.goto(WEBHOOKS_URL)
  await page.waitForLoadState('networkidle')
  await expect(page.getByText('Configured Webhooks')).toBeVisible({ timeout: 10_000 })
}

/** Opens the create dialog from whichever create button the list state shows. */
async function openCreateDialog(page: Page) {
  const createButton = page
    .getByRole('button', { name: 'Create Webhook' })
    .or(page.getByRole('button', { name: 'Create your first webhook' }))
  const dialog = page.getByRole('dialog')
  // The button is server-rendered; a click before hydration opens nothing.
  await expect(async () => {
    if (!(await dialog.isVisible())) {
      await createButton.click()
    }
    await expect(dialog).toBeVisible({ timeout: 2000 })
  }).toPass({ timeout: 15_000 })
  await expect(dialog.getByRole('heading', { name: 'Create Webhook' })).toBeVisible()
  return dialog
}

test.describe('Admin Webhooks Settings', () => {
  test.describe.configure({ mode: 'serial' })

  test.beforeEach(async ({ page }) => {
    await openWebhooksTab(page)
  })

  test('shows the empty state with its create button and the verification guide', async ({
    page,
  }) => {
    await expect(page.getByText('No webhooks configured')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Create your first webhook' })).toBeVisible()
    await expect(page.getByText(/verif/i).first()).toBeVisible()
  })

  test('the create dialog asks for an endpoint URL and at least one event', async ({ page }) => {
    const dialog = await openCreateDialog(page)

    await expect(dialog.getByLabel('Endpoint URL')).toBeVisible()
    await expect(dialog.getByPlaceholder('https://example.com/webhook')).toBeVisible()
    await expect(dialog.getByText('Events')).toBeVisible()
    await expect(dialog.getByRole('checkbox').first()).toBeVisible()

    const submit = dialog.getByRole('button', { name: 'Create Webhook' })
    await expect(submit).toBeDisabled()

    await dialog.getByLabel('Endpoint URL').fill('https://example.com/webhook')
    await expect(submit).toBeDisabled()

    await dialog.getByRole('checkbox').first().click()
    await expect(submit).toBeEnabled()
  })

  test('the create dialog closes with Escape and with Cancel', async ({ page }) => {
    const dialog = await openCreateDialog(page)
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()

    await openCreateDialog(page)
    await dialog.getByRole('button', { name: 'Cancel' }).click()
    await expect(dialog).toBeHidden()
  })

  test('creating a webhook reveals its secret once and lists it as active', async ({ page }) => {
    const dialog = await openCreateDialog(page)
    await dialog.getByLabel('Endpoint URL').fill(webhookUrl)
    await dialog.getByRole('checkbox', { name: 'Subscribe to New Post Created events' }).click()
    await dialog.getByRole('button', { name: 'Create Webhook' }).click()

    await expect(page.getByText('Signing Secret')).toBeVisible({ timeout: 10_000 })
    await page.getByRole('button', { name: "I've saved my secret" }).click()
    await expect(page.getByRole('dialog')).toBeHidden()

    const row = page.locator('div.rounded-lg.border').filter({ hasText: webhookUrl })
    await expect(row).toBeVisible()
    await expect(row.getByText('Active')).toBeVisible()
    await expect(row.getByText('New Post')).toBeVisible()
    await expect(page.getByText('1 of 25 webhooks')).toBeVisible()
  })

  test('deleting the webhook asks first and then removes it', async ({ page }) => {
    await page.getByRole('button', { name: `Delete webhook ${webhookUrl}` }).click()

    const confirm = page.getByRole('alertdialog')
    await expect(confirm.getByRole('heading', { name: 'Delete Webhook' })).toBeVisible()
    await confirm.getByRole('button', { name: 'Cancel' }).click()
    await expect(confirm).toBeHidden()
    await expect(page.getByText(webhookUrl)).toBeVisible()

    await page.getByRole('button', { name: `Delete webhook ${webhookUrl}` }).click()
    await confirm.getByRole('button', { name: 'Delete Webhook' }).click()
    // The closing dialog still quotes the URL for a moment, so the dialog is
    // checked first and then the row.
    await expect(confirm).toBeHidden({ timeout: 10_000 })
    await expect(page.locator('div.rounded-lg.border').filter({ hasText: webhookUrl })).toHaveCount(
      0
    )
    await expect(page.getByText('No webhooks configured')).toBeVisible()
  })
})
