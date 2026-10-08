// @vitest-environment happy-dom
/**
 * Absolute dates across the server render, the hydrating browser and the
 * page after hydration.
 *
 * Contract for batch L (upstream #625 372fcb6f2, #627 f560647f7, #630
 * 16938dc59), confirmed 2026-10-07 -- the items this suite pins, verbatim:
 *
 *   T1 An absolute date or time reads the same in the server's markup and in
 *      the browser's first render, so a page never fails to hydrate because
 *      of a date.
 *   T2 Once the page has hydrated, an absolute moment is shown in the
 *      viewer's own time zone.
 *   T3 Dates are written in the page's language from the first render. The
 *      viewer's browser may choose the regional form of that language (en-GB
 *      rather than en-US), never another language.
 *   T10 Outside any language provider (emails, pages without one),
 *      formatting falls back to English, as before.
 *
 * Fork note on T3: upstream switches to the browser's regional form of the
 * page language after hydration (`viewerLocaleFor`). The fork removed that,
 * because the language is decided once, in bootstrap. T3 permits a regional
 * form, it does not require one, so here both renders use exactly the page's
 * language and a browser preference changes nothing.
 *
 * The server and the browser are two runtimes in one process:
 * `setRuntimeLocale` stands in for the default locale and time zone of each,
 * so the server renders in one zone and language and the browser hydrates in
 * another. The zones sit on both sides of UTC and include a half-hour offset
 * and the two date-line extremes, so a moment near midnight lands on
 * different days on the two sides.
 */
