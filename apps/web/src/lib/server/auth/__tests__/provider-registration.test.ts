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
import fc from 'fast-check'
import {
  buildGenericOAuthConfigs,
  effectiveScopes,
  DEFAULT_OIDC_SCOPES,
} from '../build-oauth-configs'
import { getAllAuthProviders } from '../auth-providers'
import { mapProfileClaims } from '../map-profile-claims'

/** Minimal enabled provider row for the builder. */
function row(over: Record<string, unknown> = {}) {
  return {
    id: 'idp_abc',
    registrationId: 'oidc_abc',
    enabled: true,
    autoCreateUsers: true,
    discoveryUrl: 'https://x/.well-known/openid-configuration',
    ...over,
  }
}

type BuildOpts = {
  creds?: (registrationId: string) => Promise<{ clientId?: string; clientSecret?: string } | null>
  tierAllowsOidc?: boolean
}

/** Build configs from the given rows, defaulting creds + tier to the happy path. */
async function buildConfigs(rows: Record<string, unknown>[], opts: BuildOpts = {}) {
  return buildGenericOAuthConfigs({
    providers: rows as never,
    creds: opts.creds ?? (async () => ({ clientId: 'c', clientSecret: 's' })),
    tierAllowsOidc: opts.tierAllowsOidc ?? true,
  })
}

/** The single-provider shorthand: one row of overrides, one config back. */
async function buildOne(over: Record<string, unknown> = {}, opts: BuildOpts = {}) {
  return (await buildConfigs([row(over)], opts))[0]
}

describe('effectiveScopes', () => {
  it('falls back to the default set for null', () => {
    expect(effectiveScopes({ scopes: null })).toEqual([...DEFAULT_OIDC_SCOPES])
  })

  it('treats a blank or whitespace-only column as unset, not as "no scopes"', () => {
    // Regression: registration branched on truthiness ('' -> defaults) while the
    // SSO test used ?? ('' -> empty scope), so a stored blank made the test
    // exercise a different scope set from production.
    expect(effectiveScopes({ scopes: '' })).toEqual([...DEFAULT_OIDC_SCOPES])
    expect(effectiveScopes({ scopes: '   ' })).toEqual([...DEFAULT_OIDC_SCOPES])
  })

  it('splits on whitespace and collapses runs', () => {
    expect(effectiveScopes({ scopes: 'openid   public' })).toEqual(['openid', 'public'])
  })

  it('splits comma-joined values, which the column is documented to allow', () => {
    expect(effectiveScopes({ scopes: 'openid,public' })).toEqual(['openid', 'public'])
    expect(effectiveScopes({ scopes: 'openid, public' })).toEqual(['openid', 'public'])
  })

  it('preserves a custom set verbatim', () => {
    expect(effectiveScopes({ scopes: 'openid public' })).toEqual(['openid', 'public'])
  })
})

describe('buildGenericOAuthConfigs scope + userinfo wiring', () => {
  it('requests the effective scopes, not the raw column', async () => {
    expect((await buildOne({ scopes: '' }))?.scopes).toEqual([...DEFAULT_OIDC_SCOPES])
    expect((await buildOne({ scopes: 'openid public' }))?.scopes).toEqual(['openid', 'public'])
  })

  it('forwards the row userInfoUrl so the userinfo fallback has a target', async () => {
    // Without this the plugin's id_token -> userinfo fallback resolves
    // undefined for a manual-endpoint provider and the callback aborts with
    // user_info_is_missing, even though the connection test honours the column.
    const cfg = await buildOne({
      discoveryUrl: null,
      authorizationUrl: 'https://idp/authorize',
      tokenUrl: 'https://idp/token',
      userInfoUrl: 'https://idp/userinfo',
    })
    expect(cfg?.userInfoUrl).toBe('https://idp/userinfo')
  })

  it('omits userInfoUrl when the row has none', async () => {
    expect(await buildOne({ userInfoUrl: null })).not.toHaveProperty('userInfoUrl')
  })
})

