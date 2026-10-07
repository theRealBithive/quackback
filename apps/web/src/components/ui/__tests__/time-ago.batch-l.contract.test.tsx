// @vitest-environment happy-dom
/**
 * Relative times ("vor 3 Tagen", "3 days ago") in the page's language.
 *
 * Contract for batch L (upstream #630 16938dc59), confirmed 2026-10-07 --
 * the items this suite pins, verbatim:
 *
 *   T7 Relative times ("3 days ago") are worded in the page's language. Under
 *      45 seconds reads as "now", and a distance rounds to the unit that reads
 *      naturally (45 minutes is "1 hour").
 *   T10 Outside any language provider (emails, pages without one),
 *      formatting falls back to English, as before.
 *
 * "The unit that reads naturally" is pinned without restating the code's
 * thresholds: the label is read back into a count and a unit by matching it
 * against what `Intl.RelativeTimeFormat` writes for every candidate, and then
 * (a) the amount it names is within half a unit of the true distance, (b) a
 * count never reaches the size of the next unit ("60 minutes", "24 hours",
 * "12 months" never appear), and (c) a longer distance never reads as a
 * shorter amount. The two boundaries the contract names, 45 minutes and 26
 * days, are pinned by example.
 *
 * German is the witness language. The compact form ("5m") is checked in
 * Russian and Chinese instead, because German narrow units can be spelled
 * exactly as English ones ("3h"); each such check asserts the two differ.
 */
import { act } from 'react'
import { hydrateRoot } from 'react-dom/client'
import { renderToString } from 'react-dom/server'
import { IntlProvider } from 'react-intl'
import { screen } from '@testing-library/react'
import fc from 'fast-check'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { GermanIntlWrapper, renderInGerman } from '@/test/render-with-intl'
import { restoreRuntimeLocale, setRuntimeLocale } from '@/test/runtime-locale'
import { getShortTimeAgo, getTimeAgo, TimeAgo } from '../time-ago'

const SECOND = 1000
const MINUTE = 60 * SECOND
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR
const YEAR = 365.25 * DAY
const MONTH = YEAR / 12

const NOW = new Date('2026-10-07T12:00:00.000Z')

type Unit = 'minute' | 'hour' | 'day' | 'month' | 'year'

const UNIT_MS: Record<Unit, number> = {
  minute: MINUTE,
  hour: HOUR,
  day: DAY,
  month: MONTH,
  year: YEAR,
}

/** How many of a unit make the next one; a natural count stays below it. */
const NEXT_UNIT_SIZE: Record<Unit, number> = {
  minute: 60,
  hour: 24,
  day: 31,
  month: 12,
  year: Number.POSITIVE_INFINITY,
}

const MAX_COUNT: Record<Unit, number> = { minute: 60, hour: 24, day: 31, month: 12, year: 200 }

afterEach(() => {
  vi.useRealTimers()
  restoreRuntimeLocale()
  delete (navigator as { languages?: readonly string[] }).languages
})

function atNow() {
  vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] })
  vi.setSystemTime(NOW)
}

/** The date that lies `distanceMs` before now (after now for a negative distance). */
function dateAgo(distanceMs: number): Date {
  return new Date(NOW.getTime() - distanceMs)
}

/**
 * Reads a relative label back into a signed count and a unit, by matching it
 * against every label `Intl.RelativeTimeFormat` can write. Null if none match.
 */
function readLabel(label: string, locale: string): { count: number; unit: Unit } | null {
  const formatter = new Intl.RelativeTimeFormat(locale, { numeric: 'always' })
  for (const unit of Object.keys(UNIT_MS) as Unit[]) {
    for (let count = 1; count <= MAX_COUNT[unit]; count++) {
      if (formatter.format(-count, unit) === label) return { count: -count, unit }
      if (formatter.format(count, unit) === label) return { count, unit }
    }
  }
  return null
}

/** Distances from 45 seconds up to 30 years, either side of now. */
const distanceAtLeast45Seconds = fc
  .tuple(fc.integer({ min: 45, max: 30 * 366 * 24 * 3600 }), fc.boolean())
  .map(([seconds, past]) => (past ? seconds : -seconds) * SECOND)

const distanceUnder45Seconds = fc.integer({ min: -44_999, max: 44_999 })

