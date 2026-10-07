// @vitest-environment happy-dom
/**
 * Contract for batch L (dates and numbers through the shared primitives),
 * confirmed 2026-10-07:
 *
 * T1 An absolute date or time reads the same in the server's markup and in the browser's first render, so a page never fails to hydrate because of a date.
 * T2 Once the page has hydrated, an absolute moment is shown in the viewer's own time zone.
 * T3 Dates are written in the page's language from the first render. The viewer's browser may choose the regional form of that language (en-GB rather than en-US), never another language.
 * T4 A date inside copy of a fixed language (an English admin sentence) stays in that language, so a sentence never mixes languages.
 * T5 A date-only value (a calendar day such as 2026-10-01) shows as exactly that day for every viewer, whatever their time zone.
 * T6 Numbers are grouped in the page's language, the same on the server and in the browser.
 * T7 Relative times ("3 days ago") are worded in the page's language. Under 45 seconds reads as "now", and a distance rounds to the unit that reads naturally (45 minutes is "1 hour").
 * T8 The public status page states its dates in UTC, in the page's language. A UTC day is that same day for every viewer.
 * T9 A component or route that formats a date or number in the runtime's default locale or time zone, outside the shared primitives, fails a guard. Files allowed to do so are listed with a reason, and the list can only shrink.
 * T10 Outside any language provider (emails, pages without one), formatting falls back to English, as before.
 */

/**
 * The stand-in for another runtime's default locale, which the contract's
 * server-versus-browser tests rely on: it must move `n.toLocaleString()`
 * with the runtime and leave an explicit locale alone, or those tests would
 * pass without ever disagreeing.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { restoreRuntimeLocale, setRuntimeLocale } from '../runtime-locale'

afterEach(restoreRuntimeLocale)

describe('setRuntimeLocale and numbers', () => {
  it('groups n.toLocaleString() in the stand-in locale, and options still apply (T6)', () => {
    setRuntimeLocale('de-DE', 'UTC')
    expect((1234567.5).toLocaleString()).toBe('1.234.567,5')
    expect((0.5).toLocaleString(undefined, { style: 'percent' })).toBe('50 %')
    expect((1234567.5).toLocaleString([])).toBe('1.234.567,5')
  })

  it('leaves an explicit locale alone (T6)', () => {
    setRuntimeLocale('de-DE', 'UTC')
    expect((1234567.5).toLocaleString('en-US')).toBe('1,234,567.5')
  })

  it('restores the real default afterwards (T6)', () => {
    const before = (1234567.5).toLocaleString('en-US')
    setRuntimeLocale('de-DE', 'UTC')
    restoreRuntimeLocale()
    expect(typeof (1234567.5).toLocaleString()).toBe('string')
    expect((1234567.5).toLocaleString('en-US')).toBe(before)
    expect(new Intl.NumberFormat('de-DE').format(1234.5)).toBe('1.234,5')
  })
})

describe('setRuntimeLocale and dates', () => {
  const MOMENT = new Date('2026-10-06T23:30:00.000Z')

  it('moves the date methods to the stand-in locale and zone (T1, T2)', () => {
    setRuntimeLocale('de-DE', 'Pacific/Kiritimati')
    expect(MOMENT.toLocaleDateString()).toBe('7.10.2026')
    expect(MOMENT.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })).toBe('13:30')
    expect(MOMENT.toLocaleString()).toBe('7.10.2026, 13:30:00')
  })

  it('leaves an explicit locale and zone alone (T1, T2)', () => {
    setRuntimeLocale('de-DE', 'Pacific/Kiritimati')
    expect(MOMENT.toLocaleDateString('en-US', { timeZone: 'UTC' })).toBe('10/6/2026')
  })

  it('restores the date methods afterwards (T1)', () => {
    setRuntimeLocale('de-DE', 'Pacific/Kiritimati')
    restoreRuntimeLocale()
    expect(MOMENT.toLocaleDateString('en-US', { timeZone: 'UTC' })).toBe('10/6/2026')
    expect(MOMENT.toLocaleDateString('de-DE', { timeZone: 'UTC' })).toBe('6.10.2026')
  })
})
