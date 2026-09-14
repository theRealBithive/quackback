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
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockSocial, mockStash } = vi.hoisted(() => ({
  mockSocial: vi.fn(),
  mockStash: vi.fn(),
}))

vi.mock('@/lib/client/auth-client', () => ({
  authClient: { signIn: { social: mockSocial } },
}))

vi.mock('@/lib/client/sso-attempt-stash', () => ({
  stashSsoAttempt: mockStash,
}))

import {
  getEnabledOAuthProviders,
  getOAuthRedirectUrl,
  hasAnyPortalAuthMethod,
  hasDistinctSignup,
  hasRoutableOidcProvider,
  resolveSoleOidcProvider,
} from '../oauth-buttons'

describe('hasAnyPortalAuthMethod', () => {
  it('returns false when every method is disabled', () => {
    expect(
      hasAnyPortalAuthMethod({
        password: false,
        magicLink: false,
        google: false,
        github: false,
      })
    ).toBe(false)
  })

  it('returns false for an empty config', () => {
    expect(hasAnyPortalAuthMethod({})).toBe(false)
  })

  it('returns true when password is enabled', () => {
    expect(hasAnyPortalAuthMethod({ password: true, magicLink: false })).toBe(true)
  })

  it('returns true when magicLink is enabled', () => {
    expect(hasAnyPortalAuthMethod({ password: false, magicLink: true })).toBe(true)
  })

  it('returns true when at least one OAuth provider is enabled', () => {
    expect(
      hasAnyPortalAuthMethod({
        password: false,
        magicLink: false,
        google: true,
      })
    ).toBe(true)
  })

  it('ignores legacy email key (retired in migration 0049)', () => {
    expect(hasAnyPortalAuthMethod({ password: false, magicLink: false, email: true })).toBe(false)
  })

  it('ignores unknown provider keys that are not in the registry', () => {
    expect(hasAnyPortalAuthMethod({ password: false, magicLink: false, mystery: true })).toBe(false)
  })

  it('returns true for a routed-only OIDC provider with no public button (the reported bug)', () => {
    // Only an Entra IdP, routed by a verified domain, password + magic link off:
    // no public button renders, but the "Log in" entry point must still appear.
    expect(
      hasAnyPortalAuthMethod(
        { password: false, magicLink: false },
        { registeredAuthProviders: ['oidc_0habmo4o'] }
      )
    ).toBe(true)
  })

  it('returns true for a registered legacy sso / custom-oidc provider', () => {
    expect(
      hasAnyPortalAuthMethod(
        { password: false, magicLink: false },
        { registeredAuthProviders: ['sso'] }
      )
    ).toBe(true)
    expect(
      hasAnyPortalAuthMethod(
        { password: false, magicLink: false },
        { registeredAuthProviders: ['custom-oidc'] }
      )
    ).toBe(true)
  })

  it('returns true for a public-button OIDC provider from oidcProviders', () => {
    expect(
      hasAnyPortalAuthMethod(
        { password: false, magicLink: false },
        { oidcProviders: [{ id: 'oidc_x', name: 'Acme' }] }
      )
    ).toBe(true)
  })

  it('does not count a social provider registered globally but disabled on the portal', () => {
    // `google` registered (team-side) but the portal oauth flag is off — not a
    // portal sign-in path, and social ids never count as OIDC providers.
    expect(
      hasAnyPortalAuthMethod(
        { password: false, magicLink: false, google: false },
        { registeredAuthProviders: ['google'] }
      )
    ).toBe(false)
  })
})

describe('hasDistinctSignup', () => {
  it('is true by default (password defaults on, signups default open)', () => {
    expect(hasDistinctSignup({})).toBe(true)
    expect(hasDistinctSignup({ oauth: {} })).toBe(true)
  })

  it('is true when password is on and signups are open', () => {
    expect(hasDistinctSignup({ oauth: { password: true }, openSignup: true })).toBe(true)
    expect(hasDistinctSignup({ oauth: { password: true } })).toBe(true)
  })

  it('is false when password sign-in is off (magic-link / SSO create accounts implicitly)', () => {
    expect(hasDistinctSignup({ oauth: { password: false, magicLink: true } })).toBe(false)
    expect(hasDistinctSignup({ oauth: { password: false }, openSignup: true })).toBe(false)
  })

  it('is false when self-service signup is closed, even with password on', () => {
    expect(hasDistinctSignup({ oauth: { password: true }, openSignup: false })).toBe(false)
  })
})

describe('getEnabledOAuthProviders', () => {
  it('carries the uploaded logo URL onto an OIDC entry', () => {
    const entries = getEnabledOAuthProviders({}, [
      { id: 'oidc_okta', name: 'Okta', logoUrl: 'https://cdn.test/okta.png' },
    ])
    expect(entries).toEqual([
      {
        id: 'oidc_okta',
        name: 'Okta',
        type: 'generic-oauth',
        logoUrl: 'https://cdn.test/okta.png',
      },
    ])
  })

  it('normalises a missing logo to null on the OIDC entry', () => {
    const [entry] = getEnabledOAuthProviders({}, [{ id: 'oidc_okta', name: 'Okta' }])
    expect(entry.logoUrl).toBeNull()
  })

  it('leaves social providers without a logoUrl', () => {
    const [entry] = getEnabledOAuthProviders({ google: true })
    expect(entry).toEqual({ id: 'google', name: 'Google', type: 'social' })
    expect(entry.logoUrl).toBeUndefined()
  })
})

