// @vitest-environment happy-dom
/**
 * A relative age ("5m", "about 1 hour ago") across server render, hydration
 * and the minutes after.
 *
 * Contract for the batch F pick (upstream f63d503f8, #624) -- the confirmed
 * list item this suite pins:
 *
 *   F22 A row's age reads the same in the server render and the first client
 *       render, then switches to the browser's current value and keeps
 *       updating every minute.
 *
 * "The first client render" is observed as the page after the first commit
 * and before any effect of TimeAgo has run: a probe placed before TimeAgo in
 * the tree runs its effect first and reads the text then. The server clock and
 * the browser clock are set apart by a generated drift, so both sides of every
 * minute / hour / day boundary are reached, not one hand-picked pair.
 */
import { act } from 'react'
import { hydrateRoot } from 'react-dom/client'
import { renderToString } from 'react-dom/server'
import { useEffect } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import fc from 'fast-check'
import { formatDistanceToNow } from 'date-fns'
import { TimeAgo } from '../time-ago'

const POSTED = new Date('2026-09-26T10:00:00.000Z')
const MINUTE_MS = 60_000

afterEach(() => vi.useRealTimers())

/** The compact age of the contract: now / Nm / Nh / Nd, whole units rounded down. */
function expectedShortAge(clock: Date): string {
  const minutes = Math.floor((clock.getTime() - POSTED.getTime()) / MINUTE_MS)
  if (minutes < 1) return 'now'
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  return `${Math.floor(hours / 24)}d`
}

function expectedLongAge(clock: Date): string {
  vi.setSystemTime(clock)
  return formatDistanceToNow(POSTED, { addSuffix: true })
}

function ageAt(form: 'short' | 'long', clock: Date): string {
  return form === 'short' ? expectedShortAge(clock) : expectedLongAge(clock)
}

function clockAt(offsetMs: number): Date {
  return new Date(POSTED.getTime() + offsetMs)
}

interface Hydration {
  serverText: string
  textAfterFirstCommit: string
  textAfterHydration: string
  errors: unknown[]
  container: HTMLElement
  unmount: () => void
}

async function serverRenderThenHydrate(
  form: 'short' | 'long',
  serverOffsetMs: number,
  clientOffsetMs: number
): Promise<Hydration> {
  const tree = (probe: () => void) => (
    <div>
      <Probe onFirstCommit={probe} />
      <TimeAgo date={POSTED} short={form === 'short'} />
    </div>
  )

  vi.setSystemTime(clockAt(serverOffsetMs))
  const container = document.createElement('div')
  container.innerHTML = renderToString(tree(() => {}))
  const serverText = container.querySelector('span')!.textContent ?? ''

  vi.setSystemTime(clockAt(clientOffsetMs))
  let textAfterFirstCommit = ''
  const errors: unknown[] = []
  let root!: ReturnType<typeof hydrateRoot>
  await act(async () => {
    root = hydrateRoot(
      container,
      tree(() => {
        textAfterFirstCommit = container.querySelector('span')!.textContent ?? ''
      }),
      { onRecoverableError: (error) => errors.push(error) }
    )
  })

  return {
    serverText,
    textAfterFirstCommit,
    textAfterHydration: container.querySelector('span')!.textContent ?? '',
    errors,
    container,
    unmount: () => act(() => root.unmount()),
  }
}

function Probe({ onFirstCommit }: { onFirstCommit: () => void }) {
  useEffect(() => {
    onFirstCommit()
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- runs once, on mount
  }, [])
  return null
}

const ageForm = fc.constantFrom('short' as const, 'long' as const)
// From just after posting to ~5 days, in whole seconds.
const serverOffsetSeconds = fc.integer({ min: 0, max: 5 * 24 * 3600 })
// The browser hydrates 0..3 hours after the server rendered.
const driftSeconds = fc.integer({ min: 0, max: 3 * 3600 })

describe('TimeAgo across server render and hydration', () => {
  it('(F22) the first client render still shows the server text, then the browser value', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] })

    await fc.assert(
      fc.asyncProperty(ageForm, serverOffsetSeconds, driftSeconds, async (form, server, drift) => {
        const serverOffset = server * 1000
        const clientOffset = serverOffset + drift * 1000
        const expectedAtServer = ageAt(form, clockAt(serverOffset))
        const expectedAtClient = ageAt(form, clockAt(clientOffset))
        const hydration = await serverRenderThenHydrate(form, serverOffset, clientOffset)

        expect(hydration.errors).toEqual([])
        expect(hydration.serverText).toBe(expectedAtServer)
        expect(hydration.textAfterFirstCommit).toBe(hydration.serverText)
        expect(hydration.textAfterHydration).toBe(expectedAtClient)

        hydration.unmount()
      }),
      { numRuns: 40 }
    )
  })

  it('(F22) keeps updating every minute after hydration', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] })

    await fc.assert(
      fc.asyncProperty(
        ageForm,
        serverOffsetSeconds,
        fc.integer({ min: 1, max: 6 }),
        async (form, server, minutesPassed) => {
          const startOffset = server * 1000
          const hydration = await serverRenderThenHydrate(form, startOffset, startOffset)

          for (let minute = 1; minute <= minutesPassed; minute++) {
            await act(async () => {
              vi.advanceTimersByTime(MINUTE_MS)
            })
            const expected = ageAt(form, clockAt(startOffset + minute * MINUTE_MS))
            expect(hydration.container.querySelector('span')!.textContent).toBe(expected)
          }

          hydration.unmount()
        }
      ),
      { numRuns: 25 }
    )
  })

  it('(F22) does not change the text before a minute has passed', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] })
    const startOffset = 4 * MINUTE_MS + 10_000
    const hydration = await serverRenderThenHydrate('short', startOffset, startOffset)
    const before = hydration.container.querySelector('span')!.textContent

    await act(async () => {
      vi.advanceTimersByTime(MINUTE_MS - 1)
    })

    expect(hydration.container.querySelector('span')!.textContent).toBe(before)
    hydration.unmount()
  })

  it('(F22) a browser clock past a boundary replaces the server text (short, long)', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] })

    const short = await serverRenderThenHydrate(
      'short',
      4 * MINUTE_MS + 59_900,
      5 * MINUTE_MS + 400
    )
    expect([short.serverText, short.textAfterFirstCommit, short.textAfterHydration]).toEqual([
      '4m',
      '4m',
      '5m',
    ])
    short.unmount()

    const long = await serverRenderThenHydrate('long', 59 * MINUTE_MS + 10_000, 91 * MINUTE_MS)
    expect([long.serverText, long.textAfterFirstCommit, long.textAfterHydration]).toEqual([
      'about 1 hour ago',
      'about 1 hour ago',
      'about 2 hours ago',
    ])
    long.unmount()
  })
})
