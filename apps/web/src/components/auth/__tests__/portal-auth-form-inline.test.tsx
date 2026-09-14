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
import type { ReactNode } from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render as rtlRender, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { IntlProvider } from 'react-intl'

// Shared spy so tests can assert navigate was (or was not) called.
const navigate = vi.fn()

// lookup is only invoked on Continue; the Stage-1 render under test never calls it.
// Shared spy so tests can control what lookupAuthMethods resolves to.
const lookupFnSpy = vi.fn()
vi.mock('@tanstack/react-start', () => ({ useServerFn: () => lookupFnSpy }))

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    to,
    children,
    className,
  }: {
    to: string
    children: React.ReactNode
    className?: string
  }) => (
    <a href={to} className={className}>
      {children}
    </a>
  ),
  useRouter: () => ({ navigate }),
}))

vi.mock('@/lib/server/functions/auth', () => ({
  lookupAuthMethodsFn: vi.fn(),
}))

vi.mock('@/lib/client/auth-client', () => ({
  authClient: {
    signIn: { email: vi.fn(), emailOtp: vi.fn(), oauth2: vi.fn(), social: vi.fn() },
    signUp: { email: vi.fn() },
    requestPasswordReset: vi.fn(),
  },
}))

// Control which providers Stage 1 shows; the form renders its own OAuthButton.
const getEnabledOAuthProvidersMock = vi.fn(() => [] as Array<Record<string, unknown>>)
vi.mock('@/components/auth/oauth-buttons', () => ({
  getEnabledOAuthProviders: () => getEnabledOAuthProvidersMock(),
  getOAuthRedirectUrl: vi.fn(),
  hasRoutableOidcProvider: () => false,
}))

// usePopupTracker opens a BroadcastChannel on mount — stub the whole module.
vi.mock('@/lib/client/hooks/use-auth-broadcast', () => ({
  usePopupTracker: () => ({
    trackPopup: vi.fn(),
    clearPopup: vi.fn(),
    hasPopup: () => false,
    focusPopup: vi.fn(),
  }),
  openAuthPopup: vi.fn(),
  postAuthSuccess: vi.fn(),
  postAuthError: vi.fn(),
  useAuthBroadcast: vi.fn(),
}))

// OtpCodeStep imports input-otp, which schedules real setTimeouts on mount.
vi.mock('@/components/ui/input-otp', () => ({
  InputOTP: (props: Record<string, unknown>) => <input {...(props as object)} />,
  InputOTPGroup: ({ children }: { children?: ReactNode }) => <>{children}</>,
  InputOTPSlot: () => null,
  InputOTPSeparator: () => null,
  InputOTPSixSlots: () => null,
}))

import { PortalAuthFormInline } from '../portal-auth-form-inline'
import { postAuthSuccess } from '@/lib/client/hooks/use-auth-broadcast'
import { authClient } from '@/lib/client/auth-client'

function render(ui: React.ReactElement) {
  return rtlRender(
    <IntlProvider locale="en" defaultLocale="en" messages={{}}>
      {ui}
    </IntlProvider>
  )
}

function renderForm(props: React.ComponentProps<typeof PortalAuthFormInline>) {
  return render(<PortalAuthFormInline {...props} />)
}

