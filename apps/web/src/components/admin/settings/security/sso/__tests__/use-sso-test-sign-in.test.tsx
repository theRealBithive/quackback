// @vitest-environment happy-dom
/**
 * `<SsoTestSignInProvider>` / the shared test-sign-in modal. The wire-shape
 * and mapping-failure branches for the postMessage result are covered in
 * `sso-test-capture-context.test.tsx`; this suite covers what that one
 * doesn't: the legacy (no `capture` field) success shape, cancelling out of
 * the prompt before a test starts, and the offered "success action" — the
 * button that lets an admin apply a pending change (e.g. "Enable sign-in")
 * right from a passing test result.
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { SsoTestSignInProvider, useSsoTestSignIn } from '../use-sso-test-sign-in'
import { SSO_TEST_POSTMESSAGE_SOURCE } from '@/lib/shared/sso-test-keys'

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn()
  Element.prototype.hasPointerCapture = vi.fn(() => false)
  Element.prototype.setPointerCapture = vi.fn()
  Element.prototype.releasePointerCapture = vi.fn()
})

vi.mock('@tanstack/react-start', () => ({
  useServerFn: () =>
    vi.fn(async () => ({ testId: 'ssotest_x', authorizeUrl: 'https://idp.example/auth' })),
}))

vi.mock('@/lib/server/functions/sso-test', () => ({
  startSsoTestFn: vi.fn(),
  getSsoTestResultFn: vi.fn(),
}))

vi.mock('@/lib/client/hooks/use-auth-broadcast', () => ({
  openAuthPopup: vi.fn(() => ({ close: vi.fn() })),
  usePopupTracker: () => ({ trackPopup: vi.fn(), clearPopup: vi.fn() }),
}))

function renderProbe() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <SsoTestSignInProvider>
        <Probe />
      </SsoTestSignInProvider>
    </QueryClientProvider>
  )
}

let openOptions: Parameters<ReturnType<typeof useSsoTestSignIn>['open']>[0]

function Probe() {
  const { lastSuccess, open } = useSsoTestSignIn()
  return (
    <div>
      <button type="button" onClick={() => open(openOptions)}>
        open-test
      </button>
      <div data-testid="success-id">{lastSuccess?.identity?.id ?? ''}</div>
    </div>
  )
}

const startTestSignIn = async () => {
  await act(async () => {
    screen.getByText('open-test').click()
  })
  await act(async () => {
    screen.getByRole('button', { name: /start test sign-in/i }).click()
  })
}

const dispatchResult = async (result: unknown, identityMatched?: boolean) => {
  await act(async () => {
    window.dispatchEvent(
      new MessageEvent('message', {
        origin: window.location.origin,
        data: { source: SSO_TEST_POSTMESSAGE_SOURCE, result, identityMatched },
      })
    )
  })
}

beforeEach(() => {
  openOptions = undefined
})

describe('SsoTestSignInProvider', () => {
  it('builds the success capture from the claims when the server sends no structured capture', async () => {
    renderProbe()
    await startTestSignIn()
    await dispatchResult({
      ok: true,
      steps: [],
      claims: { sub: 'person-9', email: 'jane@example.test' },
      allClaims: { sub: 'person-9', email: 'jane@example.test' },
      tokenInfo: { idTokenAlg: 'RS256', hasAccessToken: true, hasRefreshToken: false },
      // No `capture` key — the legacy wire shape from before capture replay.
    })
    expect(screen.getByTestId('success-id').textContent).toBe('person-9')
  })

  it('dismisses the prompt entirely when the admin cancels before starting a test', async () => {
    renderProbe()
    await act(async () => {
      screen.getByText('open-test').click()
    })
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    await act(async () => {
      screen.getByRole('button', { name: 'Cancel' }).click()
    })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('applies the offered success action and shows its confirmation banner', async () => {
    const run = vi.fn(async () => undefined)
    openOptions = {
      registrationId: 'oidc_x',
      successAction: { label: 'Enable sign-in', doneMessage: 'Sign-in is enabled.', run },
    }
    renderProbe()
    await startTestSignIn()
    await dispatchResult({
      ok: true,
      steps: [],
      claims: { sub: 'person-9' },
      allClaims: { sub: 'person-9' },
      tokenInfo: {},
      capture: {
        version: 2,
        registrationId: 'oidc_x',
        capturedAt: '2026-09-07T12:00:00.000Z',
        detailsChangedAtAtStart: null,
        outcome: 'success',
        identity: { id: 'person-9', sources: { id: 'idToken' } },
        claims: { sub: 'person-9' },
        replay: { sources: [{ source: 'idToken', claims: { sub: 'person-9' } }] },
      },
    })
    await act(async () => {
      screen.getByRole('button', { name: 'Enable sign-in' }).click()
    })
    expect(run).toHaveBeenCalledTimes(1)
    expect(await screen.findByText('Sign-in is enabled.')).toBeInTheDocument()
  })

  it('reports that the success action failed instead of closing the modal', async () => {
    const run = vi.fn(async () => {
      throw new Error('Could not enable sign-in.')
    })
    openOptions = {
      registrationId: 'oidc_x',
      successAction: { label: 'Enable sign-in', doneMessage: 'Sign-in is enabled.', run },
    }
    renderProbe()
    await startTestSignIn()
    await dispatchResult({
      ok: true,
      steps: [],
      claims: { sub: 'person-9' },
      allClaims: { sub: 'person-9' },
      tokenInfo: {},
      capture: {
        version: 2,
        registrationId: 'oidc_x',
        capturedAt: '2026-09-07T12:00:00.000Z',
        detailsChangedAtAtStart: null,
        outcome: 'success',
        identity: { id: 'person-9', sources: { id: 'idToken' } },
        claims: { sub: 'person-9' },
        replay: { sources: [{ source: 'idToken', claims: { sub: 'person-9' } }] },
      },
    })
    await act(async () => {
      screen.getByRole('button', { name: 'Enable sign-in' }).click()
    })
    expect(await screen.findByText('Could not enable sign-in.')).toBeInTheDocument()
    // The dialog stays open on the failure — an admin can retry or cancel.
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })
})
