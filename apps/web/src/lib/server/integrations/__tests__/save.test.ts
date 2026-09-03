import { describe, expect, it } from 'vitest'
import { mergeIntegrationConfig } from '../save'

describe('mergeIntegrationConfig', () => {
  it('keeps channelId and webhook ids when GitHub OAuth reconnects', () => {
    expect(
      mergeIntegrationConfig(
        {
          channelId: 'acme/api',
          webhookSecret: 'hook-secret',
          externalWebhookId: '12',
          username: 'old-login',
        },
        { username: 'new-login', workspaceName: 'new-login' }
      )
    ).toEqual({
      channelId: 'acme/api',
      webhookSecret: 'hook-secret',
      externalWebhookId: '12',
      username: 'new-login',
      workspaceName: 'new-login',
    })
  })

  it('writes tokenExpiresAt when OAuth returns an expiry', () => {
    const expires = new Date('2026-09-01T00:00:00.000Z')
    expect(mergeIntegrationConfig({ channelId: 'acme/api' }, { username: 'ops' }, expires)).toEqual(
      {
        channelId: 'acme/api',
        username: 'ops',
        tokenExpiresAt: expires.toISOString(),
      }
    )
  })

  it('starts from the OAuth blob when there is no stored config', () => {
    expect(mergeIntegrationConfig(null, { username: 'ops' })).toEqual({ username: 'ops' })
  })

  /**
   * Contract: V2 — a reconnect against a different GitLab instance must take
   * effect, and V3 — it must not cost the connection anything else.
   *
   * The overlay has no delete semantics, so the origin only changes if the
   * exchange always states it. These two pin the halves that have to hold
   * together.
   */
  it('lets a fresh origin replace a stale one (V2)', () => {
    const merged = mergeIntegrationConfig(
      { instanceUrl: 'https://gitlab.self-hosted.example' },
      { instanceUrl: 'https://gitlab.com' }
    )

    expect(merged.instanceUrl).toBe('https://gitlab.com')
  })

  it('keeps everything the reconnect did not mention (V3)', () => {
    const merged = mergeIntegrationConfig(
      {
        instanceUrl: 'https://gitlab.self-hosted.example',
        channelId: '11',
        webhookSecret: 'shh',
      },
      { instanceUrl: 'https://gitlab.com', workspaceName: 'Ada' }
    )

    expect(merged).toEqual({
      instanceUrl: 'https://gitlab.com',
      channelId: '11',
      webhookSecret: 'shh',
      workspaceName: 'Ada',
    })
  })
})
