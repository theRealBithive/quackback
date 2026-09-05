/**
 * Which project a linked issue is closed in when its post is deleted.
 *
 * Contract (domain language, confirmed before these tests were written):
 *
 *   V11 A post that moves to a board with a different project takes its issue
 *       with it, and the link afterwards points at the issue in the new
 *       project.
 *
 * This file is V11's other half. Once an issue can move, every action on a link
 * has to follow it, and closing was the last place that worked the project out
 * by re-parsing `external_url` — a second, independent answer to a question the
 * link row now records. Two answers that can disagree is one too many: a move
 * that wrote the id and the scope but not the URL would close an issue in the
 * project the post just left, and nothing would say so.
 *
 * So the recorded project wins and the URL stays the fallback for links made
 * before it existed. That fallback also keeps a promise the previous code broke
 * by accident: a link with no URL, or one this parser cannot read, can now be
 * closed at all rather than failing with "Cannot determine project".
 *
 * The contract was agreed in German and is written here in English, which is
 * the language of this repository.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { gitlabFetch } = vi.hoisted(() => ({ gitlabFetch: vi.fn() }))
vi.mock('../fetch', () => ({ gitlabFetch }))

import { closeGitLabIssue } from '../archive'

const MOVED_URL = 'https://gitlab.example.com/group/asbs/-/issues/7'

function ctx(overrides: Record<string, unknown> = {}) {
  return {
    externalId: '7',
    externalUrl: MOVED_URL,
    accessToken: 'a-token',
    integrationConfig: { instanceUrl: 'https://gitlab.example.com' },
    ...overrides,
  }
}

function calledUrl(): string {
  return gitlabFetch.mock.calls[0][0] as string
}

describe('closeGitLabIssue', () => {
  beforeEach(() => {
    gitlabFetch.mockReset()
    gitlabFetch.mockResolvedValue({ ok: true, status: 200 })
  })

  it('closes the issue in the project the link records (V11)', async () => {
    const result = await closeGitLabIssue(ctx({ externalScope: '202' }) as never)

    expect(result).toEqual({ success: true, action: 'closed' })
    expect(calledUrl()).toBe('https://gitlab.example.com/api/v4/projects/202/issues/7')
  })

  it('prefers the recorded project over the one in the URL (V11)', async () => {
    // The disagreement this test exists for: a URL still pointing at the old
    // project while the scope says the issue has moved.
    await closeGitLabIssue(
      ctx({
        externalScope: '202',
        externalUrl: 'https://gitlab.example.com/group/datenschutz/-/issues/42',
      }) as never
    )

    expect(calledUrl()).toContain('/projects/202/')
    expect(calledUrl()).not.toContain('datenschutz')
  })

  it('still reads the project from the URL for a link made before scopes (V11)', async () => {
    await closeGitLabIssue(ctx({ externalScope: null }) as never)

    expect(calledUrl()).toBe('https://gitlab.example.com/api/v4/projects/group%2Fasbs/issues/7')
  })

  it('reads the project from the URL when no scope was passed at all', async () => {
    await closeGitLabIssue(ctx() as never)

    expect(calledUrl()).toContain('/projects/group%2Fasbs/')
  })

  it('asks GitLab to close, and nothing else', async () => {
    await closeGitLabIssue(ctx({ externalScope: '202' }) as never)

    const init = gitlabFetch.mock.calls[0][1]
    expect(init.method).toBe('PUT')
    expect(JSON.parse(init.body)).toEqual({ state_event: 'close' })
    expect(init.headers.Authorization).toBe('Bearer a-token')
  })

  it('treats an empty recorded project as not recorded', async () => {
    // An empty string is not an answer. Taking it as one would send the
    // request to `/projects//issues/7`.
    await closeGitLabIssue(ctx({ externalScope: '' }) as never)

    expect(calledUrl()).toContain('/projects/group%2Fasbs/')
  })

  it('says which link it could not place when it gives up', async () => {
    const result = await closeGitLabIssue(ctx({ externalScope: null, externalUrl: null }) as never)

    expect(result.error).toContain('project')
  })

  it('reports the platform in an error the operator will read', async () => {
    gitlabFetch.mockResolvedValue({ ok: false, status: 500, text: async () => 'boom' })

    const result = await closeGitLabIssue(ctx({ externalScope: '202' }) as never)

    expect(result.error).toContain('GitLab')
    expect(result.error).toContain('500')
  })

  it('sends JSON, and says so', async () => {
    await closeGitLabIssue(ctx({ externalScope: '202' }) as never)

    expect(gitlabFetch.mock.calls[0][1].headers['Content-Type']).toBe('application/json')
  })

  it('ignores a configured instance URL that is only whitespace', async () => {
    await closeGitLabIssue(
      ctx({
        externalScope: '202',
        integrationConfig: { instanceUrl: '   ' },
        externalUrl: 'https://self-hosted.example.org/g/p/-/issues/7',
      }) as never
    )

    expect(calledUrl()).toMatch(/^https:\/\/self-hosted\.example\.org\//)
  })

  it('falls back to gitlab.com when nothing names an instance', async () => {
    await closeGitLabIssue(
      ctx({ externalScope: '202', integrationConfig: {}, externalUrl: null }) as never
    )

    expect(calledUrl()).toMatch(/^https:\/\/gitlab\.com\/api\/v4\//)
  })

  it('falls back to gitlab.com when the stored URL cannot be parsed', async () => {
    await closeGitLabIssue(
      ctx({ externalScope: '202', integrationConfig: {}, externalUrl: 'not a url' }) as never
    )

    expect(calledUrl()).toMatch(/^https:\/\/gitlab\.com\/api\/v4\//)
  })

  it('gives up when neither the link nor its URL names a project', async () => {
    const result = await closeGitLabIssue(ctx({ externalScope: null, externalUrl: null }) as never)

    expect(result.success).toBe(false)
    expect(gitlabFetch).not.toHaveBeenCalled()
  })

  it('treats an issue that is already gone as closed', async () => {
    gitlabFetch.mockResolvedValue({ ok: false, status: 404, body: null })

    const result = await closeGitLabIssue(ctx({ externalScope: '202' }) as never)

    expect(result).toEqual({ success: true, action: 'closed' })
  })

  it('reports an expired token rather than claiming the issue is closed', async () => {
    gitlabFetch.mockResolvedValue({ ok: false, status: 401, body: null })

    const result = await closeGitLabIssue(ctx({ externalScope: '202' }) as never)

    expect(result.success).toBe(false)
  })

  it('falls back to the instance in the URL when the config names none', async () => {
    await closeGitLabIssue(ctx({ externalScope: '202', integrationConfig: {} }) as never)

    expect(calledUrl()).toMatch(/^https:\/\/gitlab\.example\.com\/api\/v4\//)
  })
})