describe('relative times are worded in the page language', () => {
  it('(T7) TimeAgo inside a German provider reads German, on the server and after hydration', async () => {
    atNow()
    const ui = (
      <GermanIntlWrapper>
        <TimeAgo date={dateAgo(3 * DAY)} />
      </GermanIntlWrapper>
    )
    const container = document.createElement('div')
    container.innerHTML = renderToString(ui)
    expect(container.textContent).toBe('vor 3 Tagen')

    const errors: unknown[] = []
    let root!: ReturnType<typeof hydrateRoot>
    await act(async () => {
      root = hydrateRoot(container, ui, { onRecoverableError: (error) => errors.push(error) })
    })

    expect(errors).toEqual([])
    expect(container.textContent).toBe('vor 3 Tagen')
    expect(getTimeAgo(dateAgo(3 * DAY), 'en')).toBe('3 days ago')
    act(() => root.unmount())
  })

  it('(T7) a German page reads German even when the browser prefers French', () => {
    atNow()
    setRuntimeLocale('fr-FR', 'Europe/Paris')
    Object.defineProperty(navigator, 'languages', { configurable: true, get: () => ['fr-FR'] })

    renderInGerman(<TimeAgo date={dateAgo(2 * HOUR)} />)

    expect(screen.getByText('vor 2 Stunden')).toBeInTheDocument()
  })

  it('(T7) every label differs between German and English', () => {
    atNow()
    fc.assert(
      fc.property(fc.oneof(distanceAtLeast45Seconds, distanceUnder45Seconds), (distance) => {
        const date = dateAgo(distance)
        expect(getTimeAgo(date, 'de')).not.toBe(getTimeAgo(date, 'en'))
      }),
      { numRuns: 300 }
    )
  })

  it('(T7) the compact form is worded in the page language', () => {
    atNow()
    const ui = (
      <IntlProvider locale="ru">
        <TimeAgo date={dateAgo(5 * MINUTE)} short />
      </IntlProvider>
    )
    const russian = new Intl.NumberFormat('ru', {
      style: 'unit',
      unit: 'minute',
      unitDisplay: 'narrow',
    }).format(5)

    expect(renderToString(ui)).toContain(`>${russian}</span>`)
    expect(russian).not.toBe('5m')
    expect(getShortTimeAgo(dateAgo(5 * MINUTE), 'en')).toBe('5m')
  })
})

describe('under 45 seconds reads as now', () => {
  it('(T7) "jetzt" in German and "now" in English, before or after now', () => {
    atNow()
    fc.assert(
      fc.property(distanceUnder45Seconds, (distance) => {
        expect(getTimeAgo(dateAgo(distance), 'de')).toBe('jetzt')
        expect(getTimeAgo(dateAgo(distance), 'en')).toBe('now')
      }),
      { numRuns: 200 }
    )
  })

  it('(T7) from 45 seconds on, a label is never "now"', () => {
    atNow()
    fc.assert(
      fc.property(distanceAtLeast45Seconds, (distance) => {
        expect(getTimeAgo(dateAgo(distance), 'de')).not.toBe('jetzt')
        expect(getTimeAgo(dateAgo(distance), 'en')).not.toBe('now')
      }),
      { numRuns: 200 }
    )
  })

  it('(T7) the compact form reads now under a minute, in the page language', () => {
    atNow()
    expect(getShortTimeAgo(dateAgo(30 * SECOND), 'de')).toBe('jetzt')
    expect(getShortTimeAgo(dateAgo(30 * SECOND), 'en')).toBe('now')
  })
})