describe('buildGenericOAuthConfigs', () => {
  it('registers one config per enabled provider under its registrationId', async () => {
    const cfgs = await buildConfigs([row({ registrationId: 'sso' })])
    expect(cfgs).toHaveLength(1)
    expect(cfgs[0].providerId).toBe('sso') // preserved registration id, NOT oidc_idp_abc
    expect(cfgs[0].pkce).toBe(true)
    expect(cfgs[0].disableSignUp).toBe(false)
    expect(cfgs[0].disableProviderLogout).toBe(true)
  })

  it('keeps sign-out local so a GitHub session does not federate Microsoft logout', async () => {
    // Better Auth 1.7 RP-initiated logout redirects to any linked OIDC
    // provider with end_session_endpoint, not the provider used this session.
    const cfg = await buildOne()
    expect(cfg.disableProviderLogout).toBe(true)
  })

  it('requests the broadly-supported prompt=login, not the OIDC-optional select_account', async () => {
    const cfgs = await buildGenericOAuthConfigs({
      providers: [
        {
          id: 'idp_abc',
          registrationId: 'sso',
          enabled: true,
          autoCreateUsers: true,
          discoveryUrl: 'https://x/.well-known/openid-configuration',
        },
      ] as any,
      creds: async () => ({ clientId: 'c', clientSecret: 's' }),
      tierAllowsOidc: true,
    })
    expect(cfgs[0].prompt).toBe('login')
  })

  it('skips disabled providers and providers without credentials', async () => {
    const cfgs = await buildConfigs(
      [
        row({ id: 'idp_off', registrationId: 'oidc_idp_off', enabled: false }),
        row({ id: 'idp_nc', registrationId: 'oidc_idp_nc' }),
      ],
      {
        creds: async (rid) => (rid === 'oidc_idp_nc' ? null : { clientId: 'c', clientSecret: 's' }),
      }
    )
    expect(cfgs).toHaveLength(0)
  })

  it('returns no configs when the tier disallows OIDC', async () => {
    const cfgs = await buildConfigs([row({ registrationId: 'sso' })], { tierAllowsOidc: false })
    expect(cfgs).toHaveLength(0)
  })
})

describe('social provider registration regression (H3)', () => {
  it('still exposes the 10 built-in social providers for the social loop', () => {
    // After OIDC moved to the identity_provider list, the only
    // generic-oauth entry in AUTH_PROVIDERS is custom-oidc; the rest are
    // social and must keep registering via the getAllAuthProviders() loop.
    const social = getAllAuthProviders().filter((p) => p.type !== 'generic-oauth')
    expect(social.map((p) => p.id).sort()).toEqual(
      [
        'apple',
        'discord',
        'facebook',
        'github',
        'gitlab',
        'google',
        'linkedin',
        'microsoft',
        'reddit',
        'twitter',
      ].sort()
    )
    const generic = getAllAuthProviders().filter((p) => p.type === 'generic-oauth')
    expect(generic.map((p) => p.id)).toEqual(['custom-oidc'])
  })
})

/**
 * Discovery injection + resolver wiring.
 *
 * The plugin's `getUserInfo` seam is typed `(tokens) => Promise<UserInfo|null>`
 * and receives nothing else — not the discovery document the callback fetched
 * moments earlier, not the row. So the userinfo endpoint has to be closed over
 * at build time, or the resolver would have to re-fetch discovery on every
 * sign-in and the "no network on the fast path" property would be a fiction.
 *
 * Injected the same way credentials already are, which keeps this file free of
 * DB and fetch imports.
 */
