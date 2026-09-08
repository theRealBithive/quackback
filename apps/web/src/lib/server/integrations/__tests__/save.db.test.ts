/**
 * `saveIntegration` on a connection that already exists (`save.ts`).
 *
 * Contract, confirmed before implementation:
 *
 *   V6 A repeated GitLab connect over OAuth keeps the board rules and the
 *      webhook secret. Only a disconnect removes them.
 *
 * Runs inside the transactional db fixture, because what V6 promises is a
 * property of the row. The board rules reference the integration's id and go
 * with it (`event_mappings_integration_fk`, on delete cascade), and the webhook
 * secret lives in the row's config. A reconnect keeps both exactly when it
 * updates the row in place instead of replacing it — which is what the upsert
 * on the integration type does, and what is pinned here against the schema
 * that has to hold it up. The UI half, that Reconnect is offered at all, is in
 * `components/admin/settings/integrations/__tests__/oauth-connection-actions.test.tsx`.
 */
import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

// Real AES encryption needs config.secretKey (unset in unit tests) and is
// incidental here — the boundary under test is the upsert.
vi.mock('../encryption', () => ({
  encryptSecrets: vi.fn((v: unknown) => JSON.stringify(v)),
  decryptSecrets: vi.fn((v: string) => JSON.parse(v)),
}))

import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { integrations, integrationEventMappings, principal, eq } from '@/lib/server/db'
import { saveIntegration } from '../save'
import type { IntegrationId, PrincipalId } from '@quackback/ids'

const fixture = await createDbTestFixture()

/** The teammate who clicks Connect. */
async function connector(): Promise<PrincipalId> {
  const [row] = await testDb
    .insert(principal)
    .values({ createdAt: new Date(), displayName: 'Ada', contactEmail: 'ada@example.com' })
    .returning({ id: principal.id })
  return row.id as PrincipalId
}

/** What the OAuth callback hands `saveIntegration` after the code exchange. */
function exchangeResult(accessToken: string, refreshToken: string) {
  return {
    accessToken,
    refreshToken,
    expiresIn: 7200,
    config: { workspaceName: 'Ada', instanceUrl: 'https://gitlab.example.com' },
  }
}

/**
 * What happens between two connects: status sync is enabled, which writes the
 * webhook secret into the config, and a board is routed to a project, which
 * writes a mapping that references the row.
 */
async function enableStatusSyncAndRouteBoard(integrationId: IntegrationId): Promise<string> {
  const [row] = await testDb
    .select({ config: integrations.config })
    .from(integrations)
    .where(eq(integrations.id, integrationId))
  await testDb
    .update(integrations)
    .set({
      config: {
        ...(row.config as Record<string, unknown>),
        webhookSecret: 'whs-1',
        statusSyncEnabled: true,
      },
      lastError: 'Could not renew the GitLab access token. Please reconnect GitLab.',
      lastErrorAt: new Date(),
    })
    .where(eq(integrations.id, integrationId))
  const [mapping] = await testDb
    .insert(integrationEventMappings)
    .values({
      integrationId,
      eventType: 'post.status_changed',
      actionType: 'send_message',
      actionConfig: { channelId: '42' },
      filters: { boardIds: ['board_1'] },
      targetKey: 'board_1',
    })
    .returning({ id: integrationEventMappings.id })
  return mapping.id
}

async function row(integrationId: IntegrationId) {
  const found = await testDb.query.integrations.findFirst({
    where: eq(integrations.id, integrationId),
  })
  if (!found) throw new Error('integration row gone')
  return found
}

async function mappingsOf(integrationId: IntegrationId) {
  return testDb
    .select({ id: integrationEventMappings.id })
    .from(integrationEventMappings)
    .where(eq(integrationEventMappings.integrationId, integrationId))
}

describe.skipIf(!fixture.available)('saveIntegration on an existing connection (V6)', () => {
  beforeEach(fixture.begin)
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  it('updates the row in place, so the board rule that references it survives', async () => {
    const who = await connector()
    const first = await saveIntegration('gitlab', {
      principalId: who,
      ...exchangeResult('a1', 'r1'),
    })
    const mappingId = await enableStatusSyncAndRouteBoard(first)

    const second = await saveIntegration('gitlab', {
      principalId: who,
      ...exchangeResult('a2', 'r2'),
    })

    expect(second).toBe(first)
    expect(await mappingsOf(first)).toEqual([{ id: mappingId }])
  })

  it('keeps the webhook secret and the status-sync setting the reconnect did not mention', async () => {
    const who = await connector()
    const id = await saveIntegration('gitlab', { principalId: who, ...exchangeResult('a1', 'r1') })
    await enableStatusSyncAndRouteBoard(id)

    await saveIntegration('gitlab', { principalId: who, ...exchangeResult('a2', 'r2') })

    const config = (await row(id)).config as Record<string, unknown>
    expect(config).toMatchObject({
      webhookSecret: 'whs-1',
      statusSyncEnabled: true,
      instanceUrl: 'https://gitlab.example.com',
    })
  })

  it('replaces the tokens, records the new expiry, and clears the renewal failure it cures', async () => {
    const who = await connector()
    const id = await saveIntegration('gitlab', { principalId: who, ...exchangeResult('a1', 'r1') })
    await enableStatusSyncAndRouteBoard(id)
    const before = Date.now()

    await saveIntegration('gitlab', { principalId: who, ...exchangeResult('a2', 'r2') })

    const after = await row(id)
    expect(JSON.parse(after.secrets ?? '{}')).toEqual({ accessToken: 'a2', refreshToken: 'r2' })
    const expiresAt = new Date((after.config as { tokenExpiresAt: string }).tokenExpiresAt)
    expect(expiresAt.getTime()).toBeGreaterThanOrEqual(before + 7200 * 1000 - 1000)
    expect(after.lastError).toBeNull()
    expect(after.lastErrorAt).toBeNull()
    expect(after.status).toBe('active')
  })

  it('keeps the service principal the first connect created', async () => {
    const who = await connector()
    const id = await saveIntegration('gitlab', { principalId: who, ...exchangeResult('a1', 'r1') })
    const servicePrincipal = (await row(id)).principalId

    await saveIntegration('gitlab', { principalId: who, ...exchangeResult('a2', 'r2') })

    expect(servicePrincipal).not.toBeNull()
    expect((await row(id)).principalId).toBe(servicePrincipal)
  })

  /**
   * The contrast V6 is measured against, and the reason Reconnect exists: this
   * is what the only button offered until now did.
   */
  it('contrast: deleting the connection takes the board rule with it', async () => {
    const who = await connector()
    const id = await saveIntegration('gitlab', { principalId: who, ...exchangeResult('a1', 'r1') })
    await enableStatusSyncAndRouteBoard(id)

    await testDb.delete(integrations).where(eq(integrations.id, id))

    expect(await mappingsOf(id)).toEqual([])
  })
})
