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
import fc from 'fast-check'
import { MCP_AS_SCOPES, MCP_FIRST_CONNECT_SCOPES } from '@/lib/shared/api-key-scopes'

/**
 * The write-back is a call-time `import('@/lib/server/db')`, so the module
 * mock reaches it. Only the update chain and `eq` are replaced; the table
 * objects stay real, because what the row is addressed by is the claim.
 */
const updateCalls: Array<{
  table: unknown
  values: unknown
  where: unknown
}> = []

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: {
    update(table: unknown) {
      const call = { table, values: undefined as unknown, where: undefined as unknown }
      updateCalls.push(call)
      return {
        set(values: unknown) {
          call.values = values
          return {
            async where(condition: unknown) {
              call.where = condition
            },
          }
        },
      }
    },
  },
  eq: (column: unknown, value: unknown) => ({ column, value }),
}))

import {
  BA_DCR_PLACEHOLDER_REDIRECT_URI,
  mcpDcrRedirectUrisToRestore,
  mcpDcrRegistrationBody,
  needsBetterAuth17RedirectRewrite,
  redirectUrisForBetterAuth17Native,
  restoreMcpDcrRegisteredRedirectUris,
} from '../mcp-dcr-scopes'

const CURSOR_REDIRECT = 'cursor://anysphere.cursor-mcp/oauth/callback'

