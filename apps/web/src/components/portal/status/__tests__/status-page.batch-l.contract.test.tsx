// @vitest-environment happy-dom
/**
 * The public status page states its dates in UTC, in the page's language.
 *
 * Contract for batch L (upstream #625 372fcb6f2, #627 f560647f7, #630
 * 16938dc59), confirmed 2026-10-07 -- the item this suite pins, verbatim:
 *
 *   T8 The public status page states its dates in UTC, in the page's
 *      language. A UTC day is that same day for every viewer.
 *
 * The moments generated here sit in the first and the last hour of a UTC day,
 * which is where any viewer zone from UTC-11 to UTC+14 puts them on a
 * neighbouring day. The viewer's zone is moved twice over: `process.env.TZ`
 * (the runtime clock) and `setRuntimeLocale` (the zone and language an `Intl`
 * format falls back to). The expected German text is built from the written
 * parts and a month table in this file, not by asking `Intl`, so the oracle
 * cannot share a mistake with the code under test.
 *
 * The routes are mounted without a router: `createFileRoute` hands its
 * options back, and the page's query is seeded so `useSuspenseQuery`
 * resolves at once (SELF-IMPROVE, "Mounting a real route in a test").
 */
import { cleanup, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import fc from 'fast-check'
import type { ReactElement, ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { publicStatusIncidentQueries, publicStatusPageQueries } from '@/lib/client/queries/status'
import { formatMonthYear } from '@/lib/shared/utils/date'
import { GermanIntlWrapper, renderInGerman, renderWithIntl } from '@/test/render-with-intl'
import { restoreRuntimeLocale, setRuntimeLocale } from '@/test/runtime-locale'

const loaderData = vi.hoisted(() => ({ current: {} as Record<string, unknown> }))

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: Record<string, unknown>) => ({
    options,
    useLoaderData: () => loaderData.current,
  }),
  notFound: () => new Error('not found'),
  Link: ({ children }: { children: ReactNode }) => <a>{children}</a>,
}))
vi.mock('@/lib/server/functions/public-cache', () => ({
  setPublicDocumentCacheHeaders: vi.fn(),
}))
vi.mock('@/components/portal/status/status-subscribe-button', () => ({
  StatusSubscribeButton: () => null,
}))
vi.mock('@/components/public/auth-vote-button', () => ({ AuthVoteButton: () => null }))
vi.mock('@/components/public/auth-subscription-bell', () => ({ AuthSubscriptionBell: () => null }))

import { Route as StatusIndexRoute } from '@/routes/_portal/status.index'
import { Route as StatusIncidentRoute } from '@/routes/_portal/status.$incidentId'
import { StatusIncidentTimeline } from '../status-incident-timeline'
import { StatusUptimeBar } from '../status-uptime-bar'
import { RoadmapCard } from '@/components/public/roadmap-card'
import { MetadataSidebar } from '@/components/public/post-detail/metadata-sidebar'

const KIRITIMATI = 'Pacific/Kiritimati' // UTC+14
const PAGO_PAGO = 'Pacific/Pago_Pago' // UTC-11
const VIEWER_ZONES = [KIRITIMATI, PAGO_PAGO, 'Etc/GMT+12', 'Asia/Kolkata', 'America/Los_Angeles']
const VIEWER_LOCALES = ['en-US', 'de-DE', 'fr-FR', 'ja-JP']

const GERMAN_MONTHS = [
  'Januar',
  'Februar',
  'März',
  'April',
  'Mai',
  'Juni',
  'Juli',
  'August',
  'September',
  'Oktober',
  'November',
  'Dezember',
]
const GERMAN_WEEKDAYS = [
  'Sonntag',
  'Montag',
  'Dienstag',
  'Mittwoch',
  'Donnerstag',
  'Freitag',
  'Samstag',
]

const realTz = process.env.TZ

function actAsViewerIn(timeZone: string, runtimeLocale: string) {
  process.env.TZ = timeZone
  setRuntimeLocale(runtimeLocale, timeZone)
}

afterEach(() => {
  cleanup()
  restoreRuntimeLocale()
  process.env.TZ = realTz
})

interface UtcMoment {
  iso: string
  /** "2026-10-01" */
  utcDay: string
  year: number
  /** 0-11 */
  monthIndex: number
  day: number
  weekday: number
  /** "00:30" */
  utcTime: string
}

