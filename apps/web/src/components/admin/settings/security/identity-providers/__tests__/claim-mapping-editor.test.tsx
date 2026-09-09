// @vitest-environment happy-dom
/**
 * <RoleMappingRulesBody> — the role-rule editor embedded in the Add/Edit
 * mapping dialog (`ClaimRowDialog`) and in the User details editor, both of
 * which cover the surrounding flows; this suite exercises the rule list
 * itself: reordering, removing a rule, editing the claim path, and the
 * reapply-on-sign-in switch.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { RoleMappingRulesBody } from '../claim-mapping-editor'
import type { RoleMapping } from '../provider-shared'

beforeAll(() => {
  // Radix Select internals reach for pointer-capture APIs happy-dom does not
  // implement; same stub used across this directory's suites.
  Element.prototype.scrollIntoView = vi.fn()
  Element.prototype.hasPointerCapture = vi.fn(() => false)
  Element.prototype.setPointerCapture = vi.fn()
  Element.prototype.releasePointerCapture = vi.fn()
})

vi.mock('../../sso/use-sso-test-sign-in', () => ({
  useSsoTestSignIn: () => ({ open: vi.fn(), lastSuccess: null, lastCapture: null }),
}))

vi.mock('../../sso/test-sign-in-button', () => ({
  TestSignInButton: () => <button type="button">Test sign-in</button>,
}))

function twoRules(): RoleMapping {
  return {
    claimPath: 'groups',
    rules: [
      { whenContains: 'engineering', role: 'member' },
      { whenContains: 'platform-admins', role: 'admin' },
    ],
  }
}

function renderRules(mapping: RoleMapping) {
  const onChange = vi.fn()
  render(
    <RoleMappingRulesBody
      mapping={mapping}
      disabled={false}
      registrationId="oidc_x"
      canTest={false}
      onChange={onChange}
    />
  )
  return onChange
}

describe('RoleMappingRulesBody', () => {
  it('moves a rule down past the one below it', () => {
    const mapping = twoRules()
    const onChange = renderRules(mapping)
    fireEvent.click(screen.getByRole('button', { name: 'Move rule 1 down' }))
    expect(onChange).toHaveBeenCalledWith({
      ...mapping,
      rules: [mapping.rules[1], mapping.rules[0]],
    })
  })

  it('moves a rule up past the one above it', () => {
    const mapping = twoRules()
    const onChange = renderRules(mapping)
    fireEvent.click(screen.getByRole('button', { name: 'Move rule 2 up' }))
    expect(onChange).toHaveBeenCalledWith({
      ...mapping,
      rules: [mapping.rules[1], mapping.rules[0]],
    })
  })

  it('removes one rule and keeps the other in place', () => {
    const mapping = twoRules()
    const onChange = renderRules(mapping)
    fireEvent.click(screen.getByRole('button', { name: 'Remove rule 1' }))
    expect(onChange).toHaveBeenCalledWith({ ...mapping, rules: [mapping.rules[1]] })
  })

  it('updates the claim path an admin types', () => {
    const mapping = twoRules()
    const onChange = renderRules(mapping)
    fireEvent.click(screen.getByRole('combobox', { name: 'Role claim path' }))
    fireEvent.change(screen.getByPlaceholderText('Search or type…'), {
      target: { value: 'realm_access.roles' },
    })
    fireEvent.click(screen.getByText('Use "realm_access.roles"'))
    expect(onChange).toHaveBeenCalledWith({ ...mapping, claimPath: 'realm_access.roles' })
  })

  it('turns on reapplying roles on every sign-in', () => {
    const mapping = twoRules()
    const onChange = renderRules(mapping)
    fireEvent.click(screen.getByRole('switch', { name: 'Reapply roles on every sign-in' }))
    expect(onChange).toHaveBeenCalledWith({ ...mapping, syncOnEverySignIn: true })
  })
})
