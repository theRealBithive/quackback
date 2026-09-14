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
import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { betterAuthMcpResource } from '../mcp-plugin-resource'

describe('betterAuthMcpResource', () => {
  it('leaves https and bare loopback hosts alone', () => {
    expect(betterAuthMcpResource('https://feedback.example.com/api/mcp')).toBe(
      'https://feedback.example.com/api/mcp'
    )
    expect(betterAuthMcpResource('http://localhost:3008/api/mcp')).toBe(
      'http://localhost:3008/api/mcp'
    )
    expect(betterAuthMcpResource('http://127.0.0.1:3008/api/mcp')).toBe(
      'http://127.0.0.1:3008/api/mcp'
    )
  })

  it('collapses RFC 6761 *.localhost onto localhost for Better Auth 1.7.4', () => {
    expect(betterAuthMcpResource('http://acme.localhost:3000/api/mcp')).toBe(
      'http://localhost:3000/api/mcp'
    )
  })

  it('collapses a *.localhost name that opens with a loopback address (M2)', () => {
    // `127.0.0.1.localhost` is a `*.localhost` name, not a loopback address:
    // the address is only its prefix. Reading it as one would leave the plugin
    // with a host it refuses, and `createAuth()` throws on every request.
    expect(betterAuthMcpResource('http://127.0.0.1.localhost:3000/api/mcp')).toBe(
      'http://localhost:3000/api/mcp'
    )
  })

  it('collapses a *.localhost name whose first label is 127 (M2)', () => {
    // Same trap from the other side: a name that starts with `127.` but whose
    // remaining labels are not numbers is a domain name, not an address.
    expect(betterAuthMcpResource('http://127.a.b.localhost:3000/api/mcp')).toBe(
      'http://localhost:3000/api/mcp'
    )
  })

  it('passes a plain-HTTP identifier on a real host through unchanged (M2)', () => {
    // Behind a TLS-terminating proxy the pinned origin can be plain http on a
    // public hostname. Nothing about that host is loopback, so nothing is
    // collapsed — the identifier tokens are issued for stays byte-identical.
    expect(betterAuthMcpResource('http://feedback.acme.example/api/mcp')).toBe(
      'http://feedback.acme.example/api/mcp'
    )
  })

  it('only ever rewrites the host, and only for a loopback alias (M2)', () => {
    // Non-interference: the path, port, query and fragment of the identifier
    // are never touched, whichever branch the hostname takes.
    const hostnames = fc.constantFrom(
      'localhost',
      '[::1]',
      '127.0.0.1',
      '127.9.9.9',
      'acme.localhost',
      'a.b.localhost',
      'feedback.acme.example',
      'localhost.example.com'
    )
    fc.assert(
      fc.property(
        fc.constantFrom('http', 'https'),
        hostnames,
        fc.constantFrom('', ':3000', ':8080'),
        fc.constantFrom('/api/mcp', '/base/api/mcp'),
        (scheme, hostname, port, path) => {
          const original = new URL(`${scheme}://${hostname}${port}${path}?a=1#frag`)
          const result = new URL(betterAuthMcpResource(original.href))

          expect(result.protocol).toBe(original.protocol)
          expect(result.port).toBe(original.port)
          expect(result.pathname).toBe(original.pathname)
          expect(result.search).toBe(original.search)
          expect(result.hash).toBe(original.hash)

          const collapses = scheme === 'http' && hostname.endsWith('.localhost')
          expect(result.hostname).toBe(collapses ? 'localhost' : original.hostname)
        }
      )
    )
  })
})