function describeUtcMoment(ms: number): UtcMoment {
  const date = new Date(ms)
  const iso = date.toISOString()
  return {
    iso,
    utcDay: iso.slice(0, 10),
    year: date.getUTCFullYear(),
    monthIndex: date.getUTCMonth(),
    day: date.getUTCDate(),
    weekday: date.getUTCDay(),
    utcTime: iso.slice(11, 16),
  }
}

const FIRST_DAY = Date.UTC(2000, 0, 1)
const LAST_DAY = Date.UTC(2099, 11, 31)
const MS_PER_DAY = 86_400_000
const MS_PER_MINUTE = 60_000

/** A moment in the first or the last UTC hour of a day between 2000 and 2099. */
const nearUtcMidnight: fc.Arbitrary<UtcMoment> = fc
  .tuple(
    fc.integer({ min: 0, max: (LAST_DAY - FIRST_DAY) / MS_PER_DAY }),
    fc.oneof(fc.integer({ min: 0, max: 59 }), fc.integer({ min: 23 * 60, max: 24 * 60 - 1 }))
  )
  .map(([dayOffset, minuteOfDay]) =>
    describeUtcMoment(FIRST_DAY + dayOffset * MS_PER_DAY + minuteOfDay * MS_PER_MINUTE)
  )

const anyViewerZone = fc.constantFrom(...VIEWER_ZONES)
const anyViewerLocale = fc.constantFrom(...VIEWER_LOCALES)

/** "1. Oktober 2026" */
const germanLongDay = (moment: UtcMoment) =>
  `${moment.day}. ${GERMAN_MONTHS[moment.monthIndex]} ${moment.year}`

describe('T8 the incident timeline', () => {
  it('dates an update by its UTC day and time, in German, for every viewer (T8)', () => {
    fc.assert(
      fc.property(nearUtcMidnight, anyViewerZone, anyViewerLocale, (moment, zone, locale) => {
        actAsViewerIn(zone, locale)
        const { container, unmount } = renderInGerman(
          <StatusIncidentTimeline
            updates={[
              { id: 'u1', status: 'investigating', body: 'Looking into it', createdAt: moment.iso },
            ]}
          />
        )
        const text = container.textContent ?? ''
        unmount()
        expect(text).toContain(`${germanLongDay(moment)} · ${moment.utcTime} UTC`)
      })
    )
  })

  it('the compact timeline states the UTC time (T8)', () => {
    fc.assert(
      fc.property(nearUtcMidnight, anyViewerZone, (moment, zone) => {
        actAsViewerIn(zone, 'en-US')
        const { container, unmount } = renderInGerman(
          <StatusIncidentTimeline
            compact
            updates={[
              { id: 'u1', status: 'investigating', body: 'Looking into it', createdAt: moment.iso },
            ]}
          />
        )
        const text = container.textContent ?? ''
        unmount()
        expect(text).toContain(`${moment.utcTime} UTC`)
      })
    )
  })

  it('German differs from English for the same update (T8)', () => {
    actAsViewerIn(PAGO_PAGO, 'en-US')
    const update = {
      id: 'u1',
      status: 'investigating' as const,
      body: 'Looking into it',
      createdAt: '2026-10-01T00:30:00.000Z',
    }
    const german = renderInGerman(<StatusIncidentTimeline updates={[update]} />)
    const germanText = german.container.textContent
    german.unmount()
    const english = renderWithIntl(<StatusIncidentTimeline updates={[update]} />)

    expect(germanText).toContain('1. Oktober 2026 · 00:30 UTC')
    expect(english.container.textContent).toContain('October 1, 2026 · 00:30 UTC')
    expect(germanText).not.toBe(english.container.textContent)
  })
})

