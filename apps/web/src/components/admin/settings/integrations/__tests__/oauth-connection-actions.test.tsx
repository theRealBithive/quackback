// @vitest-environment happy-dom
/**
 * <OAuthConnectionActions> — the buttons under an OAuth integration.
 *
 * Contract, confirmed before implementation:
 *
 *   V6 A repeated GitLab connect over OAuth keeps the board rules and the
 *      webhook secret. Only a disconnect removes them. For that, the UI offers
 *      a Reconnect action while connected.
 *
 * The server half — that the OAuth callback updates the existing row instead of
 * replacing it — is held in `lib/server/integrations/__tests__/save.db.test.ts`.
 * What is held here is that an operator can reach that path at all. Until now
 * the only button on a connected integration was Disconnect, which deletes the
 * row and, with it, the board rules and the webhook secret; renewing an
 * authorization meant losing both and re-entering them.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor, act } from '@testing-library/react'

const routerState = vi.hoisted(() => ({ search: {} as Record<string, string | undefined> }))
const useSearch = vi.hoisted(() => vi.fn(() => routerState.search))
vi.mock('@tanstack/react-router', () => ({
  useSearch,
}))

const deleteMutation = vi.hoisted(() => ({ mutate: vi.fn(), isPending: false }))
vi.mock('@/lib/client/mutations', () => ({
  useDeleteIntegration: () => deleteMutation,
}))

const toast = vi.hoisted(() => ({ error: vi.fn() }))
vi.mock('sonner', () => ({ toast }))

// The GitLab wrapper imports its connect-URL server function; a browser test
// has no server to call, and the wrapper's own contribution is the copy.
vi.mock('@/integrations/gitlab/server/functions', () => ({
  getGitLabConnectUrl: vi.fn(),
}))

import { OAuthConnectionActions } from '../oauth-connection-actions'
import { GitLabConnectionActions } from '@/integrations/gitlab/ui/gitlab-connection-actions'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

beforeEach(() => {
  vi.clearAllMocks()
  routerState.search = {}
  deleteMutation.isPending = false
})

/** A connect URL that never arrives, so the click leaves the page where it is. */
function pendingForever(): Promise<string> {
  return new Promise<string>(() => {})
}

function renderActions(overrides: Partial<Parameters<typeof OAuthConnectionActions>[0]> = {}) {
  const getConnectUrl = overrides.getConnectUrl ?? vi.fn(pendingForever)
  render(
    <OAuthConnectionActions
      integrationId="integration_1"
      isConnected
      searchParamKey="gitlab"
      getConnectUrl={getConnectUrl}
      displayName="GitLab"
      disconnectDescription="Removes the connection."
      {...overrides}
    />
  )
  return { getConnectUrl }
}

const button = (name: string) => screen.getByRole('button', { name })
const noButton = (name: string) => screen.queryByRole('button', { name })

describe('OAuthConnectionActions while connected (V6)', () => {
  it('offers Reconnect beside Disconnect, and no Connect', () => {
    renderActions()

    expect(button('Reconnect')).toBeTruthy()
    expect(button('Disconnect')).toBeTruthy()
    expect(noButton('Connect')).toBeNull()
  })

  it('Reconnect starts the OAuth flow again and deletes nothing', async () => {
    const { getConnectUrl } = renderActions()

    fireEvent.click(button('Reconnect'))

    expect(getConnectUrl).toHaveBeenCalledTimes(1)
    expect(deleteMutation.mutate).not.toHaveBeenCalled()
    await waitFor(() => expect(screen.getByText('Connecting...')).toBeTruthy())
    expect(noButton('Reconnect')).toBeNull()
  })

  it('holds Disconnect while a reconnect is under way, so the two cannot race', async () => {
    renderActions()

    fireEvent.click(button('Reconnect'))

    await waitFor(() => expect(screen.getByText('Connecting...')).toBeTruthy())
    expect((button('Disconnect') as HTMLButtonElement).disabled).toBe(true)
  })

  it('says why the flow could not start and offers Reconnect again', async () => {
    const getConnectUrl = vi
      .fn()
      .mockRejectedValue(new Error('GitLab platform credentials not configured'))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    renderActions({ getConnectUrl })

    fireEvent.click(button('Reconnect'))

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('GitLab platform credentials not configured')
    )
    expect((button('Reconnect') as HTMLButtonElement).disabled).toBe(false)
    expect(console.error).toHaveBeenCalledWith(
      'Failed to get connect URL:',
      expect.objectContaining({ message: 'GitLab platform credentials not configured' })
    )
  })

  it('falls back to a generic message when what was thrown is not an Error', async () => {
    const getConnectUrl = vi.fn().mockRejectedValue('nope')
    vi.spyOn(console, 'error').mockImplementation(() => {})
    renderActions({ getConnectUrl })

    fireEvent.click(button('Reconnect'))

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("Couldn't start connection. Try again.")
    )
  })

  it('Disconnect asks first, naming the integration, then deletes it by its id', async () => {
    renderActions()

    fireEvent.click(button('Disconnect'))
    expect(deleteMutation.mutate).not.toHaveBeenCalled()
    expect(await screen.findByText('Disconnect GitLab?')).toBeTruthy()

    // Two buttons now read "Disconnect": the trigger and the dialog's confirm.
    const confirms = screen.getAllByRole('button', { name: 'Disconnect' })
    fireEvent.click(confirms[confirms.length - 1])
    expect(deleteMutation.mutate).toHaveBeenCalledWith({ id: 'integration_1' })
  })

  it('deletes nothing when it does not know which connection it is looking at', async () => {
    renderActions({ integrationId: undefined })

    fireEvent.click(button('Disconnect'))
    await screen.findByText('Disconnect GitLab?')
    const confirms = screen.getAllByRole('button', { name: 'Disconnect' })
    fireEvent.click(confirms[confirms.length - 1])

    expect(deleteMutation.mutate).not.toHaveBeenCalled()
  })

  it('reads the callback marker from the route without requiring a matched route', () => {
    renderActions()

    expect(useSearch).toHaveBeenCalledWith({ strict: false })
  })

  it('holds both buttons while the disconnect is in flight', () => {
    deleteMutation.isPending = true
    renderActions()

    expect(screen.getByText('Disconnecting...')).toBeTruthy()
    expect((button('Reconnect') as HTMLButtonElement).disabled).toBe(true)
  })
})

