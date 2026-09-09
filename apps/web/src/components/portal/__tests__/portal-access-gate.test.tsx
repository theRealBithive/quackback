// @vitest-environment happy-dom
import { render, screen, act, fireEvent } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach } from 'vitest'

const navigate = vi.fn()
const invalidate = vi.fn().mockResolvedValue(undefined)
vi.mock('@tanstack/react-router', async (orig) => ({
  ...(await orig<typeof import('@tanstack/react-router')>()),
  useRouter: () => ({ navigate, invalidate }),
}))

// Capture only GateCard's broadcast onSuccess (no `enabled` prop).
let broadcastOnSuccess: (() => void) | undefined
vi.mock('@/lib/client/hooks/use-auth-broadcast', () => ({
  useAuthBroadcast: (opts: { onSuccess?: () => void; enabled?: boolean }) => {
    if (!('enabled' in opts)) broadcastOnSuccess = opts.onSuccess
  },
  postAuthSuccess: vi.fn(),
}))

const invalidateQueries = vi.fn().mockResolvedValue(undefined)
const removeQueries = vi.fn()
vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries, removeQueries }),
}))

vi.mock('@/lib/client/auth-client', () => ({ signOut: vi.fn() }))

// Capture the props the gate hands the inline form (mode etc.).
let formProps: Record<string, unknown> = {}
vi.mock('@/components/auth/portal-auth-form-inline', () => ({
  PortalAuthFormInline: (props: Record<string, unknown>) => {
    formProps = props
    return <div data-testid="auth-form-body">FORM_BODY</div>
  },
}))

vi.mock('@/lib/client/post-auth-navigation', () => ({ navigateAfterAuth: vi.fn() }))

import { PortalAccessGate } from '../portal-access-gate'
import { navigateAfterAuth } from '@/lib/client/post-auth-navigation'
import { signOut } from '@/lib/client/auth-client'
import { VIEWER_SCOPED_PORTAL_QUERY_KEYS } from '@/lib/client/queries/portal'

const baseProps = {
  reason: 'unauthenticated' as const,
  workspaceName: 'Acme',
  logoUrl: null,
  authConfig: { found: true, oauth: { password: true }, oidcProviders: undefined },
  themeStyles: '',
  customCss: '',
  userEmail: null,
  locale: 'en' as const,
}

beforeEach(() => {
  navigate.mockClear()
  invalidate.mockClear()
  invalidateQueries.mockClear()
  removeQueries.mockClear()
  vi.mocked(signOut).mockClear()
  vi.mocked(navigateAfterAuth).mockClear()
  broadcastOnSuccess = undefined
  formProps = {}
})

describe('PortalAccessGate — inline auth form', () => {
  it('renders the auth form directly for an unauthenticated visitor, with no intermediate button', () => {
    render(<PortalAccessGate {...baseProps} />)
    expect(screen.getByTestId('auth-form-body')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /sign in \/ register/i })).not.toBeInTheDocument()
  })

  it('does NOT render the auth form for an unauthorized visitor', () => {
    render(<PortalAccessGate {...baseProps} reason="unauthorized" userEmail="alice@example.com" />)
    expect(screen.queryByTestId('auth-form-body')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /sign out/i })).toBeInTheDocument()
  })

  it('signing out from the unauthorized screen drops the viewer-scoped portal caches before the loaders re-run', async () => {
    render(<PortalAccessGate {...baseProps} reason="unauthorized" userEmail="alice@example.com" />)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /sign out/i }))
    })

    expect(signOut).toHaveBeenCalledTimes(1)
    const removedKeys = removeQueries.mock.calls.map(
      (call) => (call as unknown as [{ queryKey: unknown[] }])[0].queryKey
    )
    expect(removedKeys).toEqual(expect.arrayContaining([...VIEWER_SCOPED_PORTAL_QUERY_KEYS]))
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['votedPosts'] })
    expect(invalidate).toHaveBeenCalledTimes(1)
    // The caches must be gone before the loaders re-run, or ensureQueryData
    // hands the next viewer the previous session's payload.
    const lastRemoval = Math.max(...removeQueries.mock.invocationCallOrder)
    expect(lastRemoval).toBeLessThan(invalidate.mock.invocationCallOrder[0])
  })

  it('seeds the form mode from autoOpenSignin', () => {
    render(<PortalAccessGate {...baseProps} autoOpenSignin="signup" />)
    expect(formProps.mode).toBe('signup')
  })

  it('defaults the form mode to login when autoOpenSignin is absent', () => {
    render(<PortalAccessGate {...baseProps} />)
    expect(formProps.mode).toBe('login')
  })

  it('ignores autoOpenSignin=signup and drops the switch link when password auth is off', () => {
    render(
      <PortalAccessGate
        {...baseProps}
        authConfig={{ found: true, oauth: { password: false, magicLink: true } }}
        autoOpenSignin="signup"
      />
    )
    expect(formProps.mode).toBe('login')
    expect(formProps.onModeSwitch).toBeUndefined()
  })

  it('also collapses to login when signups are closed', () => {
    render(
      <PortalAccessGate
        {...baseProps}
        authConfig={{ found: true, oauth: { password: true }, openSignup: false }}
        autoOpenSignin="signup"
      />
    )
    expect(formProps.mode).toBe('login')
    expect(formProps.onModeSwitch).toBeUndefined()
  })

  it('keeps the switch link when sign-up is a distinct flow', () => {
    render(<PortalAccessGate {...baseProps} autoOpenSignin="signup" />)
    expect(formProps.mode).toBe('signup')
    expect(formProps.onModeSwitch).toBeTypeOf('function')
  })
})

describe('PortalAccessGate — decorative backdrop', () => {
  it('renders an inert, screen-reader-hidden faux board (nothing focusable)', () => {
    render(<PortalAccessGate {...baseProps} />)
    const backdrop = screen.getByTestId('portal-gate-backdrop')
    expect(backdrop).toHaveAttribute('aria-hidden', 'true')
    // The fake board only exists to suggest a real portal sits behind the wall.
    // It must never be tabbable or announced to assistive tech.
    expect(
      backdrop.querySelectorAll('button, a, input, select, textarea, [tabindex]')
    ).toHaveLength(0)
  })
})

describe('PortalAccessGate — callbackUrl', () => {
  it('navigates to callbackUrl after a successful sign-in', async () => {
    render(<PortalAccessGate {...baseProps} callbackUrl="/admin" />)
    await act(async () => {
      broadcastOnSuccess?.()
      await Promise.resolve()
    })
    // navigateAfterAuth is called — not router.navigate directly.
    expect(vi.mocked(navigateAfterAuth)).toHaveBeenCalledWith('/admin', expect.any(Function))
    expect(navigate).not.toHaveBeenCalled()

    // Invoke the clientNavigate callback to cover the portal-local branch.
    const clientNavigate = vi.mocked(navigateAfterAuth).mock.calls[0][1]
    await act(async () => {
      clientNavigate()
      await Promise.resolve()
    })
    expect(invalidate).toHaveBeenCalled()
    expect(navigate).toHaveBeenCalledWith({ to: '/admin' })
  })

  it('does not navigate when no callbackUrl is given', async () => {
    render(<PortalAccessGate {...baseProps} />)
    await act(async () => {
      broadcastOnSuccess?.()
      await Promise.resolve()
    })
    expect(invalidate).toHaveBeenCalled()
    expect(vi.mocked(navigateAfterAuth)).not.toHaveBeenCalled()
    expect(navigate).not.toHaveBeenCalled()
  })
})
