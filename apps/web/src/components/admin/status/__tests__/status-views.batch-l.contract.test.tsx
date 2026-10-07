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
 * Dates and counts on the admin status overview and the subscriber list.
 *
 * Absolute dates follow the page language and the viewer's zone; "Started 5
 * minutes ago" sits inside English admin copy and stays English on a German
 * page; counts are grouped in the page's language.
 */
import { cleanup, screen, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderInGerman, renderWithIntl } from '@/test/render-with-intl'
import { formatIn, restoreRuntimeLocale, setRuntimeLocale } from '@/test/runtime-locale'
import { statusOverviewQueries, statusSubscriberQueries } from '@/lib/client/queries/status'

vi.mock('@/routes/admin/status', () => ({
  Route: { fullPath: '/admin/status', useSearch: () => ({}) },
}))
vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  useNavigate: () => vi.fn(),
}))
vi.mock('../status-report-incident-dialog', () => ({ ReportIncidentDialog: () => null }))
vi.mock('../status-schedule-maintenance-dialog', () => ({ ScheduleMaintenanceDialog: () => null }))
vi.mock('@/lib/client/mutations/status', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/client/mutations/status')>()),
  useStartStatusMaintenanceNow: () => ({ mutate: vi.fn(), isPending: false }),
}))

import { StatusOverviewView } from '../status-overview-view'
import { StatusSubscribersView } from '../status-subscribers-view'

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

/** Text split over elements (a label and its TimeAgo): matches the span whose whole text is `text`. */
function spanReading(text: string) {
  return screen.queryByText(
    (_, element) => element?.tagName === 'SPAN' && element.textContent === text
  )
}

function clientWith(seed: (client: QueryClient) => void) {
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } })
  seed(client)
  return client
}

// Still 6 October in UTC, already 7 October at 13:30 in Kiritimati.
const WINDOW_START = '2026-10-06T23:30:00.000Z'
const WINDOW_END = '2026-10-07T01:00:00.000Z'

const overview = {
  enabled: true,
  topLevelStatus: 'operational',
  activeIncidents: [
    {
      id: 'incident_1',
      title: 'Search is slow',
      status: 'investigating',
      impact: 'minor',
      startedAt: '2026-10-07T11:55:00.000Z',
      affectedComponents: [],
      updates: [{ id: 'u1', body: 'Looking into it', createdAt: '2026-10-07T11:57:00.000Z' }],
    },
  ],
  upcomingMaintenance: [
    {
      id: 'maintenance_1',
      title: 'Database upgrade',
      status: 'scheduled',
      impact: 'maintenance',
      scheduledStartAt: WINDOW_START,
      scheduledEndAt: WINDOW_END,
      autoStart: false,
      autoComplete: false,
      affectedComponents: [],
      updates: [],
    },
  ],
  ungroupedComponents: [],
  groups: [],
  uptime90d: 99.5,
  subscribers: { active: 12345, newLast7d: 0 },
  incidentsLast30d: 2,
}

function renderOverview(render: typeof renderInGerman) {
  const client = clientWith((c) =>
    c.setQueryData(statusOverviewQueries.get().queryKey, overview as never)
  )
  return render(
    <QueryClientProvider client={client}>
      <StatusOverviewView />
    </QueryClientProvider>
  )
}