describe('mcpDcrRegistrationBody', () => {
  it('overwrites a read-only DCR scope with the full AS allow-list', () => {
    const body = mcpDcrRegistrationBody({
      client_name: 'Cursor',
      scope: MCP_FIRST_CONNECT_SCOPES.join(' '),
    })
    const scopes = String(body.scope).split(' ')
    expect(scopes).toEqual([...MCP_AS_SCOPES])
    expect(scopes).toContain('offline_access')
    expect(scopes).toContain('write:feedback')
    expect(scopes).toContain('read:feedback')
    expect(body.application_type).toBeUndefined()
  })

  it('leaves an explicit HTTPS web client as web', () => {
    const body = mcpDcrRegistrationBody({
      application_type: 'web',
      redirect_uris: ['https://example.com/oauth/callback'],
    })
    expect(body.application_type).toBe('web')
    expect(body.redirect_uris).toEqual(['https://example.com/oauth/callback'])
  })

  it('coerces omitted application_type and Cursor custom-scheme redirects for Better Auth 1.7', () => {
    const original = {
      client_name: 'Cursor',
      redirect_uris: [CURSOR_REDIRECT],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    }
    const body = mcpDcrRegistrationBody(original)
    expect(body.application_type).toBe('native')
    expect(body.redirect_uris).toEqual([BA_DCR_PLACEHOLDER_REDIRECT_URI])
    expect(mcpDcrRedirectUrisToRestore(original)).toEqual([CURSOR_REDIRECT])
  })

  it('coerces an explicit web client that registered a private-use scheme', () => {
    const body = mcpDcrRegistrationBody({
      application_type: 'web',
      redirect_uris: [CURSOR_REDIRECT],
    })
    expect(body.application_type).toBe('native')
    expect(body.redirect_uris).toEqual([BA_DCR_PLACEHOLDER_REDIRECT_URI])
  })

  it('leaves RFC 8252 loopback and authority-free reverse-domain URIs untouched', () => {
    const original = {
      redirect_uris: ['http://127.0.0.1:9/callback', 'com.example.app:/oauth/callback'],
    }
    const body = mcpDcrRegistrationBody(original)
    expect(body.redirect_uris).toEqual(original.redirect_uris)
    expect(mcpDcrRedirectUrisToRestore(original)).toBeNull()
  })

  it('rewrites only the host-bearing custom scheme in a mixed Cursor set', () => {
    const original = {
      redirect_uris: [
        CURSOR_REDIRECT,
        'https://www.cursor.com/agents/mcp/oauth/callback',
        'http://localhost:8787/callback',
      ],
    }
    expect(mcpDcrRegistrationBody(original).redirect_uris).toEqual([
      BA_DCR_PLACEHOLDER_REDIRECT_URI,
      'https://www.cursor.com/agents/mcp/oauth/callback',
      'http://localhost:8787/callback',
    ])
    expect(mcpDcrRedirectUrisToRestore(original)).toEqual(original.redirect_uris)
  })

  it('swaps in a loopback callback, the only non-HTTPS shape 1.7.4 accepts (M4)', () => {
    // The placeholder is what the client's real callback is registered as, so
    // it has to be a URI Better Auth 1.7.4 takes on its own terms: loopback
    // host, plain HTTP, and nothing this module would want to rewrite again.
    const placeholder = new URL(BA_DCR_PLACEHOLDER_REDIRECT_URI)
    expect(placeholder.protocol).toBe('http:')
    expect(placeholder.hostname).toBe('127.0.0.1')
    expect(placeholder.pathname).toBe('/__ba_dcr_placeholder')
    expect(needsBetterAuth17RedirectRewrite(BA_DCR_PLACEHOLDER_REDIRECT_URI)).toBe(false)
    expect(mcpDcrRegistrationBody({ redirect_uris: [CURSOR_REDIRECT] }).redirect_uris).toEqual([
      BA_DCR_PLACEHOLDER_REDIRECT_URI,
    ])
  })

  it('sends a redirect_uris list that is not all strings on as it arrived (M4)', () => {
    // A registration body is a client's JSON. A list holding something that is
    // not a redirect URI is not a list to rewrite entries of — it goes to
    // Better Auth exactly as sent, which is what refuses it.
    const original = { redirect_uris: [CURSOR_REDIRECT, 42] }
    const body = mcpDcrRegistrationBody(original)
    expect(body.redirect_uris).toEqual([CURSOR_REDIRECT, 42])
    expect(body.application_type).toBeUndefined()
    expect(mcpDcrRedirectUrisToRestore(original)).toBeNull()
  })

  it('sends an empty redirect_uris string on as it arrived (M4)', () => {
    // An empty string names no callback, so there is nothing to wrap in a
    // one-entry list and nothing to restore afterwards.
    const original = { redirect_uris: '' }
    expect(mcpDcrRegistrationBody(original).redirect_uris).toBe('')
    expect(mcpDcrRedirectUrisToRestore(original)).toBeNull()
  })

  it('sends a redirect_uris value that is neither list nor string on as it arrived (M4)', () => {
    const original = { redirect_uris: 42 }
    expect(mcpDcrRegistrationBody(original).redirect_uris).toBe(42)
    expect(mcpDcrRedirectUrisToRestore(original)).toBeNull()
  })

  it('declares the client native when only one of its callbacks was swapped (M4)', () => {
    // Cursor registers a private-use callback next to an HTTPS one. One swap
    // is enough to make the registration a native one.
    const body = mcpDcrRegistrationBody({
      redirect_uris: [CURSOR_REDIRECT, 'https://www.cursor.com/agents/mcp/oauth/callback'],
    })
    expect(body.application_type).toBe('native')
  })

  it('leaves application_type unset when no callback had to be swapped (M4)', () => {
    // Nothing was rewritten, so nothing here knows the client is native and
    // Better Auth's own default decides — forcing `native` would change how a
    // plain web client is registered.
    const body = mcpDcrRegistrationBody({
      redirect_uris: ['https://app.example.com/cb'],
    })
    expect(body.application_type).toBeUndefined()
  })
})

