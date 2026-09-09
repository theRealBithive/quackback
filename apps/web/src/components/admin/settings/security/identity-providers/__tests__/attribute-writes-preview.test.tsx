// @vitest-environment happy-dom
/**
 * `<AttributeWritesPreview>` — the "skipped: …" reasons an admin sees when a
 * mapped claim did not produce a written person-attribute value. This suite
 * targets the `type_mismatch` reason specifically: the preview names the
 * *shape* of the raw claim value that failed coercion (an array, or a plain
 * scalar), because "type mismatch" alone does not tell an admin what the IdP
 * actually sent. A claim whose value is `null` is classified as a missing
 * claim before it reaches this component, so there is no null shape to show.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { SsoTestCapture } from '@/lib/shared/sso-test-capture'
import { AttributeWritesPreview } from '../attribute-writes-preview'

interface FixtureAttribute {
  key: string
  type: 'string' | 'number' | 'boolean' | 'date' | 'currency'
  label: string
}

const { userAttributesRef } = vi.hoisted(() => ({
  userAttributesRef: { current: [] as FixtureAttribute[] },
}))

vi.mock('@/lib/client/hooks/use-user-attributes-queries', () => ({
  useUserAttributes: () => ({ data: userAttributesRef.current }),
}))

// The real button opens the shared test-sign-in modal via context; this
// preview only needs it to render, not to drive a test sign-in.
vi.mock('../../sso/test-sign-in-button', () => ({
  TestSignInButton: ({
    disabled,
    children,
  }: {
    disabled?: boolean
    children?: React.ReactNode
  }) => (
    <button type="button" disabled={disabled}>
      {children ?? 'Test sign-in'}
    </button>
  ),
}))

function makeCapture(claims: Record<string, unknown>): SsoTestCapture {
  return {
    registrationId: 'oidc_x',
    capturedAt: '2026-09-01T00:00:00.000Z',
    identity: { id: 'sub', sources: {} },
    claims: claims as SsoTestCapture['claims'],
  }
}

beforeEach(() => {
  userAttributesRef.current = []
})

describe('<AttributeWritesPreview> type-mismatch skip reason', () => {
  it('names the array shape when an array claim cannot coerce to the attribute type', () => {
    userAttributesRef.current = [{ key: 'department', type: 'number', label: 'Department' }]
    render(
      <AttributeWritesPreview
        capture={makeCapture({ roles: ['admin', 'ops'] })}
        registrationId="oidc_x"
        attributeRows={[{ claimPath: 'roles', attributeKey: 'department' }]}
        overrideExisting={false}
        syncOnSignIn={false}
        canTest={true}
      />
    )
    expect(screen.getByText(/skipped: type mismatch \(array\)/)).toBeInTheDocument()
  })

  it('names the scalar shape when a plain string claim cannot coerce to the attribute type', () => {
    userAttributesRef.current = [{ key: 'department', type: 'boolean', label: 'Department' }]
    render(
      <AttributeWritesPreview
        capture={makeCapture({ nickname: 'maybe' })}
        registrationId="oidc_x"
        attributeRows={[{ claimPath: 'nickname', attributeKey: 'department' }]}
        overrideExisting={false}
        syncOnSignIn={false}
        canTest={true}
      />
    )
    expect(screen.getByText(/skipped: type mismatch \(string\)/)).toBeInTheDocument()
  })
})
