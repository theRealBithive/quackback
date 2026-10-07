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
 * Audit-log timestamps are admin copy in English: the language stays English
 * on a German page (an English table never mixes languages), and the moment
 * is shown in the viewer's zone.
 */
import { Suspense } from 'react'
import { cleanup, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderInGerman } from '@/test/render-with-intl'
import { formatIn, restoreRuntimeLocale, setRuntimeLocale } from '@/test/runtime-locale'

const OCCURRED_AT = '2026-10-06T23:48:00.000Z'

vi.mock('@/lib/client/queries/admin', async (importOriginal) => {
  const { queryOptions } = await import('@tanstack/react-query')
  return {
    ...(await importOriginal<typeof import('@/lib/client/queries/admin')>()),
    adminQueries: {
      auditEvents: () =>
        queryOptions({
          queryKey: ['audit-batch-l'],
          queryFn: async () => ({
            events: [
              {
                id: 'audit_1',
                occurredAt: '2026-10-06T23:48:00.000Z',
                eventType: 'sso.config.changed',
                eventOutcome: 'success',
                actorEmail: 'ada@example.com',
                actorType: 'user',
                actorRole: 'admin',
                authMethod: 'password',
                targetType: 'domain',
                targetId: 'domain_1',
              },
            ],
          }),
        }),
    },
  }
})

import { AuditLogPage } from '../audit-log-page'

afterEach(() => {
  cleanup()
  restoreRuntimeLocale()
})

const DATE: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' }
const TIME: Intl.DateTimeFormatOptions = { hour: 'numeric', minute: '2-digit' }
const FULL: Intl.DateTimeFormatOptions = {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
}

describe('AuditLogPage timestamps', () => {
  it('are English in the viewer zone on a German page, in both layouts (T2, T4)', async () => {
    setRuntimeLocale('de-DE', 'Pacific/Kiritimati')
    renderInGerman(
      <QueryClientProvider client={new QueryClient()}>
        <Suspense fallback={null}>
          <AuditLogPage />
        </Suspense>
      </QueryClientProvider>
    )

    const date = formatIn('en-US', 'Pacific/Kiritimati', OCCURRED_AT, DATE)
    const time = formatIn('en-US', 'Pacific/Kiritimati', OCCURRED_AT, TIME)
    const full = formatIn('en-US', 'Pacific/Kiritimati', OCCURRED_AT, FULL)

    // The stacked table cell: date above time, full stamp in the title.
    expect(await screen.findByText(date)).toBeTruthy()
    expect(screen.getByText(time)).toBeTruthy()
    // The one-line mobile row: "May 13 12:48 AM".
    expect(screen.getByText(`${date} ${time}`)).toBeTruthy()
    const titled = document.querySelectorAll(`[title="${full}"]`)
    expect(titled).toHaveLength(2)
  })
})