describe('hasRoutableOidcProvider', () => {
  it('true for a registered OIDC provider with no public button (routed-only)', () => {
    expect(hasRoutableOidcProvider(['oidc_entra'])).toBe(true)
    expect(hasRoutableOidcProvider(['sso'])).toBe(true)
  })

  it('false when the OIDC provider is a public button (already has its own tile)', () => {
    expect(hasRoutableOidcProvider(['oidc_entra'], [{ id: 'oidc_entra', name: 'Entra' }])).toBe(
      false
    )
  })

  it('false for social ids (gated by portal toggles, not routed by domain)', () => {
    expect(hasRoutableOidcProvider(['google', 'github'])).toBe(false)
  })

  it('true when a routed-only provider sits alongside a public one', () => {
    expect(
      hasRoutableOidcProvider(['oidc_public', 'oidc_routed'], [{ id: 'oidc_public', name: 'Pub' }])
    ).toBe(true)
  })

  it('false for empty / missing input', () => {
    expect(hasRoutableOidcProvider([])).toBe(false)
    expect(hasRoutableOidcProvider(undefined)).toBe(false)
  })
})

describe('resolveSoleOidcProvider', () => {
  it('returns the provider id when it is the only sign-in method', () => {
    expect(resolveSoleOidcProvider(['oidc_entra'], { password: false, magicLink: false })).toBe(
      'oidc_entra'
    )
  })

  it('returns null when password is still enabled (user has a choice)', () => {
    expect(resolveSoleOidcProvider(['oidc_entra'], { password: true, magicLink: false })).toBeNull()
    // Password defaults on when the key is absent.
    expect(resolveSoleOidcProvider(['oidc_entra'], {})).toBeNull()
  })

  it('returns null when magic link is enabled', () => {
    expect(resolveSoleOidcProvider(['oidc_entra'], { password: false, magicLink: true })).toBeNull()
  })

  it('returns null when a social provider is also registered', () => {
    expect(
      resolveSoleOidcProvider(['oidc_entra', 'google'], { password: false, magicLink: false })
    ).toBeNull()
  })

  it('returns null when more than one IdP is registered', () => {
    expect(
      resolveSoleOidcProvider(['oidc_entra', 'oidc_okta'], { password: false, magicLink: false })
    ).toBeNull()
  })

  it('returns null when no provider is registered', () => {
    expect(resolveSoleOidcProvider([], { password: false, magicLink: false })).toBeNull()
    expect(resolveSoleOidcProvider(undefined, { password: false, magicLink: false })).toBeNull()
  })
})

describe('getOAuthRedirectUrl', () => {
  beforeEach(() => {
    mockSocial.mockReset()
    mockStash.mockReset()
  })

  it('starts a generic OIDC provider through social sign-in under its own id (M8)', async () => {
    // Better Auth 1.7 retired `signIn.oauth2`; generic OIDC and the built-in
    // socials share one entry point, and the provider id is the whole
    // difference between them.
    mockSocial.mockResolvedValue({ data: { url: 'https://idp.example.com/authorize?x=1' } })

    const url = await getOAuthRedirectUrl(
      { id: 'oidc_entra', name: 'Entra', type: 'generic-oauth' },
      'https://app.example.com/portal'
    )

    expect(url).toBe('https://idp.example.com/authorize?x=1')
    expect(mockSocial).toHaveBeenCalledWith({
      provider: 'oidc_entra',
      callbackURL: 'https://app.example.com/portal',
      // Without this a failed callback lands on Better-Auth's bare error page,
      // outside our UI, and the stashed attempt has nothing to resume onto.
      errorCallbackURL: 'https://app.example.com/portal',
      disableRedirect: true,
    })
    expect(mockStash).toHaveBeenCalledWith({
      providerId: 'oidc_entra',
      providerType: 'oidc',
      callbackUrl: 'https://app.example.com/portal',
    })
  })

  it('starts a built-in social provider the same way, stashed as social (M8)', async () => {
    mockSocial.mockResolvedValue({ data: { url: 'https://github.com/login/oauth' } })

    const url = await getOAuthRedirectUrl(
      { id: 'github', name: 'GitHub', type: 'social' },
      'https://app.example.com/portal'
    )

    expect(url).toBe('https://github.com/login/oauth')
    expect(mockSocial).toHaveBeenCalledWith(expect.objectContaining({ provider: 'github' }))
    expect(mockStash).toHaveBeenCalledWith(expect.objectContaining({ providerType: 'social' }))
  })

  it('has no redirect to offer when Better Auth returned none (M8)', async () => {
    mockSocial.mockResolvedValue({ data: null, error: { message: 'provider not registered' } })

    expect(
      await getOAuthRedirectUrl(
        { id: 'oidc_entra', name: 'Entra', type: 'generic-oauth' },
        'https://app.example.com/portal'
      )
    ).toBeNull()
  })
})