describe('buildGenericOAuthConfigs discovery + resolver wiring', () => {
  const discoveryDoc = { userinfo_endpoint: 'https://idp/userinfo', issuer: 'https://idp' }

  it('resolves discovery once per build, not per sign-in', async () => {
    const discovery = vi.fn(async () => discoveryDoc)
    const cfgs = await buildGenericOAuthConfigs({
      providers: [row(), row({ id: 'idp_2', registrationId: 'oidc_2' })] as never,
      creds: async () => ({ clientId: 'c', clientSecret: 's' }),
      tierAllowsOidc: true,
      discovery,
    })
    expect(discovery).toHaveBeenCalledTimes(2) // once per provider, at build

    // Signing in must not fetch discovery again.
    discovery.mockClear()
    await cfgs[0].getUserInfo?.({ idToken: undefined, accessToken: undefined })
    expect(discovery).not.toHaveBeenCalled()
  })

  it('attaches a resolver to every provider, not just mapped ones', async () => {
    // The resolver is a superset of the default behaviour, so withholding it
    // from unmapped providers would leave two resolution paths again.
    const cfgs = await buildGenericOAuthConfigs({
      providers: [row()] as never,
      creds: async () => ({ clientId: 'c', clientSecret: 's' }),
      tierAllowsOidc: true,
      discovery: async () => discoveryDoc,
    })
    expect(cfgs[0].getUserInfo).toBeTypeOf('function')
  })

  it('prefers the row userInfoUrl over the discovery document', async () => {
    const discovery = vi.fn(async () => discoveryDoc)
    const cfgs = await buildGenericOAuthConfigs({
      providers: [row({ discoveryUrl: null, userInfoUrl: 'https://manual/userinfo' })] as never,
      creds: async () => ({ clientId: 'c', clientSecret: 's' }),
      tierAllowsOidc: true,
      discovery,
    })
    expect(cfgs[0].userInfoUrl).toBe('https://manual/userinfo')
    expect(discovery).not.toHaveBeenCalled()
  })

  it('passes mapped claim paths to resolveIdentity so userinfo-only claims are fetched', async () => {
    const fetchUserInfo = vi.fn(async () => ({ department: 'Engineering' }))
    const idToken = (payload: Record<string, unknown>) =>
      `x.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.y`
    const cfgs = await buildGenericOAuthConfigs({
      providers: [
        row({
          userInfoUrl: 'https://idp/userinfo',
          claimMapping: {
            attributes: { map: [{ claimPath: 'department', attributeKey: 'department' }] },
            role: { claimPath: 'groups', rules: [] },
          },
        }),
      ] as never,
      creds: async () => ({ clientId: 'c', clientSecret: 's' }),
      tierAllowsOidc: true,
      fetchUserInfo,
    })
    const info = await cfgs[0].getUserInfo?.({
      idToken: idToken({ sub: 's1', email: 'e@x.com', name: 'N' }),
      accessToken: 'at',
    })
    expect(fetchUserInfo).toHaveBeenCalledTimes(1)
    expect(info?.department).toBe('Engineering')
  })

  it('keeps the zero-network fast path when nothing is mapped', async () => {
    // With no attribute or role mapping there are no required claim paths, so
    // a complete ID token (including `picture`, which production pursues via
    // `wantImage`) must still stop before userinfo.
    const fetchUserInfo = vi.fn(async () => ({ department: 'Engineering' }))
    const idToken = (payload: Record<string, unknown>) =>
      `x.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.y`
    const cfgs = await buildGenericOAuthConfigs({
      providers: [row({ userInfoUrl: 'https://idp/userinfo' })] as never,
      creds: async () => ({ clientId: 'c', clientSecret: 's' }),
      tierAllowsOidc: true,
      fetchUserInfo,
    })
    await cfgs[0].getUserInfo?.({
      idToken: idToken({
        sub: 's1',
        email: 'e@x.com',
        name: 'N',
        picture: 'https://cdn.example.com/n.png',
      }),
      accessToken: 'at',
    })
    expect(fetchUserInfo).not.toHaveBeenCalled()
  })

  it('still builds when discovery is unreachable', async () => {
    // A discovery outage must not stop the provider registering — a complete
    // ID token needs no userinfo at all.
    const cfgs = await buildGenericOAuthConfigs({
      providers: [row()] as never,
      creds: async () => ({ clientId: 'c', clientSecret: 's' }),
      tierAllowsOidc: true,
      discovery: async () => null,
    })
    expect(cfgs).toHaveLength(1)
    expect(cfgs[0].getUserInfo).toBeTypeOf('function')
  })
})

/**
 * World C: the provider releases a subject and nothing else. Sign-in fails on
 * `email_is_missing` today. The gap-fill runs last in the cascade, after every
 * real source has been tried, so it can never shadow an address the provider
 * actually sent.
 */