describe('OAuthConnectionActions while not connected', () => {
  it('offers Connect alone', () => {
    renderActions({ isConnected: false })

    expect(button('Connect')).toBeTruthy()
    expect(noButton('Reconnect')).toBeNull()
    expect(noButton('Disconnect')).toBeNull()
  })

  it('uses the caller’s connect label', () => {
    renderActions({ isConnected: false, connectLabel: 'Install app' })

    expect(button('Install app')).toBeTruthy()
    expect(noButton('Connect')).toBeNull()
  })

  it('Connect starts the OAuth flow', async () => {
    const { getConnectUrl } = renderActions({ isConnected: false })

    fireEvent.click(button('Connect'))

    expect(getConnectUrl).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(screen.getByText('Connecting...')).toBeTruthy())
  })
})

describe('OAuthConnectionActions after the OAuth callback', () => {
  it('confirms the connection once, drops the marker from the URL, and moves on', () => {
    vi.useFakeTimers()
    routerState.search = { gitlab: 'connected' }
    window.history.replaceState({}, '', '/admin/settings/integrations/gitlab?gitlab=connected')

    renderActions()

    expect(screen.getByText('Connected successfully!')).toBeTruthy()
    expect(window.location.search).not.toContain('gitlab=connected')

    act(() => {
      vi.advanceTimersByTime(3000)
    })
    expect(screen.queryByText('Connected successfully!')).toBeNull()
  })

  it('shows nothing for a callback that belongs to another integration', () => {
    routerState.search = { jira: 'connected' }

    renderActions()

    expect(screen.queryByText('Connected successfully!')).toBeNull()
  })

  it('notices a callback that lands after the first render', () => {
    const view = render(
      <OAuthConnectionActions
        integrationId="integration_1"
        isConnected
        searchParamKey="gitlab"
        getConnectUrl={vi.fn(pendingForever)}
        displayName="GitLab"
        disconnectDescription="Removes the connection."
      />
    )
    expect(screen.queryByText('Connected successfully!')).toBeNull()

    routerState.search = { gitlab: 'connected' }
    view.rerender(
      <OAuthConnectionActions
        integrationId="integration_1"
        isConnected
        searchParamKey="gitlab"
        getConnectUrl={vi.fn(pendingForever)}
        displayName="GitLab"
        disconnectDescription="Removes the connection."
      />
    )

    expect(screen.getByText('Connected successfully!')).toBeTruthy()
  })

  it('keeps the confirmation for three seconds after the latest callback, not the first', () => {
    vi.useFakeTimers()
    routerState.search = { gitlab: 'connected' }
    const props = {
      integrationId: 'integration_1',
      isConnected: true,
      searchParamKey: 'gitlab',
      getConnectUrl: vi.fn(pendingForever),
      displayName: 'GitLab',
      disconnectDescription: 'Removes the connection.',
    }
    const view = render(<OAuthConnectionActions {...props} />)

    act(() => {
      vi.advanceTimersByTime(2000)
    })
    // The route reports the marker again — a fresh search object, same value.
    routerState.search = { gitlab: 'connected' }
    view.rerender(<OAuthConnectionActions {...props} />)

    act(() => {
      vi.advanceTimersByTime(1500)
    })
    expect(screen.getByText('Connected successfully!')).toBeTruthy()

    act(() => {
      vi.advanceTimersByTime(1500)
    })
    expect(screen.queryByText('Connected successfully!')).toBeNull()
  })
})

describe('GitLabConnectionActions (V6)', () => {
  it('tells the operator what a disconnect costs and that Reconnect keeps it', async () => {
    render(<GitLabConnectionActions integrationId="integration_1" isConnected />)

    fireEvent.click(button('Disconnect'))

    expect(await screen.findByText('Disconnect GitLab?')).toBeTruthy()
    expect(screen.getByText(/board rules and its webhook secret/)).toBeTruthy()
    expect(screen.getByText(/use Reconnect instead/)).toBeTruthy()
  })

  it('offers Reconnect, wired to the GitLab connect URL', async () => {
    const { getGitLabConnectUrl } = await import('@/integrations/gitlab/server/functions')
    vi.mocked(getGitLabConnectUrl).mockImplementation(pendingForever as never)
    render(<GitLabConnectionActions integrationId="integration_1" isConnected />)

    fireEvent.click(button('Reconnect'))

    expect(getGitLabConnectUrl).toHaveBeenCalledTimes(1)
  })

  it('recognises its own callback marker', () => {
    routerState.search = { gitlab: 'connected' }

    render(<GitLabConnectionActions integrationId="integration_1" isConnected />)

    expect(screen.getByText('Connected successfully!')).toBeTruthy()
  })
})
