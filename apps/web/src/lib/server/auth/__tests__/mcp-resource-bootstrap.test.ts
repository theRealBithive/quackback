/**
 * What `createAuth()` does about the MCP protected resource before Better
 * Auth 1.7's `mcp()` plugin ever initialises.
 *
 * Two separate things, on the same two lines of production code, and both
 * are about start-up rather than about any request:
 *
 * - The plugin validates its `resource` URL itself and rejects an HTTP host
 *   that is not literally loopback, so `acme.localhost` — RFC 6761 loopback,
 *   and what e2e runs on — makes every request to `createAuth()` throw. The
 *   plugin gets a collapsed spelling; nothing else does.
 * - The plugin also seeds `oauth_resource` from its config, and treats a
 *   UNIQUE collision as a no-op by matching the error *message* — which
 *   Drizzle rewrites, so a concurrent replica's insert aborts plugin init
 *   instead. The row is therefore pre-inserted here, with ON CONFLICT DO
 *   NOTHING, before the plugin is built.
 *
 * Only the library and the edges are doubled: the Better Auth builder, the
 * plugin factories, and the database. What is asserted is what the real
 * `createAuth()` hands them, and in which order.
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
import { describe, it, expect, vi, beforeEach } from 'vitest'

const hoisted = vi.hoisted(() => ({
  /** This workspace's pinned origin for the test in hand. */
  baseUrl: 'https://feedback.example.com',
  /** Every row pre-inserted into oauth_resource, with its conflict target. */
  seededResources: [] as Array<{ table: unknown; row: Record<string, unknown>; target: unknown }>,
  /** Start-up steps in the order they happened, so ordering can be asserted. */
  events: [] as string[],
  betterAuth: vi.fn((_options: unknown) => ({ api: {}, handler: vi.fn() })),
  mcp: vi.fn((opts: unknown) => ({ id: 'mcp', opts })),
}))

vi.mock('@/lib/server/config', () => ({
  config: {
    get baseUrl() {
      return hoisted.baseUrl
    },
  },
  getBaseUrl: () => hoisted.baseUrl,
}))

vi.mock('better-auth', () => ({
  betterAuth: (options: unknown) => {
    hoisted.events.push('better-auth built')
    return hoisted.betterAuth(options)
  },
}))
vi.mock('better-auth/adapters/drizzle', () => ({ drizzleAdapter: vi.fn(() => ({})) }))
vi.mock('better-auth/tanstack-start', () => ({ tanstackStartCookies: vi.fn(() => ({})) }))
vi.mock('@better-auth/mcp', () => ({
  mcp: (options: unknown) => {
    hoisted.events.push('mcp plugin built')
    return hoisted.mcp(options)
  },
}))
vi.mock('better-auth/plugins', () => ({
  anonymous: vi.fn(() => ({ id: 'anonymous' })),
  emailOTP: vi.fn(() => ({ id: 'emailOTP' })),
  oneTimeToken: vi.fn(() => ({ id: 'oneTimeToken' })),
  magicLink: vi.fn(() => ({ id: 'magicLink' })),
  jwt: vi.fn(() => ({ id: 'jwt' })),
  genericOAuth: vi.fn(() => ({ id: 'genericOAuth' })),
  bearer: vi.fn(() => ({ id: 'bearer' })),
  twoFactor: vi.fn(() => ({ id: 'twoFactor' })),
}))

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: {
    insert(table: unknown) {
      return {
        values(row: Record<string, unknown>) {
          return {
            async onConflictDoNothing(args: { target: unknown }) {
              hoisted.seededResources.push({ table, row, target: args.target })
              hoisted.events.push(`resource seeded: ${String(row.identifier)}`)
            },
          }
        },
      }
    },
    query: {},
  },
}))

vi.mock('@quackback/email', () => ({
  isEmailConfigured: () => false,
  sendPasswordResetEmail: vi.fn(),
  sendVerifyAddressEmail: vi.fn(),
}))
vi.mock('@/lib/server/secret-key', () => ({ activeSecretKey: () => 'test-secret' }))
vi.mock('@/lib/server/domains/platform-credentials/platform-credential.service', () => ({
  getPlatformCredentials: vi.fn(async () => null),
}))
vi.mock('@/lib/server/domains/settings/tier-limits.service', () => ({
  getTierLimits: vi.fn(async () => ({ features: { customOidcProvider: false } })),
}))
vi.mock('@/lib/server/domains/settings/settings.service', () => ({
  getWorkspaceSettings: vi.fn(async () => null),
}))
vi.mock('@/lib/server/domains/settings/identity-providers.service', () => ({
  listIdentityProviders: vi.fn(async () => []),
  getIdentityProviderCredentials: vi.fn(async () => null),
}))
vi.mock('@/lib/server/auth/build-oauth-configs', () => ({
  buildGenericOAuthConfigs: vi.fn(async () => []),
}))
vi.mock('@/lib/server/domains/principals/principal.factory', () => ({
  ensurePrincipalForUser: vi.fn(),
}))
vi.mock('@/lib/server/content/ssrf-guard', () => ({ safeFetch: vi.fn() }))
vi.mock('@/lib/server/auth/hooks', () => ({ hooksBefore: vi.fn(), hooksAfter: vi.fn() }))

