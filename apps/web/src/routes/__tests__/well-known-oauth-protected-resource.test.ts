/**
 * The two RFC 9728 well-known documents an MCP client reads before it ever
 * asks for a token: the root one it finds from the bare origin, and the
 * path-inserted one Better Auth 1.7's challenge helper points at for the
 * resource `…/api/mcp`. A client that follows either has to arrive at the
 * same resource identifier, or it asks the authorization server for a
 * resource this instance does not issue tokens for.
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
import { describe, it, expect, vi } from 'vitest'

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: vi.fn((path: string) => (opts: unknown) => ({ path, options: opts })),
}))

vi.mock('@/lib/server/config', () => ({
  config: { baseUrl: 'https://feedback.example.com' },
}))

import { MCP_FIRST_CONNECT_SCOPES } from '@/lib/shared/api-key-scopes'
import { Route as RootPrmRoute } from '../[.]well-known.oauth-protected-resource'
import { Route as ApiMcpPrmRoute } from '../[.]well-known.oauth-protected-resource.api.mcp'

type PrmRoute = {
  path: string
  options: { server: { handlers: { GET: (args: Record<string, never>) => Promise<Response> } } }
}

/** GET the document this route serves. */
async function get(route: unknown): Promise<Response> {
  return (route as PrmRoute).options.server.handlers.GET({})
}

describe('the MCP protected-resource well-known documents', () => {
  it('serves the root document as JSON naming this instance (M1)', async () => {
    const response = await get(RootPrmRoute)

    expect((RootPrmRoute as unknown as PrmRoute).path).toBe('/.well-known/oauth-protected-resource')
    expect(response.headers.get('content-type')).toBe('application/json')
    expect(response.headers.get('cache-control')).toBe('public, max-age=3600')
    expect(response.headers.get('vary')).toBe('Host')
    expect(await response.json()).toEqual({
      resource: 'https://feedback.example.com/api/mcp',
      authorization_servers: ['https://feedback.example.com'],
      bearer_methods_supported: ['header'],
      scopes_supported: [...MCP_FIRST_CONNECT_SCOPES],
    })
  })

  it('serves the path-inserted document at the /api/mcp well-known path (M1)', async () => {
    const response = await get(ApiMcpPrmRoute)

    expect((ApiMcpPrmRoute as unknown as PrmRoute).path).toBe(
      '/.well-known/oauth-protected-resource/api/mcp'
    )
    expect(response.headers.get('content-type')).toBe('application/json')
    expect(response.headers.get('cache-control')).toBe('public, max-age=3600')
    expect(response.headers.get('vary')).toBe('Host')
    expect(await response.json()).toMatchObject({
      resource: 'https://feedback.example.com/api/mcp',
    })
  })

  it('answers both paths with the same document (M1)', async () => {
    // A client that discovered the resource from the bare origin and one that
    // followed the 1.7 challenge header have to agree on the identifier they
    // then ask for a token for; two documents that drift are two audiences.
    const [root, inserted] = await Promise.all([get(RootPrmRoute), get(ApiMcpPrmRoute)])
    expect(await root.json()).toEqual(await inserted.json())
  })
})