describe('PortalAuthFormInline — OAuth-only Stage 1 (#231)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getEnabledOAuthProvidersMock.mockReturnValue([])
  })
  afterEach(() => cleanup())

  // With both email methods off, the email field at Stage 1 has nowhere to
  // route, so only the OAuth provider buttons should render.
  it('hides the email field, divider, and create-account when only OAuth is enabled', () => {
    getEnabledOAuthProvidersMock.mockReturnValue([
      { id: 'custom-oidc', name: 'Custom OIDC', type: 'generic-oauth' },
    ])
    render(
      <PortalAuthFormInline
        mode="login"
        authConfig={{
          found: true,
          oauth: { password: false, magicLink: false, 'custom-oidc': true },
        }}
        onModeSwitch={() => {}}
      />
    )
    expect(screen.getByRole('button', { name: /sign in with custom oidc/i })).toBeInTheDocument()
    expect(screen.queryByLabelText(/email/i)).not.toBeInTheDocument()
    expect(screen.queryByText('or')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /create an account/i })).not.toBeInTheDocument()
  })

  it('shows a no-methods message when neither email methods nor OAuth are configured', () => {
    render(
      <PortalAuthFormInline
        mode="login"
        authConfig={{ found: true, oauth: { password: false, magicLink: false } }}
      />
    )
    expect(screen.queryByLabelText(/email/i)).not.toBeInTheDocument()
    expect(screen.getByText(/no sign-in methods are configured/i)).toBeInTheDocument()
  })

  // The OAuth tiles set `error` on popup/redirect failure; that error must show
  // even in OAuth-only setups where the email form (its old home) is hidden.
  it('surfaces an OAuth provider error when the email form is hidden', async () => {
    getEnabledOAuthProvidersMock.mockReturnValue([
      { id: 'custom-oidc', name: 'Custom OIDC', type: 'generic-oauth' },
    ])
    const broadcast = await import('@/lib/client/hooks/use-auth-broadcast')
    vi.mocked(broadcast.openAuthPopup).mockReturnValueOnce({
      location: { href: '' },
      close: vi.fn(),
    } as unknown as Window)
    // getOAuthRedirectUrl (mocked) returns undefined → initiateOAuth's error path.
    render(
      <PortalAuthFormInline
        mode="login"
        authConfig={{
          found: true,
          oauth: { password: false, magicLink: false, 'custom-oidc': true },
        }}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: /sign in with custom oidc/i }))
    expect(await screen.findByText(/failed to initiate sign in/i)).toBeInTheDocument()
  })

  it('renders the uploaded provider logo on the OAuth tile', () => {
    getEnabledOAuthProvidersMock.mockReturnValue([
      {
        id: 'oidc_acme',
        name: 'Acme',
        type: 'generic-oauth',
        logoUrl: 'https://cdn.test/idp-logos/acme.png',
      },
    ])
    render(
      <PortalAuthFormInline
        mode="login"
        authConfig={{ found: true, oauth: { password: false, magicLink: false, oidc_acme: true } }}
      />
    )
    const button = screen.getByRole('button', { name: /sign in with acme/i })
    expect(button.querySelector('img')).toHaveAttribute(
      'src',
      'https://cdn.test/idp-logos/acme.png'
    )
  })

  it('falls back to no image when a provider has no logo and no bundled icon', () => {
    getEnabledOAuthProvidersMock.mockReturnValue([
      { id: 'oidc_acme', name: 'Acme', type: 'generic-oauth', logoUrl: null },
    ])
    render(
      <PortalAuthFormInline
        mode="login"
        authConfig={{ found: true, oauth: { password: false, magicLink: false, oidc_acme: true } }}
      />
    )
    expect(
      screen.getByRole('button', { name: /sign in with acme/i }).querySelector('img')
    ).toBeNull()
  })
})

describe('PortalAuthFormInline — recovery-code break-glass link', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getEnabledOAuthProvidersMock.mockReturnValue([])
  })
  afterEach(() => cleanup())

  // The recovery link belongs in SSO views only — it must NOT appear in the
  // generic password/email stage even when the callbackUrl is team-bound.
  it('does not show the recovery-code link in the password/email stage even when team-bound', () => {
    renderForm({ mode: 'login', callbackUrl: '/admin' })
    expect(screen.queryByRole('link', { name: /use a recovery code/i })).toBeNull()
  })

  it('hides the recovery-code link for a non-team callbackUrl', () => {
    renderForm({ mode: 'login', callbackUrl: '/roadmap' })
    expect(screen.queryByRole('link', { name: /use a recovery code/i })).toBeNull()
  })

  it('hides the recovery-code link when callbackUrl is undefined', () => {
    renderForm({ mode: 'login' })
    expect(screen.queryByRole('link', { name: /use a recovery code/i })).toBeNull()
  })

  // Regression: SSO-only workspaces (password + magic-link both disabled) must
  // still surface the break-glass link in Stage 1 when the context is team-bound.
  it('shows the recovery-code link in an SSO-only Stage 1 with a team callbackUrl', () => {
    getEnabledOAuthProvidersMock.mockReturnValue([
      { id: 'test-oidc', name: 'Test OIDC', type: 'generic-oauth' },
    ])
    renderForm({
      mode: 'login',
      callbackUrl: '/admin',
      authConfig: {
        found: true,
        oauth: { password: false, magicLink: false },
        oidcProviders: [{ id: 'test-oidc', name: 'Test OIDC' }],
      },
    })
    expect(screen.getByRole('link', { name: /use a recovery code/i })).toHaveAttribute(
      'href',
      '/auth/recovery'
    )
  })

  // Positive: the link must also appear in the sso-default view reached after
  // Continue when lookupAuthMethods resolves to { kind: 'sso-default' }.
  it('shows the recovery-code link in the sso-default view with a team callbackUrl', async () => {
    lookupFnSpy.mockResolvedValueOnce({ kind: 'sso-default', providerId: 'sso' })
    renderForm({ mode: 'login', callbackUrl: '/admin' })
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'user@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: /continue/i }))
    await waitFor(() => {
      expect(screen.getByRole('link', { name: /use a recovery code/i })).toBeInTheDocument()
    })
    expect(screen.getByRole('link', { name: /use a recovery code/i })).toHaveAttribute(
      'href',
      '/auth/recovery'
    )
  })
})

