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
 * The snooze wake time beside a snoozed conversation's status: in the page's
 * language, in the viewer's time zone once rendered in the browser.
 */
import { cleanup, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, describe, expect, it } from 'vitest'
import type { ConversationId } from '@quackback/ids'
import { renderInGerman, renderWithIntl } from '@/test/render-with-intl'
import { formatIn, restoreRuntimeLocale, setRuntimeLocale } from '@/test/runtime-locale'
import { StatusControl } from '../status-control'

afterEach(() => {
  cleanup()
  restoreRuntimeLocale()
})

const WAKE_AT = '2026-10-06T23:30:00.000Z'
const WAKE_FORMAT: Intl.DateTimeFormatOptions = {
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
}

function control(props: { status: 'snoozed' | 'open'; snoozedUntil?: string | null }) {
  return (
    <QueryClientProvider client={new QueryClient()}>
      <StatusControl
        conversationId={'conversation_01h455vb4pex5vsknk084sn02q' as ConversationId}
        status={props.status}
        snoozedUntil={props.snoozedUntil}
        onChanged={() => {}}
      />
    </QueryClientProvider>
  )
}

describe('StatusControl wake label', () => {
  it('is written in the page language and the viewer zone (T2, T3)', () => {
    setRuntimeLocale('en-US', 'Pacific/Kiritimati')
    renderInGerman(control({ status: 'snoozed', snoozedUntil: WAKE_AT }))

    const german = formatIn('de', 'Pacific/Kiritimati', WAKE_AT, WAKE_FORMAT)
    const english = formatIn('en', 'Pacific/Kiritimati', WAKE_AT, WAKE_FORMAT)
    expect(german).not.toBe(english)
    expect(screen.getByText(german, { exact: false })).toBeTruthy()
    expect(screen.queryByText(english, { exact: false })).toBeNull()
  })

  it('falls back to English outside a language provider (T10)', () => {
    setRuntimeLocale('de-DE', 'UTC')
    render(control({ status: 'snoozed', snoozedUntil: WAKE_AT }))
    expect(
      screen.getByText(formatIn('en-US', 'UTC', WAKE_AT, WAKE_FORMAT), { exact: false })
    ).toBeTruthy()
  })

  it('shows no label for a conversation that is not snoozed (T3)', () => {
    renderWithIntl(control({ status: 'open', snoozedUntil: WAKE_AT }))
    expect(screen.queryByText(/·/)).toBeNull()
  })
})
