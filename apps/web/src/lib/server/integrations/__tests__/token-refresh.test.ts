/**
 * Unified token refresh (IF WO-13): expiry buffer, refresh with BY-ID
 * persistence, resolver-cache invalidation, and graceful fallbacks. Runs
 * inside the transactional db fixture; the Jira refresh endpoint and
 * platform credentials are mocked at the module boundary.
 *
 * The renewal itself is V1/V2/V5 and is held per provider — for GitLab in
 * `integrations/gitlab/server/__tests__/oauth-refresh.test.ts`. What is held
 * here is what happens when a renewal cannot be made, because the row that has
 * to say so is in reach:
 *
 *   V3 A renewal the provider refuses does not look like a working connection:
 *      it is recorded that a reconnect is needed, and why.
 *   V4 A connection with no refresh token stored at all is named as such,
 *      rather than failing again every two hours.
 *   V5 Neither the old nor the new token, nor the client secret, appears in a
 *      log line or a message.
 *   V6 A renewal touches only the connection it was asked about, never
 *      another provider's connection. (Not a sibling of the same provider:
 *      `integration_type_unique` means there is only ever one of those.)
 *   V7 Asking about a connection that does not exist, or one with nothing
 *      stored, yields no token rather than an error.
 */
import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

vi.mock('@/lib/server/cache', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/cache')>()),
  cacheDel: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/integrations/jira/server/oauth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/integrations/jira/server/oauth')>()),
  refreshJiraToken: vi.fn(),
}))

vi.mock('@/lib/server/domains/platform-credentials/platform-credential.service', () => ({
  getPlatformCredentials: vi.fn().mockResolvedValue(null),
}))

// Real AES encryption needs config.secretKey (unset in unit tests) and is
// incidental here — the boundary under test is refresh + persistence.
vi.mock('../encryption', () => ({
  encryptSecrets: vi.fn((v: unknown) => JSON.stringify(v)),
  decryptSecrets: vi.fn((v: string) => JSON.parse(v)),
}))

import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { integrations, eq } from '@/lib/server/db'
import { encryptSecrets, decryptSecrets } from '../encryption'
import { getValidAccessToken } from '../token-refresh'
import { refreshJiraToken } from '@/integrations/jira/server/oauth'
import { cacheDel, CACHE_KEYS } from '@/lib/server/cache'
import type { IntegrationId } from '@quackback/ids'

const fixture = await createDbTestFixture()

const refreshJiraTokenMock = vi.mocked(refreshJiraToken)

async function seedIntegration(overrides: {
  integrationType?: string
  tokenExpiresAt?: string
  secrets?: Record<string, string>
}): Promise<IntegrationId> {
  const [row] = await testDb
    .insert(integrations)
    .values({
      integrationType: overrides.integrationType ?? 'jira',
      status: 'active',
      secrets: encryptSecrets(
        overrides.secrets ?? { accessToken: 'stored-token', refreshToken: 'stored-refresh' }
      ),
      config: {
        cloudId: 'cloud-1',
        ...(overrides.tokenExpiresAt ? { tokenExpiresAt: overrides.tokenExpiresAt } : {}),
      },
    })
    .returning()
  return row.id as IntegrationId
}