describe('T8 uptime bar tooltips', () => {
  it('names each bar by its UTC day, in German, for every viewer (T8)', () => {
    fc.assert(
      fc.property(nearUtcMidnight, anyViewerZone, anyViewerLocale, (moment, zone, locale) => {
        actAsViewerIn(zone, locale)
        const { container, unmount } = renderInGerman(
          <StatusUptimeBar
            days={[{ date: moment.utcDay, worstStatus: 'operational', uptimePct: 100 }]}
          />
        )
        const title = container.querySelector('[title]')?.getAttribute('title') ?? ''
        unmount()
        // German short month: "1. Okt." -- the day number, then the month's start.
        const monthStart = GERMAN_MONTHS[moment.monthIndex].slice(0, 3)
        expect(title.startsWith(`${moment.day}. ${monthStart}`)).toBe(true)
      })
    )
  })

  it('German differs from English for the same bar (T8)', () => {
    actAsViewerIn(KIRITIMATI, 'en-US')
    const days = [{ date: '2026-10-01', worstStatus: 'operational' as const, uptimePct: 100 }]
    const german = renderInGerman(<StatusUptimeBar days={days} />)
    const germanTitle = german.container.querySelector('[title]')?.getAttribute('title')
    german.unmount()
    const english = renderWithIntl(<StatusUptimeBar days={days} />)
    const englishTitle = english.container.querySelector('[title]')?.getAttribute('title')

    expect(germanTitle?.startsWith('1. Okt.')).toBe(true)
    expect(englishTitle?.startsWith('Oct 1')).toBe(true)
  })
})

function incident(overrides: Record<string, unknown>) {
  return {
    id: 'status_incident_1',
    kind: 'incident',
    title: 'Search is slow',
    status: 'investigating',
    impact: 'minor',
    scheduledStartAt: null,
    scheduledEndAt: null,
    startedAt: '2026-10-01T00:30:00.000Z',
    resolvedAt: null,
    affectedComponents: [],
    updates: [],
    ...overrides,
  }
}

function seededClient(key: readonly unknown[], data: unknown) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  })
  client.setQueryData(key, data)
  return client
}

function renderStatusIndexInGerman(page: unknown) {
  const client = seededClient(publicStatusPageQueries.get().queryKey, page)
  const Page = StatusIndexRoute.options.component as () => ReactElement
  return render(
    <QueryClientProvider client={client}>
      <Page />
    </QueryClientProvider>,
    { wrapper: GermanIntlWrapper }
  )
}

function statusPage(snapshot: Record<string, unknown>) {
  return {
    snapshot: {
      topLevel: {
        status: 'operational',
        worstComponentStatus: 'operational',
        activeIncidentCount: 0,
      },
      groups: [],
      ungroupedComponents: [],
      activeIncidents: [],
      upcomingMaintenance: [],
      recentIncidents: [],
      ...snapshot,
    },
    settings: { pageDescription: null, audience: 'public' },
    uptime: [],
  }
}

describe('T8 the status page route', () => {
  it('heads a day of recent incidents with its UTC day, in German, for every viewer (T8)', () => {
    fc.assert(
      fc.property(nearUtcMidnight, anyViewerZone, anyViewerLocale, (moment, zone, locale) => {
        actAsViewerIn(zone, locale)
        const { container, unmount } = renderStatusIndexInGerman(
          statusPage({ recentIncidents: [{ date: moment.utcDay, incidents: [] }] })
        )
        const text = container.textContent ?? ''
        unmount()
        expect(text).toContain(germanLongDay(moment))
      }),
      { numRuns: 30 }
    )
  })

  it('states a maintenance window by its UTC weekday, day and times, in German (T8)', () => {
    fc.assert(
      fc.property(nearUtcMidnight, anyViewerZone, anyViewerLocale, (start, zone, locale) => {
        actAsViewerIn(zone, locale)
        const end = describeUtcMoment(new Date(start.iso).getTime() + 30 * MS_PER_MINUTE)
        const { container, unmount } = renderStatusIndexInGerman(
          statusPage({
            upcomingMaintenance: [
              incident({
                kind: 'maintenance',
                status: 'scheduled',
                impact: 'maintenance',
                title: 'Database upgrade',
                scheduledStartAt: start.iso,
                scheduledEndAt: end.iso,
                startedAt: start.iso,
              }),
            ],
          })
        )
        const text = container.textContent ?? ''
        unmount()
        const weekday = GERMAN_WEEKDAYS[start.weekday]
        const month = GERMAN_MONTHS[start.monthIndex]
        expect(text).toContain(
          `${weekday}, ${start.day}. ${month} · ${start.utcTime} – ${end.utcTime} UTC`
        )
      }),
      { numRuns: 30 }
    )
  })

  it('the maintenance calendar block shows the UTC day, not the viewer day (T8)', () => {
    actAsViewerIn(KIRITIMATI, 'en-US')
    const { container } = renderStatusIndexInGerman(
      statusPage({
        upcomingMaintenance: [
          incident({
            kind: 'maintenance',
            status: 'scheduled',
            impact: 'maintenance',
            scheduledStartAt: '2026-10-01T23:30:00.000Z',
            scheduledEndAt: null,
            startedAt: '2026-10-01T23:30:00.000Z',
          }),
        ],
      })
    )
    const block = container.querySelector('.w-11')!
    expect(block.textContent).toBe('Okt1')
    expect(container.textContent).toContain('Donnerstag, 1. Oktober · 23:30 UTC')
  })

  it('states when an incident started, by its UTC day and time, in German (T8)', () => {
    fc.assert(
      fc.property(nearUtcMidnight, anyViewerZone, anyViewerLocale, (moment, zone, locale) => {
        actAsViewerIn(zone, locale)
        loaderData.current = { incidentId: 'status_incident_1' }
        const client = seededClient(
          publicStatusIncidentQueries.detail('status_incident_1' as never).queryKey,
          incident({ startedAt: moment.iso })
        )
        const Page = StatusIncidentRoute.options.component as () => ReactElement
        const { container, unmount } = render(
          <QueryClientProvider client={client}>
            <Page />
          </QueryClientProvider>,
          { wrapper: GermanIntlWrapper }
        )
        const text = container.textContent ?? ''
        unmount()
        expect(text).toContain(`${germanLongDay(moment)} um ${moment.utcTime} UTC`)
      }),
      { numRuns: 30 }
    )
  })
})

