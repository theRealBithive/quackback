/**
 * POST /api/auth/$ — dynamic client registration for an MCP desktop client.
 *
 * Better Auth 1.7.4 refuses a host-bearing private-use redirect
 * (`cursor://anysphere.cursor-mcp/oauth/callback`) outright, so the
 * registration this route forwards carries a loopback placeholder instead —
 * and the client's real callbacks have to be put back afterwards, on the
 * stored row and in the answer the client reads, or authorize never matches
 * the URI the client sends.
 *
 * The suite mocks only the two edges: the Better Auth handler and the
 * database write. The rewrite and restore modules run for real, because what
 * they do to the body is the thing under test.
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

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: vi.fn(() => (opts: unknown) => ({ options: opts })),
}))

const hoisted = vi.hoisted(() => ({
  authHandler: vi.fn<(request: Request) => Promise<Response>>(),
  /** Every `{ redirectUris }` written back onto a stored client row. */
  storedRedirectUris: [] as unknown[],
}))

vi.mock('@/lib/server/auth/index', () => ({
  auth: { handler: hoisted.authHandler },
}))

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: {
    update: () => ({
      set: (values: unknown) => {
        hoisted.storedRedirectUris.push(values)
        return { where: async () => undefined }
      },
    }),
  },
  eq: (column: unknown, value: unknown) => ({ column, value }),
}))

vi.mock('@/lib/server/config', () => ({
  config: { baseUrl: 'https://feedback.example.com' },
  getBaseUrl: () => 'https://feedback.example.com',
}))

import { MCP_AS_SCOPES } from '@/lib/shared/api-key-scopes'
import { BA_DCR_PLACEHOLDER_REDIRECT_URI } from '@/lib/server/auth/mcp-dcr-scopes'
import { Route } from '../$'

type Handlers = { POST: (args: { request: Request }) => Promise<Response> }

function post(request: Request): Promise<Response> {
  return (
    Route as unknown as { options: { server: { handlers: Handlers } } }
  ).options.server.handlers.POST({ request })
}

const REGISTER_URL = 'https://feedback.example.com/api/auth/oauth2/register'
const CURSOR_REDIRECT = 'cursor://anysphere.cursor-mcp/oauth/callback'

/** A registration request from an address of its own, so the hourly budget is per test. */
function registrationRequest(body: string, contentType: string, ip: string): Request {
  return new Request(REGISTER_URL, {
    method: 'POST',
    headers: { 'content-type': contentType, 'x-forwarded-for': ip },
    body,
  })
}

/** The body Better Auth was handed, parsed. */
async function forwardedBody(): Promise<Record<string, unknown>> {
  const forwarded = hoisted.authHandler.mock.calls[0][0]
  return (await forwarded.json()) as Record<string, unknown>
}

beforeEach(() => {
  vi.clearAllMocks()
  hoisted.storedRedirectUris.length = 0
})

describe('POST /api/auth/$ — MCP dynamic client registration', () => {
  it('registers a private-use callback as a loopback one and restores it after (M4)', async () => {
    hoisted.authHandler.mockResolvedValue(
      Response.json(
        {
          client_id: 'client_abc',
          client_secret: 'shh',
          redirect_uris: [BA_DCR_PLACEHOLDER_REDIRECT_URI],
        },
        { status: 201 }
      )
    )

    const response = await post(
      registrationRequest(
        JSON.stringify({
          client_name: 'Cursor',
          redirect_uris: [CURSOR_REDIRECT],
          scope: 'read:feedback',
        }),
        'application/json',
        '198.51.100.1'
      )
    )

    // What Better Auth 1.7 was asked to store: the placeholder, a native
    // client, and the whole allow-list so a later step-up is not invalid_scope.
    const sent = await forwardedBody()
    expect(sent.redirect_uris).toEqual([BA_DCR_PLACEHOLDER_REDIRECT_URI])
    expect(sent.application_type).toBe('native')
    expect(sent.scope).toBe(MCP_AS_SCOPES.join(' '))
    expect(sent.client_name).toBe('Cursor')

    // What the client is told, and what the row it will authorize against holds.
    expect(response.status).toBe(201)
    expect(await response.json()).toMatchObject({
      client_id: 'client_abc',
      redirect_uris: [CURSOR_REDIRECT],
    })
    expect(hoisted.storedRedirectUris).toEqual([{ redirectUris: [CURSOR_REDIRECT] }])
  })

  it('leaves a registration whose callbacks Better Auth accepts untouched (M4)', async () => {
    const registered = Response.json(
      { client_id: 'client_web', redirect_uris: ['https://app.example.com/cb'] },
      { status: 201 }
    )
    hoisted.authHandler.mockResolvedValue(registered)

    const response = await post(
      registrationRequest(
        JSON.stringify({
          application_type: 'web',
          redirect_uris: ['https://app.example.com/cb'],
        }),
        'application/json',
        '198.51.100.2'
      )
    )

    const sent = await forwardedBody()
    expect(sent.redirect_uris).toEqual(['https://app.example.com/cb'])
    expect(sent.application_type).toBe('web')
    // Nothing was swapped, so nothing is written back and the answer is the
    // authorization server's own.
    expect(hoisted.storedRedirectUris).toEqual([])
    expect(response).toBe(registered)
  })

  it('passes a registration body that is not JSON through unrewritten (M4)', async () => {
    const refused = new Response('unsupported media type', { status: 415 })
    hoisted.authHandler.mockResolvedValue(refused)

    const response = await post(
      registrationRequest('client_name=Cursor', 'application/x-www-form-urlencoded', '198.51.100.3')
    )

    // The body reaches Better Auth exactly as sent — no scope is added to
    // something this route cannot parse, and no client row is written.
    const forwarded = hoisted.authHandler.mock.calls[0][0]
    expect(await forwarded.text()).toBe('client_name=Cursor')
    expect(hoisted.storedRedirectUris).toEqual([])
    expect(response).toBe(refused)
  })

  it('does not restore anything when the registration itself failed (M4)', async () => {
    const rejected = Response.json({ error: 'invalid_redirect_uri' }, { status: 400 })
    hoisted.authHandler.mockResolvedValue(rejected)

    const response = await post(
      registrationRequest(
        JSON.stringify({ client_name: 'Cursor', redirect_uris: [CURSOR_REDIRECT] }),
        'application/json',
        '198.51.100.4'
      )
    )

    expect(response).toBe(rejected)
    expect(hoisted.storedRedirectUris).toEqual([])
  })

  it('answers a registration that came back without a client_id as a server error (M4)', async () => {
    hoisted.authHandler.mockResolvedValue(Response.json({ client_secret: 'shh' }, { status: 201 }))

    const response = await post(
      registrationRequest(
        JSON.stringify({ client_name: 'Cursor', redirect_uris: [CURSOR_REDIRECT] }),
        'application/json',
        '198.51.100.5'
      )
    )

    expect(response.status).toBe(500)
    expect(await response.json()).toMatchObject({ error: 'server_error' })
    expect(hoisted.storedRedirectUris).toEqual([])
  })

  it('forwards a POST that is not a registration without touching its body (M4)', async () => {
    const ok = new Response('ok', { status: 200 })
    hoisted.authHandler.mockResolvedValue(ok)

    const response = await post(
      new Request('https://feedback.example.com/api/auth/sign-in/email', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'someone@acme.example' }),
      })
    )

    expect(await forwardedBody()).toEqual({ email: 'someone@acme.example' })
    expect(response).toBe(ok)
  })
})
