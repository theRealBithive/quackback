// @vitest-environment happy-dom
/**
 * What the consent screen offers before anyone touches it.
 *
 * The screen is the only place a person sees what an MCP client will be able
 * to do, and the authorize request it answers has already been widened to the
 * whole allow-list so that writes CAN be granted here. That widening is what
 * makes the prefill load-bearing: read the widened `scope=` as the request and
 * every write is on by default, on a screen whose whole job is to ask.
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
import type { ComponentType } from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'

const hoisted = vi.hoisted(() => ({
  /** The validated search the mounted route reports for the test in hand. */
  search: {} as Record<string, string | undefined>,
}))

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: vi.fn(() => (opts: unknown) => ({
    options: opts,
    useSearch: () => hoisted.search,
  })),
}))

import {
  CLIENT_REQUESTED_SCOPE_PARAM,
  expandAuthorizeScopes,
} from '@/lib/shared/mcp-consent-scopes'
import { Route } from '../consent'

type ConsentRoute = { options: { component: ComponentType } }

/** Mount the real consent screen for this search, past its client-info fetch. */
async function renderConsent(search: Record<string, string | undefined>) {
  hoisted.search = search
  const ConsentPage = (Route as unknown as ConsentRoute).options.component
  render(<ConsentPage />)
  await screen.findByRole('button', { name: 'Authorize' })
}

/** The pressed chip for each domain row, as a reader would see it. */
function pressedLevels(): Record<string, string> {
  const pressed: Record<string, string> = {}
  for (const button of screen.getAllByRole('button')) {
    const label = button.getAttribute('aria-label')
    if (!label?.includes(': ')) continue
    const [domain, level] = label.split(': ')
    if (button.getAttribute('aria-pressed') === 'true') pressed[domain] = level
  }
  return pressed
}

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json({ client_name: 'Cursor' }))
  )
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('the OAuth consent screen', () => {
  /**
   * First written as "a subset request shows only that subset", which is red:
   * the three first-connect reads are a floor the screen always starts from
   * (they are what the PRM and the 401 challenge advertise, so a client that
   * asked for less than them still gets a session that can look things up).
   * What the client's own request decides is what is added on top — the
   * step-up writes — and that is what this asserts.
   */
  it('adds the step-up writes a subset request named, over the read floor (M5)', async () => {
    await renderConsent({
      client_id: 'client_abc',
      scope: expandAuthorizeScopes(),
      [CLIENT_REQUESTED_SCOPE_PARAM]: 'read:feedback write:feedback read:article',
    })

    expect(pressedLevels()).toEqual({
      Feedback: 'Read and write',
      'Help Center': 'Read',
      Conversations: 'Read',
    })
    // Changelog is write-only, and nobody asked for it.
    expect(screen.getByRole('button', { name: 'Changelog: Write' })).toHaveAttribute(
      'aria-pressed',
      'false'
    )
    expect(screen.getByRole('button', { name: 'Authorize' })).toBeEnabled()
  })

  it('falls back to the first-connect defaults for a whole-catalogue request (M5)', async () => {
    // The authorize rewrite widened `scope=` so writes COULD be granted here.
    // Reading that back as the request would pre-tick every write.
    await renderConsent({ client_id: 'client_abc', scope: expandAuthorizeScopes() })

    expect(pressedLevels()).toEqual({
      Feedback: 'Read',
      'Help Center': 'Read',
      Conversations: 'Read',
    })
  })

  it('leaves "stay signed in" off unless the client asked for offline_access (M5)', async () => {
    await renderConsent({
      client_id: 'client_abc',
      scope: expandAuthorizeScopes(),
      [CLIENT_REQUESTED_SCOPE_PARAM]: 'read:feedback',
    })
    expect(screen.getByRole('switch', { name: 'Stay signed in' })).toHaveAttribute(
      'aria-checked',
      'false'
    )

    cleanup()
    await renderConsent({
      client_id: 'client_abc',
      scope: expandAuthorizeScopes(),
      [CLIENT_REQUESTED_SCOPE_PARAM]: 'read:feedback offline_access',
    })
    expect(screen.getByRole('switch', { name: 'Stay signed in' })).toHaveAttribute(
      'aria-checked',
      'true'
    )
  })

  it('refuses to authorize once every capability is switched off (M5)', async () => {
    await renderConsent({
      client_id: 'client_abc',
      scope: expandAuthorizeScopes(),
      [CLIENT_REQUESTED_SCOPE_PARAM]: 'read:feedback read:article read:chat',
    })

    expect(screen.getByRole('button', { name: 'Authorize' })).toBeEnabled()

    // Pressing a pressed chip clears the domain, so this turns all three off.
    fireEvent.click(screen.getByRole('button', { name: 'Feedback: Read' }))
    fireEvent.click(screen.getByRole('button', { name: 'Help Center: Read' }))
    fireEvent.click(screen.getByRole('button', { name: 'Conversations: Read' }))

    expect(pressedLevels()).toEqual({})
    // A grant of identity scopes alone is not something to ask a person for.
    expect(screen.getByRole('button', { name: 'Authorize' })).toBeDisabled()
    // Denying stays available — it is the whole point of the screen.
    expect(screen.getByRole('button', { name: 'Deny' })).toBeEnabled()
  })
})
