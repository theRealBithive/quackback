import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { EventData, PostCreatedEvent } from '@/lib/server/events/types'
import { gitlabHook } from '@/integrations/gitlab/server/hook'

// GitLab requests go through the SSRF guard; route them to the stubbed global
// fetch so the assertions below see the same calls.
// The hook reads the post and its existing links before creating an issue.
// Neither is what this file is about, and both are covered against a real
// database in post-source.db.test.ts.
const postSource = vi.hoisted(() => ({
  hasActiveGitLabLink: vi.fn(async () => false),
}))
vi.mock('@/integrations/gitlab/server/post-source', () => ({
  loadIssueSource: async () => ({
    postId: 'post_1',
    title: 'Bug report',
    content: '<p>Something broke</p>',
    boardSlug: 'bugs',
    authorName: 'Alex',
    authorEmail: 'alex@example.com',
  }),
  hasActiveGitLabLink: postSource.hasActiveGitLabLink,
}))

// What the hook tells the operator, captured so the failure paths can be held
// to naming the project and the status — the two things a log line about a
// refused delivery has to carry to be worth reading.
const logged = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}))
vi.mock('@/lib/server/logger', () => ({
  logger: { child: () => logged },
}))

vi.mock('@/lib/server/content/ssrf-guard', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/content/ssrf-guard')>()),
  safeFetch: (url: string, init?: RequestInit) => globalThis.fetch(url, init),
}))

function mockFetch(status: number, body: unknown = {}) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  })
}

function makePostCreatedEvent(): PostCreatedEvent {
  return {
    id: 'evt-1',
    type: 'post.created',
    timestamp: '2025-01-01T00:00:00Z',
    actor: { type: 'user', userId: 'user_1', email: 'test@test.com' },
    data: {
      post: {
        id: 'post_1',
        title: 'Bug report',
        content: '<p>Something broke</p>',
        boardId: 'board_1',
        boardSlug: 'bugs',
        voteCount: 3,
      },
    },
  }
}

const target = { channelId: '42' }

/**
 * Contract: V10 — a comment that arrived from GitLab never causes anything to
 * be written back to GitLab.
 *
 * Comment sync imports GitLab notes as post comments, and creating a comment
 * emits `comment.created`, which fans out to this hook like any other event.
 * The hook does not write for those, so the loop cannot close — this pins it,
 * so adding an outbound comment push has to confront the echo deliberately
 * rather than shipping an infinite ping-pong.
 *
 * `post.status_changed` used to be in this list and is not any more. It was
 * never part of V10: it was here because the hook happened to write only for
 * `post.created`, and per-board routing makes a status change the trigger on
 * purpose. The echo it could cause is real and is closed somewhere better —
 * an inbound status sync writes a status onto a post that by definition
 * already has a GitLab link, and the duplicate guard refuses to create a
 * second issue for it. That is asserted in hook-triage-trigger.test.ts.
 */
