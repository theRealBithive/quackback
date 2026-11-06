import { test, expect, type Page } from '@playwright/test'

/**
 * Public feedback list — the filter bar (Filter menu, chips, Clear all).
 *
 * Contract (confirmed 2026-11-05):
 *   F1 Every filter lives in the URL: a reload shows the same list with the
 *      same chips.
 *   F2 Under a status filter every shown post carries one of the chosen
 *      statuses; with two statuses the result is their union, not their
 *      intersection.
 *   F3 Under "at least N votes" every shown post has at least N votes.
 *   F4 Under a tag filter every shown post carries that tag.
 *   F5 A filter shrinks the list or leaves it as it is, never grows it, and
 *      removing it restores the previous list.
 *   F6 Removing a chip removes exactly that filter; "Clear all" removes all.
 *   F7 When no post matches, "No posts match your filters." is shown instead of
 *      an empty page.
 *
 * The list pages in twenties, so a check over "every shown post" first loads
 * the whole list (`loadWholeList`). Filters are combined with a small base set
 * (status Closed, about twenty seeded posts) to keep that cheap. Each check also
 * asserts that the list it inspects is not empty, so no property can pass over
 * nothing.
 *
 * Status and tags are read from the card's `data-status` / `data-tag-names`
 * attributes rather than its text: a card shows at most three tags, and a
 * status name like "Open" also occurs in post bodies.
 */

interface ShownPost {
  id: string
  status: string
  tagNames: string[]
  votes: number
}

function postCards(page: Page) {
  return page.getByRole('main').locator('[data-post-id]')
}

function activeFilters(page: Page) {
  return page.getByRole('region', { name: 'Active filters' })
}

/** Scroll until the infinite list stops growing, then read every card. */
async function loadWholeList(page: Page): Promise<ShownPost[]> {
  let previousCount = -1
  let stableRounds = 0
  for (let round = 0; round < 40 && stableRounds < 2; round++) {
    const count = await postCards(page).count()
    if (count === previousCount) {
      stableRounds += 1
    } else {
      stableRounds = 0
    }
    previousCount = count
    // One evaluate, so a card replaced by a re-render cannot detach mid-call.
    await postCards(page).evaluateAll((cards) => cards.at(-1)?.scrollIntoView())
    await page.waitForTimeout(700)
  }
  return readShownPosts(page)
}

async function readShownPosts(page: Page): Promise<ShownPost[]> {
  return postCards(page).evaluateAll((cards) =>
    cards.map((card) => {
      const voteText = card.querySelector('[data-testid="vote-count"]')?.textContent ?? '0'
      const tagNameText = card.getAttribute('data-tag-names') ?? '[]'
      return {
        id: card.getAttribute('data-post-id') ?? '',
        status: card.getAttribute('data-status') ?? '',
        tagNames: JSON.parse(tagNameText) as string[],
        votes: Number(voteText.replace(/[^0-9]/g, '')),
      }
    })
  )
}

function idsOf(posts: ShownPost[]): string[] {
  return posts.map((post) => post.id).sort()
}

/** Open the feed and wait for the first card, so the filter bar is hydrated. */
async function openFeed(page: Page, query = ''): Promise<void> {
  await page.goto(`/${query}`)
  await expect(postCards(page).first()).toBeVisible({ timeout: 15000 })
  await page.waitForLoadState('networkidle')
}

/** Filter → category → option, through the toolbar's Filter menu. */
async function addFilter(page: Page, category: string, option: string): Promise<void> {
  await page.getByRole('button', { name: 'Filter', exact: true }).click()
  await page.getByRole('button', { name: category, exact: true }).click()
  await page.getByRole('option', { name: option, exact: true }).click()
  await page.waitForLoadState('networkidle')
}

async function removeChip(page: Page, chipLabel: RegExp): Promise<void> {
  await activeFilters(page).getByRole('button', { name: chipLabel }).click()
  await page.waitForLoadState('networkidle')
}

function searchParam(page: Page, name: string): string | null {
  return new URL(page.url()).searchParams.get(name)
}