describe('PortalAuthFormInline — post-sign-in navigation', () => {
  // Stub fetch so the invitation flow resolves immediately to Stage 2.
  const mockInvitation = {
    id: 'inv_test',
    email: 'user@example.com',
    role: null,
    workspaceName: 'Acme',
    inviterName: null,
  }

  beforeEach(() => {
    vi.clearAllMocks()
    navigate.mockClear()
    getEnabledOAuthProvidersMock.mockReturnValue([])
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => mockInvitation,
    } as Response)
  })
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('calls postAuthSuccess but does NOT call router.navigate on successful password sign-in', async () => {
    vi.mocked(authClient.signIn.email).mockResolvedValueOnce({ data: {}, error: null } as never)

    renderForm({ mode: 'login', invitationId: 'inv_test', callbackUrl: '/admin' })

    // Wait for invitation loader to resolve and render the credentials form.
    const passwordInput = await screen.findByLabelText(/password/i)
    fireEvent.change(passwordInput, { target: { value: 'correct-password' } })
    fireEvent.click(screen.getByRole('button', { name: /^sign in$/i }))

    await waitFor(() => {
      expect(vi.mocked(postAuthSuccess)).toHaveBeenCalled()
    })
    // Navigation is solely the dialog opener's responsibility via the broadcast.
    expect(navigate).not.toHaveBeenCalled()
  })

  // The success path cleared `loadingAction` nowhere: only `catch` did. Inside a
  // dialog that closes on success nobody saw it; on a page that stays mounted
  // the button spins forever after a sign-in that already worked, and every
  // control on the form stays disabled behind `loadingAction !== null`.
  it('stops spinning once a password sign-in succeeds', async () => {
    vi.mocked(authClient.signIn.email).mockResolvedValueOnce({ data: {}, error: null } as never)

    renderForm({ mode: 'login', invitationId: 'inv_test', callbackUrl: '/admin' })

    const passwordInput = await screen.findByLabelText(/password/i)
    fireEvent.change(passwordInput, { target: { value: 'correct-password' } })
    fireEvent.click(screen.getByRole('button', { name: /^sign in$/i }))

    await waitFor(() => {
      expect(vi.mocked(postAuthSuccess)).toHaveBeenCalled()
    })
    await waitFor(() => {
      expect(screen.queryByText(/signing in\.\.\./i)).toBeNull()
    })
    expect(screen.getByRole('button', { name: /^sign in$/i })).not.toBeDisabled()
    expect(passwordInput).not.toBeDisabled()
  })
})

/**
 * Better Auth 1.7 retired `signIn.oauth2`; a generic OIDC provider now signs
 * in through the same `signIn.social` as a built-in one, keyed by its
 * registration id. `startOidcSignIn` runs for real here — mocking the wrapper
 * would cover the call site while asserting nothing about which library
 * entry point the sign-in actually reaches.
 */
describe('PortalAuthFormInline — OIDC sign-in through Better Auth 1.7', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getEnabledOAuthProvidersMock.mockReturnValue([])
  })
  afterEach(() => cleanup())

  it('routes a domain-routed address straight to its provider on Continue (M8)', async () => {
    lookupFnSpy.mockResolvedValueOnce({ kind: 'sso-redirect', providerId: 'oidc_entra' })
    renderForm({ mode: 'login', callbackUrl: '/admin' })

    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'user@acme.example' } })
    fireEvent.click(screen.getByRole('button', { name: /continue/i }))

    await waitFor(() => expect(authClient.signIn.social).toHaveBeenCalled())
    expect(authClient.signIn.social).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'oidc_entra',
        callbackURL: '/admin',
        // The typed address is carried so the IdP does not ask for it again.
        loginHint: 'user@acme.example',
      })
    )
    // A failed callback has to land back on our own sign-in surface.
    const [args] = vi.mocked(authClient.signIn.social).mock.calls[0] as [
      Record<string, unknown>,
      ...unknown[],
    ]
    expect(args.errorCallbackURL).toBe('/?auth=signin&callbackUrl=%2Fadmin')
  })

  it('starts the workspace provider from the sso-default screen (M8)', async () => {
    lookupFnSpy.mockResolvedValueOnce({ kind: 'sso-default', providerId: 'sso' })
    renderForm({ mode: 'login', callbackUrl: '/admin' })

    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'user@acme.example' } })
    fireEvent.click(screen.getByRole('button', { name: /continue/i }))

    const ssoButton = await screen.findByRole('button', { name: /continue with sso/i })
    // Nothing starts until the person asks for it on this screen.
    expect(authClient.signIn.social).not.toHaveBeenCalled()

    fireEvent.click(ssoButton)

    await waitFor(() => expect(authClient.signIn.social).toHaveBeenCalled())
    expect(authClient.signIn.social).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'sso',
        callbackURL: '/admin',
        loginHint: 'user@acme.example',
      })
    )
  })
})
