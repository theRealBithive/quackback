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
 * T4 A number or a date a component renders is formatted for English, the
 *    language of the text around it -- the test-side reflection of V11, and
 *    what stops the helper from claiming a locale it does not actually apply.
 *
 * Every `id` below is a variable rather than a string literal, on purpose:
 * `bun run intl:extract` globs `src/**` including this file, and a literal id
 * here would be extracted into the shipped catalogue.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, screen } from '@testing-library/react'
import { FormattedMessage, FormattedNumber } from 'react-intl'
import enMessages from '@/locales/en.json'
import { renderWithIntl } from '../render-with-intl'

afterEach(cleanup)

const catalogue = enMessages as Record<string, string>

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