describe('getValidAccessToken', () => {
  beforeEach(async () => {
    await fixture.begin()
    vi.clearAllMocks()
  })
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  it('returns the stored token untouched when not near expiry', async () => {
    const id = await seedIntegration({
      tokenExpiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    })
    await expect(getValidAccessToken(id)).resolves.toBe('stored-token')
    expect(refreshJiraTokenMock).not.toHaveBeenCalled()
    expect(cacheDel).not.toHaveBeenCalled()
  })

  it('refreshes an expired token, persists BY ID, and busts the resolver cache', async () => {
    const id = await seedIntegration({
      tokenExpiresAt: new Date(Date.now() - 1000).toISOString(),
    })
    refreshJiraTokenMock.mockResolvedValue({
      accessToken: 'fresh-token',
      refreshToken: 'fresh-refresh',
      expiresIn: 3600,
    })

    await expect(getValidAccessToken(id)).resolves.toBe('fresh-token')
    expect(refreshJiraTokenMock).toHaveBeenCalledWith('stored-refresh', undefined)
    expect(cacheDel).toHaveBeenCalledWith(CACHE_KEYS.INTEGRATION_MAPPINGS)

    const row = await testDb.query.integrations.findFirst({ where: eq(integrations.id, id) })
    const secrets = decryptSecrets<Record<string, string>>(row!.secrets!)
    expect(secrets.accessToken).toBe('fresh-token')
    expect(secrets.refreshToken).toBe('fresh-refresh')
    const config = row!.config as Record<string, unknown>
    expect(new Date(config.tokenExpiresAt as string).getTime()).toBeGreaterThan(Date.now())
  })

  it('refreshes within the 5-minute buffer, not only after hard expiry', async () => {
    const id = await seedIntegration({
      tokenExpiresAt: new Date(Date.now() + 2 * 60 * 1000).toISOString(),
    })
    // The real Jira endpoint always rotates, but the slot contract allows
    // providers that don't — the stored refresh token must survive.
    refreshJiraTokenMock.mockResolvedValue({
      accessToken: 'fresh-token',
      expiresIn: 3600,
    } as Awaited<ReturnType<typeof refreshJiraToken>>)

    await expect(getValidAccessToken(id)).resolves.toBe('fresh-token')
    // No rotated refresh token in the response — the stored one is kept.
    const row = await testDb.query.integrations.findFirst({ where: eq(integrations.id, id) })
    const secrets = decryptSecrets<Record<string, string>>(row!.secrets!)
    expect(secrets.refreshToken).toBe('stored-refresh')
  })

  it('falls back to the stored token when the refresh call fails', async () => {
    const id = await seedIntegration({
      tokenExpiresAt: new Date(Date.now() - 1000).toISOString(),
    })
    refreshJiraTokenMock.mockRejectedValue(new Error('token endpoint down'))

    await expect(getValidAccessToken(id)).resolves.toBe('stored-token')
    expect(cacheDel).not.toHaveBeenCalled()
  })

  it('returns the stored token for providers without a refreshToken capability', async () => {
    const id = await seedIntegration({
      integrationType: 'github',
      tokenExpiresAt: new Date(Date.now() - 1000).toISOString(),
    })
    await expect(getValidAccessToken(id)).resolves.toBe('stored-token')
    expect(refreshJiraTokenMock).not.toHaveBeenCalled()
  })

  it('says on the integration that a refused renewal needs a reconnect (V3)', async () => {
    const id = await seedIntegration({
      tokenExpiresAt: new Date(Date.now() - 1000).toISOString(),
    })
    refreshJiraTokenMock.mockRejectedValue(new Error('token endpoint down'))

    await getValidAccessToken(id)

    const row = await testDb.query.integrations.findFirst({ where: eq(integrations.id, id) })
    expect(row!.lastError).toMatch(/reconnect/i)
    expect(row!.lastErrorAt).not.toBeNull()
  })

  it('records nothing that could be replayed (V5)', async () => {
    const id = await seedIntegration({
      tokenExpiresAt: new Date(Date.now() - 1000).toISOString(),
    })
    refreshJiraTokenMock.mockRejectedValue(new Error('token endpoint down'))

    await getValidAccessToken(id)

    const row = await testDb.query.integrations.findFirst({ where: eq(integrations.id, id) })
    expect(row!.lastError).not.toContain('stored-token')
    expect(row!.lastError).not.toContain('stored-refresh')
  })

  it('names a connection that has no refresh token to renew with (V4)', async () => {
    const id = await seedIntegration({
      secrets: { accessToken: 'stored-token' },
      tokenExpiresAt: new Date(Date.now() - 1000).toISOString(),
    })

    await expect(getValidAccessToken(id)).resolves.toBe('stored-token')

    const row = await testDb.query.integrations.findFirst({ where: eq(integrations.id, id) })
    expect(row!.lastError).toMatch(/reconnect/i)
    expect(refreshJiraTokenMock).not.toHaveBeenCalled()
  })

  it('leaves a healthy connection unmarked (V3)', async () => {
    // The unguarded half of the pair above: recording a failure must not be
    // something every call does on its way past.
    const id = await seedIntegration({
      tokenExpiresAt: new Date(Date.now() - 1000).toISOString(),
    })
    refreshJiraTokenMock.mockResolvedValue({
      accessToken: 'fresh-token',
      refreshToken: 'fresh-refresh',
      expiresIn: 3600,
    })

    await getValidAccessToken(id)

    const row = await testDb.query.integrations.findFirst({ where: eq(integrations.id, id) })
    expect(row!.lastError).toBeNull()
    expect(row!.lastErrorAt).toBeNull()
  })

  it('does not mark a provider that simply cannot refresh (V4)', async () => {
    // No capability is not a fault: the token may never expire.
    const id = await seedIntegration({
      integrationType: 'github',
      tokenExpiresAt: new Date(Date.now() - 1000).toISOString(),
    })

    await getValidAccessToken(id)

    const row = await testDb.query.integrations.findFirst({ where: eq(integrations.id, id) })
    expect(row!.lastError).toBeNull()
  })

  it("renews the connection it was asked about, not another provider's (V6)", async () => {
    const other = await seedIntegration({
      integrationType: 'github',
      tokenExpiresAt: new Date(Date.now() - 1000).toISOString(),
      secrets: { accessToken: 'other-token', refreshToken: 'other-refresh' },
    })
    const id = await seedIntegration({
      tokenExpiresAt: new Date(Date.now() - 1000).toISOString(),
    })
    refreshJiraTokenMock.mockResolvedValue({
      accessToken: 'fresh-token',
      refreshToken: 'fresh-refresh',
      expiresIn: 3600,
    })

    await expect(getValidAccessToken(id)).resolves.toBe('fresh-token')

    expect(refreshJiraTokenMock).toHaveBeenCalledWith('stored-refresh', undefined)
    const untouched = await testDb.query.integrations.findFirst({
      where: eq(integrations.id, other),
    })
    expect(decryptSecrets<Record<string, string>>(untouched!.secrets!).accessToken).toBe(
      'other-token'
    )
  })

  it('yields nothing for a connection that does not exist (V7)', async () => {
    // A real id that is then removed: a hand-typed one fails the TypeID parser
    // before the lookup, so the test would pass without reaching the code.
    const id = await seedIntegration({})
    await testDb.delete(integrations).where(eq(integrations.id, id))

    await expect(getValidAccessToken(id)).resolves.toBe('')
  })

  it('yields nothing for a connection with nothing stored (V7)', async () => {
    const [row] = await testDb
      .insert(integrations)
      .values({ integrationType: 'jira', status: 'active', secrets: null, config: {} })
      .returning()

    await expect(getValidAccessToken(row.id as IntegrationId)).resolves.toBe('')
  })

  it('leaves a provider the registry does not know alone (V4)', async () => {
    // Not the same as a known provider without the capability: here there is
    // no definition at all, and reading through it must not throw.
    const id = await seedIntegration({
      integrationType: 'not_a_provider',
      tokenExpiresAt: new Date(Date.now() - 1000).toISOString(),
    })

    await expect(getValidAccessToken(id)).resolves.toBe('stored-token')

    const row = await testDb.query.integrations.findFirst({ where: eq(integrations.id, id) })
    expect(row!.lastError).toBeNull()
  })

  it('renews a token standing exactly on the buffer boundary (V1)', async () => {
    // The boundary belongs to the renewal: a token with exactly five minutes
    // left is inside the buffer, not outside it.
    const now = new Date('2026-09-05T12:00:00.000Z')
    vi.setSystemTime(now)
    const id = await seedIntegration({
      tokenExpiresAt: new Date(now.getTime() + 5 * 60 * 1000).toISOString(),
    })
    refreshJiraTokenMock.mockResolvedValue({
      accessToken: 'fresh-token',
      refreshToken: 'fresh-refresh',
      expiresIn: 3600,
    })

    await expect(getValidAccessToken(id)).resolves.toBe('fresh-token')
    vi.useRealTimers()
  })

  it('reads snake_case token keys (access_token/refresh_token fallback)', async () => {
    const id = await seedIntegration({
      secrets: { access_token: 'snake-token', refresh_token: 'snake-refresh' },
      tokenExpiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    })
    await expect(getValidAccessToken(id)).resolves.toBe('snake-token')
  })

  it('returns the stored token when no expiry is recorded (non-expiring tokens)', async () => {
    const id = await seedIntegration({})
    await expect(getValidAccessToken(id)).resolves.toBe('stored-token')
    expect(refreshJiraTokenMock).not.toHaveBeenCalled()
  })
})
