// @vitest-environment happy-dom
/**
 * Calendar days: values that name a day, not a moment.
 *
 * Contract for batch L (upstream #625 372fcb6f2, #627 f560647f7, #630
 * 16938dc59), confirmed 2026-10-07 -- the item this suite pins, verbatim:
 *
 *   T5 A date-only value (a calendar day such as 2026-10-01) shows as exactly
 *      that day for every viewer, whatever their time zone.
 *
 * A viewer's time zone is varied in two ways at once, because they catch
 * different regressions: `process.env.TZ` moves the runtime's own clock (what
 * `new Date(y, m, d)` and `getDate()` read), and `setRuntimeLocale` moves the
 * default zone an `Intl` format falls back to when no `timeZone` is named. A
 * canary asserts the first one actually took effect, so the properties cannot
 * pass over a zone change that silently did nothing.
 *
 * Generated days are four-digit years, 1000 to 9999: a calendar day a person
 * enters or picks (a ticket answer, a filter, a publish date). Years 0000 to
 * 0099 are outside that by specification, not by observation -- `Date.UTC`
 * maps them onto 1900 to 1999, which `parseCalendarDate` already refuses.
 *
 * The filter chips and the changelog list item are English admin copy (T4),
 * so they are checked for the day only. The ticket intake answer, the inbox
 * date field and the date picker follow the page's language, so they are
 * checked in German, with a check that German differs from English.
 */
import { act } from 'react'
import { renderToString } from 'react-dom/server'
import { createIntl, IntlProvider } from 'react-intl'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import fc from 'fast-check'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ChangelogId, TicketId, TicketTypeId } from '@quackback/ids'
import type { TicketDTO } from '@/lib/server/domains/tickets'
import type { TicketFormField } from '@/lib/shared/tickets'
import { ticketKeys } from '@/lib/client/queries/inbox'
import { formatCalendarDate, parseCalendarDate } from '@/lib/shared/utils/date'
import { GermanIntlWrapper, renderInGerman, renderWithIntl } from '@/test/render-with-intl'
import { restoreRuntimeLocale, setRuntimeLocale } from '@/test/runtime-locale'

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
  useRouteContext: (opts?: { select?: (context: object) => unknown }) =>
    opts?.select ? opts.select({}) : {},
}))
vi.mock('@/components/admin/inbox/ticket-chips', () => ({
  TicketTypeBadge: () => null,
  TicketStageChip: () => null,
}))
vi.mock('@/components/admin/inbox/ticket-controls', () => ({
  TicketStatusControl: () => null,
  TicketAssigneeControl: () => null,
  TicketPriorityControl: () => null,
  TicketWatchControl: () => null,
}))
vi.mock('@/components/admin/inbox/ticket-links', () => ({ TicketLinks: () => null }))
vi.mock('@/components/admin/conversation/company-card', () => ({ CompanyCard: () => null }))
vi.mock('@/components/admin/users/block-person-control', () => ({
  usePersonBlockStatus: () => ({ blocked: false, isLoading: false }),
}))
vi.mock('@/lib/server/functions/conversation', () => ({
  listConversationsForUserFn: vi.fn().mockResolvedValue({ conversations: [], hasMore: false }),
  getConversationAssistantActivityFn: vi.fn().mockResolvedValue(null),
}))
vi.mock('@/lib/server/functions/admin', () => ({
  getPortalUserFn: vi.fn().mockResolvedValue(null),
}))

import { CalendarDate } from '../local-date'
import { DateTimePicker } from '../datetime-picker'
import { formatIntakeValue } from '@/components/shared/conversation/ticket-header-card'
import { ActiveFiltersBar } from '@/components/admin/feedback/active-filters-bar'
import type { InboxFilters } from '@/components/admin/feedback/use-inbox-filters'
import { UsersActiveFiltersBar } from '@/components/admin/users/users-active-filters-bar'
import { ChangelogListItem } from '@/components/admin/changelog/changelog-list-item'
import { InboxDetailPanel } from '@/components/admin/inbox/inbox-detail-panel'

const KIRITIMATI = 'Pacific/Kiritimati' // UTC+14
const PAGO_PAGO = 'Pacific/Pago_Pago' // UTC-11
const EXTREME_ZONES = [KIRITIMATI, PAGO_PAGO, 'Etc/GMT+12', 'America/Los_Angeles', 'UTC']
const ALL_ZONES = [...Intl.supportedValuesOf('timeZone'), ...EXTREME_ZONES]
const RUNTIME_LOCALES = ['en-US', 'de-DE', 'fr-FR', 'ja-JP', 'ar-EG']