import { act, useEffect, type ReactElement } from 'react'
import { hydrateRoot } from 'react-dom/client'
import { renderToString } from 'react-dom/server'
import { IntlProvider } from 'react-intl'
import fc from 'fast-check'
import { render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { SUPPORTED_LOCALES } from '@/lib/shared/i18n'
import { GermanIntlWrapper } from '@/test/render-with-intl'
import { formatIn, restoreRuntimeLocale, setRuntimeLocale } from '@/test/runtime-locale'
import {
  CalendarDate,
  formatFirstRenderDate,
  formatViewerDate,
  LocalDate,
  NUMERIC_DATE_TIME,
  useLocalDateFormatter,
} from '../local-date'

const ZONES = [
  'UTC',
  'Pacific/Kiritimati', // UTC+14
  'Pacific/Pago_Pago', // UTC-11
  'Asia/Kolkata', // UTC+5:30
  'America/Los_Angeles',
  'Europe/Berlin',
] as const

const RUNTIME_LOCALES = ['en-US', 'en-GB', 'de-DE', 'fr-FR', 'ja-JP', 'ar-EG'] as const

const DAY: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', year: 'numeric' }
const TIME: Intl.DateTimeFormatOptions = { hour: 'numeric', minute: '2-digit' }
const WEEKDAY_IN_NEW_YORK: Intl.DateTimeFormatOptions = {
  weekday: 'long',
  hour: 'numeric',
  timeZone: 'America/New_York',
}
const OPTION_SHAPES = [DAY, TIME, NUMERIC_DATE_TIME, WEEKDAY_IN_NEW_YORK, undefined] as const

// 20:30 UTC on Oct 1 is Oct 2 in Kiritimati and still Oct 1 in Pago Pago.
const AT = '2026-10-01T20:30:00.000Z'

afterEach(restoreRuntimeLocale)
afterEach(() => {
  delete (navigator as { languages?: readonly string[] }).languages
})

function setPreferredLanguages(languages: readonly string[]) {
  Object.defineProperty(navigator, 'languages', { configurable: true, get: () => languages })
}

/** Moments over two centuries, in whole minutes, so near-midnight values occur. */
const moment = fc
  .integer({ min: Date.UTC(1990, 0, 1) / 60_000, max: Date.UTC(2090, 0, 1) / 60_000 })
  .map((minutes) => new Date(minutes * 60_000).toISOString())

const runtime = fc.record({
  locale: fc.constantFrom(...RUNTIME_LOCALES),
  timeZone: fc.constantFrom(...ZONES),
})

/** A page language, or none: the nine shipped locales plus "no provider". */
const pageLanguage = fc.option(fc.constantFrom(...SUPPORTED_LOCALES), { nil: undefined })

const optionShape = fc.constantFrom(...OPTION_SHAPES)

function inPage(language: string | undefined, ui: ReactElement): ReactElement {
  if (language === undefined) return ui
  return <IntlProvider locale={language}>{ui}</IntlProvider>
}

/** Records what the formatter hook returns on every render, in order. */
function HookProbe({
  date,
  options,
  seen,
}: {
  date: string
  options?: Intl.DateTimeFormatOptions
  seen: string[]
}) {
  const format = useLocalDateFormatter()
  const text = format(date, options)
  seen.push(text)
  return <span data-probe="hook">{text}</span>
}

/**
 * Reads the DOM after the hydrating render committed and before any later
 * render: its effect runs once, on mount, before the post-hydration update
 * has been rendered.
 */
function FirstCommitReader({ onFirstCommit }: { onFirstCommit: () => void }) {
  useEffect(() => {
    onFirstCommit()
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- runs once, on mount
  }, [])
  return null
}

interface Hydration {
  serverText: string
  firstClientText: string
  textAfterHydration: string
  hookRenders: string[]
  errors: unknown[]
  unmount: () => void
}

/**
 * Server-renders a `<LocalDate>` and a formatter-hook probe as one runtime,
 * then hydrates them as another. Every call builds its own container and
 * restores the runtime before returning its result to the caller.
 */
async function serverThenHydrate(params: {
  date: string
  options?: Intl.DateTimeFormatOptions
  language: string | undefined
  server: { locale: string; timeZone: string }
  browser: { locale: string; timeZone: string }
  wrap?: (ui: ReactElement) => ReactElement
}): Promise<Hydration> {
  const wrap = params.wrap ?? ((ui: ReactElement) => inPage(params.language, ui))
  const hookRenders: string[] = []
  const serverHookRenders: string[] = []
  const tree = (seen: string[], onFirstCommit: () => void) =>
    wrap(
      <div>
        <FirstCommitReader onFirstCommit={onFirstCommit} />
        <LocalDate date={params.date} options={params.options} />
        <HookProbe date={params.date} options={params.options} seen={seen} />
      </div>
    )
  const readText = (container: HTMLElement) => {
    const time = container.querySelector('time')?.textContent ?? ''
    const hook = container.querySelector('[data-probe="hook"]')?.textContent ?? ''
    return `${time}|${hook}`
  }

  setRuntimeLocale(params.server.locale, params.server.timeZone)
  const container = document.createElement('div')
  container.innerHTML = renderToString(tree(serverHookRenders, () => {}))
  const serverText = readText(container)

  setRuntimeLocale(params.browser.locale, params.browser.timeZone)
  const errors: unknown[] = []
  let firstClientText = ''
  let root!: ReturnType<typeof hydrateRoot>
  await act(async () => {
    root = hydrateRoot(
      container,
      tree(hookRenders, () => {
        firstClientText = readText(container)
      }),
      { onRecoverableError: (error) => errors.push(error) }
    )
  })
  const textAfterHydration = readText(container)
  restoreRuntimeLocale()

  return {
    serverText,
    firstClientText,
    textAfterHydration,
    hookRenders,
    errors,
    unmount: () => act(() => root.unmount()),
  }
}

/** The text both leaves show: `<time>` and the hook probe format the same. */
function both(text: string): string {
  return `${text}|${text}`
}

/** The zone a moment is shown in after hydration: the one the options name, else the viewer's. */
function shownZone(options: Intl.DateTimeFormatOptions | undefined, viewerZone: string): string {
  return options?.timeZone ?? viewerZone
}

describe('the first render is the same on the server and in the browser', () => {
  it('(T1) for every moment, page language, option shape and pair of runtimes', async () => {
    await fc.assert(
      fc.asyncProperty(
        moment,
        pageLanguage,
        optionShape,
        runtime,
        runtime,
        async (date, language, options, server, browser) => {
          const hydration = await serverThenHydrate({ date, options, language, server, browser })

          expect(hydration.errors).toEqual([])
          expect(hydration.firstClientText).toBe(hydration.serverText)
          expect(hydration.hookRenders[0]).toBe(hydration.serverText.split('|')[1])
          expect(hydration.serverText).not.toBe('|')

          hydration.unmount()
        }
      ),
      { numRuns: 60 }
    )
  })

  it('(T1) the server markup does not depend on the server runtime at all', () => {
    fc.assert(
      fc.property(
        moment,
        pageLanguage,
        optionShape,
        runtime,
        runtime,
        (date, language, options, a, b) => {
          const ui = inPage(language, <LocalDate date={date} options={options} />)
          setRuntimeLocale(a.locale, a.timeZone)
          const fromA = renderToString(ui)
          setRuntimeLocale(b.locale, b.timeZone)
          const fromB = renderToString(ui)
          restoreRuntimeLocale()

          expect(fromA).toBe(fromB)
        }
      ),
      { numRuns: 100 }
    )
  })

  it('(T1) a moment on different days east and west of UTC still hydrates cleanly', async () => {
    // Witness that the runtimes really disagree here: Oct 2 in the browser, Oct 1 on the server.
    expect(formatIn('en-US', 'Pacific/Kiritimati', AT, DAY)).toBe('Oct 2, 2026')
    expect(formatIn('en-US', 'Pacific/Pago_Pago', AT, DAY)).toBe('Oct 1, 2026')

    const hydration = await serverThenHydrate({
      date: AT,
      options: DAY,
      language: 'en',
      server: { locale: 'en-US', timeZone: 'Pacific/Pago_Pago' },
      browser: { locale: 'en-US', timeZone: 'Pacific/Kiritimati' },
    })

    expect(hydration.errors).toEqual([])
    expect(hydration.serverText).toBe(both('Oct 1, 2026'))
    expect(hydration.firstClientText).toBe(both('Oct 1, 2026'))
    expect(hydration.textAfterHydration).toBe(both('Oct 2, 2026'))
    hydration.unmount()
  })
})

describe("after hydration the moment is in the viewer's zone", () => {
  it('(T2) for every moment, page language, option shape and pair of runtimes', async () => {
    await fc.assert(
      fc.asyncProperty(
        moment,
        fc.constantFrom(...SUPPORTED_LOCALES),
        optionShape,
        runtime,
        runtime,
        async (date, language, options, server, browser) => {
          const hydration = await serverThenHydrate({ date, options, language, server, browser })
          const zone = shownZone(options, browser.timeZone)

          expect(hydration.textAfterHydration).toBe(both(formatIn(language, zone, date, options)))

          hydration.unmount()
        }
      ),
      { numRuns: 60 }
    )
  })

  it('(T2) a zone the options name is kept, whatever the viewer zone', async () => {
    const hydration = await serverThenHydrate({
      date: AT,
      options: WEEKDAY_IN_NEW_YORK,
      language: 'en',
      server: { locale: 'en-US', timeZone: 'UTC' },
      browser: { locale: 'en-US', timeZone: 'Pacific/Kiritimati' },
    })

    expect(hydration.serverText).toBe(both('Thursday 4 PM'))
    expect(hydration.textAfterHydration).toBe(both('Thursday 4 PM'))
    hydration.unmount()
  })
})

describe("dates are in the page's language", () => {
  it('(T3) a German page reads German in both renders, whatever the browser prefers', async () => {
    const preferences = [['fr-FR', 'fr'], ['de-AT', 'de'], ['en-US'], ['de-CH']]
    for (const preferred of preferences) {
      setPreferredLanguages(preferred)
      const hydration = await serverThenHydrate({
        date: AT,
        options: DAY,
        language: 'de',
        wrap: (ui) => <GermanIntlWrapper>{ui}</GermanIntlWrapper>,
        server: { locale: 'en-US', timeZone: 'America/Los_Angeles' },
        // The browser's own runtime speaks the preferred language too.
        browser: { locale: preferred[0], timeZone: 'Pacific/Kiritimati' },
      })

      expect(hydration.errors).toEqual([])
      expect(hydration.serverText).toBe(both(formatIn('de', 'UTC', AT, DAY)))
      expect(hydration.firstClientText).toBe(both(formatIn('de', 'UTC', AT, DAY)))
      expect(hydration.textAfterHydration).toBe(both(formatIn('de', 'Pacific/Kiritimati', AT, DAY)))
      hydration.unmount()
    }

    // The witnesses: German differs from what the browser's languages would write.
    expect(formatIn('de', 'Pacific/Kiritimati', AT, DAY)).toBe('2. Okt. 2026')
    expect(formatIn('fr-FR', 'Pacific/Kiritimati', AT, DAY)).not.toBe('2. Okt. 2026')
    expect(formatIn('en-US', 'Pacific/Kiritimati', AT, DAY)).not.toBe('2. Okt. 2026')
  })

  it('(T3) a regional preference of the page language does not change the text', async () => {
    // Austrian German names January "Jänner"; the page's German says "Januar".
    const january = '2027-01-15T12:00:00.000Z'
    const longDay: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'long', year: 'numeric' }
    expect(formatIn('de-AT', 'UTC', january, longDay)).toBe('15. Jänner 2027')
    setPreferredLanguages(['de-AT', 'de'])

    const hydration = await serverThenHydrate({
      date: january,
      options: longDay,
      language: 'de',
      wrap: (ui) => <GermanIntlWrapper>{ui}</GermanIntlWrapper>,
      server: { locale: 'de-DE', timeZone: 'UTC' },
      browser: { locale: 'de-AT', timeZone: 'Europe/Vienna' },
    })

    expect(hydration.errors).toEqual([])
    expect(hydration.serverText).toBe(both('15. Januar 2027'))
    expect(hydration.textAfterHydration).toBe(both('15. Januar 2027'))
    hydration.unmount()
  })

  it('(T3) for every page language the text is in that language, never the runtime one', async () => {
    await fc.assert(
      fc.asyncProperty(
        moment,
        fc.constantFrom(...SUPPORTED_LOCALES),
        runtime,
        runtime,
        async (date, language, server, browser) => {
          const hydration = await serverThenHydrate({
            date,
            options: NUMERIC_DATE_TIME,
            language,
            server,
            browser,
          })

          expect(hydration.serverText).toBe(
            both(formatIn(language, 'UTC', date, NUMERIC_DATE_TIME))
          )
          expect(hydration.textAfterHydration).toBe(
            both(formatIn(language, browser.timeZone, date, NUMERIC_DATE_TIME))
          )
          hydration.unmount()
        }
      ),
      { numRuns: 40 }
    )
  })
})