describe('needsBetterAuth17RedirectRewrite', () => {
  it('rewrites Cursor host-bearing cursor:// callbacks', () => {
    expect(needsBetterAuth17RedirectRewrite(CURSOR_REDIRECT)).toBe(true)
  })

  it('does not rewrite reserved schemes so Better Auth still rejects them', () => {
    expect(needsBetterAuth17RedirectRewrite('file:///tmp/callback')).toBe(false)
    expect(needsBetterAuth17RedirectRewrite('javascript:alert(1)')).toBe(false)
  })

  it('leaves a value that is not a URI at all for Better Auth to refuse (M4)', () => {
    // Nothing here can be a loopback rewrite, and swallowing it would turn a
    // malformed registration into an accepted one.
    expect(needsBetterAuth17RedirectRewrite('not a uri at all')).toBe(false)
    expect(needsBetterAuth17RedirectRewrite('')).toBe(false)
  })

  it('does not rewrite a redirect carrying a fragment or credentials (M4)', () => {
    // RFC 6749 §3.1.2 forbids a fragment on a redirection endpoint, and
    // embedded credentials are not something to swap a placeholder in for —
    // both stay as sent so Better Auth refuses the registration itself.
    expect(needsBetterAuth17RedirectRewrite('cursor://anysphere.cursor-mcp/cb#frag')).toBe(false)
    expect(needsBetterAuth17RedirectRewrite('cursor://user:pw@anysphere.cursor-mcp/cb')).toBe(false)
  })

  it('does not rewrite a redirect carrying only a username (M4)', () => {
    // A callback with a user part is not the callback the client will be sent
    // to; swapping a placeholder in would register it as a working client.
    expect(needsBetterAuth17RedirectRewrite('cursor://user@anysphere.cursor-mcp/cb')).toBe(false)
  })

  it('does not rewrite a redirect carrying only a password (M4)', () => {
    expect(needsBetterAuth17RedirectRewrite('cursor://:pw@anysphere.cursor-mcp/cb')).toBe(false)
  })

  it('leaves every reserved scheme for Better Auth to refuse (M4)', () => {
    // These are the schemes a redirect must never carry. Rewriting one to a
    // loopback placeholder would register a client whose callback the
    // authorization server had already decided to reject.
    expect(needsBetterAuth17RedirectRewrite('file:///tmp/callback')).toBe(false)
    expect(needsBetterAuth17RedirectRewrite('ftp://files.example.com/cb')).toBe(false)
    expect(needsBetterAuth17RedirectRewrite('mailto:ops@acme.example')).toBe(false)
    expect(needsBetterAuth17RedirectRewrite('javascript:alert(1)')).toBe(false)
    expect(needsBetterAuth17RedirectRewrite('data:text/plain,cb')).toBe(false)
    expect(needsBetterAuth17RedirectRewrite('vbscript:msgbox(1)')).toBe(false)
  })

  it('rewrites a reverse-domain redirect that carries a host (M4)', () => {
    // RFC 8252 private-use URIs have no authority. One with a host is the
    // shape Better Auth 1.7.4 refuses, so it is the shape to swap out.
    expect(needsBetterAuth17RedirectRewrite('com.example.app://host.example/cb')).toBe(true)
  })

  it('rewrites a reverse-domain redirect whose path is not absolute (M4)', () => {
    expect(needsBetterAuth17RedirectRewrite('com.example.app:oauth/callback')).toBe(true)
  })

  it('rewrites a reverse-domain redirect with an empty authority (M4)', () => {
    // `scheme:///cb` is an authority, just an empty one — not the
    // authority-free form, and not what 1.7.4 accepts either.
    expect(needsBetterAuth17RedirectRewrite('com.example.app:///oauth/callback')).toBe(true)
  })

  it('rewrites a private-use redirect whose scheme is a single label (M4)', () => {
    // A scheme with no dot is not a domain name anyone can own, so it is not
    // the private-use form Better Auth stores unchanged.
    expect(needsBetterAuth17RedirectRewrite('myapp:/oauth/callback')).toBe(true)
  })

  it('keeps a reverse-domain redirect whatever the length of its labels (M4)', () => {
    // Single-character and two-character labels are ordinary domain labels.
    // Treating one as malformed would swap a placeholder into a registration
    // that was already valid, and the client would never get its callback back.
    expect(needsBetterAuth17RedirectRewrite('x.example.app:/oauth/callback')).toBe(false)
    expect(needsBetterAuth17RedirectRewrite('ab.example:/oauth/callback')).toBe(false)
    expect(needsBetterAuth17RedirectRewrite('com.x:/oauth/callback')).toBe(false)
    expect(needsBetterAuth17RedirectRewrite('a.b:/oauth/callback')).toBe(false)
  })

  it('rewrites a scheme that merely contains or borders on a reverse domain (M4)', () => {
    // The whole scheme has to be the domain name. A label that ends or starts
    // with a hyphen, or a scheme with a `+` in it, is not a name in DNS.
    expect(needsBetterAuth17RedirectRewrite('a+b.example:/oauth/callback')).toBe(true)
    expect(needsBetterAuth17RedirectRewrite('com.example+x:/oauth/callback')).toBe(true)
    expect(needsBetterAuth17RedirectRewrite('com.example-:/oauth/callback')).toBe(true)
    expect(needsBetterAuth17RedirectRewrite('com.-example:/oauth/callback')).toBe(true)
  })

  it('rewrites exactly the redirects that are not RFC 8252 private-use URIs (M4)', () => {
    // A private-use redirect is a reverse-domain scheme, no authority, and a
    // path with one leading slash. Every candidate below is either that shape
    // or that shape with exactly one property broken, and the assertion is
    // unguarded across both: the answer is the flaw and nothing else.
    type RedirectFlaw =
      | 'none'
      | 'host'
      | 'relative-path'
      | 'empty-authority'
      | 'single-label'
      | 'trailing-hyphen'
      | 'leading-hyphen'
      | 'plus-in-scheme'

    const middleChars = fc.constantFrom('a', 'm', 'z', '0', '7', '-')
    const endChar = fc.constantFrom('a', 'q', '9')
    const domainLabel = (startChar: fc.Arbitrary<string>) =>
      fc
        .tuple(
          startChar,
          fc.array(middleChars, { maxLength: 4 }),
          fc.option(endChar, { nil: null })
        )
        .map(([start, middle, end]) => (end === null ? start : start + middle.join('') + end))

    const flaws: RedirectFlaw[] = [
      'none',
      'host',
      'relative-path',
      'empty-authority',
      'single-label',
      'trailing-hyphen',
      'leading-hyphen',
      'plus-in-scheme',
    ]

    fc.assert(
      fc.property(
        domainLabel(fc.constantFrom('a', 'c', 'q', 'z')),
        fc.array(domainLabel(fc.constantFrom('a', 'c', 'q', 'z', '0', '5', '9')), {
          minLength: 1,
          maxLength: 3,
        }),
        fc.array(fc.constantFrom('oauth', 'callback', 'cb'), { minLength: 1, maxLength: 3 }),
        fc.constantFrom(...flaws),
        (firstLabel, restLabels, segments, flaw) => {
          const scheme = [firstLabel, ...restLabels].join('.')
          const path = `/${segments.join('/')}`
          const candidates: Record<RedirectFlaw, { uri: string; rewritten: boolean }> = {
            none: { uri: `${scheme}:${path}`, rewritten: false },
            host: { uri: `${scheme}://host.example${path}`, rewritten: true },
            'relative-path': { uri: `${scheme}:${path.slice(1)}`, rewritten: true },
            'empty-authority': { uri: `${scheme}://${path}`, rewritten: true },
            'single-label': { uri: `${firstLabel}:${path}`, rewritten: true },
            'trailing-hyphen': { uri: `${scheme}-:${path}`, rewritten: true },
            'leading-hyphen': { uri: `${scheme}.-app:${path}`, rewritten: true },
            'plus-in-scheme': {
              uri: `${firstLabel}+${restLabels.join('.')}:${path}`,
              rewritten: true,
            },
          }

          const candidate = candidates[flaw]
          expect(needsBetterAuth17RedirectRewrite(candidate.uri)).toBe(candidate.rewritten)
        }
      )
    )
  })
})

