/**
 * `oauth_client_resource` is the row Better Auth 1.7 writes when a dynamically
 * registered MCP client is bound to the resource it will be issued tokens for,
 * and it is addressed unusually: by the client's `client_id` on one side and
 * by the resource's RFC 8707 *identifier* on the other — not by either table's
 * primary key. That is a claim about two foreign keys pointing at UNIQUE
 * columns, and it is only true if the database says so: a schema file that
 * pointed either reference at `id` would type-check, migrate, and leave orphan
 * bindings behind after a client or a resource is removed.
 *
 * So the substitution here is the connection and nothing else. Real tables,
 * real constraints, one transaction that is always rolled back.
 *
 * Contract group M — MCP scoped OAuth on Better Auth 1.7 (upstream #540, #550, #541, #551)
 *
 * M1 The MCP protected-resource metadata is served as JSON at both well-known paths, the
 *    root one and the one under `/api/mcp`, and names this instance's MCP resource.
 * M2 The MCP resource identifier is this instance's `/api/mcp` URL. A `*.localhost` host is
 *    collapsed to a loopback form for plugin registration only; every other identifier
 *    passes through unchanged.
 * M3 On start-up the instance makes sure its MCP `oauth_resource` row exists before Better
 *    Auth seeds it, so a concurrent replica cannot abort plugin init; a second start changes
 *    nothing.
 * M4 Dynamic client registration from an MCP client with a private-use redirect scheme is
 *    accepted: the request is rewritten to a loopback callback Better Auth 1.7 allows, and
 *    after registration the client's real redirect URIs are restored both on the stored
 *    client and in the response. A registration answer without a `client_id` is a server
 *    error, and only a JSON body is rewritten.
 * M5 The consent page shows the scopes the client asked for when it asked for a subset, and
 *    the first-connect defaults when it asked for the whole catalogue; the domain levels
 *    start from those scopes, and authorising needs at least one capability scope selected.
 * M6 The authorize request carries the client's requested scope in `qb_requested_scope`
 *    exactly once: a full-catalogue request is stamped only when the parameter is not
 *    already there, and a client-supplied prefill on the first hop is not trusted.
 * M7 An MCP request whose body is not JSON is not refused by the scope gate with a 403; it
 *    passes to the protocol layer, which rejects it.
 * M8 OIDC sign-in from the portal header, the auth form, onboarding and the provider-link
 *    flow starts through Better Auth's social sign-in with the provider id; a generic OAuth
 *    account's subject is the profile `id`, falling back to `sub`.
 * M9 The API-key dialog refuses an empty scope selection with a message, and resets name,
 *    levels and error when it closes.
 * M10 An `oauth_client_resource` row is bound to an existing client and to a resource by its
 *     identifier, and both bindings cascade on delete.
 */
import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest'
import { eq, getTableName } from 'drizzle-orm'
import { getTableConfig } from 'drizzle-orm/pg-core'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { oauthClient, oauthClientResource, oauthResource } from '@/lib/server/db'
import { API_KEY_SCOPES } from '@/lib/shared/api-key-scopes'
import { mcpOauthResourceSeedRow } from '../ensure-mcp-oauth-resource'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: oauthClient.id }).from(oauthClient).limit(0)
    await db.select({ id: oauthResource.id }).from(oauthResource).limit(0)
    await db.select({ id: oauthClientResource.id }).from(oauthClientResource).limit(0)
  },
})

/** A run-unique suffix, so two rolled-back runs cannot collide on a UNIQUE. */
function unique(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
}