const realTz = process.env.TZ

/** Act as a viewer whose clock and whose default `Intl` zone are both `timeZone`. */
function actAsViewerIn(timeZone: string, runtimeLocale = 'en-US') {
  process.env.TZ = timeZone
  setRuntimeLocale(runtimeLocale, timeZone)
}

afterEach(() => {
  cleanup()
  restoreRuntimeLocale()
  process.env.TZ = realTz
})

const FIRST_DAY = Date.UTC(1000, 0, 1)
const LAST_DAY = Date.UTC(9999, 11, 31)
const MS_PER_DAY = 86_400_000

interface WrittenDay {
  /** As written: "2026-10-01". */
  value: string
  year: string
  month: string
  day: string
}

/** Any real calendar day from 1000-01-01 to 9999-12-31, leap days included. */
const writtenDay: fc.Arbitrary<WrittenDay> = fc
  .integer({ min: 0, max: (LAST_DAY - FIRST_DAY) / MS_PER_DAY })
  .map((offset) => {
    const value = new Date(FIRST_DAY + offset * MS_PER_DAY).toISOString().slice(0, 10)
    const [year, month, day] = value.split('-')
    return { value, year, month, day }
  })

const anyZone = fc.constantFrom(...ALL_ZONES)
const anyRuntimeLocale = fc.constantFrom(...RUNTIME_LOCALES)

/** German numeric day, built from the written parts: "01.10.2026". */
const germanNumeric = (day: WrittenDay) => `${day.day}.${day.month}.${day.year}`
const NUMERIC_DAY: Intl.DateTimeFormatOptions = {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
}

describe('T5 the viewer zone really moves in this suite', () => {
  it('puts UTC midnight on different days in Pago Pago and Kiritimati (T5)', () => {
    process.env.TZ = PAGO_PAGO
    const dayInPagoPago = new Date('2026-10-01T00:00:00Z').getDate()
    process.env.TZ = KIRITIMATI
    const dayInKiritimati = new Date('2026-10-01T00:00:00Z').getDate()

    expect(dayInPagoPago).toBe(30)
    expect(dayInKiritimati).toBe(1)
  })
})

describe('T5 the shared calendar-date primitives', () => {
  it('formatCalendarDate shows the written day, month and year in every zone (T5)', () => {
    fc.assert(
      fc.property(writtenDay, anyZone, anyRuntimeLocale, (day, zone, runtimeLocale) => {
        actAsViewerIn(zone, runtimeLocale)
        // en-CA writes the numeric parts in ISO order: "2026-10-01".
        expect(formatCalendarDate(day.value, NUMERIC_DAY, 'en-CA')).toBe(day.value)
        expect(formatCalendarDate(day.value, NUMERIC_DAY, 'de-DE')).toBe(germanNumeric(day))
      })
    )
  })

  it('formatCalendarDate reads only the date written at the start of a timestamp (T5)', () => {
    fc.assert(
      fc.property(
        writtenDay,
        anyZone,
        fc.constantFrom('T00:00:00Z', 'T23:59:59-11:00', 'T00:30:00+14:00', 'T12:00:00.000Z'),
        (day, zone, timePart) => {
          actAsViewerIn(zone)
          expect(formatCalendarDate(`${day.value}${timePart}`, NUMERIC_DAY, 'en-CA')).toBe(
            day.value
          )
        }
      )
    )
  })

  it('parseCalendarDate names the written day in UTC, independent of the runtime clock (T5)', () => {
    fc.assert(
      fc.property(writtenDay, anyZone, (day, zone) => {
        actAsViewerIn(zone)
        const parsed = parseCalendarDate(day.value)
        expect(parsed?.toISOString().slice(0, 10)).toBe(day.value)
      })
    )
  })

  it('formatCalendarDate is not moved by the runtime zone: one answer for all viewers (T5)', () => {
    fc.assert(
      fc.property(writtenDay, anyZone, anyZone, (day, firstZone, secondZone) => {
        actAsViewerIn(firstZone)
        const first = formatCalendarDate(day.value, undefined, 'de')
        actAsViewerIn(secondZone)
        const second = formatCalendarDate(day.value, undefined, 'de')
        expect(second).toBe(first)
      })
    )
  })

  it('<CalendarDate> renders the written day on the server and in the browser (T5)', () => {
    fc.assert(
      fc.property(writtenDay, anyZone, anyZone, (day, serverZone, viewerZone) => {
        const element = (
          <IntlProvider locale="de" defaultLocale="en">
            <CalendarDate value={day.value} options={NUMERIC_DAY} />
          </IntlProvider>
        )
        actAsViewerIn(serverZone)
        const serverMarkup = renderToString(element)
        actAsViewerIn(viewerZone, 'en-US')
        const { container, unmount } = render(element)
        const browserText = container.textContent
        unmount()

        expect(serverMarkup).toContain(`>${germanNumeric(day)}</time>`)
        expect(browserText).toBe(germanNumeric(day))
      }),
      { numRuns: 60 }
    )
  })

  it('<CalendarDate> writes the day in the page language: German differs from English (T5)', () => {
    actAsViewerIn(PAGO_PAGO)
    const german = renderToString(
      <IntlProvider locale="de" defaultLocale="en">
        <CalendarDate value="2026-10-01" options={{ month: 'long', day: 'numeric' }} />
      </IntlProvider>
    )
    const english = renderToString(
      <IntlProvider locale="en" defaultLocale="en">
        <CalendarDate value="2026-10-01" options={{ month: 'long', day: 'numeric' }} />
      </IntlProvider>
    )

    expect(german).toContain('1. Oktober')
    expect(english).toContain('October 1')
    expect(german).not.toBe(english)
  })
})