describe('T8 roadmap ETAs, month and year in UTC', () => {
  /** The first of a UTC month between 2000 and 2099, as an ETA is stored. */
  const firstOfUtcMonth = fc
    .tuple(fc.integer({ min: 2000, max: 2099 }), fc.integer({ min: 0, max: 11 }))
    .map(([year, monthIndex]) => ({
      iso: new Date(Date.UTC(year, monthIndex, 1)).toISOString(),
      year,
      monthIndex,
    }))

  it('formatMonthYear names the stored UTC month in German, in every viewer zone (T8)', () => {
    fc.assert(
      fc.property(firstOfUtcMonth, anyViewerZone, anyViewerLocale, (eta, zone, locale) => {
        actAsViewerIn(zone, locale)
        const label = formatMonthYear(eta.iso, 'de') ?? ''
        expect(label.startsWith(GERMAN_MONTHS[eta.monthIndex].slice(0, 3))).toBe(true)
        expect(label.endsWith(String(eta.year))).toBe(true)
      })
    )
  })

  it('the roadmap card shows the ETA month in the page language (T8)', () => {
    actAsViewerIn(PAGO_PAGO, 'en-US')
    const card = (
      <RoadmapCard
        id={'post_1' as never}
        title="Dark mode"
        voteCount={3}
        commentCount={0}
        board={{ id: 'board_1', name: 'Ideas', slug: 'ideas' } as never}
        eta="2027-03-01T00:00:00.000Z"
      />
    )
    const german = renderInGerman(card)
    const germanText = german.container.textContent ?? ''
    german.unmount()
    const english = renderWithIntl(card)
    const englishText = english.container.textContent ?? ''

    expect(germanText).toContain('März 2027')
    expect(englishText).toContain('Mar 2027')
    expect(englishText).not.toContain('Feb')
  })

  it('the post sidebar shows the ETA month in the page language (T8)', () => {
    actAsViewerIn(PAGO_PAGO, 'en-US')
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Infinity } },
    })
    render(
      <QueryClientProvider client={client}>
        <MetadataSidebar
          postId={'post_1' as never}
          voteCount={3}
          board={{ id: 'board_1', name: 'Ideas', slug: 'ideas' }}
          authorName={null}
          createdAt={new Date('2026-09-01T10:00:00.000Z')}
          eta="2027-03-01T00:00:00.000Z"
          hideSubscribe
        />
      </QueryClientProvider>,
      { wrapper: GermanIntlWrapper }
    )
    expect(screen.getByText('März 2027')).toBeInTheDocument()
  })
})
