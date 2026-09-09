// @vitest-environment happy-dom
/**
 * `<ManualEndpointsFields>` — the escape hatch for an IdP with no discovery
 * document, rendered only for the "other" kind inside Connection options.
 * `<IdpDiscoveryFields>` itself is covered end-to-end through
 * `provider-detail-page.test.tsx` and `provider-create-page.test.tsx`; this
 * suite only fills the one gap those pages never reach: typing into a
 * manual endpoint field.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ManualEndpointsFields, EMPTY_MANUAL_ENDPOINTS } from '../idp-discovery-fields'

describe('<ManualEndpointsFields>', () => {
  it('reports the authorization URL an admin types, leaving the other fields untouched', () => {
    const onChange = vi.fn()
    render(
      <ManualEndpointsFields values={EMPTY_MANUAL_ENDPOINTS} disabled={false} onChange={onChange} />
    )
    fireEvent.change(screen.getByLabelText('Authorization URL'), {
      target: { value: 'https://idp.example/authorize' },
    })
    expect(onChange).toHaveBeenCalledWith({ authorizationUrl: 'https://idp.example/authorize' })
  })

  it('reports the JWKS URI an admin types', () => {
    const onChange = vi.fn()
    render(
      <ManualEndpointsFields values={EMPTY_MANUAL_ENDPOINTS} disabled={false} onChange={onChange} />
    )
    fireEvent.change(screen.getByLabelText('JWKS URI'), {
      target: { value: 'https://idp.example/.well-known/jwks.json' },
    })
    expect(onChange).toHaveBeenCalledWith({ jwksUri: 'https://idp.example/.well-known/jwks.json' })
  })
})