import { API_KEY_SCOPES } from '@/lib/shared/api-key-scopes'
import { oauthResource } from '@/lib/server/db'
import { getAuth, resetAuth } from '../index'

/** The options the MCP plugin was built with on the most recent start-up. */
function mcpOptions(): Record<string, unknown> {
  return hoisted.mcp.mock.calls.at(-1)?.[0] as Record<string, unknown>
}

/** The identifiers pre-inserted into oauth_resource, in insertion order. */
function seededIdentifiers(): string[] {
  return hoisted.seededResources.map((seed) => String(seed.row.identifier))
}

beforeEach(() => {
  resetAuth()
  vi.clearAllMocks()
  hoisted.seededResources.length = 0
  hoisted.events.length = 0
  hoisted.baseUrl = 'https://feedback.example.com'
})

describe('the MCP resource an auth instance starts with', () => {
  it('registers the plugin against this instance own /api/mcp URL (M2)', async () => {
    await getAuth()

    expect(mcpOptions().resource).toBe('https://feedback.example.com/api/mcp')
    expect(mcpOptions().resources).toEqual([
      {
        identifier: 'https://feedback.example.com/api/mcp',
        allowedScopes: [...API_KEY_SCOPES],
      },
    ])
  })

  it('collapses a *.localhost host for the plugin and nothing else (M2)', async () => {
    hoisted.baseUrl = 'http://acme.localhost:3000'

    await getAuth()

    // The plugin refuses the RFC 6761 spelling outright, so it gets the
    // loopback one …
    expect(mcpOptions().resource).toBe('http://localhost:3000/api/mcp')
    // … while the declared resource, which is what tokens are audienced for,
    // stays on the host the request actually arrived on.
    expect(mcpOptions().resources).toEqual([
      { identifier: 'http://acme.localhost:3000/api/mcp', allowedScopes: [...API_KEY_SCOPES] },
    ])
    expect(mcpOptions().clientRegistrationAllowedResources).toEqual([
      'http://acme.localhost:3000/api/mcp',
    ])
  })

  it('pre-inserts the resource row before Better Auth is built (M3)', async () => {
    await getAuth()

    expect(seededIdentifiers()).toEqual(['https://feedback.example.com/api/mcp'])
    const seed = hoisted.seededResources[0]
    expect(seed.table).toBe(oauthResource)
    expect(seed.row.allowedScopes).toEqual([...API_KEY_SCOPES])
    // A second replica starting at the same moment must be a no-op, not an
    // aborted plugin init: the insert carries its own conflict target.
    expect(seed.target).toBe(oauthResource.identifier)

    // Ordering is the claim: seeded first, plugin built afterwards. Asserting
    // only that both happened would pass on the sequence that fails.
    expect(hoisted.events).toEqual([
      'resource seeded: https://feedback.example.com/api/mcp',
      'mcp plugin built',
      'better-auth built',
    ])
  })

  it('seeds both spellings when the host has a loopback alias (M3)', async () => {
    hoisted.baseUrl = 'http://acme.localhost:3000'

    await getAuth()

    // The plugin will look its own `resource` up, and the rest of the app
    // uses the public one — both rows have to exist.
    expect(seededIdentifiers()).toEqual([
      'http://acme.localhost:3000/api/mcp',
      'http://localhost:3000/api/mcp',
    ])
  })

  it('seeds one row when both spellings are the same (M3)', async () => {
    await getAuth()
    expect(seededIdentifiers()).toHaveLength(1)

    // A restart repeats the insert rather than skipping it — the point is
    // that repeating it changes nothing, which is what the conflict target is.
    resetAuth()
    hoisted.seededResources.length = 0
    hoisted.events.length = 0
    await getAuth()
    expect(seededIdentifiers()).toEqual(['https://feedback.example.com/api/mcp'])
  })
})
