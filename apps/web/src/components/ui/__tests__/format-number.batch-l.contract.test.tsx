// @vitest-environment happy-dom
/**
 * Numbers grouped in the page's language, on the server and in the browser.
 *
 * Contract for batch L (upstream #625 372fcb6f2, #627 f560647f7, #630
 * 16938dc59), confirmed 2026-10-07 -- the item this suite pins, verbatim:
 *
 *   T6 Numbers are grouped in the page's language, the same on the server and
 *      in the browser.
 *
 * The server and the browser are two runtimes in one process:
 * `setRuntimeLocale` stands in for the default locale of each, so the server
 * renders under one and the browser hydrates under another. The page's
 * language is the IntlProvider's, and changing the runtime's default must
 * never change a digit of the output (non-interference). German groups with
 * "." and English with ",", so the two are told apart by an assertion that
 * holds for every generated number, not by a fixed example.
 */
import { act, type ReactElement } from 'react'
import { hydrateRoot } from 'react-dom/client'
import { renderToString } from 'react-dom/server'
import { IntlProvider } from 'react-intl'
import { cleanup, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import fc from 'fast-check'
import { afterEach, describe, expect, it } from 'vitest'
import { changelogQueries } from '@/lib/client/queries/changelog'
import { GermanIntlWrapper } from '@/test/render-with-intl'
import { restoreRuntimeLocale, setRuntimeLocale } from '@/test/runtime-locale'
import { useFormatNumber } from '../format-number'
import { AnalyticsBarList } from '@/components/admin/analytics/analytics-bar-list'
import { ChangelogTopViewed } from '@/components/admin/changelog/changelog-top-viewed'
import {
  ExportHistoryList,
  type ExportRunListItem,
} from '@/components/admin/settings/imports/export-history-list'

afterEach(() => {
  cleanup()
  restoreRuntimeLocale()
})

/** Runtime defaults that group differently from each other and from the page. */
const RUNTIME_LOCALES = ['en-US', 'de-DE', 'fr-FR', 'de-CH', 'hi-IN', 'ar-EG', 'es-ES']
const anyRuntimeLocale = fc.constantFrom(...RUNTIME_LOCALES)

/** Integers of every size a count reaches, both signs, around the 1,000 boundary too. */
const anyCount = fc.oneof(
  fc.integer({ min: -10_000_000_000, max: 10_000_000_000 }),
  fc.integer({ min: 990, max: 1_010 }),
  fc.integer({ min: 1_000, max: 9_999_999 })
)

function Probe({ value }: { value: number }) {
  return <span data-testid="n">{useFormatNumber()(value)}</span>
}

const inLocale = (locale: string, ui: ReactElement) => (
  <IntlProvider locale={locale} defaultLocale="en">
    {ui}
  </IntlProvider>
)

function renderProbe(locale: string, value: number): string {
  const { getByTestId, unmount } = render(inLocale(locale, <Probe value={value} />))
  const text = getByTestId('n').textContent ?? ''
  unmount()
  return text
}

const withoutGrouping = (text: string, separator: string) => text.split(separator).join('')

describe('T6 useFormatNumber groups in the page language', () => {
  it('groups German with "." and English with ",", for every count (T6)', () => {
    fc.assert(
      fc.property(anyCount, anyRuntimeLocale, (count, runtimeLocale) => {
        setRuntimeLocale(runtimeLocale, 'UTC')
        const german = renderProbe('de', count)
        const english = renderProbe('en', count)

        expect(withoutGrouping(german, '.')).toBe(String(count))
        expect(withoutGrouping(english, ',')).toBe(String(count))
        const grouped = Math.abs(count) >= 1_000
        expect(german === english).toBe(!grouped)
      })
    )
  })

  it('never changes a digit when only the runtime default locale changes (T6)', () => {
    fc.assert(
      fc.property(
        anyCount,
        fc.constantFrom('de', 'en', 'fr'),
        anyRuntimeLocale,
        anyRuntimeLocale,
        (count, pageLocale, firstRuntime, secondRuntime) => {
          setRuntimeLocale(firstRuntime, 'UTC')
          const first = renderProbe(pageLocale, count)
          setRuntimeLocale(secondRuntime, 'UTC')
          const second = renderProbe(pageLocale, count)
          expect(second).toBe(first)
        }
      )
    )
  })

  it('1000 reads "1.000" in German and "1,000" in English (T6)', () => {
    setRuntimeLocale('fr-FR', 'UTC')
    expect(renderProbe('de', 1000)).toBe('1.000')
    expect(renderProbe('en', 1000)).toBe('1,000')
  })
})

/** Server markup under one runtime, hydrated under another. */
async function serverThenHydrate(
  ui: ReactElement,
  serverRuntime: string,
  browserRuntime: string
): Promise<{ serverText: string; browserText: string; errors: unknown[] }> {
  setRuntimeLocale(serverRuntime, 'UTC')
  const container = document.createElement('div')
  container.innerHTML = renderToString(ui)
  const serverText = container.textContent ?? ''

  setRuntimeLocale(browserRuntime, 'Pacific/Kiritimati')
  const errors: unknown[] = []
  let root: ReturnType<typeof hydrateRoot> | undefined
  await act(async () => {
    root = hydrateRoot(container, ui, { onRecoverableError: (error) => errors.push(error) })
  })
  const browserText = container.textContent ?? ''
  await act(async () => root?.unmount())
  return { serverText, browserText, errors }
}

describe('T6 the analytics bar list, server render and hydration', () => {
  it('shows the same German grouping on the server and in the browser (T6)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1_000, max: 999_999_999 }),
        anyRuntimeLocale,
        anyRuntimeLocale,
        async (count, serverRuntime, browserRuntime) => {
          const list = inLocale(
            'de',
            <AnalyticsBarList
              header={{ label: 'Name', value: 'Count' }}
              rows={[{ key: 'a', label: 'Alpha', value: count }]}
            />
          )
          const { serverText, browserText, errors } = await serverThenHydrate(
            list,
            serverRuntime,
            browserRuntime
          )
          const german = new Intl.NumberFormat('de').format(count)

          expect(errors).toEqual([])
          expect(serverText).toBe(browserText)
          expect(serverText).toContain(german)
          expect(withoutGrouping(german, '.')).toBe(String(count))
        }
      ),
      { numRuns: 40 }
    )
  })
})