describe('redirectUrisForBetterAuth17Native', () => {
  it('replaces a URI or keeps it, position by position, and never reorders (M4)', () => {
    // Conservation law across both branches: same length, same order, and
    // every entry is either untouched or exactly the placeholder. The
    // restore list is non-null exactly when at least one entry changed, so
    // the route cannot restore URIs it never rewrote.
    const redirectUri = fc.constantFrom(
      CURSOR_REDIRECT,
      'vscode://quackback.mcp/callback',
      'https://www.cursor.com/agents/mcp/oauth/callback',
      'http://127.0.0.1:9/callback',
      'http://localhost:8787/callback',
      'com.example.app:/oauth/callback',
      'file:///tmp/callback',
      'javascript:alert(1)',
      'not a uri at all'
    )
    fc.assert(
      fc.property(fc.array(redirectUri, { minLength: 1, maxLength: 5 }), (uris) => {
        const rewritten = redirectUrisForBetterAuth17Native(uris)

        expect(rewritten).toHaveLength(uris.length)
        rewritten.forEach((uri, index) => {
          const kept = uri === uris[index]
          expect(kept || uri === BA_DCR_PLACEHOLDER_REDIRECT_URI).toBe(true)
        })

        const changed = uris.some((uri, index) => uri !== rewritten[index])
        expect(mcpDcrRedirectUrisToRestore({ redirect_uris: uris })).toEqual(changed ? uris : null)
      })
    )
  })

  it('reads a single redirect_uris string as a one-entry list (M4)', () => {
    expect(mcpDcrRedirectUrisToRestore({ redirect_uris: CURSOR_REDIRECT })).toEqual([
      CURSOR_REDIRECT,
    ])
    expect(mcpDcrRegistrationBody({ redirect_uris: CURSOR_REDIRECT }).redirect_uris).toEqual([
      BA_DCR_PLACEHOLDER_REDIRECT_URI,
    ])
  })

  it('has nothing to restore when the body names no redirect URIs (M4)', () => {
    expect(mcpDcrRedirectUrisToRestore({ client_name: 'Cursor' })).toBeNull()
    expect(mcpDcrRedirectUrisToRestore({ redirect_uris: [1, 2] })).toBeNull()
  })
})