describe.skipIf(!fixture.available)('oauth_client_resource bindings', () => {
  beforeEach(fixture.begin)
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  /** A registered MCP client, its resource, and the binding between them. */
  async function seedBinding(): Promise<{
    clientId: string
    identifier: string
    bindingId: string
  }> {
    const suffix = unique()
    const clientId = `client_${suffix}`
    const identifier = `https://feedback-${suffix}.example.com/api/mcp`
    const bindingId = `ocr_${suffix}`

    await testDb.insert(oauthClient).values({
      id: `oc_${suffix}`,
      clientId,
      name: 'Cursor',
      redirectUris: ['cursor://anysphere.cursor-mcp/oauth/callback'],
      createdAt: new Date(),
    })
    // The same row the instance pre-inserts on start-up, so this is the
    // shape a real binding points at rather than an invented one.
    await testDb.insert(oauthResource).values(mcpOauthResourceSeedRow(identifier, API_KEY_SCOPES))
    await testDb.insert(oauthClientResource).values({
      id: bindingId,
      clientId,
      resourceId: identifier,
      createdAt: new Date(),
    })

    return { clientId, identifier, bindingId }
  }

  /**
   * The SQLSTATE the database refused with. Drizzle wraps the driver error in
   * a `Failed query: …` message, so `.rejects.toThrow()` alone cannot tell a
   * referential-integrity refusal from a typo in the fixture.
   */
  function refusalCode(error: unknown): string | undefined {
    const cause = (error as { cause?: { code?: string } } | null)?.cause
    return cause?.code ?? (error as { code?: string } | null)?.code
  }

  /** Whether the binding row is still there. */
  async function bindingExists(bindingId: string): Promise<boolean> {
    const rows = await testDb
      .select({ id: oauthClientResource.id })
      .from(oauthClientResource)
      .where(eq(oauthClientResource.id, bindingId))
    return rows.length === 1
  }

  it('binds a client by client_id and a resource by its identifier (M10)', async () => {
    const { clientId, identifier, bindingId } = await seedBinding()

    const [row] = await testDb
      .select()
      .from(oauthClientResource)
      .where(eq(oauthClientResource.id, bindingId))

    // Neither side is a primary key: `client_id` and `identifier` are what
    // Better Auth 1.7 writes, and what the constraints have to accept.
    expect(row.clientId).toBe(clientId)
    expect(row.resourceId).toBe(identifier)
    expect(identifier.startsWith('https://')).toBe(true)
  })

  it('refuses a binding to a client that was never registered (M10)', async () => {
    const suffix = unique()
    const identifier = `https://feedback-${suffix}.example.com/api/mcp`
    await testDb.insert(oauthResource).values(mcpOauthResourceSeedRow(identifier, API_KEY_SCOPES))

    const refusal = await testDb
      .insert(oauthClientResource)
      .values({
        id: `ocr_${suffix}`,
        clientId: `client_never_registered_${suffix}`,
        resourceId: identifier,
        createdAt: new Date(),
      })
      .then(
        () => null,
        (error: unknown) => error
      )

    // 23503 is foreign_key_violation: the refusal is the constraint, not a
    // column the fixture spelled wrong.
    expect(refusalCode(refusal)).toBe('23503')
  })

  it('refuses a binding to a resource this instance does not issue for (M10)', async () => {
    const suffix = unique()
    const clientId = `client_${suffix}`
    await testDb.insert(oauthClient).values({
      id: `oc_${suffix}`,
      clientId,
      name: 'Cursor',
      redirectUris: ['https://app.example.com/cb'],
      createdAt: new Date(),
    })

    const refusal = await testDb
      .insert(oauthClientResource)
      .values({
        id: `ocr_${suffix}`,
        clientId,
        resourceId: `https://unknown-${suffix}.example.com/api/mcp`,
        createdAt: new Date(),
      })
      .then(
        () => null,
        (error: unknown) => error
      )

    expect(refusalCode(refusal)).toBe('23503')
  })

  it('drops the binding when the client is deleted (M10)', async () => {
    const { clientId, bindingId } = await seedBinding()
    expect(await bindingExists(bindingId)).toBe(true)

    await testDb.delete(oauthClient).where(eq(oauthClient.clientId, clientId))

    expect(await bindingExists(bindingId)).toBe(false)
  })

  it('drops the binding when the resource is deleted (M10)', async () => {
    const { identifier, bindingId } = await seedBinding()
    expect(await bindingExists(bindingId)).toBe(true)

    await testDb.delete(oauthResource).where(eq(oauthResource.identifier, identifier))

    expect(await bindingExists(bindingId)).toBe(false)
  })
})

/**
 * The same two claims, read off the schema rather than off the database.
 *
 * This half needs no connection, which is the point: the cascades above are
 * enforced by whatever the migrations already built, while these assertions
 * are what the TypeScript schema declares. Drift between the two is what the
 * repository's own drift check exists for; drift between either and the
 * intent — a reference retargeted onto a primary key — is what this catches.
 */
describe('the oauth_client_resource schema declaration', () => {
  /** Each inline foreign key, resolved to the table and column it points at. */
  function references() {
    return getTableConfig(oauthClientResource).foreignKeys.map((foreignKey) => {
      const reference = foreignKey.reference()
      return {
        columns: reference.columns.map((column) => column.name),
        foreignTable: getTableName(reference.foreignTable),
        foreignColumns: reference.foreignColumns.map((column) => column.name),
        onDelete: foreignKey.onDelete,
      }
    })
  }

  it('points at client_id and at the resource identifier, both cascading (M10)', () => {
    expect(references()).toEqual([
      {
        columns: ['client_id'],
        foreignTable: 'oauth_client',
        foreignColumns: ['client_id'],
        onDelete: 'cascade',
      },
      {
        columns: ['resource_id'],
        foreignTable: 'oauth_resource',
        // Better Auth 1.7 DCR writes the RFC 8707 URL here, never oauth_resource.id.
        foreignColumns: ['identifier'],
        onDelete: 'cascade',
      },
    ])
  })
})