describe('T6 converted call sites render German grouping', () => {
  it('the changelog top-viewed list groups view counts in German (T6)', () => {
    setRuntimeLocale('en-US', 'UTC')
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Infinity } },
    })
    client.setQueryData(changelogQueries.topViewed().queryKey, [
      { id: 'changelog_1', title: 'Faster search', viewCount: 12_345 },
    ] as never)
    render(
      <QueryClientProvider client={client}>
        <ChangelogTopViewed />
      </QueryClientProvider>,
      { wrapper: GermanIntlWrapper }
    )
    expect(screen.getByText('12.345')).toBeInTheDocument()
    expect(screen.queryByText('12,345')).not.toBeInTheDocument()
  })

  it('the export history groups entity counts in German, in the cell and its title (T6)', () => {
    setRuntimeLocale('en-US', 'UTC')
    const run: ExportRunListItem = {
      id: 'run_1',
      status: 'completed',
      fileName: 'export.zip',
      sizeBytes: 2048,
      entityCounts: { posts: 1_204, votes: 5_632 },
      error: null,
      createdAt: '2026-10-01T10:00:00.000Z',
      finishedAt: '2026-10-01T10:01:00.000Z',
      expiresAt: '2999-01-01T00:00:00.000Z',
    }
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Infinity } },
    })
    client.setQueryData(['export-runs'], [run])
    render(
      <QueryClientProvider client={client}>
        <ExportHistoryList />
      </QueryClientProvider>,
      { wrapper: GermanIntlWrapper }
    )
    const cell = screen.getByText('1.204 posts · 5.632 votes')
    expect(cell.getAttribute('title')).toBe('1.204 posts · 5.632 votes')
  })
})

describe('the formatter follows the page language when it changes', () => {
  it('(T6) a mounted number regroups when the page switches language', () => {
    const view = render(inLocale('en', <Probe value={1234567} />))
    expect(screen.getByTestId('n').textContent).toBe('1,234,567')
    view.rerender(inLocale('de', <Probe value={1234567} />))
    expect(screen.getByTestId('n').textContent).toBe('1.234.567')
  })
})