describe('gap-fill for providers that release no email or name', () => {
  const idToken = (payload: Record<string, unknown>) =>
    `x.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.y`

  /** Build one config with the gap-fill dependency injected. */
  async function buildWithPlaceholder(
    over: Record<string, unknown>,
    placeholderFor?: (registrationId: string, accountId: string) => Promise<string>
  ) {
    const cfgs = await buildGenericOAuthConfigs({
      providers: [row(over)] as never,
      creds: async () => ({ clientId: 'c', clientSecret: 's' }),
      tierAllowsOidc: true,
      ...(placeholderFor ? { placeholderEmailFor: placeholderFor } : {}),
    } as never)
    return cfgs[0]
  }

  it('leaves a provider that sends an email completely untouched', async () => {
    const cfg = await buildWithPlaceholder(
      { claimMapping: { profile: { allowMissingEmail: true } } },
      async () => 'should-not-be-used@anon.quackback.io'
    )
    const info = await cfg.getUserInfo?.({
      idToken: idToken({ sub: 's1', email: 'real@x.com', name: 'Real Person' }),
      accessToken: undefined,
    })
    expect(info?.email).toBe('real@x.com')
    expect(info?.name).toBe('Real Person')
  })

  it('does not mint when the provider has not opted in', async () => {
    // allowMissingEmail is off by default and minting is one-way, so an
    // unconfigured provider must keep failing rather than quietly create
    // accounts nobody can reach.
    const cfg = await buildWithPlaceholder({}, async () => 'minted@anon.quackback.io')
    const info = await cfg.getUserInfo?.({
      idToken: idToken({ sub: 's1' }),
      accessToken: undefined,
    })
    expect(info?.email).toBeUndefined()
  })

  it('mints an address when opted in and the provider sends none', async () => {
    const cfg = await buildWithPlaceholder(
      { claimMapping: { profile: { allowMissingEmail: true } } },
      async () => 'sso-oidc-abc-deadbeef@anon.quackback.io'
    )
    const info = await cfg.getUserInfo?.({
      idToken: idToken({ sub: 's1' }),
      accessToken: undefined,
    })
    expect(info?.email).toBe('sso-oidc-abc-deadbeef@anon.quackback.io')
  })

  it('asks for the address by account identity, so a returning user keeps theirs', async () => {
    // getUserInfo runs on EVERY sign-in. Minting unconditionally here would
    // hand a returning person a different address each time, so the dependency
    // is read-or-mint and is keyed by the subject.
    const seen: Array<[string, string]> = []
    const cfg = await buildWithPlaceholder(
      { claimMapping: { profile: { allowMissingEmail: true } } },
      async (registrationId, accountId) => {
        seen.push([registrationId, accountId])
        return 'stored@anon.quackback.io'
      }
    )
    await cfg.getUserInfo?.({ idToken: idToken({ sub: 'subject-9' }), accessToken: undefined })
    expect(seen).toEqual([['oidc_abc', 'subject-9']])
  })

  it('synthesizes a missing name without needing an opt-in', async () => {
    // A missing name only ever fails a sign-in that would otherwise work, and
    // a display name creates nothing irreversible, so it needs no switch.
    const cfg = await buildWithPlaceholder({})
    const info = await cfg.getUserInfo?.({
      idToken: idToken({ sub: 's1', email: 'real@x.com', preferred_username: 'somebody' }),
      accessToken: undefined,
    })
    expect(info?.name).toBe('somebody')
  })

  it('still resolves a name when the provider sends only a subject', async () => {
    const cfg = await buildWithPlaceholder({})
    const info = await cfg.getUserInfo?.({
      idToken: idToken({ sub: 'ACCOUNT:REGION:2119', email: 'real@x.com' }),
      accessToken: undefined,
    })
    expect(info?.name).toBeTruthy()
    expect(info?.name).not.toContain(':')
  })
})

/**
 * Better-Auth's genericOAuth only maps `userInfo.image` to the account avatar,
 * never the OIDC-standard `picture` claim, so `getUserInfo` has to promote it.
 */
