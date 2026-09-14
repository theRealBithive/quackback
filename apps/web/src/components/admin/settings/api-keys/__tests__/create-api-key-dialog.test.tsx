// @vitest-environment happy-dom
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
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { API_KEY_SCOPES, EMPTY_SCOPES_MESSAGE } from '@/lib/server/domains/api-keys/api-key-scopes'

const { mockCreateApiKeyFn } = vi.hoisted(() => ({
  mockCreateApiKeyFn: vi.fn(),
}))

vi.mock('@/lib/server/functions/api-keys', () => ({
  createApiKeyFn: mockCreateApiKeyFn,
}))

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}))

vi.mock('@tanstack/react-router', () => ({
  useRouter: () => ({ invalidate: vi.fn() }),
}))

import { CreateApiKeyDialog } from '../create-api-key-dialog'

function renderDialog(onKeyCreated = vi.fn()) {
  return {
    onKeyCreated,
    ...render(
      <CreateApiKeyDialog open={true} onOpenChange={vi.fn()} onKeyCreated={onKeyCreated} />
    ),
  }
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('CreateApiKeyDialog scopes', () => {
  it('defaults every domain to its maximum level (legacy-equivalent authority)', () => {
    const { getByRole } = renderDialog()
    expect(getByRole('button', { name: 'Feedback: Read and write' })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
    expect(getByRole('button', { name: 'Help Center: Read and write' })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
    expect(getByRole('button', { name: 'Conversations: Read and write' })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
    expect(getByRole('button', { name: 'Changelog: Write' })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
    expect(getByRole('button', { name: 'Feedback: Read' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('submits the selected scopes with the key name', async () => {
    mockCreateApiKeyFn.mockResolvedValue({
      apiKey: { id: 'api_key_1', name: 'CI' },
      plainTextKey: 'qb_secret',
    })
    const { getByLabelText, getByRole, onKeyCreated } = renderDialog()

    fireEvent.change(getByLabelText('Name'), { target: { value: 'CI' } })
    fireEvent.click(getByRole('button', { name: 'Create Key' }))

    await waitFor(() => expect(onKeyCreated).toHaveBeenCalled())
    expect(mockCreateApiKeyFn).toHaveBeenCalledWith({
      data: { name: 'CI', scopes: [...API_KEY_SCOPES] },
    })
  })

  it('stores only the three reads after downgrading every domain from Read and write', async () => {
    mockCreateApiKeyFn.mockResolvedValue({
      apiKey: { id: 'api_key_1', name: 'Read bot' },
      plainTextKey: 'qb_secret',
    })
    const { getByLabelText, getByRole, onKeyCreated } = renderDialog()

    fireEvent.change(getByLabelText('Name'), { target: { value: 'Read bot' } })
    fireEvent.click(getByRole('button', { name: 'Feedback: Read' }))
    fireEvent.click(getByRole('button', { name: 'Help Center: Read' }))
    fireEvent.click(getByRole('button', { name: 'Conversations: Read' }))
    fireEvent.click(getByRole('button', { name: 'Changelog: Write' }))
    fireEvent.click(getByRole('button', { name: 'Create Key' }))

    await waitFor(() => expect(onKeyCreated).toHaveBeenCalled())
    const sent = mockCreateApiKeyFn.mock.calls[0][0].data.scopes as string[]
    expect(sent).toEqual(['read:feedback', 'read:article', 'read:chat'])
  })

  it('disables submit when every domain is off', () => {
    const { getByLabelText, getByRole } = renderDialog()
    fireEvent.change(getByLabelText('Name'), { target: { value: 'k' } })
    fireEvent.click(getByRole('button', { name: 'Feedback: Read and write' }))
    fireEvent.click(getByRole('button', { name: 'Help Center: Read and write' }))
    fireEvent.click(getByRole('button', { name: 'Conversations: Read and write' }))
    fireEvent.click(getByRole('button', { name: 'Changelog: Write' }))
    expect(getByRole('button', { name: 'Create Key' })).toBeDisabled()
    expect(mockCreateApiKeyFn).not.toHaveBeenCalled()
  })
})

describe('CreateApiKeyDialog submission and reset', () => {
  /** Turn every domain off, leaving the selection empty. */
  function clearEveryDomain(getByRole: ReturnType<typeof renderDialog>['getByRole']) {
    fireEvent.click(getByRole('button', { name: 'Feedback: Read and write' }))
    fireEvent.click(getByRole('button', { name: 'Help Center: Read and write' }))
    fireEvent.click(getByRole('button', { name: 'Conversations: Read and write' }))
    fireEvent.click(getByRole('button', { name: 'Changelog: Write' }))
  }

  it('refuses a submit with no scopes selected and says why (M9)', async () => {
    // The submit button is disabled in that state, so this is the guard behind
    // it: a form submitted any other way (an implicit submit, a stale render)
    // must not reach the server with an empty scope list.
    const { getByLabelText, getByRole, getByText, baseElement } = renderDialog()

    fireEvent.change(getByLabelText('Name'), { target: { value: 'Scopeless' } })
    clearEveryDomain(getByRole)
    fireEvent.submit(baseElement.querySelector('form')!)

    await waitFor(() => expect(getByText(EMPTY_SCOPES_MESSAGE)).toBeInTheDocument())
    expect(mockCreateApiKeyFn).not.toHaveBeenCalled()
  })

  it('refuses a submit with no name and says why (M9)', async () => {
    const { getByRole, getByText, baseElement } = renderDialog()

    fireEvent.submit(baseElement.querySelector('form')!)

    await waitFor(() =>
      expect(getByText('Please enter a name for the API key')).toBeInTheDocument()
    )
    expect(mockCreateApiKeyFn).not.toHaveBeenCalled()
    expect(getByRole('button', { name: 'Feedback: Read and write' })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
  })

  it('forgets the name, the levels and the error when it closes (M9)', async () => {
    const { getByLabelText, getByRole, getByText, queryByText, baseElement } = renderDialog()

    fireEvent.change(getByLabelText('Name'), { target: { value: 'Half-finished' } })
    clearEveryDomain(getByRole)
    fireEvent.submit(baseElement.querySelector('form')!)
    await waitFor(() => expect(getByText(EMPTY_SCOPES_MESSAGE)).toBeInTheDocument())

    // Escape is how a person closes this; the dialog stays mounted here
    // because the test owns `open`, which is what makes the reset observable.
    fireEvent.keyDown(document, { key: 'Escape' })

    await waitFor(() => expect(getByLabelText('Name')).toHaveValue(''))
    expect(queryByText(EMPTY_SCOPES_MESSAGE)).toBeNull()
    expect(getByRole('button', { name: 'Feedback: Read and write' })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
    expect(getByRole('button', { name: 'Changelog: Write' })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
  })
})
