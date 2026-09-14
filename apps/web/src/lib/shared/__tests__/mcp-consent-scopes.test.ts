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
import {
  ACCESS_DOMAINS,
  API_KEY_SCOPES,
  MCP_AS_SCOPES,
  MCP_FIRST_CONNECT_SCOPES,
  domainAccessLevels,
} from '@/lib/shared/api-key-scopes'
import {
  CLIENT_REQUESTED_SCOPE_PARAM,
  clientRequestedFromConsentSearch,
  consentGrantScope,
  defaultSelectedScopes,
  expandAuthorizeScopes,
  hasCapabilityGrant,
  parseScopeList,
  rewriteMcpAuthorizeRequest,
} from '../mcp-consent-scopes'

describe('ACCESS_DOMAINS', () => {
  it('lists every capability domain, including write-only changelog', () => {
    expect(ACCESS_DOMAINS.map((d) => d.label)).toEqual([
      'Feedback',
      'Changelog',
      'Help Center',
      'Conversations',
    ])
    expect(ACCESS_DOMAINS.find((d) => d.domain === 'changelog')).toEqual(
      expect.objectContaining({
        readScope: null,
        writeScope: 'write:changelog',
        kind: 'write_only',
      })
    )
  })
})

describe('defaultSelectedScopes', () => {
  it('prefills the MCP first-connect reads and leaves writes off', () => {
    const selected = defaultSelectedScopes([...MCP_FIRST_CONNECT_SCOPES])
    expect(selected).toEqual([...MCP_FIRST_CONNECT_SCOPES])
    expect(selected).not.toContain('write:feedback')
    expect(selected).not.toContain('offline_access')
    expect(domainAccessLevels(selected)).toEqual({
      feedback: 'read',
      changelog: 'off',
      article: 'read',
      chat: 'read',
    })
  })

  it('turns on a step-up write the client asked for without forcing the others', () => {
    const selected = defaultSelectedScopes([
      ...MCP_FIRST_CONNECT_SCOPES,
      'write:feedback',
      'offline_access',
    ])
    expect(selected).toContain('write:feedback')
    expect(selected).toContain('offline_access')
    expect(selected).not.toContain('write:chat')
    expect(domainAccessLevels(selected).feedback).toBe('read_write')
  })
})

describe('consentGrantScope', () => {
  it('always includes identity and orders the grant like the AS catalogue', () => {
    expect(consentGrantScope(['write:feedback', 'read:feedback'])).toBe(
      'openid profile email read:feedback write:feedback'
    )
  })

  it('expands a write-only grant to include the sibling read', () => {
    expect(consentGrantScope(['write:feedback'])).toBe(
      'openid profile email read:feedback write:feedback'
    )
  })
})

describe('expandAuthorizeScopes', () => {
  it('is the full AS allow-list so consent can grant writes the client omitted', () => {
    expect(expandAuthorizeScopes().split(' ')).toEqual([...MCP_AS_SCOPES])
  })
})

