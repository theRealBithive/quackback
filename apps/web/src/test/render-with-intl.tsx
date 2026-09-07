import type { ReactElement, ReactNode } from 'react'
import { render, type RenderResult } from '@testing-library/react'
import { IntlProvider, type IntlConfig } from 'react-intl'
import { DEFAULT_LOCALE } from '@/lib/shared/i18n'
import enMessages from '@/locales/en.json'
import deMessages from '@/locales/de.json'
import frMessages from '@/locales/fr.json'

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

/** The same provider, for `renderHook`, which takes a wrapper rather than an
 *  element. A hook that formats a message needs the catalogue as much as a
 *  component does, and mounting a bare `IntlProvider` beside it would be the
 *  empty-catalogue problem this file exists to close. */
export function IntlWrapper({ children }: { children: ReactNode }) {
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

/**
 * The same, under a second shipped catalogue.
 *
 * English rendering cannot tell a translated string from an untranslated one:
 * the `defaultMessage` beside every id is English, so a surface nobody
 * translated still reads correctly. Under a second locale it does not --
 * react-intl reports a missing entry, and `failOnIntlError` turns that into a
 * failing test rather than a console line.
 *
 * German is the usual choice, because it is the one language this fork reads
 * by hand, so a counterexample is one somebody can judge. It is not always the
 * language that can witness a difference, though: German keeps a good many
 * English words ("Feedback", "Support", "Changelog"), and a screen made only
 * of those renders identically whether the catalogue was consulted or not.
 * French is here for those, and picking it is a statement that the German
 * entries are loanwords rather than a gap.
 */
const CATALOGUES: Record<'de' | 'fr', Record<string, string>> = {
  de: deMessages as Record<string, string>,
  fr: frMessages as Record<string, string>,
}

export type TestLocale = keyof typeof CATALOGUES

export function IntlWrapperFor(locale: TestLocale) {
  return function LocalisedIntlWrapper({ children }: { children: ReactNode }) {
    return (
      <IntlProvider
        locale={locale}
        defaultLocale={DEFAULT_LOCALE}
        messages={CATALOGUES[locale]}
        onError={failOnIntlError}
      >
        {children}
      </IntlProvider>
    )
  }
}

export const GermanIntlWrapper = IntlWrapperFor('de')

export function renderInLocale(locale: TestLocale, ui: ReactElement): RenderResult {
  return render(ui, { wrapper: IntlWrapperFor(locale) })
}

export function renderInGerman(ui: ReactElement): RenderResult {
  return renderInLocale('de', ui)
}
