/**
 * When the GitLab hook creates an issue, and when it refuses to.
 *
 * Issue creation used to happen on `post.created`: every piece of feedback
 * became an issue the moment it arrived, unsorted. With one project per
 * product that is noise; the trigger is now the post reaching a status the
 * board's rule names, which is to say after triage. Which statuses those are
 * is the routing rule's business — by the time the hook runs, the resolver has
 * already decided this post belongs in this project.
 *
 * Contract (domain language, confirmed before these tests were written; the
 * numbering is the plan's):
 *
 *   V3  A post that already has an active GitLab link gets no second issue —
 *       however often it reaches the triggering state again.
 *   V4  An issue is created only once the post reaches one of the triggering
 *       statuses recorded for its board. A post merely arriving creates none.
 *
 * The reads the hook needs are stubbed here and covered against a real
 * database in `post-source.db.test.ts`. What this file pins is the decision,
 * including the one that costs money to get wrong: the duplicate check runs
 * *before* the POST. `persistExternalLink` dedupes on
 * (externalId, integrationType, postId), and a second issue carries a
 * different external id — so a late check would find no conflict, insert
 * happily, and leave two issues in the tracker for one post.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { EventData } from '@/lib/server/events/types'

const hoisted = vi.hoisted(() => ({
  loadIssueSource: vi.fn(),
  hasActiveGitLabLink: vi.fn(),
}))

vi.mock('@/integrations/gitlab/server/post-source', () => ({
  loadIssueSource: hoisted.loadIssueSource,
  hasActiveGitLabLink: hoisted.hasActiveGitLabLink,
}))

vi.mock('@/lib/server/content/ssrf-guard', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/content/ssrf-guard')>()),
  safeFetch: (url: string, init?: RequestInit) => globalThis.fetch(url, init),
}))

import { gitlabHook } from '@/integrations/gitlab/server/hook'

const target = { channelId: '42' }
const config = { accessToken: 'tok', rootUrl: 'https://portal.example' }

function mockFetch(status = 201, body: unknown = { iid: 7, web_url: 'https://gl/x/-/issues/7' }) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  })
}

function statusChanged(postId = 'post_1'): EventData {
  return {
    id: 'evt-1',
    type: 'post.status_changed',
    timestamp: '2026-01-01T00:00:00Z',
    actor: { type: 'user', userId: 'user_1', email: 'a@b.c' },
    data: {
      post: { id: postId, title: 'Bug report', boardId: 'board_1', boardSlug: 'bugs' },
      previousStatus: 'New',
      newStatus: 'Planned',
    },
  } as unknown as EventData
}

const SOURCE = {
  postId: 'post_1',
  title: 'Bug report',
  content: '<p>Something broke</p>',
  boardSlug: 'bugs',
  authorName: 'Alex',
  authorEmail: 'alex@example.com',
}

beforeEach(() => {
  vi.clearAllMocks()
  hoisted.loadIssueSource.mockResolvedValue(SOURCE)
  hoisted.hasActiveGitLabLink.mockResolvedValue(false)
})

describe('a post reaching a triggering status (V4)', () => {
  it('creates the issue in the project the resolver chose', async () => {
    const fetchMock = mockFetch()
    vi.stubGlobal('fetch', fetchMock)

    const result = await gitlabHook.run(statusChanged(), target, config)

    expect(result).toMatchObject({ success: true, externalId: '7' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][0]).toContain('/projects/42/issues')
  })

  it('writes the post body and author into the issue, which its own event does not carry', async () => {
    const fetchMock = mockFetch()
    vi.stubGlobal('fetch', fetchMock)

    await gitlabHook.run(statusChanged(), target, config)

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string)
    expect(body.title).toBe('Bug report')
    expect(body.description).toContain('Something broke')
    expect(body.description).toContain('Alex')
  })

  it('creates nothing when the post is gone by the time the job runs', async () => {
    hoisted.loadIssueSource.mockResolvedValue(null)
    const fetchMock = mockFetch()
    vi.stubGlobal('fetch', fetchMock)

    const result = await gitlabHook.run(statusChanged(), target, config)

    expect(result).toEqual({ success: true })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('a post that already has an issue (V3)', () => {
  it('creates no second issue, and does not call GitLab at all', async () => {
    hoisted.hasActiveGitLabLink.mockResolvedValue(true)
    const fetchMock = mockFetch()
    vi.stubGlobal('fetch', fetchMock)

    const result = await gitlabHook.run(statusChanged(), target, config)

    expect(result).toEqual({ success: true })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('checks before calling GitLab, not after — however often the status is set again', async () => {
    const fetchMock = mockFetch()
    vi.stubGlobal('fetch', fetchMock)

    // First pass creates it; from then on the link exists.
    await gitlabHook.run(statusChanged(), target, config)
    hoisted.hasActiveGitLabLink.mockResolvedValue(true)
    for (let i = 0; i < 5; i++) await gitlabHook.run(statusChanged(), target, config)

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('applies the guard to post.created too, so a redelivery cannot double up (V3)', async () => {
    hoisted.hasActiveGitLabLink.mockResolvedValue(true)
    const fetchMock = mockFetch()
    vi.stubGlobal('fetch', fetchMock)

    const created = {
      id: 'evt-2',
      type: 'post.created',
      timestamp: '2026-01-01T00:00:00Z',
      actor: { type: 'user', userId: 'user_1', email: 'a@b.c' },
      data: {
        post: {
          id: 'post_1',
          title: 'Bug report',
          content: '<p>x</p>',
          boardId: 'board_1',
          boardSlug: 'bugs',
          voteCount: 0,
        },
      },
    } as unknown as EventData

    const result = await gitlabHook.run(created, target, config)

    expect(result).toEqual({ success: true })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('a status change that came back from GitLab itself (V3, V10)', () => {
  it('creates no issue, because the post it names already has one', async () => {
    // Inbound status sync applies GitLab's state to the post, which emits
    // post.status_changed with the integration's own service principal as the
    // actor — and that event fans out to this hook like any other. The echo is
    // closed by the fact that such a post has a GitLab link by definition:
    // that link is how the inbound webhook found it in the first place.
    hoisted.hasActiveGitLabLink.mockResolvedValue(true)
    const fetchMock = mockFetch()
    vi.stubGlobal('fetch', fetchMock)

    const echoed = {
      ...statusChanged(),
      actor: { type: 'service', userId: 'prn_gitlab_service' },
    } as unknown as EventData

    const result = await gitlabHook.run(echoed, target, config)

    expect(result).toEqual({ success: true })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('events the hook has no business acting on', () => {
  it('ignores an event type that is neither arrival nor a status change', async () => {
    const fetchMock = mockFetch()
    vi.stubGlobal('fetch', fetchMock)

    const result = await gitlabHook.run(
      { ...statusChanged(), type: 'post.deleted' } as EventData,
      target,
      config
    )

    expect(result).toEqual({ success: true })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(hoisted.hasActiveGitLabLink).not.toHaveBeenCalled()
  })

  it('ignores an event that names no post, rather than reading one that is not there', async () => {
    const fetchMock = mockFetch()
    vi.stubGlobal('fetch', fetchMock)

    const result = await gitlabHook.run(
      { ...statusChanged(), data: {} } as unknown as EventData,
      target,
      config
    )

    expect(result).toEqual({ success: true })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
