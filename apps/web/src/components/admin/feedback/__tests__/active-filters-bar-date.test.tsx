// @vitest-environment happy-dom
/**
 * A date filter is a calendar date ("2026-10-01"). Read as a moment it is UTC
 * midnight, which is still Sep 30 in Los Angeles, so the chip must show the
 * day as written, for every viewer.
 */
import { render, screen, cleanup } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { restoreRuntimeLocale, setRuntimeLocale } from '@/test/runtime-locale'
import { ActiveFiltersBar } from '../active-filters-bar'
import type { InboxFilters } from '../use-inbox-filters'

// The chip shows a preset label ("Last 7 days") when the filter happens to
// equal one counted back from today, so the real clock would make this test
// fail on the days its fixture is 1, 7, 30 or 90 days old. Pin today far away.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2027-03-15T12:00:00Z'))
})

afterEach(() => {
  cleanup()
  restoreRuntimeLocale()
  vi.useRealTimers()
})

describe('ActiveFiltersBar date chip', () => {
  it('shows a date filter as the day it names, west of UTC', () => {
    setRuntimeLocale('en-US', 'America/Los_Angeles')
    render(
      <ActiveFiltersBar
        filters={{ dateFrom: '2026-10-01' } as InboxFilters}
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
    expect(screen.getByText(/Oct 1, 2026/)).toBeInTheDocument()
    expect(screen.queryByText(/Sep 30, 2026/)).not.toBeInTheDocument()
  })
})