describe('rewriteMcpAuthorizeRequest', () => {
  it('expands authorize scope and preserves what the client sent', () => {
    const request = rewriteMcpAuthorizeRequest(
      new Request(
        'http://localhost:3008/api/auth/oauth2/authorize?client_id=c&scope=read:feedback+read:article+read:chat'
      )
    )
    const url = new URL(request.url)
    expect(url.searchParams.get('scope')?.split(' ')).toEqual([...MCP_AS_SCOPES])
    expect(parseScopeList(url.searchParams.get(CLIENT_REQUESTED_SCOPE_PARAM))).toEqual([
      ...MCP_FIRST_CONNECT_SCOPES,
    ])
  })

  it('does not rewrite a request whose scope is already the catalogue', () => {
    const once = rewriteMcpAuthorizeRequest(
      new Request('http://localhost:3008/api/auth/oauth2/authorize?scope=read:feedback')
    )
    const twice = rewriteMcpAuthorizeRequest(once)
    expect(twice.url).toBe(once.url)
  })

  it('ignores a client-supplied qb_requested_scope when scope is not the catalogue', () => {
    const request = rewriteMcpAuthorizeRequest(
      new Request(
        'http://localhost:3008/api/auth/oauth2/authorize?scope=read:feedback&qb_requested_scope=write:chat+write:feedback'
      )
    )
    const url = new URL(request.url)
    expect(parseScopeList(url.searchParams.get(CLIENT_REQUESTED_SCOPE_PARAM))).toEqual([
      'read:feedback',
    ])
    expect(url.searchParams.get('scope')?.split(' ')).toEqual([...MCP_AS_SCOPES])
  })

  it('stamps a full-catalogue request that arrives without the parameter (M6)', () => {
    // The step-up hop a client makes on its own: it already holds the whole
    // allow-list, so there is nothing to expand — but consent still needs to
    // know what was asked for, and nothing has recorded it yet.
    const request = rewriteMcpAuthorizeRequest(
      new Request(
        `http://localhost:3008/api/auth/oauth2/authorize?client_id=c&scope=${encodeURIComponent(
          MCP_AS_SCOPES.join(' ')
        )}`
      )
    )
    const url = new URL(request.url)
    expect(url.searchParams.get('scope')?.split(' ')).toEqual([...MCP_AS_SCOPES])
    expect(parseScopeList(url.searchParams.get(CLIENT_REQUESTED_SCOPE_PARAM))).toEqual([
      ...MCP_AS_SCOPES,
    ])
  })

  it('records an authorize call that named no scope as having asked for nothing (M6)', () => {
    const request = rewriteMcpAuthorizeRequest(
      new Request('http://localhost:3008/api/auth/oauth2/authorize?client_id=c')
    )
    const url = new URL(request.url)
    expect(url.searchParams.get(CLIENT_REQUESTED_SCOPE_PARAM)).toBe('')
    expect(url.searchParams.get('scope')).toBe(expandAuthorizeScopes())
  })

  it('leaves a request that is not an authorize call alone (M6)', () => {
    const original = new Request('http://localhost:3008/api/auth/oauth2/token?scope=read:feedback')
    expect(rewriteMcpAuthorizeRequest(original)).toBe(original)
  })

  it('carries the requested scope exactly once, and rewriting again changes nothing (M6)', () => {
    // Both branches are reached: a subset `scope=` (expanded and stamped) and
    // the full catalogue (stamped only when the parameter is absent). The
    // conservation law that holds across both: after one rewrite the parameter
    // is present exactly once, and a second rewrite is a no-op.
    const scopeRequest = fc.oneof(
      fc
        .subarray([...MCP_AS_SCOPES], { minLength: 1 })
        .map((scopes) => scopes.join(' '))
        .filter((scope) => scope.split(' ').length < MCP_AS_SCOPES.length),
      fc.constant(MCP_AS_SCOPES.join(' '))
    )
    fc.assert(
      fc.property(scopeRequest, fc.boolean(), (scope, clientPrefill) => {
        const url = new URL('http://localhost:3008/api/auth/oauth2/authorize')
        url.searchParams.set('client_id', 'c')
        url.searchParams.set('scope', scope)
        if (clientPrefill) url.searchParams.set(CLIENT_REQUESTED_SCOPE_PARAM, 'write:chat')

        const once = rewriteMcpAuthorizeRequest(new Request(url))
        const onceUrl = new URL(once.url)
        expect(onceUrl.searchParams.getAll(CLIENT_REQUESTED_SCOPE_PARAM)).toHaveLength(1)

        const twice = rewriteMcpAuthorizeRequest(once)
        expect(new URL(twice.url).searchParams.getAll(CLIENT_REQUESTED_SCOPE_PARAM)).toEqual(
          onceUrl.searchParams.getAll(CLIENT_REQUESTED_SCOPE_PARAM)
        )
        expect(new URL(twice.url).searchParams.get('scope')).toBe(onceUrl.searchParams.get('scope'))
      })
    )
  })

  it('never lets a client-supplied prefill decide the first hop (M6)', () => {
    // Non-interference: on a request that is not already the catalogue, the
    // recorded request is `scope=` whatever the client wrote into the param.
    const subsetScope = fc
      .subarray([...MCP_AS_SCOPES], { minLength: 1 })
      .map((scopes) => scopes.join(' '))
      .filter((scope) => scope.split(' ').length < MCP_AS_SCOPES.length)
    fc.assert(
      fc.property(subsetScope, subsetScope, (scope, prefill) => {
        const url = new URL('http://localhost:3008/api/auth/oauth2/authorize')
        url.searchParams.set('scope', scope)
        url.searchParams.set(CLIENT_REQUESTED_SCOPE_PARAM, prefill)

        const rewritten = new URL(rewriteMcpAuthorizeRequest(new Request(url)).url)
        expect(rewritten.searchParams.get(CLIENT_REQUESTED_SCOPE_PARAM)).toBe(scope)
        expect(rewritten.searchParams.get('scope')).toBe(expandAuthorizeScopes())
      })
    )
  })
})

describe('clientRequestedFromConsentSearch', () => {
  it('prefers the preserved client request over the expanded authorize scope', () => {
    expect(
      clientRequestedFromConsentSearch({
        requested: 'read:feedback read:article read:chat',
        scope: expandAuthorizeScopes(),
      })
    ).toEqual([...MCP_FIRST_CONNECT_SCOPES])
  })

  it('does not treat an expanded scope= as the client request', () => {
    expect(clientRequestedFromConsentSearch({ scope: expandAuthorizeScopes() })).toEqual([
      ...MCP_FIRST_CONNECT_SCOPES,
    ])
  })

  it('reads an unexpanded subset scope= as the client request (M5)', () => {
    // A consent URL that never went through the authorize rewrite — the
    // client asked for a subset and that subset is what consent prefills.
    expect(clientRequestedFromConsentSearch({ scope: 'read:feedback write:feedback' })).toEqual([
      'read:feedback',
      'write:feedback',
    ])
  })

  it('reads a consent URL with no scope at all as no client request (M5)', () => {
    expect(clientRequestedFromConsentSearch({})).toEqual([])
  })
})

describe('hasCapabilityGrant', () => {
  it('requires at least one API-key scope', () => {
    expect(hasCapabilityGrant(['offline_access'])).toBe(false)
    expect(hasCapabilityGrant(['read:feedback'])).toBe(true)
    expect(hasCapabilityGrant(API_KEY_SCOPES)).toBe(true)
  })
})
