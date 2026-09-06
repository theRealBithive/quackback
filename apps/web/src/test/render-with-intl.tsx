import type { ReactElement, ReactNode } from 'react'
import { render, type RenderResult } from '@testing-library/react'
import { IntlProvider, type IntlConfig } from 'react-intl'
import { DEFAULT_LOCALE } from '@/lib/shared/i18n'
import enMessages from '@/locales/en.json'

/**
 * Fail the test on any intl error.
 *
 * The application's own `onIntlError` carves out MISSING_TRANSLATION and logs
 * the rest. This provider needs no carve-out and deliberately has none:
 * react-intl reports a missing translation only when the active locale
 * differs from the default one, and this renders under `en`, which is both
 * (measured -- `en`/unset and `en`/`en` report nothing, `de`/`en` reports).
 * A carve-out here would be a branch no test could reach, which is how the
 * first draft's was found: the mutation gate reported it as a survivor.
 *
 * It throws where production logs, because `console.error` during a test run
 * is a line nobody reads and a suite that passes anyway -- so a malformed ICU
 * pattern or a placeholder the caller never supplied would survive review
 * (T2). A message id no catalogue defines still costs nothing (T3): it never
 * reaches here, and it degrades to the English written beside it.
 */
const failOnIntlError: NonNullable<IntlConfig['onError']> = (error) => {
  throw error
}

function IntlWrapper({ children }: { children: ReactNode }) {
  return (
    <IntlProvider
      locale={DEFAULT_LOCALE}
      messages={enMessages as Record<string, string>}
      onError={failOnIntlError}
    >
      {children}
    </IntlProvider>
  )
}

/**
 * Render a component under the English message catalogue the application
 * actually ships.
 *
 * Component suites here each mount their own `<IntlProvider messages={{}}>`,
 * which renders the `defaultMessage` written beside every id instead of the
 * catalogue entry. The two agree for all but 27 of the 947 ids they share
 * (measured 2026-09-06), so a suite can pass on wording no user is ever
 * shown. Mounting the real catalogue closes that for every suite using this
 * helper (T1).
 *
 * It provides one thing on purpose. A suite that also needs a QueryClient or
 * a tooltip root nests those inside `ui`, so this never becomes the wrapper
 * that has to know about every provider in the application.
 */
export function renderWithIntl(ui: ReactElement): RenderResult {
  return render(ui, { wrapper: IntlWrapper })
}