describe('gitlabHook.run leaves comment and update events alone (V10)', () => {
  it.each(['comment.created', 'post.updated'])('writes nothing to GitLab for %s', async (type) => {
    const fetchMock = mockFetch(201, { iid: 1, web_url: 'https://gitlab.example.com/i/1' })
    vi.stubGlobal('fetch', fetchMock)

    const event = { ...makePostCreatedEvent(), type } as unknown as EventData
    const result = await gitlabHook.run(event, target, {
      accessToken: 'token',
      rootUrl: 'https://app.example.com',
    })

    expect(result.success).toBe(true)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

beforeEach(() => {
  vi.restoreAllMocks()
  postSource.hasActiveGitLabLink.mockReset().mockResolvedValue(false)
  for (const fn of Object.values(logged)) fn.mockClear()
})

describe('gitlabHook', () => {
  it('creates issues on gitlab.com when instanceUrl is omitted', async () => {
    const fetchMock = mockFetch(201, { iid: 9, web_url: 'https://gitlab.com/acme/app/-/issues/9' })
    vi.stubGlobal('fetch', fetchMock)

    const result = await gitlabHook.run(makePostCreatedEvent(), target, {
      accessToken: 'tok',
      rootUrl: 'https://app.example.com',
    })

    expect(result).toEqual({
      success: true,
      externalId: '9',
      // The project the issue was created in. Recorded on the link so an
      // inbound webhook can tell this #9 from another project's #9.
      externalScope: '42',
      externalUrl: 'https://gitlab.com/acme/app/-/issues/9',
    })
    expect(fetchMock).toHaveBeenCalledWith(
      'https://gitlab.com/api/v4/projects/42/issues',
      expect.objectContaining({ method: 'POST' })
    )
  })

  it('creates issues on a custom HTTPS instance', async () => {
    const fetchMock = mockFetch(201, {
      iid: 3,
      web_url: 'https://gitlab.example.com/acme/app/-/issues/3',
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await gitlabHook.run(makePostCreatedEvent(), target, {
      accessToken: 'tok',
      rootUrl: 'https://app.example.com',
      instanceUrl: 'https://gitlab.example.com/',
    })

    expect(result.success).toBe(true)
    expect(fetchMock).toHaveBeenCalledWith(
      'https://gitlab.example.com/api/v4/projects/42/issues',
      expect.objectContaining({ method: 'POST' })
    )
  })

  it('tests the connection against the configured instance', async () => {
    const fetchMock = mockFetch(200, { username: 'ada' })
    vi.stubGlobal('fetch', fetchMock)

    if (!gitlabHook.testConnection) throw new Error('gitlabHook.testConnection missing')
    const result = await gitlabHook.testConnection({
      accessToken: 'tok',
      rootUrl: 'https://app.example.com',
      instanceUrl: 'https://gitlab.example.com',
    })

    expect(result).toEqual({ ok: true, error: undefined })
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://gitlab.example.com/api/v4/user')
    expect(init.headers).toEqual({ Authorization: 'Bearer tok' })
  })

  it('skips an event type it does not create issues for', async () => {
    const result = await gitlabHook.run({ type: 'post.deleted' } as unknown as EventData, target, {
      accessToken: 'tok',
      rootUrl: 'https://app.example.com',
    })
    expect(result).toEqual({ success: true })
  })
})

/**
 * Contract: V2 — when GitLab rejects a delivery as unauthenticated, the
 * delivery is retried exactly once with a freshly renewed token before it is
 * reported as failed.
 *
 * The hook's part of that is to say so. `authExpired` is the worker's cue to
 * renew and try once more; `shouldRetry: false` is what keeps the queue from
 * retrying a dead token on its own hourly curve instead. GitLab revokes the
 * previous token pair on every renewal, so a job that started with the copy
 * from just before another worker renewed is rejected although the row holds a
 * live token — without the flag that was reported as "please reconnect", and
 * the operator did.
 *
 * Every other failure keeps its own classification: a rate limit and a server
 * error wait and retry, a client error gives up, and none of them asks for a
 * token — renewing does not cure a 404.
 */
describe('gitlabHook.run on a rejected token (V2)', () => {
  const config = { accessToken: 'stale', rootUrl: 'https://app.example.com' }

  it.each([401, 403])('asks the worker for one renewal and retry on %i', async (status) => {
    vi.stubGlobal('fetch', mockFetch(status, { message: 'unauthorized' }))

    const result = await gitlabHook.run(makePostCreatedEvent(), target, config)

    expect(result).toEqual({
      success: false,
      error: `Authentication failed (${status}). Please reconnect GitLab.`,
      shouldRetry: false,
      authExpired: true,
    })
  })

  it('lets a rate limit wait and retry without touching the token', async () => {
    vi.stubGlobal('fetch', mockFetch(429, { message: 'slow down' }))

    const result = await gitlabHook.run(makePostCreatedEvent(), target, config)

    expect(result).toEqual({ success: false, error: 'Rate limited', shouldRetry: true })
  })

  it.each([500, 503])('retries a server error (%i) without touching the token', async (status) => {
    vi.stubGlobal('fetch', mockFetch(status, { message: 'down' }))

    const result = await gitlabHook.run(makePostCreatedEvent(), target, config)

    expect(result).toEqual({
      success: false,
      error: `GitLab API error: ${status}`,
      shouldRetry: true,
    })
  })

  it.each([400, 404, 422, 499])(
    'gives up on a client error (%i) without renewing',
    async (status) => {
      vi.stubGlobal('fetch', mockFetch(status, { message: 'no' }))

      const result = await gitlabHook.run(makePostCreatedEvent(), target, config)

      expect(result).toEqual({
        success: false,
        error: `GitLab API error: ${status}`,
        shouldRetry: false,
      })
    }
  )

  it('retries a dropped connection and does not call it an auth failure', async () => {
    const dropped = Object.assign(new Error('connection reset'), { code: 'ECONNRESET' })
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(dropped))

    const result = await gitlabHook.run(makePostCreatedEvent(), target, config)

    expect(result).toEqual({ success: false, error: 'connection reset', shouldRetry: true })
  })

  it('gives up on an exception it cannot classify', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('boom')))

    const result = await gitlabHook.run(makePostCreatedEvent(), target, config)

    expect(result).toEqual({ success: false, error: 'boom', shouldRetry: false })
  })

  it('names the failure even when what was thrown is not an Error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue('not an error'))

    const result = await gitlabHook.run(makePostCreatedEvent(), target, config)

    expect(result).toEqual({ success: false, error: 'Unknown error', shouldRetry: false })
  })
})

describe('gitlabHook edges the worker relies on', () => {
  it('creates nothing for a post.created event that names no post', async () => {
    const fetchMock = mockFetch(201, { iid: 1, web_url: 'https://gitlab.com/i/1' })
    vi.stubGlobal('fetch', fetchMock)
    const event = makePostCreatedEvent()
    delete (event.data.post as { id?: string }).id

    const result = await gitlabHook.run(event, target, {
      accessToken: 'tok',
      rootUrl: 'https://app.example.com',
    })

    expect(result).toEqual({ success: true })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('reports the status when the connection test is refused', async () => {
    vi.stubGlobal('fetch', mockFetch(401, { message: 'unauthorized' }))

    if (!gitlabHook.testConnection) throw new Error('gitlabHook.testConnection missing')
    const result = await gitlabHook.testConnection({
      accessToken: 'stale',
      rootUrl: 'https://app.example.com',
    })

    expect(result).toEqual({ ok: false, error: 'HTTP 401' })
  })

  it('reports the exception when the connection test cannot reach GitLab', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('unreachable')))

    if (!gitlabHook.testConnection) throw new Error('gitlabHook.testConnection missing')
    const result = await gitlabHook.testConnection({
      accessToken: 'tok',
      rootUrl: 'https://app.example.com',
    })

    expect(result).toEqual({ ok: false, error: 'unreachable' })
  })

  it('says the connection failed when what was thrown is not an Error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue('nope'))

    if (!gitlabHook.testConnection) throw new Error('gitlabHook.testConnection missing')
    const result = await gitlabHook.testConnection({
      accessToken: 'tok',
      rootUrl: 'https://app.example.com',
    })

    expect(result).toEqual({ ok: false, error: 'Connection failed' })
  })
})

