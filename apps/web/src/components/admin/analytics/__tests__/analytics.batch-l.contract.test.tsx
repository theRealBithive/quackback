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
 *
 * This suite pins T5 and T6 for the analytics section. The recharts
 * primitives are mocked (jsdom lays no chart out, so a real chart never asks
 * its axis or tooltip for a label): the mocked XAxis calls `tickFormatter`
 * and the mocked Tooltip renders its `content` element with one payload row,
 * so the real formatters and the real ChartTooltipContent run.
 */
import { cleanup, fireEvent, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderInGerman, renderWithIntl } from '@/test/render-with-intl'
import { restoreRuntimeLocale, setRuntimeLocale } from '@/test/runtime-locale'
import { formatBucketDay } from '../analytics-constants'
import { AnalyticsAreaChart } from '../analytics-area-chart'
import { AnalyticsConversationVolumeChart } from '../analytics-conversation-volume-chart'
import { AnalyticsFirstResponseChart } from '../analytics-first-response-chart'
import { AnalyticsTimeToCloseChart } from '../analytics-time-to-close-chart'
import { AnalyticsTeammatePerformance } from '../analytics-teammate-performance'
import { AnalyticsPage } from '../analytics-page'

vi.mock('recharts', async (importOriginal) => {
  const React = await import('react')
  const passThrough = ({ children }: { children?: React.ReactNode }) =>
    React.createElement('div', null, children)
  const nothing = () => null
  return {
    ...(await importOriginal<typeof import('recharts')>()),
    ResponsiveContainer: passThrough,
    AreaChart: passThrough,
    Area: nothing,
    CartesianGrid: nothing,
    YAxis: nothing,
    XAxis: ({ tickFormatter }: { tickFormatter: (value: string) => string }) =>
      React.createElement('span', { 'data-testid': 'tick' }, tickFormatter('2026-10-01')),
    Tooltip: ({ content }: { content: React.ReactElement }) =>
      React.cloneElement(content, {
        active: true,
        label: '2026-10-01',
        payload: [{ dataKey: 'v', name: 'v', value: 1234, color: 'red', payload: {} }],
      } as object),
  }
})

vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  useRouteContext: () => ({
    settings: { featureFlags: { feedback: true, supportInbox: true, changelog: true } },
  }),
}))

afterEach(() => {
  cleanup()
  restoreRuntimeLocale()
})

/** Zones on both sides of the date line: a local-midnight bug moves the day in one of them. */
const VIEWER_ZONES = ['Pacific/Kiritimati', 'Pacific/Pago_Pago']

const DAYS = [{ date: '2026-10-01', medianMinutes: 90 }]
const VOLUME = {
  channels: ['widget'],
  days: [{ date: '2026-10-01', widget: 3 }],
}

describe('formatBucketDay', () => {
  it.each(VIEWER_ZONES)('names the UTC day it covers for a viewer in %s (T5)', (zone) => {
    setRuntimeLocale('de-DE', zone)
    expect(formatBucketDay('2026-10-01')).toBe('Oct 1')
    expect(formatBucketDay('2026-01-31')).toBe('Jan 31')
  })
})

describe('daily charts label their buckets', () => {
  const charts = [
    [
      'area chart',
      <AnalyticsAreaChart
        key="a"
        data={[{ date: '2026-10-01', posts: 1 }]}
        dataKey="posts"
        label="Posts"
        metric="posts"
      />,
    ],
    ['conversation volume chart', <AnalyticsConversationVolumeChart key="v" volume={VOLUME} />],
    ['first response chart', <AnalyticsFirstResponseChart key="f" days={DAYS} />],
    ['time to close chart', <AnalyticsTimeToCloseChart key="t" days={DAYS} />],
  ] as const

  it.each(charts)(
    '%s: axis tick and tooltip title read "Oct 1" in every zone (T5)',
    (_name, chart) => {
      for (const zone of VIEWER_ZONES) {
        cleanup()
        setRuntimeLocale('de-DE', zone)
        renderInGerman(chart)
        expect(screen.getByTestId('tick')).toHaveTextContent('Oct 1')
        expect(screen.getByText('Oct 1', { selector: '.font-medium' })).toBeTruthy()
      }
    }
  )

  it('area chart: a tooltip value is grouped per the page language (T6)', () => {
    renderInGerman(charts[0][1])
    expect(screen.getByText('1.234')).toBeTruthy()
    cleanup()
    renderWithIntl(charts[0][1])
    expect(screen.getByText('1,234')).toBeTruthy()
  })

  it('volume chart: a tooltip value is grouped per the page language (T6)', () => {
    renderInGerman(charts[1][1])
    expect(screen.getByText('1.234')).toBeTruthy()
  })
})