describe('avatar from the OIDC `picture` claim', () => {
  const idToken = (payload: Record<string, unknown>) =>
    `x.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.y`

  it('returns `picture` as `image` so Better-Auth sets the avatar', async () => {
    const cfg = await buildOne()
    const info = await cfg.getUserInfo?.({
      idToken: idToken({
        sub: 's1',
        email: 'real@x.com',
        name: 'Real',
        picture: 'https://cdn.example.com/u/1.png',
      }),
      accessToken: undefined,
    })
    expect(info?.image).toBe('https://cdn.example.com/u/1.png')
  })

  it('omits `image` when the provider sends no usable picture', async () => {
    const cfg = await buildOne()
    const info = await cfg.getUserInfo?.({
      idToken: idToken({ sub: 's1', email: 'real@x.com', name: 'Real' }),
      accessToken: undefined,
    })
    expect(info && 'image' in info).toBe(false)
    // The rest of the profile is unaffected.
    expect(info?.email).toBe('real@x.com')
    expect(info?.name).toBe('Real')
  })

  it('ignores a `picture` that is not an http(s) URL', async () => {
    const cfg = await buildOne()
    const info = await cfg.getUserInfo?.({
      idToken: idToken({
        sub: 's1',
        email: 'real@x.com',
        picture: 'data:image/png;base64,iVBORw0KGgo=',
      }),
      accessToken: undefined,
    })
    expect(info && 'image' in info).toBe(false)
  })

  it('pulls `picture` from userinfo when the ID token is otherwise complete', async () => {
    // The reported failure: a "custom OIDC" provider whose ID token carries
    // sub + email + name (so the resolver fast-path stopped there) but whose
    // avatar is only at userinfo. `wantImage` keeps the cascade going for it.
    const fetchUserInfo = vi.fn(async () => ({
      sub: 's1',
      picture: 'https://cdn.example.com/from-userinfo.png',
    }))
    const cfgs = await buildGenericOAuthConfigs({
      providers: [row({ discoveryUrl: null, userInfoUrl: 'https://idp/userinfo' })] as never,
      creds: async () => ({ clientId: 'c', clientSecret: 's' }),
      tierAllowsOidc: true,
      fetchUserInfo,
    } as never)
    const info = await cfgs[0].getUserInfo?.({
      idToken: idToken({ sub: 's1', email: 'real@x.com', name: 'Real' }),
      accessToken: 'opaque',
    })
    expect(fetchUserInfo).toHaveBeenCalledWith('https://idp/userinfo', 'opaque')
    expect(info?.image).toBe('https://cdn.example.com/from-userinfo.png')
  })
})

/**
 * Production getUserInfo must honour stored profile claim paths and sources.
 * The SSO test already forwarded them; production previously resolved only the
 * OIDC defaults, so a stored `upn` mapping would pass the test and fail sign-in.
 */