/**
 * The token a delivery was handed is the token it presents. This is where
 * V1 and V4 land in the end: a renewed token that never reached the request
 * would have renewed nothing.
 */
describe('gitlabHook.run presents the token it was given (V1, V4)', () => {
  it('sends the issue as JSON with the token as a bearer', async () => {
    const fetchMock = mockFetch(201, { iid: 9, web_url: 'https://gitlab.com/acme/app/-/issues/9' })
    vi.stubGlobal('fetch', fetchMock)

    await gitlabHook.run(makePostCreatedEvent(), target, {
      accessToken: 'renewed-token',
      rootUrl: 'https://app.example.com',
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(init.method).toBe('POST')
    expect(init.headers).toEqual({
      Authorization: 'Bearer renewed-token',
      'Content-Type': 'application/json',
    })
    const body = JSON.parse(init.body as string) as { title: string; description: string }
    expect(body.title).toBe('Bug report')
    expect(body.description).toContain('Something broke')
  })
})

/**
 * Where the issue text comes from depends on the event. `post.created` carries
 * the post; `post.status_changed` names it, and the body is read from the row.
 * The fixtures are told apart on purpose: the event says one title and the row
 * another, so a hook reading the wrong one is caught rather than agreed with.
 */
describe('gitlabHook.run reads the issue text from where the event keeps it', () => {
  it('takes title and body from the payload of post.created', async () => {
    const fetchMock = mockFetch(201, { iid: 1, web_url: 'https://gitlab.com/i/1' })
    vi.stubGlobal('fetch', fetchMock)
    const event = makePostCreatedEvent()
    event.data.post.title = 'From the event, not the row'
    event.data.post.content = '<p>payload body</p>'

    await gitlabHook.run(event, target, { accessToken: 'tok', rootUrl: 'https://app.example.com' })

    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string) as {
      title: string
      description: string
    }
    expect(body.title).toBe('From the event, not the row')
    expect(body.description).toContain('payload body')
    expect(body.description).not.toContain('Something broke')
  })

  it('reads title and body from the row for post.status_changed', async () => {
    const fetchMock = mockFetch(201, { iid: 1, web_url: 'https://gitlab.com/i/1' })
    vi.stubGlobal('fetch', fetchMock)
    const event = {
      ...makePostCreatedEvent(),
      type: 'post.status_changed',
      data: { post: { id: 'post_1', title: 'Payload title the row does not know' } },
    } as unknown as EventData

    await gitlabHook.run(event, target, { accessToken: 'tok', rootUrl: 'https://app.example.com' })

    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string) as {
      title: string
      description: string
    }
    expect(body.title).toBe('Bug report')
    expect(body.description).toContain('Something broke')
  })

  it.each([
    ['an empty payload', {}],
    ['no payload at all', undefined],
  ])('creates nothing for a status change that names no post (%s)', async (_label, data) => {
    const fetchMock = mockFetch(201, { iid: 1, web_url: 'https://gitlab.com/i/1' })
    vi.stubGlobal('fetch', fetchMock)
    const event = {
      ...makePostCreatedEvent(),
      type: 'post.status_changed',
      data,
    } as unknown as EventData

    const result = await gitlabHook.run(event, target, {
      accessToken: 'tok',
      rootUrl: 'https://app.example.com',
    })

    expect(result).toEqual({ success: true })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

/**
 * What the log says about each outcome. An operator reading it after a quiet
 * morning needs the project and the status without opening GitLab, which is
 * the whole reason the failure lines carry them — see the "why did nothing
 * arrive?" note in SELF-IMPROVE.md for what it costs when they do not.
 */
describe('gitlabHook.run tells the operator what happened', () => {
  const config = { accessToken: 'tok', rootUrl: 'https://app.example.com' }

  it('logs the event it is handling and the issue it created', async () => {
    vi.stubGlobal('fetch', mockFetch(201, { iid: 9, web_url: 'https://gitlab.com/i/9' }))

    await gitlabHook.run(makePostCreatedEvent(), target, config)

    expect(logged.debug).toHaveBeenCalledWith(
      { event_type: 'post.created', project_id: '42' },
      'processing event'
    )
    expect(logged.info).toHaveBeenCalledWith({ issue_iid: 9, project_id: '42' }, 'issue created')
  })

  it('logs which post already had an issue when it skips', async () => {
    postSource.hasActiveGitLabLink.mockResolvedValue(true)
    const fetchMock = mockFetch(201, { iid: 9, web_url: 'https://gitlab.com/i/9' })
    vi.stubGlobal('fetch', fetchMock)

    const result = await gitlabHook.run(makePostCreatedEvent(), target, config)

    expect(result).toEqual({ success: true })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(logged.info).toHaveBeenCalledWith(
      { post_id: 'post_1', project_id: '42' },
      'post already has an issue, skipping'
    )
  })

  it.each([401, 403])(
    'logs a refused token (%i) with the status, the project and the answer',
    async (status) => {
      vi.stubGlobal('fetch', mockFetch(status, { message: 'unauthorized' }))

      await gitlabHook.run(makePostCreatedEvent(), target, config)

      expect(logged.error).toHaveBeenCalledWith(
        {
          status_code: status,
          project_id: '42',
          body: JSON.stringify({ message: 'unauthorized' }),
        },
        'auth error'
      )
    }
  )

  it('logs a rate limit as a warning, with the status and the project', async () => {
    vi.stubGlobal('fetch', mockFetch(429, { message: 'slow down' }))

    await gitlabHook.run(makePostCreatedEvent(), target, config)

    expect(logged.warn).toHaveBeenCalledWith(
      { status_code: 429, project_id: '42', body: JSON.stringify({ message: 'slow down' }) },
      'rate limited'
    )
    expect(logged.error).not.toHaveBeenCalled()
  })

  it('logs any other refusal as an API error, with the status and the project', async () => {
    vi.stubGlobal('fetch', mockFetch(500, { message: 'down' }))

    await gitlabHook.run(makePostCreatedEvent(), target, config)

    expect(logged.error).toHaveBeenCalledWith(
      { status_code: 500, project_id: '42', body: JSON.stringify({ message: 'down' }) },
      'api error'
    )
  })

  it('logs the exception and the project when the request itself failed', async () => {
    const dropped = new Error('connection reset')
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(dropped))

    await gitlabHook.run(makePostCreatedEvent(), target, config)

    expect(logged.error).toHaveBeenCalledWith(
      { err: dropped, project_id: '42' },
      'issue creation failed'
    )
  })
})
