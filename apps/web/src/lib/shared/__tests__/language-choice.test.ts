/**
 * The choice a signed-in person makes about the language of the product.
 *
 * The guarantees below are the language card's, in domain language. The three
 * this module holds on its own are L2, L3 and L4 -- what the card can offer,
 * and what it must not quietly drop. The rest are about what the card says and
 * does, and are held in `components/settings/__tests__/language-card.test.tsx`.
 *
 *   L2 "Follow my browser" stays available as a choice, not only as the state
 *      someone starts in: a person who has picked a language can give the
 *      choice back to their browser. (V2)
 *   L3 The card offers every language the product is translated into, each
 *      named in that language, so a reader can find their own without already
 *      reading ours. (V3)
 *   L4 A person whose stored language is one the product is not translated
 *      into still finds that language selected when they open the card, and
 *      opening the card does not discard it. (V3)
 *
 * L4 is the reason this module exists as its own thing. The stored column is
 * deliberately any BCP-47 tag, because inbox translation has to reach
 * languages the interface will never speak; a picker built only from the nine
 * we ship shows an empty box to whoever stored one of the others, and the
 * first touch overwrites it.
 */
import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import { SUPPORTED_LOCALES } from '../i18n'
import {
  BROWSER_LANGUAGE_VALUE,
  SUPPORTED_LOCALE_LABELS,
  languageOptions,
  optionToPreference,
  selectedLanguageValue,
} from '../language-choice'

const values = (stored: string | null, displayLocale = 'en') =>
  languageOptions(stored, displayLocale).map((option) => option.value)

describe('the languages the card can offer', () => {
  it('turns the browser choice back into "no stored preference" (L2)', () => {
    expect(optionToPreference(BROWSER_LANGUAGE_VALUE)).toBeNull()
    expect(optionToPreference('de')).toBe('de')
  })

  it('offers every language the product ships (L3)', () => {
    // The browser choice is not here on purpose: it is a line of copy the card
    // translates, not a language, and the one place that decides its wording
    // should be the place that decides the rest of the card's wording.
    expect(values(null)).toEqual([...SUPPORTED_LOCALES])
  })

  it('names each shipped language in that language (L3)', () => {
    const german = languageOptions(null, 'en').find((option) => option.value === 'de')
    const chinese = languageOptions(null, 'en').find((option) => option.value === 'zh-tw')

    expect(german?.label).toBe('Deutsch')
    expect(chinese?.label).toBe('繁體中文')
  })

  it('marks the shipped languages as shipped (L3)', () => {
    for (const option of languageOptions(null, 'en')) {
      expect(option.shipped).toBe(true)
    }
  })

  it('keeps a stored language we do not ship, and names it (L4)', () => {
    const options = languageOptions('ja', 'en')
    const japanese = options.find((option) => option.value === 'ja')

    expect(japanese).toBeDefined()
    expect(japanese?.label).toBe('Japanese')
    expect(japanese?.shipped).toBe(false)
    expect(selectedLanguageValue('ja')).toBe('ja')
  })

  it('names that language in the language the reader is reading (L4)', () => {
    // Someone can have stored Japanese for their inbox while their browser
    // puts the interface in German -- V3 is exactly that case -- so the entry
    // has to read as German to them, not as English.
    const german = languageOptions('ja', 'de').find((option) => option.value === 'ja')

    expect(german?.label).toBe('Japanisch')
  })

  it('falls back to the raw tag when nothing can name it (L4)', () => {
    // A tag `Intl` refuses outright. The first version of this test used
    // `qqq-ZZ-nonsense`, which is malformed as a language but well-formed as a
    // tag -- `Intl` names it happily, and on top of that names it differently
    // under two runtimes. The guarantee is about the entry never going blank,
    // so the example has to be a tag no runtime can resolve.
    const options = languageOptions('!!', 'en')
    const kept = options.find((option) => option.value === '!!')

    expect(kept?.label).toBe('!!')
    expect(kept?.shipped).toBe(false)
    expect(selectedLanguageValue('!!')).toBe('!!')
  })

  it('does not offer a second entry for a stored tag that is a shipped language (L4)', () => {
    // `de-DE` is German. Adding it beside `de` would offer "Deutsch" twice and
    // make the two disagree about which one is selected.
    expect(values('de-DE')).toEqual([...SUPPORTED_LOCALES])
    expect(selectedLanguageValue('de-DE')).toBe('de')
  })

  it('treats an empty or blank stored value as no choice at all (L2)', () => {
    expect(selectedLanguageValue('')).toBe(BROWSER_LANGUAGE_VALUE)
    expect(selectedLanguageValue('   ')).toBe(BROWSER_LANGUAGE_VALUE)
    expect(values('   ')).toEqual([...SUPPORTED_LOCALES])
  })

  it('selects the browser choice when nothing is stored (L2)', () => {
    expect(selectedLanguageValue(null)).toBe(BROWSER_LANGUAGE_VALUE)
  })

  it('has a label for every language it ships (L3)', () => {
    for (const locale of SUPPORTED_LOCALES) {
      expect(SUPPORTED_LOCALE_LABELS[locale].trim().length).toBeGreaterThan(0)
    }
    expect(Object.keys(SUPPORTED_LOCALE_LABELS).sort()).toEqual([...SUPPORTED_LOCALES].sort())
  })
})

describe('the choice holds for anything the column can hold', () => {
  const storedTag = fc.oneof(fc.constant(null), fc.string())
  const readerLocale = fc.oneof(fc.constantFrom(...SUPPORTED_LOCALES), fc.string())

  it('always shows something the card has an entry for (L4)', () => {
    // The failure this rules out is the whole point of L4: a `value` the
    // `<Select>` has no item for renders an empty box, and the next touch
    // writes over whatever was stored. One unguarded expression on purpose --
    // it holds for a shipped language, an unshipped one, and no preference
    // alike, and the card renders exactly these two sources of entries.
    fc.assert(
      fc.property(storedTag, (stored) => {
        const shown = selectedLanguageValue(stored)
        expect(shown === BROWSER_LANGUAGE_VALUE || values(stored).includes(shown)).toBe(true)
      })
    )
  })

  it('always offers all nine shipped languages (L3)', () => {
    fc.assert(
      fc.property(storedTag, (stored) => {
        const offered = values(stored)
        for (const locale of SUPPORTED_LOCALES) {
          expect(offered).toContain(locale)
        }
      })
    )
  })

  it('never offers the same language twice (L4)', () => {
    fc.assert(
      fc.property(storedTag, (stored) => {
        const offered = values(stored)
        expect(new Set(offered).size).toBe(offered.length)
      })
    )
  })

  it('never offers an entry a reader cannot read (L3, L4)', () => {
    fc.assert(
      fc.property(storedTag, readerLocale, (stored, displayLocale) => {
        for (const option of languageOptions(stored, displayLocale)) {
          expect(option.label.trim().length).toBeGreaterThan(0)
        }
      })
    )
  })

  it('shows again what it was just told to store (L2, L4)', () => {
    // Picking the entry that is already selected has to leave the card
    // showing that same entry -- otherwise a choice appears to have been lost
    // the moment the page comes back.
    fc.assert(
      fc.property(storedTag, (stored) => {
        const shown = selectedLanguageValue(stored)
        expect(selectedLanguageValue(optionToPreference(shown))).toBe(shown)
      })
    )
  })
})