describe('outside any language provider', () => {
  it('(T10) a server render with no provider is English, whatever the server runtime', () => {
    fc.assert(
      fc.property(moment, optionShape, runtime, (date, options, server) => {
        setRuntimeLocale(server.locale, server.timeZone)
        const html = renderToString(<LocalDate date={date} options={options} />)
        restoreRuntimeLocale()

        const expected = formatIn('en-US', options?.timeZone ?? 'UTC', date, options)
        expect(html).toContain(`>${expected}</time>`)
      }),
      { numRuns: 100 }
    )
  })

  it('(T10) a page with no provider stays English after hydration in a German browser', async () => {
    setPreferredLanguages(['de-DE', 'de'])
    const hydration = await serverThenHydrate({
      date: AT,
      options: DAY,
      language: undefined,
      server: { locale: 'en-GB', timeZone: 'America/Los_Angeles' },
      browser: { locale: 'de-DE', timeZone: 'Pacific/Kiritimati' },
    })

    expect(hydration.errors).toEqual([])
    expect(hydration.serverText).toBe(both('Oct 1, 2026'))
    expect(hydration.textAfterHydration).toBe(both('Oct 2, 2026'))
    expect(formatIn('de-DE', 'Pacific/Kiritimati', AT, DAY)).not.toBe('Oct 2, 2026')
    hydration.unmount()
  })

  it('(T10) the formatter hook outside a provider formats English in both renders', async () => {
    await fc.assert(
      fc.asyncProperty(
        moment,
        optionShape,
        runtime,
        runtime,
        async (date, options, server, browser) => {
          const hydration = await serverThenHydrate({
            date,
            options,
            language: undefined,
            server,
            browser,
          })
          const zone = shownZone(options, browser.timeZone)

          expect(hydration.serverText).toBe(
            both(formatIn('en-US', options?.timeZone ?? 'UTC', date, options))
          )
          expect(hydration.textAfterHydration).toBe(both(formatIn('en-US', zone, date, options)))
          hydration.unmount()
        }
      ),
      { numRuns: 40 }
    )
  })
})

