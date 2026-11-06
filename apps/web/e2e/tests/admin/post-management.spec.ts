import { test, expect, type Locator, type Page } from '@playwright/test'
import { waitForHydration } from '../../utils/helpers'

// The admin feedback inbox, walked through with posts this file creates
// itself: one on "Feature Requests" that every later step works on, and one
// on "Integrations" that the board filter must hide. Serial, because each
// step reads what the one before it left behind; the seeded posts are only
// used where any post will do.

const runId = Date.now().toString(36)
const postTitle = `E2E managed post ${runId}`
const postBody = `Body written by the e2e suite ${runId}`
const otherBoardTitle = `E2E other board post ${runId}`
const editedTitle = `E2E edited post ${runId}`
const editedBody = `Edited body ${runId}`
const commentText = `E2E comment ${runId}`

async function openInbox(page: Page, search?: string): Promise<void> {
  const query = search ? `?search=${encodeURIComponent(search)}` : ''
  await page.goto(`/admin/feedback${query}`)
  await page.waitForLoadState('networkidle')
  await waitForHydration(page.getByRole('button', { name: 'Create new post' }))
}

function postCard(page: Page, title: string): Locator {
  return page.locator('[data-post-id]').filter({
    has: page.getByRole('heading', { level: 3, name: title, exact: true }),
  })
}

async function createPost(page: Page, title: string, body: string, board: string) {
  await page.getByRole('button', { name: 'Create new post' }).click()
  const dialog = page.getByRole('dialog', { name: 'Create new post' })
  await expect(dialog).toBeVisible()

  await dialog.getByPlaceholder("What's the feedback about?").fill(title)
  await dialog.locator('.tiptap').click()
  await page.keyboard.type(body)
  await dialog.getByRole('combobox').first().click()
  await page.getByRole('option', { name: board, exact: true }).click()
  await expect(dialog.getByRole('combobox').first()).toHaveText(board)

  await dialog.getByRole('button', { name: 'Create post' }).click()
  await expect(dialog).toBeHidden({ timeout: 10_000 })
}

/** Opens the post's modal from the inbox and waits for its form to load. */
async function openPostModal(page: Page, title: string): Promise<Locator> {
  await openInbox(page, title)
  await postCard(page, title).getByRole('heading', { level: 3 }).click()
  const modal = page.getByRole('dialog', { name: 'Edit post' })
  await expect(modal.getByPlaceholder("What's the feedback about?")).toHaveValue(title, {
    timeout: 10_000,
  })
  return modal
}

function sidebarButton(modal: Locator, label: string, current: string): Locator {
  return modal
    .getByRole('complementary')
    .getByText(label, { exact: true })
    .locator('xpath=following::button[1]')
    .filter({ hasText: current })
}