const dateField: TicketFormField = {
  key: 'incident_day',
  label: 'Day it happened',
  type: 'date',
  required: false,
  visibleToCustomer: true,
  order: 0,
}

describe('T5 ticket intake answers (portal, the page language)', () => {
  it('shows a date answer as the written day in German in every zone (T5)', () => {
    const german = createIntl({ locale: 'de' })
    fc.assert(
      fc.property(writtenDay, anyZone, (day, zone) => {
        actAsViewerIn(zone)
        const shown = formatIntakeValue(dateField, day.value, german)
        // German: "1. Okt. 2026" -- the day number first, the year last.
        expect(shown).toMatch(new RegExp(`^${Number(day.day)}\\. \\S+ ${day.year}$`))
        actAsViewerIn('UTC')
        expect(formatIntakeValue(dateField, day.value, german)).toBe(shown)
      })
    )
  })

  it('reads 2026-10-01 as 1 October at both date-line extremes, in German and English (T5)', () => {
    for (const zone of [KIRITIMATI, PAGO_PAGO]) {
      actAsViewerIn(zone)
      const german = formatIntakeValue(dateField, '2026-10-01', createIntl({ locale: 'de' }))
      const english = formatIntakeValue(dateField, '2026-10-01', createIntl({ locale: 'en' }))
      expect(german).toBe('1. Okt. 2026')
      expect(english).toBe('Oct 1, 2026')
      expect(german).not.toBe(english)
    }
  })
})

function ticketWithDateAnswer(answer: string): TicketDTO {
  return {
    id: 'ticket_1' as TicketId,
    number: 142,
    reference: '#142',
    type: 'customer',
    ticketType: {
      id: 'ticket_type_1' as TicketTypeId,
      name: 'Bug',
      slug: 'bug',
      category: 'customer',
      icon: null,
      color: '#888',
    },
    title: 'Cannot log in',
    status: { id: 'ticket_status_1', name: 'Open', color: '#10b981', category: 'open' },
    stage: { slot: 'received', label: 'Received' },
    priority: 'high',
    requester: null,
    assignee: { principalId: null, displayName: null, teamId: null, teamName: null },
    company: null,
    firstResponseAt: null,
    dueAt: null,
    resolvedAt: null,
    sla: null,
    createdAt: '2026-09-20T10:00:00.000Z',
    updatedAt: '2026-09-20T10:00:00.000Z',
    reopenedCount: 0,
    customAttributes: { incident_day: answer },
    lastMessagePreview: null,
    lastMessageAt: null,
  } as unknown as TicketDTO
}

function renderInboxPanelInGerman(ticket: TicketDTO) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  client.setQueryData(ticketKeys.types(), [
    { id: 'ticket_type_1' as TicketTypeId, fields: [dateField] },
  ])
  return render(
    <QueryClientProvider client={client}>
      <InboxDetailPanel
        item={{ kind: 'ticket', id: ticket.id }}
        ticket={ticket}
        onChanged={() => {}}
        onSelectItem={() => {}}
        onTrackAsFeedback={() => {}}
        onCreateTicket={() => {}}
        onInsertFromCopilot={() => {}}
      />
    </QueryClientProvider>,
    { wrapper: GermanIntlWrapper }
  )
}

