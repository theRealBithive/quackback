/**
 * The one shape check every unsubscribe entry point shares.
 *
 * Contract (upstream #687), verbatim:
 *
 *   U1 Opening an unsubscribe link never unsubscribes anyone. It shows what would happen and asks for confirmation.
 *   U2 The unsubscribe happens only on an explicit confirmation, or on a one-click request from the mail provider.
 *   U3 A malformed, unknown, used or expired token shows the expired-link page, never a server error.
 *   U4 A one-click request in the RFC 8058 form is answered with success for every token, whether live, used, unknown or malformed. A request without the one-click body is refused. A body larger than 1 KB is refused after reading no more than that.
 *   U5 A token is spent only once the opt-out has actually happened. If the opt-out fails, the link keeps working and a retry succeeds exactly once.
 *   U6 Unsubscribing from the changelog also stops the changelog mail that reaches a person through posts they follow, even if they never subscribed to the changelog.
 *   U7 Every notification email that has an unsubscribe link carries List-Unsubscribe. It offers one-click only when the link is HTTPS. An email without a link carries neither header.
 *   U8 The unsubscribe page is in the language the rest of the site resolved for the request, in all nine languages, and the German addresses the reader formally.
 *   U9 The unsubscribe page's strings are not loaded into the portal or the widget.
 *
 * This module holds U3 for the shape check: a link that arrives rewritten,
 * truncated or guessed is told apart from a minted one without ever throwing,
 * and a minted one is never mistaken for a malformed one (which would break
 * U2 for every real link).
 */
import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { isUnsubscribeToken } from '../unsubscribe-token'

describe('isUnsubscribeToken', () => {
  it('(U3) accepts every token the product mints', () => {
    fc.assert(
      fc.property(fc.uuid({ version: 4 }), (token) => {
        expect(isUnsubscribeToken(token)).toBe(true)
      })
    )
    expect(isUnsubscribeToken(crypto.randomUUID())).toBe(true)
  })

  it('(U3) answers any input at all with a yes or no, never by throwing', () => {
    fc.assert(
      fc.property(fc.anything(), (input) => {
        expect(typeof isUnsubscribeToken(input)).toBe('boolean')
      })
    )
  })

  it('(U3) refuses anything that is not a string', () => {
    fc.assert(
      fc.property(
        fc.anything().filter((input) => typeof input !== 'string'),
        (input) => {
          expect(isUnsubscribeToken(input)).toBe(false)
        }
      )
    )
  })

  it('(U3) refuses a minted token that was truncated or had text appended', () => {
    fc.assert(
      fc.property(
        fc.uuid({ version: 4 }),
        fc.integer({ min: 0, max: 35 }),
        fc.string({ minLength: 1, maxLength: 8 }),
        (token, keep, appended) => {
          expect(isUnsubscribeToken(token.slice(0, keep))).toBe(false)
          expect(isUnsubscribeToken(token + appended)).toBe(false)
        }
      )
    )
  })

  it('(U3) refuses a string that only looks like a UUID', () => {
    // Passes a loose hex pattern; the version nibble is 0.
    expect(isUnsubscribeToken('12345678-1234-0234-8234-123456789abc')).toBe(false)
    expect(isUnsubscribeToken('not-a-token')).toBe(false)
    expect(isUnsubscribeToken('')).toBe(false)
  })
})