describe('restoreMcpDcrRegisteredRedirectUris', () => {
  beforeEach(() => {
    updateCalls.length = 0
  })

  it('answers a registration with no client_id as a server error (M4)', async () => {
    const restored = await restoreMcpDcrRegisteredRedirectUris(
      Response.json({ client_name: 'Cursor' }, { status: 201 }),
      [CURSOR_REDIRECT]
    )

    expect(restored.status).toBe(500)
    expect(await restored.json()).toEqual({
      error: 'server_error',
      error_description: 'Registered client was missing client_id',
    })
    // Nothing is written against a registration we cannot address.
    expect(updateCalls).toHaveLength(0)
  })

  it('writes the real URIs onto the stored client and back into the answer (M4)', async () => {
    const { oauthClient } = await import('@/lib/server/db')
    const registered = Response.json(
      {
        client_id: 'client_abc',
        client_secret: 'shh',
        redirect_uris: [BA_DCR_PLACEHOLDER_REDIRECT_URI],
        scope: MCP_AS_SCOPES.join(' '),
      },
      { status: 201, headers: { 'content-length': '999', 'x-request-id': 'req_1' } }
    )

    const restored = await restoreMcpDcrRegisteredRedirectUris(registered, [CURSOR_REDIRECT])

    expect(updateCalls).toHaveLength(1)
    expect(updateCalls[0].table).toBe(oauthClient)
    expect(updateCalls[0].values).toEqual({ redirectUris: [CURSOR_REDIRECT] })
    expect(updateCalls[0].where).toEqual({ column: oauthClient.clientId, value: 'client_abc' })

    expect(restored.status).toBe(201)
    expect(await restored.json()).toEqual({
      client_id: 'client_abc',
      client_secret: 'shh',
      redirect_uris: [CURSOR_REDIRECT],
      scope: MCP_AS_SCOPES.join(' '),
    })
    // The body length changed, so a copied content-length would truncate it.
    expect(restored.headers.get('content-length')).not.toBe('999')
    expect(restored.headers.get('x-request-id')).toBe('req_1')
  })

  it('answers a registration whose client_id is not a string as a server error (M4)', async () => {
    // The client_id addresses the row the real callbacks are written onto.
    // Anything that is not a string is no client this instance can name, and
    // using it as one would update whatever row it happened to coerce to.
    const restored = await restoreMcpDcrRegisteredRedirectUris(
      Response.json({ client_id: 12345, client_secret: 'shh' }, { status: 201 }),
      [CURSOR_REDIRECT]
    )

    expect(restored.status).toBe(500)
    expect(await restored.json()).toEqual({
      error: 'server_error',
      error_description: 'Registered client was missing client_id',
    })
    expect(updateCalls).toHaveLength(0)
  })
})
