// @vitest-environment happy-dom
/**
 * The shared render helper for component suites.
 *
 * These are guarantees about test infrastructure rather than about the
 * product, so they are numbered T and not V: the product contract for the
 * language work is V1-V16 and lives beside the code it constrains.
 *
 * T1 A component under test renders the English text the application actually
 *    ships, not the fallback written beside the message id -- so a passing
 *    assertion is evidence about what a user is shown.
 * T2 A message the component cannot format -- a placeholder the caller never
 *    supplied, a malformed pattern -- fails the test that renders it, instead
 *    of degrading quietly into a console line nobody reads.
 * T3 A message id that no catalogue defines renders its English fallback and
 *    does not fail the test. That is a finding about the repository, reported
 *    once by the i18n gate, not once per test that happens to render the id.
 *    This is the one guarantee here the helper inherits rather than enforces:
 *    react-intl reports a missing translation only when the active locale
 *    differs from the default one, and this renders under `en`, which is both.
 *    There is therefore no code in the helper for a mutant to break -- the
 *    test pins the behaviour so that changing the locale or the provider here
 *    cannot take it away without a red suite saying so.
 * T4 A number or a date a component renders is formatted for English, the
 *    language of the text around it -- the test-side reflection of V11, and
 *    what stops the helper from claiming a locale it does not actually apply.
 * T5 A component rendered under a second shipped language shows that
 *    language's catalogue text. This is the whole reason the localised
 *    wrappers exist: English rendering cannot tell a translated surface from
 *    an untranslated one, because the `defaultMessage` beside every id is the
 *    English a surface renders when nobody translated it.
 * T6 Under a second language, a message id that catalogue does not define
 *    fails the test that renders it -- the exact opposite of T3, and on
 *    purpose. Every "the German text proves the catalogue was consulted" test
 *    in this repository rests on that asymmetry, so it is pinned here rather
 *    than inherited from react-intl and assumed.
 * T7 Every way of reaching a language mounts the same language: the wrapper
 *    factory, the ready-made German wrapper beside it, and both render
 *    helpers. A helper that named one language and mounted another would let
 *    a suite read as evidence about German while proving nothing.
 * T8 A number rendered under a second language is formatted for that
 *    language, not merely surrounded by its words -- T4 from the other side,
 *    and what shows the `locale` is applied and not only the `messages`.
 *
 * Every `id` below is a variable rather than a string literal, on purpose:
 * `bun run intl:extract` globs `src/**` including this file, and a literal id
 * here would be extracted into the shipped catalogue.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { FormattedMessage, FormattedNumber } from 'react-intl'
import enMessages from '@/locales/en.json'
import deMessages from '@/locales/de.json'
import frMessages from '@/locales/fr.json'
import {
  GermanIntlWrapper,
  IntlWrapperFor,
  renderInGerman,
  renderInLocale,
  renderWithIntl,
} from '../render-with-intl'

afterEach(cleanup)

const catalogue = enMessages as Record<string, string>
const german = deMessages as Record<string, string>
const french = frMessages as Record<string, string>

/** An id the shipped catalogue defines. The expected text is read back from
 *  the catalogue rather than repeated here, so a reworded string moves the
 *  test with it instead of breaking it. */
const DEFINED_ID = 'common.cancel'
const UNDEFINED_ID = 'test.render-with-intl.no-such-message'