describe('production profile mapping adapter', () => {
  const idToken = (payload: Record<string, unknown>) =>
    `x.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.y`

  it('production honors stored profile paths and sources', async () => {
    const fetchUserInfo = vi.fn(async () => ({
      sub: 'from-userinfo',
      upn: 'mapped@x.com',
      preferred_username: 'Mapped Name',
    }))
    const onIdentityFailure = vi.fn()
    const cfgs = await buildGenericOAuthConfigs({
      providers: [
        row({
          userInfoUrl: 'https://idp/userinfo',
          claimMapping: {
            profile: {
              sources: ['userinfo'],
              claims: { id: 'sub', email: 'upn', name: 'preferred_username' },
            },
          },
        }),
      ] as never,
      creds: async () => ({ clientId: 'c', clientSecret: 's' }),
      tierAllowsOidc: true,
      fetchUserInfo,
      onIdentityFailure,
    })
    const info = await cfgs[0].getUserInfo?.({
      idToken: idToken({
        sub: 'from-id-token',
        email: 'raw@x.com',
        name: 'Raw Name',
        oid: 'oid-99',
      }),
      accessToken: 'at',
    })
    expect(fetchUserInfo).toHaveBeenCalledTimes(1)
    expect(onIdentityFailure).not.toHaveBeenCalled()
    expect(info?.id).toBe('from-userinfo')
    expect(info?.email).toBe('mapped@x.com')
    expect(info?.name).toBe('Mapped Name')
  })

  it('explicit mapped email cannot fall back to an unrelated raw email', async () => {
    const onIdentityFailure = vi.fn()
    const cfgs = await buildGenericOAuthConfigs({
      providers: [
        row({
          claimMapping: { profile: { claims: { email: 'upn' } } },
        }),
      ] as never,
      creds: async () => ({ clientId: 'c', clientSecret: 's' }),
      tierAllowsOidc: true,
      onIdentityFailure,
    })
    const info = await cfgs[0].getUserInfo?.({
      idToken: idToken({
        sub: 's1',
        email: 'raw-default@x.com',
        name: 'N',
        mail: ['array@x.com'],
      }),
      accessToken: undefined,
    })
    expect(info).toBeNull()
    expect(onIdentityFailure).toHaveBeenCalledTimes(1)
    expect(onIdentityFailure).toHaveBeenCalledWith('oidc_abc', 'missing_email')
    const [registrationId, reason] = onIdentityFailure.mock.calls[0] as [string, string]
    expect(registrationId).toBe('oidc_abc')
    expect(reason).toBe('missing_email')
    expect(JSON.stringify(onIdentityFailure.mock.calls[0])).not.toMatch(/raw-default@x\.com/)
  })

  it('treats an array-valued mapped email as missing rather than using a raw default', async () => {
    const onIdentityFailure = vi.fn()
    const cfgs = await buildGenericOAuthConfigs({
      providers: [
        row({
          claimMapping: { profile: { claims: { email: 'mail' } } },
        }),
      ] as never,
      creds: async () => ({ clientId: 'c', clientSecret: 's' }),
      tierAllowsOidc: true,
      onIdentityFailure,
    })
    const info = await cfgs[0].getUserInfo?.({
      idToken: idToken({
        sub: 's1',
        email: 'raw-default@x.com',
        name: 'N',
        mail: ['array@x.com'],
      }),
      accessToken: undefined,
    })
    expect(info).toBeNull()
    expect(onIdentityFailure).toHaveBeenCalledWith('oidc_abc', 'missing_email')
  })

  it('mints a placeholder when opted in and leaves mapped email missing unverified', async () => {
    const placeholderEmailFor = vi.fn(async () => 'sso-oidc-abc-deadbeef@anon.quackback.io')
    const cfgs = await buildGenericOAuthConfigs({
      providers: [
        row({
          claimMapping: {
            profile: { allowMissingEmail: true, claims: { email: 'upn' } },
          },
        }),
      ] as never,
      creds: async () => ({ clientId: 'c', clientSecret: 's' }),
      tierAllowsOidc: true,
      placeholderEmailFor,
    })
    const info = await cfgs[0].getUserInfo?.({
      idToken: idToken({
        sub: 's1',
        email: 'raw-default@x.com',
        name: 'N',
        email_verified: true,
      }),
      accessToken: undefined,
    })
    expect(placeholderEmailFor).toHaveBeenCalledWith('oidc_abc', 's1')
    expect(info?.email).toBe('sso-oidc-abc-deadbeef@anon.quackback.io')
    expect(info?.emailVerified).toBe(false)
    expect(info?.email_verified).toBe(false)
    expect(mapProfileClaims(info).emailVerified).toBe(false)
  })

  it('does not mint a placeholder when the mapped email is missing and opt-in is off', async () => {
    const placeholderEmailFor = vi.fn(async () => 'should-not-mint@anon.quackback.io')
    const onIdentityFailure = vi.fn()
    const cfgs = await buildGenericOAuthConfigs({
      providers: [
        row({
          claimMapping: { profile: { claims: { email: 'upn' } } },
        }),
      ] as never,
      creds: async () => ({ clientId: 'c', clientSecret: 's' }),
      tierAllowsOidc: true,
      placeholderEmailFor,
      onIdentityFailure,
    })
    const info = await cfgs[0].getUserInfo?.({
      idToken: idToken({ sub: 's1', email: 'raw-default@x.com', name: 'N' }),
      accessToken: undefined,
    })
    expect(placeholderEmailFor).not.toHaveBeenCalled()
    expect(info).toBeNull()
    expect(onIdentityFailure).toHaveBeenCalledWith('oidc_abc', 'missing_email')
  })

  it('profile hook preserves resolved email verification provenance', async () => {
    // ID token asserts verified for a different address; the mapped email lives
    // only at userinfo and carries no verification. The resolved address must
    // stay unverified through getUserInfo and mapProfileToUser.
    const fetchUserInfo = vi.fn(async () => ({
      sub: 's1',
      upn: 'from-userinfo@x.com',
      name: 'N',
    }))
    const cfgs = await buildGenericOAuthConfigs({
      providers: [
        row({
          userInfoUrl: 'https://idp/userinfo',
          claimMapping: { profile: { claims: { email: 'upn' } } },
        }),
      ] as never,
      creds: async () => ({ clientId: 'c', clientSecret: 's' }),
      tierAllowsOidc: true,
      fetchUserInfo,
    })
    const info = await cfgs[0].getUserInfo?.({
      idToken: idToken({
        sub: 's1',
        name: 'N',
        email: 'id-token@x.com',
        email_verified: true,
      }),
      accessToken: 'at',
    })
    expect(info?.email).toBe('from-userinfo@x.com')
    expect(info?.emailVerified).toBe(false)
    expect(info?.email_verified).toBe(false)
    expect(mapProfileClaims(info).emailVerified).toBe(false)
  })

  it('missing email fails before Better-Auth can log a claims profile', async () => {
    const onIdentityFailure = vi.fn()
    const cfgs = await buildGenericOAuthConfigs({
      providers: [
        row({
          claimMapping: { profile: { claims: { email: 'upn' } } },
        }),
      ] as never,
      creds: async () => ({ clientId: 'c', clientSecret: 's' }),
      tierAllowsOidc: true,
      onIdentityFailure,
    })
    const info = await cfgs[0].getUserInfo?.({
      idToken: idToken({
        sub: 's1',
        email: 'raw-default@x.com',
        name: 'N',
        groups: ['captured-group'],
      }),
      accessToken: undefined,
    })
    // Returning a profile without email lets genericOAuth log the entire
    // userInfo on email_is_missing. Null keeps the claims bag out of that path.
    expect(info).toBeNull()
    expect(onIdentityFailure.mock.calls).toEqual([['oidc_abc', 'missing_email']])
  })
})

