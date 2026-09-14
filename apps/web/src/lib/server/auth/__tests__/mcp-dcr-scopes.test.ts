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
})