describe('StatusOverviewView', () => {
  it('shows the maintenance window in the page language and the viewer zone (T2, T3)', () => {
    renderOverview(renderInGerman)

    const month = formatIn('de', VIEWER_ZONE, WINDOW_START, { month: 'short' })
    expect(screen.getByText(month)).toBeTruthy()
    // The calendar tile's day: a plain digit in the viewer's zone, not UTC's 6th.
    const tile = screen.getByText(month).parentElement!
    expect(within(tile).getByText('7')).toBeTruthy()

    const day = formatIn('de', VIEWER_ZONE, WINDOW_START, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    })
    const time = { hour: '2-digit', minute: '2-digit' } as const
    const window =
      `${day}, ${formatIn('de', VIEWER_ZONE, WINDOW_START, time)}` +
      ` – ${formatIn('de', VIEWER_ZONE, WINDOW_END, time)}`
    expect(screen.getByText(window)).toBeTruthy()
  })

  it('keeps the incident ages in English inside English copy on a German page (T4)', () => {
    renderOverview(renderInGerman)
    expect(spanReading('Started 5 minutes ago')).toBeTruthy()
    expect(spanReading('Latest update 3 minutes ago:')).toBeTruthy()
    expect(screen.queryByText(/vor 5 Minuten/)).toBeNull()
  })

  it('groups the subscriber count in the page language (T6)', () => {
    renderOverview(renderInGerman)
    expect(screen.getByText('12.345')).toBeTruthy()
    cleanup()
    renderOverview(renderWithIntl)
    expect(screen.getByText('12,345')).toBeTruthy()
  })

  it('shows a dash for a window that has no start (T3)', () => {
    const client = clientWith((c) =>
      c.setQueryData(statusOverviewQueries.get().queryKey, {
        ...overview,
        upcomingMaintenance: [
          { ...overview.upcomingMaintenance[0], scheduledStartAt: null, scheduledEndAt: null },
        ],
      } as never)
    )
    renderInGerman(
      <QueryClientProvider client={client}>
        <StatusOverviewView />
      </QueryClientProvider>
    )
    expect(screen.getByText('Not scheduled')).toBeTruthy()
    expect(screen.getByText('?')).toBeTruthy()
  })

  it('shows a window with a start and no end as the start alone (T3)', () => {
    const client = clientWith((c) =>
      c.setQueryData(statusOverviewQueries.get().queryKey, {
        ...overview,
        upcomingMaintenance: [{ ...overview.upcomingMaintenance[0], scheduledEndAt: null }],
      } as never)
    )
    renderInGerman(
      <QueryClientProvider client={client}>
        <StatusOverviewView />
      </QueryClientProvider>
    )
    const time = formatIn('de', VIEWER_ZONE, WINDOW_START, { hour: '2-digit', minute: '2-digit' })
    expect(screen.getByText(new RegExp(`, ${time}$`))).toBeTruthy()
  })
})

describe('StatusSubscribersView', () => {
  const subscribers = {
    pages: [
      {
        nextCursor: null,
        items: [
          {
            id: 'sub_1',
            displayName: 'Ada',
            email: 'ada@example.com',
            scope: 'page',
            componentIds: [],
            source: 'portal',
            createdAt: '2026-10-07T09:00:00.000Z',
            unsubscribedAt: null,
          },
          {
            id: 'sub_2',
            displayName: 'Bob',
            email: 'bob@example.com',
            scope: 'page',
            componentIds: [],
            source: 'portal',
            createdAt: '2026-09-01T09:00:00.000Z',
            unsubscribedAt: '2026-10-04T12:00:00.000Z',
          },
        ],
      },
    ],
    pageParams: [undefined],
  }

  function renderSubscribers(render: typeof renderInGerman) {
    const client = clientWith((c) => {
      c.setQueryData(statusSubscriberQueries.counts().queryKey, {
        total: 12345,
        active: 2345,
        unsubscribed: 10000,
      })
      c.setQueryData(statusSubscriberQueries.list(undefined).queryKey, subscribers as never)
    })
    return render(
      <QueryClientProvider client={client}>
        <StatusSubscribersView />
      </QueryClientProvider>
    )
  }

  it('groups the count tiles in the page language (T6)', () => {
    renderSubscribers(renderInGerman)
    expect(screen.getByText('12.345')).toBeTruthy()
    expect(screen.getByText('2.345')).toBeTruthy()
    expect(screen.getByText('10.000')).toBeTruthy()
    cleanup()
    renderSubscribers(renderWithIntl)
    expect(screen.getByText('12,345')).toBeTruthy()
  })

  it('words the subscription ages in English on a German page (T4)', () => {
    renderSubscribers(renderInGerman)
    expect(spanReading('Subscribed 3 hours ago')).toBeTruthy()
    expect(spanReading('Unsubscribed 3 days ago')).toBeTruthy()
  })
})
