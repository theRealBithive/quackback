// @vitest-environment happy-dom
/**
 * Where the language choice sits.
 *
 *   L10 The card sits on the page a person reaches from their own account
 *       menu, beside the other choices they make about themselves. (V4)
 *
 * The card itself stands in for itself here. What it offers and what it
 * promises is held by `components/settings/__tests__/language-card.test.tsx`;
 * this suite answers the one question that one cannot -- whether a person
 * ever arrives somewhere they can make the choice at all. Before this, the
 * stored language had no writer anywhere in the application.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import '@testing-library/jest-dom/vitest'
import { cleanup, screen } from '@testing-library/react'
import { renderWithIntl } from '@/test/render-with-intl'

vi.mock('@/components/settings/language-card', () => ({
  LanguageCard: () => <h2>Language</h2>,
}))

vi.mock('@/components/settings/notification-matrix-form', () => ({
  NotificationMatrixForm: () => <div />,
}))

vi.mock('@/components/theme-switcher', () => ({
  ThemeSwitcher: () => <div />,
}))

import { PreferencesPage } from '../settings.preferences'

afterEach(cleanup)

describe('the preferences page', () => {
  it('offers the language choice beside the other personal ones (L10)', () => {
    renderWithIntl(<PreferencesPage />)

    const headings = screen
      .getAllByRole('heading', { level: 2 })
      .map((heading) => heading.textContent)

    expect(headings).toEqual(['Appearance', 'Language', 'Notifications'])
  })
})
