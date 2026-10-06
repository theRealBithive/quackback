/**
 * Updating the GitHub comment that mirrors an edited message: every way the
 * remote write can go wrong must surface as an error, so that the edit is
 * abandoned and the message stays as it was.
 *
 * Contract for upstream batch G (#580, `ccf8f0521`, "edit and delete your own
 * support messages") — the confirmed item this suite pins:
 *
 *   G7  An edit is refused while the original is still being delivered; a
 *       message mirrored to GitHub updates its GitHub comment first, and if
 *       that fails the message stays unchanged. An email that was already sent
 *       is not changed.
 *
 * What "fails" means here: the conversation is not linked to a GitHub issue,
 * GitHub is not connected, GitHub rejects the token (and the integration is
 * told so), or GitHub answers with any other error. A comment that is already
 * gone (404) is not a failure: there is nothing left to keep in step, and the
 * local edit stands. How the service abandons the edit when this throws is
 * pinned in `conversation/__tests__/message-edit.contract.db.test.ts`.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import type { ConversationId } from '@quackback/ids'

const lookup = vi.hoisted(() => vi.fn())
const findFirst = vi.hoisted(() => vi.fn())
const recordLastError = vi.hoisted(() => vi.fn(async () => {}))
const decrypted = vi.hoisted(() => ({ secrets: { accessToken: 'tok' } as Record<string, unknown> }))

vi.mock('@/lib/server/domains/conversation/conversation.inbound-resolve', () => ({
  lookupChannelThreadByConversation: lookup,
}))

vi.mock('@/lib/server/logger', () => ({
  logger: {
    child: () => ({ warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  },
}))

vi.mock('@/lib/server/db', () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => [{ config: { integrationId: 'integration_1' } }],
        }),
      }),
    }),
    query: { integrations: { findFirst } },
  },
  eq: () => ({}),
  and: () => ({}),
  desc: () => ({}),
  isNull: () => ({}),
  conversationMessages: { id: 'id', metadata: 'metadata' },
  channelAccounts: { id: 'id', config: 'config' },
  integrations: { id: 'id', integrationType: 'integrationType', status: 'status' },
}))

vi.mock('@/lib/server/integrations/encryption', () => ({
  decryptSecrets: () => decrypted.secrets,
}))

vi.mock('@/lib/server/domains/conversation/conversation.channel-delivery', () => ({
  persistChannelDelivery: vi.fn(async () => {}),
}))

vi.mock('@/lib/server/integrations/webhook-registration', () => ({
  recordIntegrationLastError: recordLastError,
}))

import { updateGitHubIssueComment } from '../github-deliver'

const conversationId = 'conversation_01kw8qxn1eeh4t2rek7varh032' as ConversationId

describe('updating the GitHub comment of an edited message (G7)', () => {
  beforeEach(() => {
    lookup.mockResolvedValue({
      channelAccountId: 'channelaccount_1',
      externalThreadKey: 'acme/api#201',
    })
    findFirst.mockResolvedValue({ id: 'integration_1', secrets: 'enc' })
    decrypted.secrets = { accessToken: 'tok' }
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  it('writes the new body to the comment that mirrors the message (G7)', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => '' })
    vi.stubGlobal('fetch', fetchMock)

    await updateGitHubIssueComment(conversationId, '444', 'new body')

    expect(String(fetchMock.mock.calls[0][0])).toContain('/repos/acme/api/issues/comments/444')
    expect(fetchMock.mock.calls[0][1].method).toBe('PATCH')
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ body: 'new body' })
  })

  it('counts a comment that is already gone as nothing left to update (G7)', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: false, status: 404, text: async () => 'gone' })
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      updateGitHubIssueComment(conversationId, '444', 'new body')
    ).resolves.toBeUndefined()
  })

  it('fails, and tells the integration, when GitHub rejects the token (G7)', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: false, status: 401, text: async () => 'bad token' })
    vi.stubGlobal('fetch', fetchMock)

    await expect(updateGitHubIssueComment(conversationId, '444', 'new body')).rejects.toThrow(
      /Authentication failed/
    )
    expect(recordLastError).toHaveBeenCalledWith(
      'integration_1',
      'Authentication failed. Please reconnect GitHub.'
    )
  })

  it('fails with the status and the answer when GitHub refuses for any other reason (G7)', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: false, status: 500, text: async () => 'upstream exploded' })
    vi.stubGlobal('fetch', fetchMock)

    await expect(updateGitHubIssueComment(conversationId, '444', 'new body')).rejects.toThrow(
      'HTTP 500: upstream exploded'
    )
  })

  it('fails without calling GitHub when the conversation is not linked to an issue (G7)', async () => {
    lookup.mockResolvedValue(null)
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await expect(updateGitHubIssueComment(conversationId, '444', 'new body')).rejects.toThrow(
      'This conversation is not linked to a GitHub issue.'
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('fails without calling GitHub when GitHub is not connected (G7)', async () => {
    decrypted.secrets = {}
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await expect(updateGitHubIssueComment(conversationId, '444', 'new body')).rejects.toThrow(
      'GitHub is not connected.'
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