describe('renderWithIntl', () => {
  it('renders the shipped catalogue text, not the fallback beside the id (T1)', () => {
    // Without this the test would still pass against an empty catalogue and
    // prove nothing, so the id's presence is asserted rather than assumed.
    expect(catalogue[DEFINED_ID]).toBeTruthy()

    renderWithIntl(<FormattedMessage id={DEFINED_ID} defaultMessage="fallback must not render" />)

    expect(screen.getByText(catalogue[DEFINED_ID])).toBeInTheDocument()
    expect(screen.queryByText('fallback must not render')).toBeNull()
  })

  it('ignores the fallback entirely for an id the catalogue defines (T1)', () => {
    renderWithIntl(<FormattedMessage id={DEFINED_ID} defaultMessage="one fallback" />)
    const rendered = document.body.textContent
    cleanup()

    renderWithIntl(<FormattedMessage id={DEFINED_ID} defaultMessage="a different fallback" />)

    expect(document.body.textContent).toBe(rendered)
  })

  it('renders the English fallback for an id no catalogue defines (T3)', () => {
    // This costs the helper nothing to hold: react-intl reports a missing
    // translation only when the active locale differs from the default, and
    // the provider renders under `en`, which is both. So the id never reaches
    // `failOnIntlError` at all -- there is deliberately no carve-out there.
    expect(catalogue[UNDEFINED_ID]).toBeUndefined()

    renderWithIntl(<FormattedMessage id={UNDEFINED_ID} defaultMessage="Readable English" />)

    expect(screen.getByText('Readable English')).toBeInTheDocument()
  })

  it('fails the test when a message cannot be formatted (T2)', () => {
    expect(() =>
      renderWithIntl(<FormattedMessage id={UNDEFINED_ID} defaultMessage="Hello {name}" />)
    ).toThrow()
  })

  it('formats numbers for English rather than another locale (T4)', () => {
    // English groups with commas and points the decimal; German is the exact
    // mirror ('1.234,5'), so this fails loudly if the provider ever renders
    // under a locale other than the one it claims.
    renderWithIntl(
      <span>
        <FormattedNumber value={1234.5} />
      </span>
    )

    expect(screen.getByText('1,234.5')).toBeInTheDocument()
  })
})

describe('rendering under a second language', () => {
  it('shows that language’s catalogue text rather than the English fallback (T5)', () => {
    // Asserted rather than assumed: if the three catalogues happened to agree
    // on this id, every test below would hold against a helper that mounted
    // English and named it German.
    expect(new Set([catalogue[DEFINED_ID], german[DEFINED_ID], french[DEFINED_ID]]).size).toBe(3)

    renderInGerman(<FormattedMessage id={DEFINED_ID} defaultMessage="fallback must not render" />)

    expect(screen.getByText(german[DEFINED_ID])).toBeInTheDocument()
    expect(screen.queryByText(catalogue[DEFINED_ID])).toBeNull()
  })

  it('reaches any shipped language it is asked for, not only German (T5)', () => {
    renderInLocale('fr', <FormattedMessage id={DEFINED_ID} defaultMessage="fallback" />)

    expect(screen.getByText(french[DEFINED_ID])).toBeInTheDocument()
  })

  it('fails the test for an id that language does not define (T6)', () => {
    // The opposite of T3, and the asymmetry every second-language test in this
    // repository is built on. Under `en` the same id renders its fallback and
    // the suite stays green; under `de` react-intl reports the missing entry
    // and `failOnIntlError` turns it into this throw.
    expect(german[UNDEFINED_ID]).toBeUndefined()

    expect(() =>
      renderInGerman(<FormattedMessage id={UNDEFINED_ID} defaultMessage="Readable English" />)
    ).toThrow()
  })

  it('mounts the same language whichever way it is reached (T7)', () => {
    // `GermanIntlWrapper` is a second path to German -- the batch's component
    // suites pass it to `renderHook`, which takes a wrapper and not an
    // element -- so it is possible for it to name one language and mount
    // another without any of those suites noticing.
    const readBack = (result: { unmount: () => void }) => {
      const text = document.body.textContent
      result.unmount()
      return text
    }

    const viaWrapper = readBack(
      render(<FormattedMessage id={DEFINED_ID} defaultMessage="fallback" />, {
        wrapper: GermanIntlWrapper,
      })
    )
    const viaFactory = readBack(
      render(<FormattedMessage id={DEFINED_ID} defaultMessage="fallback" />, {
        wrapper: IntlWrapperFor('de'),
      })
    )
    const viaHelper = readBack(
      renderInGerman(<FormattedMessage id={DEFINED_ID} defaultMessage="fallback" />)
    )

    expect(viaWrapper).toBe(german[DEFINED_ID])
    expect(viaFactory).toBe(german[DEFINED_ID])
    expect(viaHelper).toBe(german[DEFINED_ID])
  })

  it('formats numbers for the language it mounted (T8)', () => {
    // The exact mirror of the English case above: German groups with points
    // and commas the decimal. A helper that passed the German catalogue under
    // an English locale would translate the words and still print '1,234.5'.
    renderInGerman(
      <span>
        <FormattedNumber value={1234.5} />
      </span>
    )

    expect(screen.getByText('1.234,5')).toBeInTheDocument()
  })
})
