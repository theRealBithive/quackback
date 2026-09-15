import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { ValidationError } from '@/lib/shared/errors'
import { assertHexColor, assertTrimmedName } from '../taxonomy'

/**
 * ## T — Taxonomy names, colours, slugs, positions
 * - T1 A taxonomy name is stored trimmed. An empty or whitespace-only name is
 *   rejected, as is a name longer than the limit (50 unless the entity says
 *   otherwise), each with the message the calling entity supplies, verbatim.
 * - T2 A colour is accepted only as `#` followed by six hex digits, either
 *   case; anything else is rejected with the caller's message.
 */

describe('assertTrimmedName', () => {
  it('trims and returns a valid name (T1)', () => {
    expect(assertTrimmedName('  Bug ', { required: 'Name is required', tooLong: 'too long' })).toBe(
      'Bug'
    )
  })

  it('rejects empty / whitespace with the call-site required message (T1)', () => {
    expect(() =>
      assertTrimmedName('   ', { required: 'PostTag name is required', tooLong: 'too long' })
    ).toThrow(new ValidationError('VALIDATION_ERROR', 'PostTag name is required'))
  })

  it('rejects over-length with the call-site tooLong message (T1)', () => {
    expect(() =>
      assertTrimmedName('x'.repeat(51), {
        required: 'required',
        tooLong: 'Name must be 50 characters or less',
      })
    ).toThrow(new ValidationError('VALIDATION_ERROR', 'Name must be 50 characters or less'))
  })

  it('honors a custom max length (T1)', () => {
    expect(assertTrimmedName('x'.repeat(60), { required: 'r', tooLong: 't' }, 60)).toHaveLength(60)
    expect(() =>
      assertTrimmedName('x'.repeat(61), { required: 'r', tooLong: 'too long' }, 60)
    ).toThrow(new ValidationError('VALIDATION_ERROR', 'too long'))
  })

  it('accepts exactly the default 50-char boundary and rejects 51 (T1)', () => {
    const at50 = 'x'.repeat(50)
    expect(assertTrimmedName(at50, { required: 'r', tooLong: 't' })).toBe(at50)
    expect(() => assertTrimmedName('x'.repeat(51), { required: 'r', tooLong: 't' })).toThrow(
      new ValidationError('VALIDATION_ERROR', 't')
    )
  })

  it('accepts exactly a custom max-length boundary and rejects one over it (T1)', () => {
    const at10 = 'y'.repeat(10)
    expect(assertTrimmedName(at10, { required: 'r', tooLong: 't' }, 10)).toBe(at10)
    expect(() => assertTrimmedName('y'.repeat(11), { required: 'r', tooLong: 't' }, 10)).toThrow(
      new ValidationError('VALIDATION_ERROR', 't')
    )
  })

  it('for any string and max length, returns the trimmed non-empty name or throws the caller message verbatim (T1)', () => {
    fc.assert(
      fc.property(
        fc.string({ maxLength: 80 }),
        fc.integer({ min: 1, max: 80 }),
        (raw, maxLength) => {
          const messages = { required: 'CALLER_REQUIRED_MSG', tooLong: 'CALLER_TOO_LONG_MSG' }
          const trimmed = raw.trim()

          if (!trimmed) {
            expect(() => assertTrimmedName(raw, messages, maxLength)).toThrow(
              new ValidationError('VALIDATION_ERROR', messages.required)
            )
          } else if (trimmed.length > maxLength) {
            expect(() => assertTrimmedName(raw, messages, maxLength)).toThrow(
              new ValidationError('VALIDATION_ERROR', messages.tooLong)
            )
          } else {
            const result = assertTrimmedName(raw, messages, maxLength)
            // Unguarded across this branch: whatever comes back is exactly the
            // trimmed input, never empty, never longer than the limit.
            expect(result).toBe(trimmed)
            expect(result.length).toBeGreaterThan(0)
            expect(result.length).toBeLessThanOrEqual(maxLength)
          }
        }
      )
    )
  })
})

describe('assertHexColor', () => {
  it('accepts #rrggbb (T2)', () => {
    expect(assertHexColor('#3b82f6', 'bad')).toBe('#3b82f6')
  })

  it('rejects non-hex with the call-site message (T2)', () => {
    expect(() => assertHexColor('blue', 'Color must be a valid hex color (e.g., #6b7280)')).toThrow(
      new ValidationError('VALIDATION_ERROR', 'Color must be a valid hex color (e.g., #6b7280)')
    )
  })

  const hexDigit = fc.constantFrom(...'0123456789abcdefABCDEF'.split(''))
  const validColor = fc
    .array(hexDigit, { minLength: 6, maxLength: 6 })
    .map((digits) => `#${digits.join('')}`)

  it('accepts every well-formed #rrggbb, upper- or lower-case, unchanged (T2)', () => {
    fc.assert(
      fc.property(validColor, (color) => {
        expect(assertHexColor(color, 'unreachable')).toBe(color)
      })
    )
  })

  it('rejects 5-digit, 7-digit, missing-#, non-hex-char, and #rrggbbaa near-misses with the caller message (T2)', () => {
    const fiveDigits = fc
      .array(hexDigit, { minLength: 5, maxLength: 5 })
      .map((d) => `#${d.join('')}`)
    const sevenDigits = fc
      .array(hexDigit, { minLength: 7, maxLength: 7 })
      .map((d) => `#${d.join('')}`)
    const missingHash = fc.array(hexDigit, { minLength: 6, maxLength: 6 }).map((d) => d.join(''))
    const nonHexChar = fc
      .tuple(
        fc.array(hexDigit, { minLength: 5, maxLength: 5 }),
        fc.constantFrom('g', 'z', '#', ' ', '-')
      )
      .map(([digits, bad]) => `#${bad}${digits.join('')}`)
    const rgbaEightDigits = fc
      .array(hexDigit, { minLength: 8, maxLength: 8 })
      .map((d) => `#${d.join('')}`)

    fc.assert(
      fc.property(
        fc.oneof(fiveDigits, sevenDigits, missingHash, nonHexChar, rgbaEightDigits),
        (color) => {
          expect(() => assertHexColor(color, 'CALLER_COLOR_MSG')).toThrow(
            new ValidationError('VALIDATION_ERROR', 'CALLER_COLOR_MSG')
          )
        }
      )
    )
  })
})
