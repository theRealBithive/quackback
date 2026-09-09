// @vitest-environment happy-dom
/**
 * `<ClaimPathInput>` and `useClaimSuggestions` with `suggestionsFor` left at
 * its default ('role'): the only production call site
 * (`claim-attribute-mapping-editor.tsx`) always passes `suggestionsFor="attribute"`,
 * so the role/group-suggestion branch (array-of-string claim paths via
 * `deriveClaimSuggestions`) and the standalone `useClaimSuggestions` hook are
 * exercised here directly rather than through that editor.
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest'
import { render, screen, fireEvent, renderHook } from '@testing-library/react'
import type { SsoTestCapture } from '@/lib/shared/sso-test-capture'
import { ClaimPathInput, useClaimSuggestions } from '../claim-path-input'

beforeAll(() => {
  // Radix Popover/cmdk internals reach for pointer-capture APIs happy-dom
  // does not implement; same stub as provider-detail-page.test.tsx.
  Element.prototype.scrollIntoView = vi.fn()
  Element.prototype.hasPointerCapture = vi.fn(() => false)
  Element.prototype.setPointerCapture = vi.fn()
  Element.prototype.releasePointerCapture = vi.fn()
})

const { lastSuccessRef } = vi.hoisted(() => ({
  lastSuccessRef: { current: null as SsoTestCapture | null },
}))

vi.mock('../../sso/use-sso-test-sign-in', () => ({
  useSsoTestSignIn: () => ({ open: vi.fn(), lastSuccess: lastSuccessRef.current }),
}))

function makeCapture(claims: Record<string, unknown>, registrationId = 'oidc_x'): SsoTestCapture {
  return {
    registrationId,
    capturedAt: '2026-09-01T00:00:00.000Z',
    identity: { id: 'sub', sources: {} },
    claims: claims as SsoTestCapture['claims'],
  }
}

beforeEach(() => {
  lastSuccessRef.current = null
})

describe('<ClaimPathInput> role/group suggestions (suggestionsFor left at default)', () => {
  it('offers the array-valued claim paths from a matching fixture', () => {
    const onChange = vi.fn()
    render(
      <ClaimPathInput
        value=""
        onChange={onChange}
        registrationId="oidc_x"
        canTest={true}
        ariaLabel="Claim path"
        capture={makeCapture({ groups: ['admin', 'viewer'], display_name: 'Ada' })}
      />
    )

    fireEvent.click(screen.getByRole('combobox', { name: 'Claim path' }))
    // `display_name` is a scalar claim and deriveClaimSuggestions only ever
    // records array-of-string leaves, so only `groups` is offered.
    expect(screen.getByText('groups')).toBeInTheDocument()
    expect(screen.queryByText('display_name')).not.toBeInTheDocument()

    fireEvent.click(screen.getByText('groups'))
    expect(onChange).toHaveBeenCalledWith('groups')
  })

  it('offers no suggestions when the test sign-in was for a different provider', () => {
    render(
      <ClaimPathInput
        value=""
        onChange={vi.fn()}
        registrationId="oidc_x"
        canTest={true}
        ariaLabel="Claim path"
        capture={makeCapture({ groups: ['admin'] }, 'oidc_other')}
      />
    )
    fireEvent.click(screen.getByRole('combobox', { name: 'Claim path' }))
    expect(screen.getByText(/Run a test sign-in to discover/)).toBeInTheDocument()
  })
})

describe('useClaimSuggestions', () => {
  it('returns null when no test sign-in fixture exists for this provider', () => {
    const { result } = renderHook(() => useClaimSuggestions('oidc_x'))
    expect(result.current).toBeNull()
  })

  it('derives the array-claim suggestions from the session fixture when one matches', () => {
    lastSuccessRef.current = makeCapture({ groups: ['admin', 'viewer'] })
    const { result } = renderHook(() => useClaimSuggestions('oidc_x'))
    expect(result.current?.paths).toEqual(['groups'])
  })
})
