// @vitest-environment happy-dom
/**
 * The admin form for the ID token nonce setting of an OIDC provider.
 *
 * Contract for batch F, upstream #609 (`94acff2f7`, "detect providers that
 * leave out the ID token nonce"). Items served by this file, verbatim:
 *
 *   F10 A provider set to "no nonce" sends none and accepts a token without
 *       one, while signature, issuer and audience are still verified.
 *   F12 Providers that existed before the migration keep the nonce check on.
 *
 * The server side of both is in
 * lib/server/auth/__tests__/id-token-nonce.contract.test.ts. What belongs here
 * is the way in: an admin can actually choose "Don't use a nonce", the choice
 * is what gets saved, choosing the default again saves nothing special, and a
 * provider stored before the setting existed is shown, and re-saved, as
 * "check".
 */
import { useState } from 'react'
import { describe, it, expect, beforeAll, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  ConnectionFields,
  connectionDraftFrom,
  connectionPatchFrom,
  emptyConnectionDraft,
  type ConnectionDraft,
} from '../connection-form'
import type { IdentityProvider } from '@/lib/server/domains/settings/identity-providers.service'

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn()
  Element.prototype.hasPointerCapture = vi.fn(() => false)
})

vi.mock('@tanstack/react-start', () => ({ useServerFn: (fn: unknown) => fn }))
vi.mock('@/lib/server/functions/sso', () => ({
  fetchDiscoveryScopesFn: vi.fn(async () => ({ scopesSupported: null })),
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

/** Holds the draft the way the pages do, and reports every draft to the test. */
function FormUnderTest({
  initial,
  onDraft,
}: {
  initial: ConnectionDraft
  onDraft: (draft: ConnectionDraft) => void
}) {
  const [draft, setDraft] = useState(initial)
  return (
    <ConnectionFields
      draft={draft}
      onChange={(next) => {
        setDraft(next)
        onDraft(next)
      }}
      registrationId="oidc_acme"
      baseUrl="https://app.example.com"
      disabled={false}
      existing={false}
    />
  )
}

async function chooseNonceOption(label: string) {
  // The panel opens by itself when a non-default setting is already stored.
  const toggle = screen.getByRole('button', { name: /Connection options/ })
  if (toggle.getAttribute('aria-expanded') !== 'true') fireEvent.click(toggle)
  await userEvent.click(screen.getByRole('combobox', { name: 'ID token nonce' }))
  await userEvent.click(screen.getByRole('option', { name: label }))
}

describe('choosing the ID token nonce setting (F10)', () => {
  it('(F10) an admin can choose "Don\'t use a nonce", and that is what gets saved', async () => {
    const drafts: ConnectionDraft[] = []
    render(<FormUnderTest initial={emptyConnectionDraft()} onDraft={(d) => drafts.push(d)} />)

    await chooseNonceOption("Don't use a nonce")

    expect(drafts.at(-1)?.idTokenNonce).toBe('off')
    expect(connectionPatchFrom(drafts.at(-1)!).idTokenNonce).toBe('off')
  })

  it('(F10) choosing the check again goes back to the stored default', async () => {
    const drafts: ConnectionDraft[] = []
    const initial = { ...emptyConnectionDraft(), idTokenNonce: 'off' }
    render(<FormUnderTest initial={initial} onDraft={(d) => drafts.push(d)} />)

    await chooseNonceOption('Send a nonce and check it')

    expect(drafts.at(-1)?.idTokenNonce).toBe('check')
    expect(connectionPatchFrom(drafts.at(-1)!).idTokenNonce).toBeNull()
  })
})

describe('a provider stored before the setting existed (F12)', () => {
  const storedBeforeTheMigration = {
    kind: 'other',
    discoveryUrl: 'https://idp.example/.well-known/openid-configuration',
    clientId: 'client-1',
    scopes: null,
    prompt: null,
    tokenEndpointAuthMethod: null,
    idTokenNonce: null,
    authorizationUrl: null,
    tokenUrl: null,
    userInfoUrl: null,
    jwksUri: null,
    issuer: null,
  } as unknown as IdentityProvider

  it('(F12) is shown with the check on, and saving it again leaves the check on', () => {
    const draft = connectionDraftFrom(storedBeforeTheMigration)

    expect(draft.idTokenNonce).toBe('check')
    expect(connectionPatchFrom(draft).idTokenNonce).toBeNull()
  })
})