describe('values that are not a moment', () => {
  const NOT_A_MOMENT = [null, undefined, '', 'not a date', new Date(Number.NaN)] as const

  it('(T1) both formatters answer an empty string for a missing or invalid date', () => {
    for (const value of NOT_A_MOMENT) {
      expect(formatFirstRenderDate(value)).toBe('')
      expect(formatViewerDate(value)).toBe('')
    }
  })

  it('(T1) <LocalDate> renders nothing for a missing or invalid date', () => {
    for (const value of NOT_A_MOMENT) {
      expect(renderToString(<LocalDate date={value} />)).toBe('')
    }
  })

  it('(T2) a date with no options shows the time of day too, down to the second', () => {
    const shown = formatFirstRenderDate(AT, NUMERIC_DATE_TIME)
    expect(shown).toMatch(/10\/1\/2026/)
    expect(shown).toMatch(/8:30:00/)
  })
})

describe('<CalendarDate>', () => {
  it('(T5) shows a value that is not a calendar day exactly as given', () => {
    expect(renderToString(<CalendarDate value="soon" />)).toBe('soon')
    expect(renderToString(<CalendarDate value="2026-02-31" />)).toBe('2026-02-31')
  })

  it('(T5) shows the named day to a viewer on either side of the date line, after hydration', () => {
    for (const timeZone of ['Pacific/Pago_Pago', 'Pacific/Kiritimati', 'America/Los_Angeles']) {
      setRuntimeLocale('en-US', timeZone)
      const { container, unmount } = render(<CalendarDate value="2026-10-01" options={DAY} />)
      expect(container.textContent).toBe('Oct 1, 2026')
      unmount()
      restoreRuntimeLocale()
    }
  })

  it('(T5) names the day even when the options ask for another zone', () => {
    setRuntimeLocale('en-US', 'Pacific/Pago_Pago')
    const { container, unmount } = render(
      <CalendarDate value="2026-10-01" options={{ ...DAY, timeZone: 'Pacific/Pago_Pago' }} />
    )
    expect(container.textContent).toBe('Oct 1, 2026')
    unmount()
  })

  it('(T3) writes the day in the language it is given', () => {
    const german = renderToString(<CalendarDate value="2026-10-01" options={DAY} locale="de" />)
    const english = renderToString(<CalendarDate value="2026-10-01" options={DAY} locale="en" />)
    expect(german).not.toBe(english)
    expect(german).toContain('2026')
    expect(german).toContain('Okt')
  })
})
