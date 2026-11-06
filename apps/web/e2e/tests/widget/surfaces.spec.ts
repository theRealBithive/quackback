import { test, expect } from '@playwright/test'
import { setHelpCenter, setWidgetSurfaces } from '../../utils/db-helpers'
import { HELP_CENTER_FIXTURE } from '../../fixtures/help-center'
import { setWorkspaceAnon } from '../../utils/access-helpers'

test.describe('Widget visitor surfaces', { tag: '@smoke' }, () => {
  test.beforeAll(() => {
    setWidgetSurfaces(true)
    // The Help tab lists categories; the fixture guarantees one.
    setHelpCenter(true)
    // The post detail offers "Log in to join the conversation" only while the
    // workspace does not allow anonymous comments; voting.spec.ts turns that on.
    setWorkspaceAnon(false)
  })

  test('Feedback tab lists posts and opens post detail', async ({ page }) => {
    await page.goto('/widget')
    await page.getByRole('button', { name: 'Feedback', exact: true }).click()
    const vote = page.getByRole('button', { name: /^Vote \(/ }).first()
    await expect(vote).toBeVisible({ timeout: 15000 })

    const postRow = page
      .locator('button')
      .filter({ has: page.locator('p.font-medium') })
      .first()
    await expect(postRow).toBeVisible()
    await postRow.click()
    await expect(page.getByRole('button', { name: 'Go back' })).toBeVisible({ timeout: 10000 })
    await expect(page.getByRole('heading').first()).toBeVisible()
    await expect(
      page.getByRole('button', { name: 'Log in to join the conversation' })
    ).toBeVisible()
  })

  test('Help tab loads via the widget BFF', async ({ page }) => {
    await page.goto('/widget')
    await page.getByRole('button', { name: 'Help', exact: true }).click()
    const search = page.getByRole('textbox', { name: 'Search help articles' })
    await expect(search).toBeVisible({ timeout: 10000 })
    await expect(page.getByText(HELP_CENTER_FIXTURE.categoryName).first()).toBeVisible({
      timeout: 10000,
    })
    await expect(page.getByText('No articles yet')).toHaveCount(0)
  })

  test('Changelog tab loads via the widget BFF', async ({ page }) => {
    await page.goto('/widget')
    await page.getByRole('button', { name: 'Changelog', exact: true }).click()
    const latest = page.getByRole('heading', { name: 'Latest' })
    const empty = page.getByText('No updates yet')
    await expect(latest.or(empty)).toBeVisible({ timeout: 10000 })
  })

  test('anonymous visitors do not see the Tickets tab', async ({ page }) => {
    await page.goto('/widget')
    await expect(page.getByRole('button', { name: 'Home', exact: true })).toBeVisible({
      timeout: 10000,
    })
    await expect(page.getByRole('button', { name: /^(?:\d+ unread )?Tickets$/ })).toHaveCount(0)
  })
})
