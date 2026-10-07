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
 * A notification's time: relative in the page's language, or an absolute
 * stamp in the page's language and the viewer's zone, with the full stamp in
 * the title. "Today" is the viewer's today.
 */
import { cleanup, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderInGerman, renderWithIntl } from '@/test/render-with-intl'
import { formatIn, restoreRuntimeLocale, setRuntimeLocale } from '@/test/runtime-locale'
import type { SerializedNotification } from '@/lib/client/hooks/use-notifications-queries'
import { NotificationItem } from '../notification-item'

// 12:00 UTC on 7 October is already 8 October, 02:00, in Kiritimati (UTC+14).
const NOW = '2026-10-07T12:00:00.000Z'
const VIEWER_ZONE = 'Pacific/Kiritimati'

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(NOW))
  setRuntimeLocale('en-US', VIEWER_ZONE)
})

afterEach(() => {
  cleanup()
  restoreRuntimeLocale()
  vi.useRealTimers()
})

function notification(createdAt: string): SerializedNotification {
  return {
    id: 'notification_01h455vb4pex5vsknk084sn02q',
    principalId: 'principal_01h455vb4pex5vsknk084sn02q',
    type: 'comment_created',
    title: 'Ada commented',
    body: null,
    postId: null,
    commentId: null,
    conversationId: null,
    ticketId: null,
    changelogId: null,
    incidentId: null,
    actorName: null,
    actorAvatarUrl: null,
    audience: null,
    readAt: '2026-10-07T00:00:00.000Z',
    archivedAt: null,
    createdAt,
  } as SerializedNotification
}

const STAMP: Intl.DateTimeFormatOptions = {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
}
const EARLIER: Intl.DateTimeFormatOptions = {
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
}

const FIVE_MINUTES_AGO = '2026-10-07T11:55:00.000Z'
// 09:00 UTC is 23:00 on the 7th in Kiritimati: yesterday for the viewer, though today in UTC.
const YESTERDAY_FOR_VIEWER = '2026-10-07T09:00:00.000Z'

describe('NotificationItem time', () => {
  it('compact: always relative, worded in the page language, full stamp in the title (T3, T7)', () => {
    renderInGerman(<NotificationItem notification={notification(YESTERDAY_FOR_VIEWER)} />)
    const time = screen.getByText('vor 3 Stunden').closest('time')!
    expect(time.getAttribute('title')).toBe(
      formatIn('de', VIEWER_ZONE, YESTERDAY_FOR_VIEWER, STAMP)
    )
    expect(time.getAttribute('datetime')).toBe(YESTERDAY_FOR_VIEWER)
  })

  it("full: a notification from the viewer's today is relative (T2, T7)", () => {
    renderInGerman(
      <NotificationItem notification={notification(FIVE_MINUTES_AGO)} variant="full" />
    )
    expect(screen.getByText('vor 5 Minuten')).toBeTruthy()
  })

  it('full: an earlier day reads as an absolute stamp in the page language and viewer zone (T2, T3)', () => {
    renderInGerman(
      <NotificationItem notification={notification(YESTERDAY_FOR_VIEWER)} variant="full" />
    )
    const german = formatIn('de', VIEWER_ZONE, YESTERDAY_FOR_VIEWER, EARLIER)
    const english = formatIn('en', VIEWER_ZONE, YESTERDAY_FOR_VIEWER, EARLIER)
    expect(german).not.toBe(english)
    expect(screen.getByText(german)).toBeTruthy()
    expect(screen.queryByText('vor 3 Stunden')).toBeNull()
  })

  it('full: the same notification reads in English under the English page (T3)', () => {
    renderWithIntl(
      <NotificationItem notification={notification(YESTERDAY_FOR_VIEWER)} variant="full" />
    )
    expect(
      screen.getByText(formatIn('en', VIEWER_ZONE, YESTERDAY_FOR_VIEWER, EARLIER))
    ).toBeTruthy()
  })
})
