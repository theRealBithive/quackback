import { test, expect, type Page } from '@playwright/test'

/**
 * Public feedback list: cards, sorting, the board sidebar and search.
 *
 * The filter bar has its own spec (`post-list-filters.spec.ts`).
 *
 * This file used to guard most tests with `if (count > 0)` or `test.skip(...)`
 * on exactly the condition under test, so a broken list passed. The seed has
 * 500 posts across several boards; each test now asserts its precondition
 * instead of skipping on it. Polls wait for a list to settle; each one also
 * requires the list to be non-empty, so none can pass over nothing.
 */

function postCards(page: Page) {
  return page.getByRole('main').locator('[data-post-id]')
}

/** Open the feed and wait for the first card, so the toolbar is hydrated. */
async function openFeed(page: Page, query = ''): Promise<void> {
  await page.goto(`/${query}`)
  await expect(postCards(page).first()).toBeVisible({ timeout: 15000 })
  await page.waitForLoadState('networkidle')
}

function sortButton(page: Page, name: 'Trending' | 'Top' | 'New') {
  return page.getByRole('button', { name, exact: true })
}

async function readVoteCounts(page: Page): Promise<number[]> {
  const texts = await postCards(page).getByTestId('vote-count').allTextContents()
  return texts.map((text) => Number(text.replace(/[^0-9]/g, '')))
}

async function readTitles(page: Page): Promise<string[]> {
  return postCards(page).locator('h3').allTextContents()
}

async function readPostHrefs(page: Page): Promise<string[]> {
  return postCards(page).evaluateAll((cards) =>
    cards.map((card) => card.getAttribute('href') ?? '')
  )
}

/** Submit a search through the toolbar's Search popover. */
async function searchFor(page: Page, term: string): Promise<void> {
  const input = page.getByRole('textbox', { name: 'Search posts...' })
  // The toolbar is server-rendered; a click before hydration opens nothing.
  await expect(async () => {
    await sortButton(page, 'Trending').scrollIntoViewIfNeeded()
    await page.getByRole('button', { name: 'Search', exact: true }).first().click()
    await expect(input).toBeVisible({ timeout: 2000 })
  }).toPass({ timeout: 15000 })
  await input.fill(term)
  await input.press('Enter')
}

test.describe('Public Post List — cards', () => {
  test('shows post cards with a title and a vote button', async ({ page }) => {
    await openFeed(page)

    const firstCard = postCards(page).first()
    await expect(firstCard.locator('h3')).not.toBeEmpty()
    await expect(firstCard.getByTestId('vote-button')).toBeVisible()
    await expect(firstCard.getByTestId('vote-count')).toHaveText(/^\d+$/)
  })

  test('clicking a post opens its detail page with the same title', async ({ page }) => {
    await openFeed(page)
    const firstCard = postCards(page).first()
    const title = (await firstCard.locator('h3').textContent())?.trim() ?? ''
    expect(title.length).toBeGreaterThan(0)

    await firstCard.locator('h3').click()

    await expect(page).toHaveURL(/\/b\/[^/]+\/posts\/post_/)
    await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible()
  })
})

test.describe('Public Post List — sorting', () => {
  test('Trending is the default sort', async ({ page }) => {
    await openFeed(page)

    await expect(sortButton(page, 'Trending')).toHaveClass(/font-medium/)
    await expect(sortButton(page, 'Top')).not.toHaveClass(/font-medium/)
    await expect(sortButton(page, 'New')).not.toHaveClass(/font-medium/)
  })

  for (const sort of ['New', 'Top', 'Trending'] as const) {
    test(`clicking ${sort} puts it in the URL and marks it active`, async ({ page }) => {
      await openFeed(page, sort === 'Trending' ? '?sort=new' : '')

      await sortButton(page, sort).click()

      await expect(page).toHaveURL(new RegExp(`[?&]sort=${sort.toLowerCase()}`))
      await expect(sortButton(page, sort)).toHaveClass(/font-medium/)
      for (const other of (['New', 'Top', 'Trending'] as const).filter((name) => name !== sort)) {
        await expect(sortButton(page, other)).not.toHaveClass(/font-medium/)
      }
    })
  }

  test('a sort in the URL is shown as active', async ({ page }) => {
    await openFeed(page, '?sort=new')

    await expect(sortButton(page, 'New')).toHaveClass(/font-medium/)
    await expect(sortButton(page, 'Trending')).not.toHaveClass(/font-medium/)
  })

  test('Top lists posts by vote count, highest first', async ({ page }) => {
    await openFeed(page, '?sort=top')

    const votes = await readVoteCounts(page)
    expect(votes.length).toBeGreaterThan(1)
    for (let index = 1; index < votes.length; index++) {
      expect(votes[index]).toBeLessThanOrEqual(votes[index - 1])
    }
  })

  test('New and Top order the same posts differently', async ({ page }) => {
    await openFeed(page, '?sort=new')
    const newestFirst = await readPostHrefs(page)

    await sortButton(page, 'Top').click()
    await expect(page).toHaveURL(/[?&]sort=top/)
    await expect.poll(() => readPostHrefs(page)).not.toEqual(newestFirst)
  })
})

