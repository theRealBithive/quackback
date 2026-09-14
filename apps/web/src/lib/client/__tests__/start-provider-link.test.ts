/**
 * Recovering from `account_not_linked`: the person is already signed in, and
 * the provider they just failed with has to be attached to that session
 * explicitly. Better Auth 1.7 routes that through `linkSocial` for generic
 * OIDC as well as the built-in socials, and the caller needs the IdP URL back
 * rather than a redirect, because a failure here is not fatal — the user is
 * signed in either way and the caller falls through to its destination.
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

const { mockLinkSocial } = vi.hoisted(() => ({ mockLinkSocial: vi.fn() }))

vi.mock('@/lib/client/auth-client', () => ({
  authClient: { linkSocial: mockLinkSocial },
}))

import { startProviderLink } from '../start-provider-link'

const LINK_ARGS = {
  providerId: 'oidc_entra',
  providerType: 'oidc' as const,
  callbackURL: 'https://app.example.com/portal',
}

beforeEach(() => {
  mockLinkSocial.mockReset()
})

describe('startProviderLink', () => {
  it('starts the explicit link under the provider id and returns the IdP URL (M8)', async () => {
    mockLinkSocial.mockResolvedValue({ data: { url: 'https://idp.example.com/authorize?link=1' } })

    expect(await startProviderLink(LINK_ARGS)).toBe('https://idp.example.com/authorize?link=1')
    // The provider type is the caller's own bookkeeping — Better Auth 1.7 has
    // one linking entry point and it takes the registration id.
    expect(mockLinkSocial).toHaveBeenCalledWith({
      provider: 'oidc_entra',
      callbackURL: 'https://app.example.com/portal',
    })
  })

  it('returns nothing to navigate to when the link could not be started (M8)', async () => {
    // The session is already valid, so the caller falls back to its
    // destination rather than stranding the user on an error.
    mockLinkSocial.mockResolvedValue({ data: null, error: { message: 'no such provider' } })
    expect(await startProviderLink(LINK_ARGS)).toBeNull()

    mockLinkSocial.mockResolvedValue({ data: {} })
    expect(await startProviderLink(LINK_ARGS)).toBeNull()
  })
})