describe('T5 ticket date fields in the inbox detail panel (the page language)', () => {
  it.each([KIRITIMATI, PAGO_PAGO])(
    'shows the date field as the written day in German in %s (T5)',
    (zone) => {
      actAsViewerIn(zone, 'en-US')
      renderInboxPanelInGerman(ticketWithDateAnswer('2026-10-01'))

      const row = screen.getByText('Day it happened').closest('div')!.parentElement!
      expect(row.textContent).toContain('1. Okt. 2026')
      expect(row.textContent).not.toContain('Oct')
      expect(row.textContent).not.toContain('30.')
      expect(row.textContent).not.toContain('2. Okt.')
    }
  )
})

describe('T5 date filter chips (English admin copy)', () => {
  // A chip whose day equals a preset ("Last 7 days", counted from today in
  // the viewer's zone) shows the preset's name instead of a date, so the
  // days here lie years before any preset could reach.
  it.each([KIRITIMATI, PAGO_PAGO, 'America/Los_Angeles'])(
    'the feedback chip names the written day in %s (T5)',
    (zone) => {
      actAsViewerIn(zone, 'de-DE')
      render(
        <ActiveFiltersBar
          filters={{ dateFrom: '2024-03-01' } as InboxFilters}
          onFiltersChange={() => {}}
          onClearAll={() => {}}
          onToggleStatus={() => {}}
          onToggleBoard={() => {}}
          boards={[]}
          tags={[]}
          statuses={[]}
          members={[]}
        />
      )
      expect(screen.getByText(/Mar 1, 2024/)).toBeInTheDocument()
      expect(screen.queryByText(/Feb 29|Mar 2,/)).not.toBeInTheDocument()
    }
  )

  it.each([KIRITIMATI, PAGO_PAGO, 'America/Los_Angeles'])(
    'the users chip names the written range in %s (T5)',
    (zone) => {
      actAsViewerIn(zone, 'de-DE')
      render(
        <QueryClientProvider client={new QueryClient()}>
          <UsersActiveFiltersBar
            filters={{ dateFrom: '2024-03-01', dateTo: '2024-03-31' } as never}
            onFiltersChange={() => {}}
            onClearFilters={() => {}}
          />
        </QueryClientProvider>
      )
      expect(screen.getByText(/Mar 1, 2024 - Mar 31, 2024/)).toBeInTheDocument()
    }
  )
})

describe('T5 the changelog published date picked as a calendar day', () => {
  /** A picked day is stored as noon UTC on it (see the date picker). */
  const pickedDay = (value: string) => `${value}T12:00:00.000Z`

  it('the list item names the picked day in every zone (T5)', () => {
    fc.assert(
      fc.property(
        // A picked day equal to the publish day shows no "Showing as" at all,
        // by design, so that one day has nothing to check.
        writtenDay.filter((day) => day.value !== '2026-09-20'),
        fc.constantFrom(...EXTREME_ZONES),
        (day, zone) => {
          actAsViewerIn(zone, 'de-DE')
          const { container, unmount } = render(
            <ChangelogListItem
              id={'changelog_1' as ChangelogId}
              title="Faster search"
              content="Search is faster."
              status="published"
              publishedAt="2026-09-20T10:00:00.000Z"
              displayDate={pickedDay(day.value)}
              createdAt="2026-09-19T10:00:00.000Z"
              author={null}
              linkedPosts={[]}
            />
          )
          const expected = new Intl.DateTimeFormat('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
            timeZone: 'UTC',
          }).format(Date.UTC(Number(day.year), Number(day.month) - 1, Number(day.day)))
          const text = container.textContent ?? ''
          unmount()
          expect(text).toContain(`Showing as ${expected}`)
        }
      ),
      { numRuns: 40 }
    )
  })
})

