/**
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
import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/server/config', () => ({
  config: { baseUrl: 'https://feedback.example.com' },
}))

import { MCP_FIRST_CONNECT_SCOPES } from '@/lib/shared/api-key-scopes'
import {
  mcpProtectedResourceMetadata,
  mcpProtectedResourceResponse,
} from '../protected-resource-metadata'
import { insufficientScopeChallenge, unauthenticatedMcpChallenge } from '../oauth-challenge'

describe('MCP protected resource metadata', () => {
  it('advertises only the three first-connect read scopes', () => {
    const doc = mcpProtectedResourceMetadata('https://feedback.example.com')
    expect(doc.resource).toBe('https://feedback.example.com/api/mcp')
    expect(doc.scopes_supported).toEqual([...MCP_FIRST_CONNECT_SCOPES])
    expect(doc.scopes_supported).toEqual(['read:feedback', 'read:article', 'read:chat'])
    expect(doc.scopes_supported).not.toContain('offline_access')
    expect(doc.scopes_supported).not.toContain('write:feedback')
    expect(doc.scopes_supported).not.toContain('openid')
  })

  it('names this instance as the authorization server and header-only tokens (M1)', () => {
    // RFC 9728: the client reads `authorization_servers` to find where to
    // register and authorize. An empty list leaves it with nowhere to go, and
    // a `bearer_methods_supported` that does not say `header` invites the
    // client to put the access token in a query string.
    const doc = mcpProtectedResourceMetadata('https://feedback.example.com')
    expect(doc.authorization_servers).toEqual(['https://feedback.example.com'])
    expect(doc.bearer_methods_supported).toEqual(['header'])
  })

  it('serves the document as cacheable JSON that varies by host (M1)', async () => {
    const response = mcpProtectedResourceResponse('https://feedback.example.com')

    expect(response.headers.get('content-type')).toBe('application/json')
    expect(response.headers.get('cache-control')).toBe('public, max-age=3600')
    // The document names the requesting host's own resource, so a shared
    // cache that ignored Host would serve one workspace's identifier to
    // another's MCP client.
    expect(response.headers.get('vary')).toBe('Host')
    expect(await response.json()).toEqual(
      mcpProtectedResourceMetadata('https://feedback.example.com')
    )
  })
})

describe('MCP OAuth challenges', () => {
  it('puts first-connect scopes on the unauthenticated 401 challenge', () => {
    const header = unauthenticatedMcpChallenge()
    expect(header).toContain('scope="read:feedback read:article read:chat"')
    expect(header).toContain('resource_metadata="')
    expect(header).toContain('/.well-known/oauth-protected-resource')
    expect(header).not.toContain('/api/mcp')
  })

  it('returns HTTP 403 insufficient_scope for the current operation', async () => {
    const response = insufficientScopeChallenge('write:feedback')
    expect(response.status).toBe(403)
    const header = response.headers.get('www-authenticate') ?? ''
    expect(header).toContain('error="insufficient_scope"')
    expect(header).toContain('scope="write:feedback"')
    expect(header).toContain('resource_metadata=')
    const body = (await response.json()) as { error: string }
    expect(body.error).toBe('insufficient_scope')
  })
})
