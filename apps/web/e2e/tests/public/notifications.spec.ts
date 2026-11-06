import { test, expect } from '@playwright/test'

/**
 * Portal notifications page, visited anonymously.
 *
 * Contract (confirmed 2026-11-05):
 *   N1 An anonymous visitor to /notifications is redirected to the portal home.
 *   N2 A signed-in visitor stays on /notifications.
 *
 * N2 needs a signed-in portal session; the route's `beforeLoad` is covered for
 * both cases in `src/routes/_portal/__tests__/notifications.redirect.test.ts`.
 *
 * The page used to accept either a redirect or a page that hid its heading, and
 * compared the URL against a hardcoded `acme.localhost:3000`, so it passed on
 * neither port nor behaviour in particular.
 */

test.describe('Portal Notifications (unauthenticated)', () => {
  test('an anonymous visitor to /notifications lands on the portal home (N1)', async ({ page }) => {
    await page.goto('/notifications')

    await expect(page).toHaveURL((url) => url.pathname === '/')
    await expect(page.getByRole('heading', { name: 'Notifications' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: /log in/i }).first()).toBeVisible()
  })

  test('the portal header offers Log in and Sign up and no notification bell', async ({ page }) => {
    await page.goto('/')

    await expect(page.getByRole('button', { name: /log in/i }).first()).toBeVisible()
    await expect(page.getByRole('button', { name: /sign up/i }).first()).toBeVisible()
    await expect(page.getByRole('button', { name: 'Notifications' })).toHaveCount(0)
  })
})