describe('T5 the date-only picker (the page language)', () => {
  /**
   * Noon UTC on the 15th of the viewer's current month: the calendar opens on
   * the viewer's local month, so the month is read in the viewer's zone.
   * Call after `actAsViewerIn`.
   */
  function pickedThisMonth() {
    const now = new Date()
    return new Date(Date.UTC(now.getFullYear(), now.getMonth(), 15, 12))
  }

  /** The calendar's button for a day of the shown month, by the number it shows. */
  function dayButton(day: number) {
    const buttons = screen.getAllByRole('button')
    const matching = buttons.filter((button) => button.textContent === String(day))
    expect(matching).toHaveLength(1)
    return matching[0]
  }

  async function openPicker() {
    await act(async () => {
      fireEvent.click(screen.getAllByRole('button')[0])
    })
  }

  it.each([KIRITIMATI, PAGO_PAGO])(
    'the trigger shows the picked day in German in %s, and German differs from English (T5)',
    (zone) => {
      actAsViewerIn(zone)
      const value = new Date('2026-10-01T12:00:00.000Z')
      const german = renderInGerman(<DateTimePicker value={value} onChange={() => {}} dateOnly />)
      const germanText = german.getByRole('button').textContent
      german.unmount()
      const english = renderWithIntl(<DateTimePicker value={value} onChange={() => {}} dateOnly />)
      const englishText = english.getByRole('button').textContent

      expect(germanText).toBe('1. Okt. 2026')
      expect(englishText).toBe('Oct 1, 2026')
    }
  )

  it.each([KIRITIMATI, PAGO_PAGO])(
    'the opened calendar marks the picked day as selected in %s (T5)',
    async (zone) => {
      actAsViewerIn(zone)
      const value = pickedThisMonth()
      renderInGerman(<DateTimePicker value={value} onChange={() => {}} dateOnly />)
      await openPicker()

      const selected = document.querySelectorAll('[aria-selected="true"]')
      expect(selected).toHaveLength(1)
      expect(selected[0].textContent).toBe('15')
    }
  )

  it('picking a day in the calendar stores that day, whatever the zone (T5)', async () => {
    for (const zone of [KIRITIMATI, PAGO_PAGO]) {
      actAsViewerIn(zone)
      const onChange = vi.fn()
      const { unmount } = renderInGerman(<DateTimePicker onChange={onChange} dateOnly />)
      await openPicker()
      await act(async () => {
        fireEvent.click(dayButton(15))
      })
      const stored: Date = onChange.mock.calls[0][0]
      const now = new Date()
      expect(stored.toISOString().slice(0, 10)).toBe(
        `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-15`
      )
      unmount()
    }
  })

  it('under a maxDate of now, every day offered is stored as the day picked (T5)', async () => {
    // 12:00 UTC on Oct 7 is already 02:00 on Oct 8 in Kiritimati and still
    // 01:00 on Oct 7 in Pago Pago. The changelog display-date picker passes
    // maxDate = now, and the server refuses a display date in the future, so
    // Oct 8 cannot be stored yet: it must not be offered either.
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      for (const zone of [KIRITIMATI, PAGO_PAGO]) {
        actAsViewerIn(zone)
        vi.setSystemTime(new Date('2026-10-07T12:00:00.000Z'))
        const onChange = vi.fn()
        const { unmount } = renderInGerman(
          <DateTimePicker onChange={onChange} maxDate={new Date()} dateOnly />
        )
        await openPicker()

        expect(dayButton(8)).toBeDisabled()
        expect(dayButton(7)).not.toBeDisabled()
        await act(async () => {
          fireEvent.click(dayButton(7))
        })
        const stored: Date = onChange.mock.calls[0][0]
        expect(stored.toISOString().slice(0, 10)).toBe('2026-10-07')
        unmount()
      }
    } finally {
      vi.useRealTimers()
    }
  })

  it('under a minDate, the minimum UTC day is offered and stored as picked (T5)', async () => {
    // A minDate of 23:30 UTC on Oct 7 is already Oct 8 in Kiritimati. Its
    // UTC day, Oct 7, can still be stored (clamped to the minimum on that
    // same day), so it is offered in every zone; Oct 6 is not.
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      for (const zone of [KIRITIMATI, PAGO_PAGO]) {
        actAsViewerIn(zone)
        vi.setSystemTime(new Date('2026-10-07T23:30:00.000Z'))
        const onChange = vi.fn()
        const { unmount } = renderInGerman(
          <DateTimePicker onChange={onChange} minDate={new Date()} dateOnly />
        )
        await openPicker()

        expect(dayButton(6)).toBeDisabled()
        expect(dayButton(7)).not.toBeDisabled()
        await act(async () => {
          fireEvent.click(dayButton(7))
        })
        const stored: Date = onChange.mock.calls[0][0]
        expect(stored.toISOString().slice(0, 10)).toBe('2026-10-07')
        unmount()
      }
    } finally {
      vi.useRealTimers()
    }
  })
})