describe('a distance rounds to the unit that reads naturally', () => {
  it('(T7) the boundaries the contract names', () => {
    atNow()
    const cases: [number, string, string][] = [
      [44 * SECOND, 'jetzt', 'now'],
      [45 * SECOND, 'vor 1 Minute', '1 minute ago'],
      [44 * MINUTE, 'vor 44 Minuten', '44 minutes ago'],
      [45 * MINUTE, 'vor 1 Stunde', '1 hour ago'],
      [25 * DAY, 'vor 25 Tagen', '25 days ago'],
      [26 * DAY, 'vor 1 Monat', '1 month ago'],
      [-2 * DAY, 'in 2 Tagen', 'in 2 days'],
    ]
    for (const [distance, german, english] of cases) {
      expect(getTimeAgo(dateAgo(distance), 'de')).toBe(german)
      expect(getTimeAgo(dateAgo(distance), 'en')).toBe(english)
    }
  })

  it('(T7) the label names the distance to within half a unit, in a natural count', () => {
    atNow()
    fc.assert(
      fc.property(distanceAtLeast45Seconds, (distance) => {
        const label = getTimeAgo(dateAgo(distance), 'de')
        const read = readLabel(label, 'de')

        expect(read, label).not.toBeNull()
        const unitMs = UNIT_MS[read!.unit]
        const namedAmount = -read!.count * unitMs
        expect(Math.abs(namedAmount - distance)).toBeLessThanOrEqual(unitMs / 2)
        expect(Math.abs(read!.count)).toBeLessThan(NEXT_UNIT_SIZE[read!.unit])
        expect(Math.sign(read!.count)).toBe(-Math.sign(distance))
      }),
      { numRuns: 500 }
    )
  })

  it('(T7) a longer distance never reads as a shorter amount', () => {
    atNow()
    const amountOf = (distance: number) => {
      const read = readLabel(getTimeAgo(dateAgo(distance), 'de'), 'de')!
      return Math.abs(read.count) * UNIT_MS[read.unit]
    }
    fc.assert(
      fc.property(
        fc.integer({ min: 45, max: 30 * 366 * 24 * 3600 }),
        fc.integer({ min: 0, max: 400 * 24 * 3600 }),
        (seconds, extra) => {
          const shorter = seconds * SECOND
          const longer = (seconds + extra) * SECOND
          expect(amountOf(longer)).toBeGreaterThanOrEqual(amountOf(shorter))
        }
      ),
      { numRuns: 500 }
    )
  })

  it('(T7) the compact form counts whole units, in the page language', () => {
    atNow()
    const narrow = (unit: string, value: number) =>
      new Intl.NumberFormat('zh-cn', { style: 'unit', unit, unitDisplay: 'narrow' }).format(value)
    fc.assert(
      fc.property(fc.integer({ min: 60, max: 60 * 24 * 3600 }), (seconds) => {
        const label = getShortTimeAgo(dateAgo(seconds * SECOND), 'zh-cn')
        const minutes = Math.floor(seconds / 60)
        const hours = Math.floor(minutes / 60)
        const days = Math.floor(hours / 24)
        let expected = narrow('day', days)
        if (minutes < 60) expected = narrow('minute', minutes)
        else if (hours < 24) expected = narrow('hour', hours)

        expect(label).toBe(expected)
        expect(label).not.toBe(getShortTimeAgo(dateAgo(seconds * SECOND), 'en'))
      }),
      { numRuns: 300 }
    )
  })
})

describe('outside any language provider', () => {
  it('(T10) TimeAgo is English on the server and after hydration in a German browser', async () => {
    atNow()
    Object.defineProperty(navigator, 'languages', { configurable: true, get: () => ['de-DE'] })
    const ui = <TimeAgo date={dateAgo(3 * DAY)} />
    setRuntimeLocale('de-DE', 'Europe/Berlin')
    const container = document.createElement('div')
    container.innerHTML = renderToString(ui)
    expect(container.textContent).toBe('3 days ago')

    const errors: unknown[] = []
    let root!: ReturnType<typeof hydrateRoot>
    await act(async () => {
      root = hydrateRoot(container, ui, { onRecoverableError: (error) => errors.push(error) })
    })

    expect(errors).toEqual([])
    expect(container.textContent).toBe('3 days ago')
    act(() => root.unmount())
  })

  it('(T10) the helpers word English when no language is given', () => {
    atNow()
    setRuntimeLocale('de-DE', 'Europe/Berlin')
    fc.assert(
      fc.property(fc.oneof(distanceAtLeast45Seconds, distanceUnder45Seconds), (distance) => {
        const date = dateAgo(distance)
        expect(getTimeAgo(date)).toBe(getTimeAgo(date, 'en'))
        expect(getShortTimeAgo(date)).toBe(getShortTimeAgo(date, 'en'))
      }),
      { numRuns: 200 }
    )
    expect(getTimeAgo(dateAgo(3 * DAY))).toBe('3 days ago')
    expect(getShortTimeAgo(dateAgo(3 * DAY))).toBe('3d')
  })

  it('(T10) a compact TimeAgo with no provider is English', () => {
    atNow()
    expect(renderToString(<TimeAgo date={dateAgo(5 * MINUTE)} short />)).toContain('>5m</span>')
  })
})