describe('accountSubject', () => {
  /** The subject the plugin would store for this profile, via a built config. */
  async function subjectFor(profile: Record<string, unknown>): Promise<string | undefined> {
    const config = await buildOne()
    return config.accountSubject?.({ profile })
  }

  it('keys the account on the profile id when the provider released one (M8)', async () => {
    expect(await subjectFor({ id: 'idp-user-7', sub: 'sub-1' })).toBe('idp-user-7')
  })

  it('falls back to sub when the profile carries no id (M8)', async () => {
    expect(await subjectFor({ sub: 'sub-1' })).toBe('sub-1')
  })

  it('reads a present-but-empty id as the id, not as a missing one (M8)', async () => {
    // `??` and `||` differ exactly here, and the difference is an account key:
    // falling through to `sub` for a provider that really did release `0`
    // would key the same person under two different accounts.
    expect(await subjectFor({ id: 0, sub: 'sub-1' })).toBe('0')
    expect(await subjectFor({ id: '', sub: 'sub-1' })).toBe('')
    expect(await subjectFor({ id: false, sub: 'sub-1' })).toBe('false')
  })

  it('has no subject at all when the profile names neither id nor sub (M8)', async () => {
    expect(await subjectFor({ email: 'someone@acme.example' })).toBe('')
  })

  it('reads only id and sub, and prefers id whenever it is present (M8)', async () => {
    // Non-interference: whatever else the provider puts in the profile, the
    // subject is decided by those two claims alone.
    const claimValue = fc.oneof(
      fc.string(),
      fc.integer(),
      fc.boolean(),
      fc.constant(0),
      fc.constant('')
    )
    const noise = fc.dictionary(
      fc.constantFrom('email', 'name', 'groups', 'upn', 'preferred_username'),
      fc.string()
    )
    const config = await buildOne()
    fc.assert(
      fc.property(
        fc.option(claimValue, { nil: undefined }),
        fc.option(claimValue, { nil: undefined }),
        noise,
        (id, sub, extra) => {
          const profile: Record<string, unknown> = { ...extra }
          if (id !== undefined) profile.id = id
          if (sub !== undefined) profile.sub = sub

          const expected = id !== undefined ? String(id) : sub !== undefined ? String(sub) : ''
          expect(config.accountSubject?.({ profile })).toBe(expected)
        }
      )
    )
  })
})