describe('AnalyticsTeammatePerformance', () => {
  const teammates = [
    {
      agentId: 'a1',
      displayName: 'Ada',
      avatarUrl: null,
      handled: 12345,
      medianFirstResponseMinutes: 5,
      medianCloseMinutes: 60,
    },
  ]

  it('groups the handled count per the page language (T6)', () => {
    renderInGerman(<AnalyticsTeammatePerformance teammates={teammates} />)
    expect(screen.getByText('12.345')).toBeTruthy()
    cleanup()
    renderWithIntl(<AnalyticsTeammatePerformance teammates={teammates} />)
    expect(screen.getByText('12,345')).toBeTruthy()
  })
})

describe('AnalyticsPage', () => {
  const emptyDay = { date: '2026-10-01', posts: 0, votes: 0, comments: 0, users: 0 }
  const metric = { total: 0, delta: 0 }
  const data = {
    computedAt: new Date().toISOString(),
    summary: { posts: metric, votes: metric, postComments: metric, users: metric },
    dailyStats: [emptyDay],
    conversationVolume: { total: 1234, delta: 0, ...VOLUME },
    firstResponse: { medianMinutes: 90, responded: 2345, days: DAYS },
    responseDistribution: { total: 0, buckets: [] },
    timeToClose: { medianMinutes: 90, closed: 3456, days: DAYS },
    teammatePerformance: [],
    csat: { responseCount: 0 },
    ai: {
      involved: 4567,
      resolutionRate: 50,
      escalationRate: 25,
      ratingCount: 0,
      avgRating: null,
      resolved: 1111,
      escalated: 2222,
      pending: 3333,
    },
    changelog: { publishedInPeriod: 4, totalViews: 3000, publishedCount: 2, topEntries: [] },
  }

  function renderPage(render: typeof renderInGerman) {
    const client = new QueryClient()
    client.setQueryData(['analytics', '30d'], data)
    return render(
      <QueryClientProvider client={client}>
        <AnalyticsPage />
      </QueryClientProvider>
    )
  }

  function openSection(label: string) {
    fireEvent.click(screen.getByRole('button', { name: label }))
  }

  it('support stats and the Quinn outcome split are grouped per the page language (T6)', async () => {
    renderPage(renderInGerman)
    openSection('Support')
    expect(await screen.findByText('1.234')).toBeTruthy()
    expect(screen.getByText('2.345')).toBeTruthy()
    expect(screen.getByText('3.456')).toBeTruthy()

    openSection('Quinn AI')
    expect(screen.getByText('4.567')).toBeTruthy()
    expect(screen.getByText('1.111')).toBeTruthy()
    expect(screen.getByText('2.222')).toBeTruthy()
    expect(screen.getByText('3.333')).toBeTruthy()
  })

  it('support stats are grouped with commas under English (T6)', async () => {
    renderPage(renderWithIntl)
    openSection('Support')
    expect((await screen.findAllByText('1,234')).length).toBeGreaterThan(0)
  })

  it('changelog totals and the average per entry are grouped per the page language (T6)', () => {
    renderPage(renderInGerman)
    openSection('Changelog')
    expect(screen.getAllByText('3.000')).toHaveLength(1)
    expect(screen.getByText('1.500')).toBeTruthy()
  })

  it('an average over no entries reads 0 (T6)', () => {
    const client = new QueryClient()
    client.setQueryData(['analytics', '30d'], {
      ...data,
      changelog: { ...data.changelog, publishedCount: 0 },
    })
    renderInGerman(
      <QueryClientProvider client={client}>
        <AnalyticsPage />
      </QueryClientProvider>
    )
    openSection('Changelog')
    expect(screen.getByText('0')).toBeTruthy()
  })
})
