/**
 * GitLab's server functions.
 *
 * Contract, confirmed before implementation:
 *
 *   V3 The GitLab settings page lists projects with a renewed token; an expired
 *      access token alone never makes the list fail.
 *
 * The project list is what the settings page loads first, so it used to be the
 * morning's first symptom: the stored token had expired overnight, the page
 * said the projects could not be loaded, and the operator read that as a lost
 * connection — although the refresh token in the same row would have worked,
 * had anything asked. The handler now asks by id, and never reads the blob.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { PERMISSIONS } from '@/lib/shared/permissions'

type AnyHandler = (args?: { data?: Record<string, unknown> }) => Promise<unknown>
const handlers: AnyHandler[] = []
const declared: unknown[] = []

vi.mock('@tanstack/react-start', () => ({
  createServerFn: (options: unknown) => {
    declared.push(options)
    const chain = {
      validator() {
        return chain
      },
      handler(fn: AnyHandler) {
        handlers.push(fn)
        return chain
      },
    }
    return chain
  },
}))

const hoisted = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  findFirst: vi.fn(),
  getValidAccessToken: vi.fn(),
  listGitLabProjects: vi.fn(),
  decryptSecrets: vi.fn(),
  hasPlatformCredentials: vi.fn(),
  signOAuthState: vi.fn(),
}))

vi.mock('@/lib/server/functions/auth-helpers', () => ({ requireAuth: hoisted.requireAuth }))
// `eq` hands back a marker so the test can see the lookup that reached the
// query, not only that some query ran.
const GITLAB_LOOKUP = vi.hoisted(() => ({ marker: 'where integration_type = gitlab' }))
vi.mock('@/lib/server/db', () => ({
  db: { query: { integrations: { findFirst: hoisted.findFirst } } },
  integrations: { integrationType: 'integration_type' },
  eq: vi.fn((column: unknown, value: unknown) => ({ column, value, ...GITLAB_LOOKUP })),
}))
vi.mock('@/lib/server/integrations/token-refresh', () => ({
  getValidAccessToken: hoisted.getValidAccessToken,
}))
vi.mock('@/integrations/gitlab/server/projects', () => ({
  listGitLabProjects: hoisted.listGitLabProjects,
}))
vi.mock('@/lib/server/integrations/encryption', () => ({
  decryptSecrets: hoisted.decryptSecrets,
}))
vi.mock('@/lib/server/domains/platform-credentials/platform-credential.service', () => ({
  hasPlatformCredentials: hoisted.hasPlatformCredentials,
}))
vi.mock('@/lib/server/auth/oauth-state', () => ({ signOAuthState: hoisted.signOAuthState }))
vi.mock('@/lib/server/config', () => ({ config: { baseUrl: 'https://feedback.example.com' } }))

await import('@/integrations/gitlab/server/functions')
const [getGitLabConnectUrl, fetchGitLabProjects] = handlers

const connectedRow = {
  id: 'integration_gl',
  integrationType: 'gitlab',
  status: 'active',
  secrets: 'ciphertext-with-an-expired-token',
  config: { instanceUrl: 'https://gitlab.example.com' },
}

describe('fetchGitLabProjectsFn', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    hoisted.requireAuth.mockResolvedValue({ principal: { id: 'principal_1' } })
    hoisted.findFirst.mockResolvedValue(connectedRow)
    hoisted.getValidAccessToken.mockResolvedValue('renewed-token')
    hoisted.listGitLabProjects.mockResolvedValue([{ id: '7', name: 'acme / app' }])
  })

  it('looks up the GitLab connection, not any connection', async () => {
    await fetchGitLabProjects()

    expect(hoisted.findFirst).toHaveBeenCalledWith({
      where: { column: 'integration_type', value: 'gitlab', ...GITLAB_LOOKUP },
    })
  })

  it('lists projects with a token renewed by the connection id (V3)', async () => {
    await expect(fetchGitLabProjects()).resolves.toEqual([{ id: '7', name: 'acme / app' }])

    expect(hoisted.getValidAccessToken).toHaveBeenCalledTimes(1)
    expect(hoisted.getValidAccessToken).toHaveBeenCalledWith('integration_gl')
    expect(hoisted.listGitLabProjects).toHaveBeenCalledWith(
      'renewed-token',
      'https://gitlab.example.com'
    )
  })

  it('never reads the stored blob, so an expired access token there cannot fail the list (V3)', async () => {
    await fetchGitLabProjects()

    expect(hoisted.decryptSecrets).not.toHaveBeenCalled()
  })

  it('asks the renewal even for a row that stores nothing, and names what is missing', async () => {
    hoisted.findFirst.mockResolvedValue({ ...connectedRow, secrets: null })
    hoisted.getValidAccessToken.mockResolvedValue('')

    await expect(fetchGitLabProjects()).rejects.toThrow('GitLab access token missing')
    expect(hoisted.listGitLabProjects).not.toHaveBeenCalled()
  })

  it('lists on gitlab.com when the connection records no instance', async () => {
    hoisted.findFirst.mockResolvedValue({ ...connectedRow, config: null })

    await fetchGitLabProjects()

    expect(hoisted.listGitLabProjects).toHaveBeenCalledWith('renewed-token', undefined)
  })

  it('refuses when GitLab is not connected', async () => {
    hoisted.findFirst.mockResolvedValue(undefined)

    await expect(fetchGitLabProjects()).rejects.toThrow('GitLab not connected')
    expect(hoisted.getValidAccessToken).not.toHaveBeenCalled()
  })

  it('refuses when the connection is paused', async () => {
    hoisted.findFirst.mockResolvedValue({ ...connectedRow, status: 'paused' })

    await expect(fetchGitLabProjects()).rejects.toThrow('GitLab not connected')
    expect(hoisted.getValidAccessToken).not.toHaveBeenCalled()
  })

  it('requires the permission to manage integrations before reading anything', async () => {
    hoisted.requireAuth.mockRejectedValue(new Error('Forbidden'))

    await expect(fetchGitLabProjects()).rejects.toThrow('Forbidden')
    expect(hoisted.requireAuth).toHaveBeenCalledWith({
      permission: PERMISSIONS.INTEGRATION_MANAGE,
    })
    expect(hoisted.findFirst).not.toHaveBeenCalled()
  })
})

describe('getGitLabConnectUrl', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    hoisted.requireAuth.mockResolvedValue({
      settings: { id: 'workspace_1' },
      principal: { id: 'principal_1' },
    })
    hoisted.hasPlatformCredentials.mockResolvedValue(true)
    hoisted.signOAuthState.mockReturnValue('signed state/with=chars')
  })

  it('returns the connect route carrying the signed state, URL-encoded', async () => {
    await expect(getGitLabConnectUrl()).resolves.toBe(
      `/oauth/gitlab/connect?state=${encodeURIComponent('signed state/with=chars')}`
    )
  })

  it('signs who is connecting, from where, and for which workspace', async () => {
    const before = Date.now()
    await getGitLabConnectUrl()

    expect(hoisted.signOAuthState).toHaveBeenCalledTimes(1)
    const state = hoisted.signOAuthState.mock.calls[0][0] as Record<string, unknown>
    expect(state).toMatchObject({
      type: 'gitlab_oauth',
      workspaceId: 'workspace_1',
      returnDomain: 'feedback.example.com',
      principalId: 'principal_1',
    })
    expect(typeof state.nonce).toBe('string')
    expect((state.nonce as string).length).toBeGreaterThan(0)
    expect(state.ts as number).toBeGreaterThanOrEqual(before)
  })

  it('refuses before signing anything when no platform credentials are stored', async () => {
    hoisted.hasPlatformCredentials.mockResolvedValue(false)

    await expect(getGitLabConnectUrl()).rejects.toThrow(
      'GitLab platform credentials not configured'
    )
    expect(hoisted.hasPlatformCredentials).toHaveBeenCalledWith('gitlab')
    expect(hoisted.signOAuthState).not.toHaveBeenCalled()
  })

  it('requires the permission to manage integrations', async () => {
    hoisted.requireAuth.mockRejectedValue(new Error('Forbidden'))

    await expect(getGitLabConnectUrl()).rejects.toThrow('Forbidden')
    expect(hoisted.requireAuth).toHaveBeenCalledWith({
      permission: PERMISSIONS.INTEGRATION_MANAGE,
    })
    expect(hoisted.hasPlatformCredentials).not.toHaveBeenCalled()
  })
})

describe('the server functions as declared', () => {
  it('declares both as reads', () => {
    expect(declared).toEqual([{ method: 'GET' }, { method: 'GET' }])
  })
})