test.describe('Public Post List — filter bar', () => {
  test('a filter set through the menu survives a reload with the same chips and posts (F1)', async ({
    page,
  }) => {
    await openFeed(page)
    await addFilter(page, 'Status', 'Closed')
    await addFilter(page, 'Vote count', '5+ votes')

    await expect(page).toHaveURL(/[?&]status=/)
    await expect(page).toHaveURL(/[?&]minVotes=5/)
    const before = await loadWholeList(page)
    expect(before.length).toBeGreaterThan(0)

    await page.reload()
    await expect(postCards(page).first()).toBeVisible({ timeout: 15000 })

    await expect(
      activeFilters(page).getByRole('button', { name: 'Status: Closed', exact: true })
    ).toBeVisible()
    await expect(
      activeFilters(page).getByRole('button', { name: 'Min votes: 5+ votes', exact: true })
    ).toBeVisible()
    const after = await loadWholeList(page)
    expect(idsOf(after)).toEqual(idsOf(before))
  })

  test('a status filter shows only posts in that status (F2)', async ({ page }) => {
    await openFeed(page)
    await addFilter(page, 'Status', 'Closed')

    const shown = await loadWholeList(page)
    expect(shown.length).toBeGreaterThan(0)
    for (const post of shown) {
      expect(post.status).toBe('closed')
    }
  })

  test('two statuses show the union of both lists (F2)', async ({ page }) => {
    await openFeed(page)
    await addFilter(page, 'Status', 'Closed')
    const closed = await loadWholeList(page)

    await openFeed(page)
    await addFilter(page, 'Status', 'Complete')
    const complete = await loadWholeList(page)

    await addFilter(page, 'Status', 'Closed')
    const both = await loadWholeList(page)

    expect(closed.length).toBeGreaterThan(0)
    expect(complete.length).toBeGreaterThan(0)
    // A post has exactly one status, so the two lists are disjoint and their
    // union is exactly as long as both together.
    expect(both.length).toBe(closed.length + complete.length)
    expect(idsOf(both)).toEqual([...idsOf(closed), ...idsOf(complete)].sort())
  })

  test('a vote-count filter shows only posts with at least that many votes (F3)', async ({
    page,
  }) => {
    await openFeed(page)
    await addFilter(page, 'Status', 'Closed')
    await addFilter(page, 'Vote count', '25+ votes')

    const shown = await loadWholeList(page)
    expect(shown.length).toBeGreaterThan(0)
    for (const post of shown) {
      expect(post.votes).toBeGreaterThanOrEqual(25)
    }
  })

  test('a tag filter shows only posts carrying that tag (F4)', async ({ page }) => {
    await openFeed(page)
    await addFilter(page, 'Status', 'Closed')
    await addFilter(page, 'Tag', 'UX')

    await expect(page).toHaveURL(/[?&]tagIds=/)
    await expect(
      activeFilters(page).getByRole('button', { name: 'Tag: UX', exact: true })
    ).toBeVisible()

    const shown = await loadWholeList(page)
    expect(shown.length).toBeGreaterThan(0)
    for (const post of shown) {
      expect(post.tagNames).toContain('UX')
    }
  })

  test('adding a filter never grows the list, and removing it restores the list (F5)', async ({
    page,
  }) => {
    await openFeed(page)
    await addFilter(page, 'Status', 'Closed')
    const base = await loadWholeList(page)
    expect(base.length).toBeGreaterThan(0)

    await addFilter(page, 'Vote count', '100+ votes')
    const narrowed = await loadWholeList(page)
    const baseIds = new Set(base.map((post) => post.id))
    expect(narrowed.length).toBeLessThanOrEqual(base.length)
    for (const post of narrowed) {
      expect(baseIds.has(post.id)).toBe(true)
    }

    await removeChip(page, /^Remove Min votes:/)
    const restored = await loadWholeList(page)
    expect(idsOf(restored)).toEqual(idsOf(base))
  })

  test('removing one chip drops only that filter (F6)', async ({ page }) => {
    await openFeed(page)
    await addFilter(page, 'Status', 'Closed')
    await addFilter(page, 'Vote count', '5+ votes')

    await removeChip(page, /^Remove Min votes:/)

    await expect(page).not.toHaveURL(/[?&]minVotes=/)
    expect(searchParam(page, 'status')).toBe('["closed"]')
    await expect(
      activeFilters(page).getByRole('button', { name: 'Status: Closed', exact: true })
    ).toBeVisible()
    await expect(activeFilters(page).getByRole('button', { name: /^Min votes:/ })).toHaveCount(0)
  })

  test('"Clear all" removes every filter (F6)', async ({ page }) => {
    await openFeed(page)
    await addFilter(page, 'Status', 'Closed')
    await addFilter(page, 'Vote count', '5+ votes')

    await activeFilters(page).getByRole('button', { name: 'Clear all' }).click()
    await page.waitForLoadState('networkidle')

    await expect(page).not.toHaveURL(/[?&]status=/)
    await expect(page).not.toHaveURL(/[?&]minVotes=/)
    await expect(activeFilters(page)).toHaveCount(0)
  })

  test('a filter nothing matches shows the empty-state message (F7)', async ({ page }) => {
    await page.goto('/?minVotes=1000000')

    await expect(page.getByText('No posts match your filters.')).toBeVisible({ timeout: 15000 })
    await expect(postCards(page)).toHaveCount(0)
  })
})
