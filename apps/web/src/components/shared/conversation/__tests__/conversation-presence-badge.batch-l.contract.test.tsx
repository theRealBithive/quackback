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
 * The "Back Monday 9:00 AM" cue of the offline badge: the visitor's language
 * and, once rendered in the browser, the visitor's time zone.
 */
import { cleanup, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { renderInGerman, renderWithIntl } from '@/test/render-with-intl'
import { formatIn, restoreRuntimeLocale, setRuntimeLocale } from '@/test/runtime-locale'
import {
  BackAtTime,
  ConversationPresenceBadge,
  hasBackAtTime,
} from '../conversation-presence-badge'

afterEach(() => {
  cleanup()
  restoreRuntimeLocale()
})

// Sunday 2026-10-04 23:00 UTC is already Monday in Tokyo and still Sunday in UTC.
const BACK_AT = '2026-10-04T23:00:00.000Z'
const BACK_AT_FORMAT: Intl.DateTimeFormatOptions = {
  weekday: 'long',
  hour: 'numeric',
  minute: '2-digit',
}

describe('ConversationPresenceBadge when the team is away', () => {
  it('words the weekday in the page language and shows it in the viewer zone (T2, T3)', () => {
    setRuntimeLocale('en-US', 'Asia/Tokyo')
    renderInGerman(<ConversationPresenceBadge available={false} nextOpenAt={BACK_AT} />)

    const expected = formatIn('de', 'Asia/Tokyo', BACK_AT, BACK_AT_FORMAT)
    expect(expected).toContain('Montag')
    expect(screen.getByText(expected, { exact: false })).toBeTruthy()
    expect(screen.queryByText(/Monday/)).toBeNull()
  })

  it('reads in English under the English page (T3)', () => {
    setRuntimeLocale('de-DE', 'Asia/Tokyo')
    renderWithIntl(<ConversationPresenceBadge available={false} nextOpenAt={BACK_AT} />)
    expect(screen.getByText(/Monday/)).toBeTruthy()
  })

  it.each([null, undefined, '', 'not a date'])('says nothing about %s (T3)', (nextOpenAt) => {
    renderInGerman(<ConversationPresenceBadge available={false} nextOpenAt={nextOpenAt} />)
    expect(screen.queryByText(/·/)).toBeNull()
  })

  it('shows no back-at cue while the team is online (T3)', () => {
    renderInGerman(<ConversationPresenceBadge available nextOpenAt={BACK_AT} />)
    expect(screen.queryByText(/Montag/)).toBeNull()
  })
})

describe('BackAtTime and hasBackAtTime', () => {
  it('renders nothing for a missing time (T3)', () => {
    const { container } = renderWithIntl(<BackAtTime at={null} />)
    expect(container.textContent).toBe('')
  })

  it('accepts exactly the values that parse as a time (T3)', () => {
    expect(hasBackAtTime(BACK_AT)).toBe(true)
    expect(hasBackAtTime('not a date')).toBe(false)
    expect(hasBackAtTime('')).toBe(false)
    expect(hasBackAtTime(null)).toBe(false)
    expect(hasBackAtTime(undefined)).toBe(false)
  })
})
