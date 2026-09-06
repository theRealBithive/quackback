// @vitest-environment node
/**
 * Which language the portal renders in.
 *
 * Contract (domain language; V numbers from the confirmed language contract):
 *
 *   V5 The language a page declares to a browser or a screen reader is always
 *      the language its text is actually written in.
 *
 * The mechanism that holds V5 is that there is exactly **one** place the
 * interface language is decided. The document's `<html lang>` is built from
 * the locale the request bootstrap resolved -- which knows the teammate's own
 * choice as well as their browser's header -- while the portal used to resolve
 * a second locale of its own from the header alone. Two resolvers agreeing
 * today is not a guarantee; the moment a teammate picks a language they
 * disagree, and the page says `lang="de"` over French text.
 *
 * So the guarantee under test is stated as: the portal renders in the locale
 * it is handed, and offers no way to resolve one for itself.
 */
import { describe, it, expect } from 'vitest'
import * as locale from '../locale'

describe('the portal renders in the locale it is given (V5)', () => {
  it('returns the locale it was handed', async () => {
    const intl = await locale.loadPortalIntl('de')
    expect(intl.locale).toBe('de')
  })

  it('loads that locale’s catalogue, not the default one', async () => {
    const german = await locale.loadPortalIntl('de')
    const english = await locale.loadPortalIntl('en')
    const translated = Object.keys(german.messages).filter(
      (key) => german.messages[key] !== english.messages[key]
    )
    expect(translated.length).toBeGreaterThan(100)
  })

  it('returns the portal slice rather than the whole catalogue', async () => {
    const { messages } = await locale.loadPortalIntl('en')
    const keys = Object.keys(messages)
    expect(keys.length).toBeGreaterThan(0)
    expect(keys.every((k) => /^(portal|widget|helpAskAi|ui|common)\./.test(k))).toBe(true)
  })

  it('offers no way to resolve a locale of its own (V5)', () => {
    expect(Object.keys(locale)).toEqual(['loadPortalIntl'])
  })
})