test.describe('Admin Post Management', () => {
  test.describe.configure({ mode: 'serial' })

  test('the inbox lists posts with their sort and filter controls', async ({ page }) => {
    await openInbox(page)

    await expect(page.locator('[data-post-id]').first()).toBeVisible()
    for (const sort of ['Newest', 'Oldest', 'Top Votes']) {
      await expect(page.getByRole('button', { name: sort })).toBeVisible()
    }
    await expect(page.getByRole('region', { name: 'Active filters' })).toBeVisible()
  })

  test('the create dialog offers author, board, status and a shortcut hint', async ({ page }) => {
    await openInbox(page)
    await page.getByRole('button', { name: 'Create new post' }).click()

    const dialog = page.getByRole('dialog', { name: 'Create new post' })
    await expect(dialog.getByPlaceholder("What's the feedback about?")).toBeVisible()
    const sidebar = dialog.getByRole('complementary')
    for (const label of ['Author', 'Board', 'Status']) {
      await expect(sidebar.getByText(label, { exact: true })).toBeVisible()
    }
    await expect(dialog.getByRole('combobox')).toHaveCount(2)
    await expect(dialog.getByText(/to create/)).toBeVisible()

    await dialog.getByRole('button', { name: 'Cancel' }).click()
    await expect(dialog).toBeHidden()
  })

  test('a created post appears in the inbox with its body', async ({ page }) => {
    await openInbox(page)
    await createPost(page, postTitle, postBody, 'Feature Requests')
    await createPost(page, otherBoardTitle, 'On another board', 'Integrations')

    await openInbox(page, postTitle)
    const card = postCard(page, postTitle)
    await expect(card).toBeVisible()
    await expect(card).toHaveAttribute('data-status', 'open')
    await expect(card.getByText(postBody)).toBeVisible()
  })

  test('the post modal shows the title, body, board, status and author', async ({ page }) => {
    const modal = await openPostModal(page, postTitle)

    await expect(modal.locator('.tiptap').first()).toContainText(postBody)
    await expect(sidebarButton(modal, 'Board', 'Feature Requests')).toBeVisible()
    await expect(sidebarButton(modal, 'Status', 'Open')).toBeVisible()
    await expect(
      modal.getByRole('complementary').getByRole('link', { name: /Demo User/ })
    ).toBeVisible()
  })

  test("the author's own vote counts, and voting from the inbox toggles it", async ({ page }) => {
    await openInbox(page, postTitle)
    const card = postCard(page, postTitle)

    // Creating a post votes for it on the author's behalf.
    const removeVote = card.getByRole('button', { name: /^Remove vote \(1 vote\)/ })
    // The search result list renders before it hydrates; a click before
    // hydration is lost.
    await waitForHydration(removeVote)
    await removeVote.click()

    const addVote = card.getByRole('button', { name: /^Vote for this post \(0 votes\)/ })
    await expect(addVote).toBeVisible()
    await addVote.click()
    await expect(removeVote).toBeVisible()
  })

  test('changing the status confirms it, updates the badge and persists', async ({ page }) => {
    const modal = await openPostModal(page, postTitle)

    await sidebarButton(modal, 'Status', 'Open').click()
    await page
      .locator('[data-slot="popover-content"]')
      .getByRole('button', { name: 'Planned' })
      .click()

    await expect(page.locator('[data-sonner-toast]').first()).toBeVisible()
    await expect(sidebarButton(modal, 'Status', 'Planned')).toBeVisible()

    await openInbox(page, postTitle)
    await expect(postCard(page, postTitle)).toHaveAttribute('data-status', 'planned')
    const reopened = await openPostModal(page, postTitle)
    await expect(sidebarButton(reopened, 'Status', 'Planned')).toBeVisible()
  })

  test('Cmd+Enter in the comment box posts a comment and leaves the post alone', async ({
    page,
  }) => {
    const modal = await openPostModal(page, postTitle)
    await expect(modal.getByRole('heading', { level: 2, name: '0 Comments' })).toBeVisible()

    const commentEditor = modal.locator('[data-testid="comment-form-editor"] .tiptap')
    await commentEditor.click()
    await page.keyboard.type(commentText)
    await page.keyboard.press('ControlOrMeta+Enter')

    await expect(modal.getByText(commentText)).toBeVisible({ timeout: 10_000 })
    await expect(modal.getByRole('heading', { level: 2, name: '1 Comment' })).toBeVisible()
    await expect(modal.getByPlaceholder("What's the feedback about?")).toHaveValue(postTitle)
    await expect(modal.getByRole('button', { name: 'Save Changes' })).toBeDisabled()
  })

  test('editing the title and body saves both', async ({ page }) => {
    const modal = await openPostModal(page, postTitle)
    await expect(modal.getByText(/to save/)).toBeVisible()

    await modal.getByPlaceholder("What's the feedback about?").fill(editedTitle)
    const bodyEditor = modal.locator('.tiptap').first()
    await bodyEditor.click()
    await page.keyboard.press('ControlOrMeta+A')
    await page.keyboard.type(editedBody)
    await modal.getByRole('button', { name: 'Save Changes' }).click()
    // Saving confirms and closes the modal.
    await expect(
      page.locator('[data-sonner-toast]').filter({ hasText: 'Post updated' })
    ).toBeVisible({
      timeout: 10_000,
    })
    await expect(modal).toBeHidden()

    const reopened = await openPostModal(page, editedTitle)
    await expect(reopened.locator('.tiptap').first()).toHaveText(editedBody)
  })

  test('moving the post to another board shows the new board', async ({ page }) => {
    const modal = await openPostModal(page, editedTitle)

    await sidebarButton(modal, 'Board', 'Feature Requests').click()
    await page
      .locator('[data-slot="popover-content"]')
      .getByRole('button', { name: 'General Feedback' })
      .click()
    await expect(sidebarButton(modal, 'Board', 'General Feedback')).toBeVisible()

    const reopened = await openPostModal(page, editedTitle)
    await expect(sidebarButton(reopened, 'Board', 'General Feedback')).toBeVisible()
  })

  // The filter steps stay in this serial block: the board filter reads the two
  // posts created above, and a separate describe could land in another shard.

  test('a status filter leaves only posts with that status', async ({ page }) => {
    await openInbox(page)
    await page.getByRole('button', { name: 'Add filter' }).click()
    await page
      .locator('[data-slot="popover-content"]')
      .getByRole('button', { name: 'Status' })
      .click()
    await page.getByRole('option', { name: /^Planned/ }).click()

    await expect(page).toHaveURL(/status=/)
    await expect(page.getByRole('button', { name: 'Status: Planned', exact: true })).toBeVisible()
    await expect(page.locator('[data-post-id]').first()).toBeVisible()
    // The list swaps in place after the filter lands, so read it until it settles.
    await expect
      .poll(() =>
        page
          .locator('[data-post-id]')
          .evaluateAll((cards) => [
            ...new Set(cards.map((card) => card.getAttribute('data-status'))),
          ])
      )
      .toEqual(['planned'])
  })

  test('a board filter shows that board and hides posts from others', async ({ page }) => {
    await openInbox(page)
    await page.getByRole('button', { name: 'Add filter' }).click()
    await page
      .locator('[data-slot="popover-content"]')
      .getByRole('button', { name: 'Board' })
      .click()
    await page.getByRole('option', { name: /^Integrations/ }).click()

    await expect(page).toHaveURL(/board=/)
    const search = page.getByRole('textbox', { name: 'Search...' })
    await search.fill(runId)
    await expect(postCard(page, otherBoardTitle)).toBeVisible({ timeout: 10_000 })
    await expect(postCard(page, editedTitle)).toHaveCount(0)
  })

  test('search narrows the list to matching titles and clearing it restores the list', async ({
    page,
  }) => {
    await openInbox(page)
    const cards = page.locator('[data-post-id]')
    await expect(cards.first()).toBeVisible()
    const unfilteredCount = await cards.count()

    const search = page.getByRole('textbox', { name: 'Search...' })
    await search.fill(runId)
    await expect(page).toHaveURL(new RegExp(`search=${runId}`))
    await expect(cards).toHaveCount(2)
    for (const title of await cards.getByRole('heading', { level: 3 }).allTextContents()) {
      expect(title).toContain(runId)
    }

    await search.fill('')
    await expect(cards).toHaveCount(unfilteredCount)
  })
})
