/**
 * normalizeAttributeKey is exercised indirectly by the A2 example in
 * attribute-definition-rulebook.test.ts. This suite adds the general property the
 * contract promises (contract-c.md, A2): the normalised key has no leading/trailing
 * whitespace, no uppercase letters, no whitespace characters at all, and normalising
 * is idempotent.
 *
 * Generator: `fc.string()` reaches arbitrary unicode strings, including empty,
 * whitespace-only, mixed-case, and already-normalised input.
 */
import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import { normalizeAttributeKey } from '../normalize-attribute-key'

describe('normalizeAttributeKey', () => {
  it('has no leading/trailing whitespace, no uppercase letters, no whitespace at all, and is idempotent', () => {
    fc.assert(
      fc.property(fc.string(), (raw) => {
        const normalized = normalizeAttributeKey(raw)
        expect(normalized).toBe(normalized.trim())
        expect(normalized).toBe(normalized.toLowerCase())
        expect(/\s/.test(normalized)).toBe(false)
        expect(normalizeAttributeKey(normalized)).toBe(normalized)
      })
    )
  })

  // (A2) A run of inner whitespace collapses to ONE underscore, not one
  // underscore per whitespace character. The property above cannot see this:
  // "plan__tier" (one underscore per space) satisfies "no whitespace",
  // "lowercase", "trimmed" and "idempotent" exactly as well as "plan_tier"
  // does, so only a concrete example pins the collapsing behaviour.
  it('(A2) collapses a run of inner whitespace into a single underscore', () => {
    expect(normalizeAttributeKey('Plan  Tier')).toBe('plan_tier')
    expect(normalizeAttributeKey('Plan\t Tier')).toBe('plan_tier')
  })
})