test.describe('Public Post List — boards', () => {
  // Admin specs rename and re-slug boards, so a shard that ran them first has
  // no seeded slug to rely on. The tests pick a board from the sidebar and read
  // its slug from the URL.

  /**
   * A sidebar board with posts. The sidebar renders the post-count badge only
   * for a count above 0; the button name cannot tell it apart, because boards
   * created by other specs end in a timestamp.
   */
  function boardWithPosts(page: Page) {
    const postCountBadge = page.locator('span.tabular-nums')
    return page
      .getByRole('complementary')
      .getByRole('button')
      .filter({ has: postCountBadge })
      .first()
  }

  async function chooseBoardWithPosts(page: Page): Promise<string> {
    await boardWithPosts(page).click()
    await expect(page).toHaveURL(/[?&]board=/)
    const slug = new URL(page.url()).searchParams.get('board') ?? ''
    expect(slug.length).toBeGreaterThan(0)
    return slug
  }

  test('choosing a board in the sidebar shows only that board’s posts', async ({ page }) => {
    await openFeed(page)
    const board = boardWithPosts(page)

    const slug = await chooseBoardWithPosts(page)

    await expect(board).toHaveClass(/font-medium/)
    await expect
      .poll(async () => {
        const hrefs = await readPostHrefs(page)
        return hrefs.length > 0 && hrefs.every((href) => href.startsWith(`/b/${slug}/posts/`))
      })
      .toBe(true)
  })

  test('"View all posts" leaves the board and shows posts from several boards', async ({
    page,
  }) => {
    await openFeed(page)
    await chooseBoardWithPosts(page)

    await page.getByRole('button', { name: /View all posts/ }).click()

    await expect(page).not.toHaveURL(/[?&]board=/)
    await expect(page.getByRole('button', { name: /View all posts/ })).toHaveClass(/font-medium/)
    await expect
      .poll(async () => {
        const boards = (await readPostHrefs(page)).map((href) => href.split('/')[2])
        return new Set(boards).size
      })
      .toBeGreaterThan(1)
  })

  test('a board and a sort in the URL are both applied', async ({ page }) => {
    await openFeed(page)
    const slug = await chooseBoardWithPosts(page)

    await openFeed(page, `?board=${slug}&sort=new`)

    await expect(sortButton(page, 'New')).toHaveClass(/font-medium/)
    const hrefs = await readPostHrefs(page)
    expect(hrefs.length).toBeGreaterThan(0)
    for (const href of hrefs) {
      expect(href.startsWith(`/b/${slug}/posts/`)).toBe(true)
    }
  })
})

test.describe('Public Post List — search', () => {
  // "dashboard" occurs in seeded titles and in none of the seeded post bodies,
  // so every match must carry it in the title.
  const term = 'dashboard'

  test('a search shows only posts that match it', async ({ page }) => {
    await openFeed(page)

    await searchFor(page, term)

    await expect(page).toHaveURL(/[?&]search=dashboard/)
    // The list swaps once the search response lands; until then the old cards show.
    await expect
      .poll(async () => {
        const titles = await readTitles(page)
        return titles.length > 0 && titles.every((title) => title.toLowerCase().includes(term))
      })
      .toBe(true)
  })

  test('clearing the search brings back the unfiltered list', async ({ page }) => {
    await openFeed(page)
    const unfiltered = await readPostHrefs(page)
    await searchFor(page, term)
    await expect(page).toHaveURL(/[?&]search=/)
    await expect.poll(() => readPostHrefs(page)).not.toEqual(unfiltered)

    await page.getByRole('button', { name: 'Search', exact: true }).first().click()
    await page.getByRole('button', { name: /Clear search/i }).click()

    await expect(page).not.toHaveURL(/[?&]search=/)
    await expect.poll(() => readPostHrefs(page)).toEqual(unfiltered)
  })

  test('a search nothing matches shows the empty-state message', async ({ page }) => {
    await openFeed(page)

    await searchFor(page, 'xyzzy_no_such_post_zqwerty_99999')

    await expect(page.getByText('No posts match your filters.')).toBeVisible({ timeout: 10000 })
    await expect(postCards(page)).toHaveCount(0)
  })
})
