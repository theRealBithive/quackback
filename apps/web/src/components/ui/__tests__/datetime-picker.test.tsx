// @vitest-environment happy-dom
/**
 * A date-only pick is stored as noon UTC on the picked day, so it names the
 * same calendar day everywhere. The trigger must show that day in every time
 * zone: noon UTC on Oct 1 is already Oct 2 in Kiritimati (UTC+14).
 *
 * Fork: the picker formats in the app's locale (it reads the IntlProvider), and
 * that locale decides the hour cycle, so English reads "02:00 AM" where
 * upstream pins en-US with a 24-hour clock.
 */
import { screen, cleanup } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { renderWithIntl } from '@/test/render-with-intl'
import { DateTimePicker } from '../datetime-picker'

const realTz = process.env.TZ

beforeEach(() => {
  process.env.TZ = 'Pacific/Kiritimati'
})

afterEach(() => {
  cleanup()
  process.env.TZ = realTz
})

describe('DateTimePicker', () => {
  it('shows a date-only value as its calendar day in any zone', () => {
    renderWithIntl(
      <DateTimePicker value={new Date('2026-10-01T12:00:00.000Z')} onChange={() => {}} dateOnly />
    )
    expect(screen.getByRole('button', { name: /2026/ }).textContent).toContain('Oct 1, 2026')
  })

  it('shows a date and time in the viewer zone', () => {
    renderWithIntl(
      <DateTimePicker value={new Date('2026-10-01T12:00:00.000Z')} onChange={() => {}} />
    )
    expect(screen.getByRole('button', { name: /2026/ }).textContent).toContain(
      'Oct 2, 2026 · 02:00 AM'
    )
  })
})
